import {
  fetchWalldob2bDetailHtml,
  parseWalldob2bDetailHtml,
  parseWalldob2bProductAvailability,
  type Walldob2bLogin,
} from "../../adapters/walldob2b/walldob2b-adapter.js"
import {
  fetchWalldob2bProductExcel,
  parseWalldob2bProductExcelHtml,
} from "../../adapters/walldob2b/walldob2b-excel-download.js"
import type { CollectedProduct } from "../../domain/product.js"
import type {
  SupplierAtomicAdapter,
  SupplierProductDetail,
  SupplierProductReference,
} from "../supplier-adapter.js"

export class Walldob2bAtomicAdapter implements SupplierAtomicAdapter {
  readonly supplierId = "walldob2b"
  private indexRows: readonly CollectedProduct[] | null = null

  constructor(private readonly login: Walldob2bLogin) {}

  async listProducts(): Promise<readonly SupplierProductReference[]> {
    const rows = await this.loadIndex()
    const groups = groupBySourceProduct(rows)
    return [...groups.entries()].map(([sourceProductId, productRows]) => ({
      supplierId: this.supplierId,
      sourceProductId,
      originalTitle: productRows[0]?.originalProductName ?? sourceProductId,
      detailUrl:
        productRows[0]?.productUrl ??
        `https://walldob2b.com/shop/item.php?it_id=${encodeURIComponent(sourceProductId)}`,
      listingStartPrice: minimum(productRows.map((row) => row.price)),
    }))
  }

  async fetchProductDetail(reference: SupplierProductReference): Promise<SupplierProductDetail> {
    const indexRows = (await this.loadIndex()).filter(
      (row) => sourceProductId(row) === reference.sourceProductId,
    )
    const html = await fetchWalldob2bDetailHtml(reference.sourceProductId, this.login)
    const parsed = parseWalldob2bDetailHtml(html, {
      wooProductId: 0,
      productName: reference.originalTitle,
      itId: reference.sourceProductId,
      sourceUrl: reference.detailUrl,
    })
    const availability = parseWalldob2bProductAvailability(html)
    const detailOptions =
      parsed.length > 0
        ? parsed
        : availability.soldOut
          ? indexRows.map((row) => ({
              ...row,
              stockStatus: "out_of_stock" as const,
              rawJson: JSON.stringify({
                ...rawJson(row),
                availabilityEvidence: availability.evidence,
              }),
            }))
          : parsed
    const verifiedAt = new Date().toISOString()
    return {
      supplierId: this.supplierId,
      sourceProductId: reference.sourceProductId,
      originalTitle: reference.originalTitle,
      detailUrl: reference.detailUrl,
      listingStartPrice: reference.listingStartPrice,
      detailDescription: extractDescription(html),
      imageUrl: extractImageUrls(html, reference.detailUrl)[0] ?? null,
      shippingFee: 0,
      options: detailOptions.map((option) => {
        const indexMatch = findIndexOption(indexRows, option.originalOptionName ?? "")
        const attributes = JSON.parse(option.rawJson) as Readonly<Record<string, unknown>>
        return {
          sourceOptionId:
            indexMatch === undefined
              ? stableOptionId(reference.sourceProductId, option.originalOptionName ?? "기본")
              : sourceOptionId(indexMatch),
          originalOptionName: option.originalOptionName ?? "기본",
          optionGroupTitle: stringValue(attributes["optionGroupTitle"]),
          actualPrice: option.price,
          soldOut: option.stockStatus === "out_of_stock",
          structuredAttributes: stringAttributes(attributes),
        }
      }),
      verifiedAt,
    }
  }

  private async loadIndex(): Promise<readonly CollectedProduct[]> {
    if (this.indexRows !== null) return this.indexRows
    const html = await fetchWalldob2bProductExcel(this.login)
    this.indexRows = parseWalldob2bProductExcelHtml(html, 100_000).products
    return this.indexRows
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function groupBySourceProduct(
  rows: readonly CollectedProduct[],
): ReadonlyMap<string, readonly CollectedProduct[]> {
  const groups = new Map<string, CollectedProduct[]>()
  for (const row of rows) {
    const id = sourceProductId(row)
    const group = groups.get(id) ?? []
    group.push(row)
    groups.set(id, group)
  }
  return groups
}

function sourceProductId(row: CollectedProduct): string {
  return String(rawJson(row)["sourceProductId"] ?? "")
}

function sourceOptionId(row: CollectedProduct): string {
  return String(rawJson(row)["sourceOptionId"] ?? "")
}

function rawJson(row: CollectedProduct): Readonly<Record<string, unknown>> {
  return JSON.parse(row.rawJson) as Readonly<Record<string, unknown>>
}

function findIndexOption(
  rows: readonly CollectedProduct[],
  optionName: string,
): CollectedProduct | undefined {
  const key = optionKey(optionName)
  return rows.find((row) => optionKey(row.originalOptionName ?? "") === key)
}

function optionKey(value: string): string {
  return value.replace(/[^0-9A-Za-z가-힣]/gu, "").toLowerCase()
}

function stableOptionId(productId: string, optionName: string): string {
  return `${productId}:${optionKey(optionName)}`
}

function minimum(values: readonly number[]): number | null {
  return values.length === 0 ? null : Math.min(...values)
}

function extractDescription(html: string): string | null {
  const match =
    /<div[^>]+(?:id|class)=["'][^"']*(?:item_explan|sit_inf_explan)[^"']*["'][^>]*>([\s\S]*?)<\/div>/iu.exec(
      html,
    )
  if (match?.[1] === undefined) return null
  return stripTags(match[1]).slice(0, 10_000) || null
}

function extractImageUrls(html: string, baseUrl: string): readonly string[] {
  const urls = new Set<string>()
  for (const match of html.matchAll(/<img[^>]+src=["']([^"']+)["']/giu)) {
    const value = match[1]
    if (value === undefined || /logo|icon|spinner|blank/iu.test(value)) continue
    try {
      urls.add(new URL(value, baseUrl).toString())
    } catch {
      // Invalid supplier image URLs are ignored in the dry-run report.
    }
  }
  return [...urls].slice(0, 20)
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
}

function stringAttributes(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === "string" ? item : JSON.stringify(item),
    ]),
  )
}
