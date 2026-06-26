import ky from "ky"
import { z } from "zod"

const WooProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  sku: z.string().nullable().optional(),
  status: z.string(),
  type: z.string(),
  price: z.string().nullable().optional(),
  stock_status: z.string().nullable().optional(),
  permalink: z.string().nullable().optional(),
})

const WooVariationSchema = z.object({
  id: z.number().int(),
  sku: z.string().nullable().optional(),
  price: z.string().nullable().optional(),
  stock_status: z.string().nullable().optional(),
  permalink: z.string().nullable().optional(),
})

export type WooCommerceSearchResult = {
  readonly product_id: number
  readonly name: string
  readonly sku: string
  readonly status: string
  readonly type: string
  readonly price: string
  readonly stock_status: string
  readonly permalink: string
  readonly variations: readonly WooCommerceVariationCandidate[]
}

export type WooCommerceVariationCandidate = {
  readonly variation_id: number
  readonly sku: string
  readonly price: string
  readonly stock_status: string
  readonly permalink: string
}

export type WooCommerceSearchOptions = {
  readonly baseUrl: string
  readonly consumerKey: string
  readonly consumerSecret: string
  readonly query: string
  readonly perPage?: number
}

export async function searchWooCommerceProducts(
  options: WooCommerceSearchOptions,
): Promise<readonly WooCommerceSearchResult[]> {
  const baseUrl = options.baseUrl.replace(/\/$/u, "")
  const headers = {
    Authorization: `Basic ${Buffer.from(`${options.consumerKey}:${options.consumerSecret}`).toString("base64")}`,
  }
  const products = z.array(WooProductSchema).parse(
    await ky
      .get(`${baseUrl}/wp-json/wc/v3/products`, {
        headers,
        searchParams: { search: options.query, per_page: String(options.perPage ?? 10) },
        timeout: 30_000,
        retry: { limit: 1 },
      })
      .json(),
  )
  return Promise.all(
    products.map(async (product) => ({
      product_id: product.id,
      name: product.name,
      sku: product.sku ?? "",
      status: product.status,
      type: product.type,
      price: product.price ?? "",
      stock_status: product.stock_status ?? "",
      permalink: product.permalink ?? "",
      variations:
        product.type === "variable"
          ? await searchWooCommerceVariations(baseUrl, headers, product.id)
          : [],
    })),
  )
}

async function searchWooCommerceVariations(
  baseUrl: string,
  headers: Record<string, string>,
  productId: number,
): Promise<readonly WooCommerceVariationCandidate[]> {
  const variations = z.array(WooVariationSchema).parse(
    await ky
      .get(`${baseUrl}/wp-json/wc/v3/products/${productId}/variations`, {
        headers,
        searchParams: { per_page: "20" },
        timeout: 30_000,
        retry: { limit: 1 },
      })
      .json(),
  )
  return variations.map((variation) => ({
    variation_id: variation.id,
    sku: variation.sku ?? "",
    price: variation.price ?? "",
    stock_status: variation.stock_status ?? "",
    permalink: variation.permalink ?? "",
  }))
}
