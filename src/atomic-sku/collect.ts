import { createHash } from "node:crypto"
import type {
  SupplierAtomicAdapter,
  SupplierProductDetail,
  SupplierProductReference,
} from "./supplier-adapter.js"
import type { AtomicSupplierSku } from "./types.js"

export type SupplierCollectionDiagnostics = {
  readonly supplierId: string
  readonly originalProductCount: number
  readonly classifiedProductCount: number
  readonly detailSuccessCount: number
  readonly detailFailureCount: number
  readonly atomicSkuCount: number
}

export async function collectAtomicSkus(input: {
  readonly adapters: readonly SupplierAtomicAdapter[]
  readonly includeProduct: (reference: SupplierProductReference) => boolean
  readonly collectedAt?: string
}): Promise<readonly AtomicSupplierSku[]> {
  return (await collect(input, false)).atomicSkus
}

export async function collectAtomicSkusWithDiagnostics(input: {
  readonly adapters: readonly SupplierAtomicAdapter[]
  readonly includeProduct: (reference: SupplierProductReference) => boolean
  readonly collectedAt?: string
}): Promise<{
  readonly atomicSkus: readonly AtomicSupplierSku[]
  readonly suppliers: readonly SupplierCollectionDiagnostics[]
}> {
  return collect(input, true)
}

async function collect(
  input: {
    readonly adapters: readonly SupplierAtomicAdapter[]
    readonly includeProduct: (reference: SupplierProductReference) => boolean
    readonly collectedAt?: string
  },
  continueOnDetailFailure: boolean,
): Promise<{
  readonly atomicSkus: readonly AtomicSupplierSku[]
  readonly suppliers: readonly SupplierCollectionDiagnostics[]
}> {
  const collectedAt = input.collectedAt ?? new Date().toISOString()
  const byId = new Map<string, AtomicSupplierSku>()
  const suppliers: SupplierCollectionDiagnostics[] = []
  for (const adapter of input.adapters) {
    const allReferences = await adapter.listProducts()
    const references = allReferences.filter(input.includeProduct)
    let detailSuccessCount = 0
    let detailFailureCount = 0
    const beforeCount = byId.size
    for (const reference of references) {
      let detail: SupplierProductDetail
      try {
        detail = await adapter.fetchProductDetail(reference)
        detailSuccessCount += 1
      } catch (error) {
        detailFailureCount += 1
        if (!continueOnDetailFailure) throw error
        continue
      }
      const priceAnomalyOptionIds = detectPriceAnomalyOptionIds(detail.options)
      for (const option of detail.options) {
        const atomicSkuId = stableId(
          `${adapter.supplierId}|${detail.sourceProductId}|${option.sourceOptionId}`,
        )
        byId.set(atomicSkuId, {
          atomicSkuId,
          supplierId: adapter.supplierId,
          sourceProductId: detail.sourceProductId,
          sourceOptionId: option.sourceOptionId,
          originalProductTitle: detail.originalTitle,
          originalOptionName: option.originalOptionName,
          optionGroupTitle: option.optionGroupTitle ?? null,
          structuredAttributes: option.structuredAttributes,
          productUrl: detail.detailUrl,
          detailDescription: detail.detailDescription,
          imageUrl: detail.imageUrl,
          listingStartPrice: reference.listingStartPrice,
          supplierPrice: option.actualPrice ?? 0,
          priceAnomaly: priceAnomalyOptionIds.has(option.sourceOptionId),
          shippingFee: detail.shippingFee,
          stockStatus: option.soldOut ? "out_of_stock" : "in_stock",
          collectedAt,
          detailVerifiedAt: detail.verifiedAt,
        })
      }
    }
    suppliers.push({
      supplierId: adapter.supplierId,
      originalProductCount: allReferences.length,
      classifiedProductCount: references.length,
      detailSuccessCount,
      detailFailureCount,
      atomicSkuCount: byId.size - beforeCount,
    })
  }
  return { atomicSkus: [...byId.values()], suppliers }
}

function detectPriceAnomalyOptionIds(
  options: SupplierProductDetail["options"],
): ReadonlySet<string> {
  const rows = options
    .map((option) => ({
      id: option.sourceOptionId,
      count: optionCount(option.originalOptionName),
      price: option.actualPrice,
    }))
    .filter(
      (row): row is { readonly id: string; readonly count: number; readonly price: number } =>
        row.count !== null && row.price !== null && row.price > 0,
    )
    .sort((left, right) => left.count - right.count)
  const anomalous = new Set<string>()
  let highestLowerCountPrice = 0
  for (const row of rows) {
    if (row.price < highestLowerCountPrice) anomalous.add(row.id)
    highestLowerCountPrice = Math.max(highestLowerCountPrice, row.price)
  }
  return anomalous
}

function optionCount(value: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*(?:개입|개|입|과|팩|봉)/u.exec(value)
  return match?.[1] === undefined ? null : Number(match[1])
}

function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
