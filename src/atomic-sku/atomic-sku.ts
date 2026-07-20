import { createHash } from "node:crypto"
import type { CollectedProduct } from "../domain/product.js"
import type { AtomicSupplierSku } from "./types.js"

export function splitCollectedProductsIntoAtomicSkus(
  products: readonly CollectedProduct[],
  collectedAt = new Date().toISOString(),
): readonly AtomicSupplierSku[] {
  return products.map((product) => {
    const raw = safeJson(product.rawJson)
    const sourceProductId = firstString(
      raw["sourceProductId"],
      raw["walldoItId"],
      stableId(product.originalProductName),
    )
    const originalOptionName = product.originalOptionName?.trim() || "기본"
    const sourceOptionId = firstString(
      raw["sourceOptionId"],
      stableId(`${sourceProductId}|${originalOptionName}`),
    )
    return {
      atomicSkuId: stableId(`${product.supplierId}|${sourceProductId}|${sourceOptionId}`),
      supplierId: product.supplierId,
      sourceProductId,
      sourceOptionId,
      originalProductTitle: product.originalProductName,
      originalOptionName,
      productUrl: product.productUrl,
      detailDescription: stringOrNull(raw["detailDescription"]),
      imageUrl: firstNullableString(raw["imageUrl"], raw["sourceImageUrl"]),
      listingStartPrice: numberOrNull(raw["listingStartPrice"]),
      supplierPrice: product.price,
      shippingFee: product.shippingFee,
      stockStatus: product.stockStatus,
      collectedAt,
      detailVerifiedAt: firstString(raw["detailVerifiedAt"], collectedAt),
    }
  })
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function firstString(...values: readonly unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim()
  }
  throw new Error("atomic SKU source identity is missing")
}

function firstNullableString(...values: readonly unknown[]): string | null {
  for (const value of values) {
    const parsed = stringOrNull(value)
    if (parsed !== null) return parsed
  }
  return null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
