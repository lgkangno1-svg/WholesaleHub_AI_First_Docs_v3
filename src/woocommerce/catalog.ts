import ky from "ky"
import { z } from "zod"

const MetaSchema = z.object({ key: z.string(), value: z.unknown() })
const AttributeSchema = z.object({ name: z.string(), option: z.string().optional() })
const ProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  type: z.string(),
  price: z.string().nullable().optional(),
  status: z.string(),
  meta_data: z.array(MetaSchema).optional(),
})
const VariationSchema = z.object({
  id: z.number().int(),
  price: z.string().nullable().optional(),
  status: z.string().optional(),
  attributes: z.array(AttributeSchema).optional(),
  meta_data: z.array(MetaSchema).optional(),
})

export type WooCatalogItem = {
  readonly productId: number
  readonly variationId: number | null
  readonly productName: string
  readonly optionName: string | null
  readonly price: string
  readonly type: string
  readonly status: string
  readonly meta: Record<string, string>
}

export type WooCatalogOptions = {
  readonly baseUrl: string
  readonly consumerKey: string
  readonly consumerSecret: string
  readonly maxProducts?: number
}

export async function fetchWooCommerceCatalog(
  options: WooCatalogOptions,
): Promise<readonly WooCatalogItem[]> {
  const baseUrl = options.baseUrl.replace(/\/$/u, "")
  const headers = authHeaders(options.consumerKey, options.consumerSecret)
  const products = await fetchProducts(baseUrl, headers, options.maxProducts ?? 500)
  const catalog: WooCatalogItem[] = []
  for (const product of products) {
    if (product.type === "variable") {
      const variations = await fetchVariations(baseUrl, headers, product.id)
      catalog.push(...variations.map((variation) => toVariationItem(product, variation)))
    } else {
      catalog.push(toProductItem(product))
    }
  }
  return catalog
}

function authHeaders(consumerKey: string, consumerSecret: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}`,
  }
}

async function fetchProducts(
  baseUrl: string,
  headers: Record<string, string>,
  maxProducts: number,
): Promise<readonly z.infer<typeof ProductSchema>[]> {
  const products: z.infer<typeof ProductSchema>[] = []
  for (let page = 1; products.length < maxProducts; page += 1) {
    const rows = z.array(ProductSchema).parse(
      await ky
        .get(`${baseUrl}/wp-json/wc/v3/products`, {
          headers,
          searchParams: { per_page: "100", page: String(page), status: "publish" },
          timeout: 30_000,
          retry: { limit: 1 },
        })
        .json(),
    )
    products.push(...rows)
    if (rows.length < 100) {
      break
    }
  }
  return products.slice(0, maxProducts)
}

async function fetchVariations(
  baseUrl: string,
  headers: Record<string, string>,
  productId: number,
): Promise<readonly z.infer<typeof VariationSchema>[]> {
  const variations: z.infer<typeof VariationSchema>[] = []
  for (let page = 1; ; page += 1) {
    const rows = z.array(VariationSchema).parse(
      await ky
        .get(`${baseUrl}/wp-json/wc/v3/products/${productId}/variations`, {
          headers,
          searchParams: { per_page: "100", page: String(page) },
          timeout: 30_000,
          retry: { limit: 1 },
        })
        .json(),
    )
    variations.push(...rows)
    if (rows.length < 100) {
      break
    }
  }
  return variations
}

function toProductItem(product: z.infer<typeof ProductSchema>): WooCatalogItem {
  return {
    productId: product.id,
    variationId: null,
    productName: product.name,
    optionName: null,
    price: product.price ?? "",
    type: product.type,
    status: product.status,
    meta: metaRecord(product.meta_data ?? []),
  }
}

function toVariationItem(
  product: z.infer<typeof ProductSchema>,
  variation: z.infer<typeof VariationSchema>,
): WooCatalogItem {
  return {
    productId: product.id,
    variationId: variation.id,
    productName: product.name,
    optionName: variation.attributes?.map((attribute) => attribute.option ?? "").join(" / ") ?? "",
    price: variation.price ?? "",
    type: product.type,
    status: variation.status ?? product.status,
    meta: { ...metaRecord(product.meta_data ?? []), ...metaRecord(variation.meta_data ?? []) },
  }
}

function metaRecord(meta: readonly z.infer<typeof MetaSchema>[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const item of meta) {
    if (typeof item.value === "string" || typeof item.value === "number") {
      result[item.key] = String(item.value)
    }
  }
  return result
}
