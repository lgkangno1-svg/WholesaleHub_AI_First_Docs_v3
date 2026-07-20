import {
  crawlDailyFoodDirectSite,
  type DailyFoodDirectSiteOptions,
  type DailyFoodDirectSiteProduct,
} from "../../adapters/dailyfood/dailyfood-direct-site.js"
import type {
  SupplierAtomicAdapter,
  SupplierProductDetail,
  SupplierProductReference,
} from "../supplier-adapter.js"

export class DailyFoodAtomicAdapter implements SupplierAtomicAdapter {
  readonly supplierId = "dailyfood"
  private products: readonly DailyFoodDirectSiteProduct[] | null = null
  private crawledAt: string | null = null

  constructor(private readonly options: DailyFoodDirectSiteOptions) {}

  async listProducts(): Promise<readonly SupplierProductReference[]> {
    await this.ensureCrawled()
    return (this.products ?? []).map((product) => ({
      supplierId: this.supplierId,
      sourceProductId: product.sourceProductId,
      originalTitle: product.productName,
      detailUrl: detailUrl(product.sourceProductId),
      listingStartPrice: listingPriceFromRaw(product.raw),
    }))
  }

  async fetchProductDetail(reference: SupplierProductReference): Promise<SupplierProductDetail> {
    await this.ensureCrawled()
    const product = (this.products ?? []).find(
      (item) => item.sourceProductId === reference.sourceProductId,
    )
    if (product === undefined) {
      throw new Error(`DailyFood detail product disappeared: ${reference.sourceProductId}`)
    }
    return {
      supplierId: this.supplierId,
      sourceProductId: product.sourceProductId,
      originalTitle: product.productName,
      detailUrl: detailUrl(product.sourceProductId),
      listingStartPrice: reference.listingStartPrice,
      detailDescription:
        stringValue(product.raw["detailDescriptionText"]) ??
        stringValue(product.raw["description"]),
      imageUrl:
        unique([
          product.imageUrl,
          ...product.detailImageUrls,
          ...product.options.map((option) => option.imageUrl),
        ])[0] ?? null,
      shippingFee: 0,
      options: product.options.map((option) => ({
        sourceOptionId: option.sourceOptionId,
        originalOptionName: option.optionName,
        optionGroupTitle: optionGroupTitleFromRaw(option.raw),
        actualPrice: option.price,
        soldOut: option.stockStatus === "out_of_stock",
        structuredAttributes: stringAttributes(option.raw),
      })),
      verifiedAt: this.crawledAt ?? new Date().toISOString(),
    }
  }

  private async ensureCrawled(): Promise<void> {
    if (this.products !== null) return
    const result = await crawlDailyFoodDirectSite(this.options)
    this.products = result.products
    this.crawledAt = result.crawledAt
  }
}

function optionGroupTitleFromRaw(raw: Readonly<Record<string, unknown>>): string | null {
  for (const [key, value] of Object.entries(raw)) {
    if (!/group|subject|header|옵션.*제목|그룹/iu.test(key)) continue
    const text = stringValue(value)
    if (text !== null) return text
  }
  return null
}

function detailUrl(sourceProductId: string): string {
  return `https://dailyfood.adminplus.co.kr/partner/?mod=product&actpage=prt.grp.detail.pop&pcode=${encodeURIComponent(sourceProductId)}`
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.length > 0))]
}

function listingPriceFromRaw(raw: Readonly<Record<string, unknown>>): number | null {
  const html = typeof raw["html"] === "string" ? raw["html"] : ""
  const candidates = [...html.matchAll(/([0-9][0-9,]{2,})\s*원/gu)]
    .map((match) => Number((match[1] ?? "").replace(/,/gu, "")))
    .filter((value) => Number.isFinite(value) && value > 0)
  return candidates.length === 0 ? null : Math.min(...candidates)
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
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
