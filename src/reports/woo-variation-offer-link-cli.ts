import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import ky from "ky"
import { z } from "zod"

const MetaSchema = z.object({ key: z.string(), value: z.unknown() })
const ProductSchema = z.object({
  id: z.number().int(),
  variations: z.array(z.number().int()).default([]),
})
const VariationSchema = z.object({
  id: z.number().int(),
  parent_id: z.number().int(),
  meta_data: z.array(MetaSchema).default([]),
})

async function main(): Promise<void> {
  await loadDotEnv()
  const database = new DatabaseSync(resolve(argument("--db") ?? "data/wholesalehub.sqlite"))
  try {
    database.exec("PRAGMA foreign_keys = ON")
    database.exec("PRAGMA busy_timeout = 5000")
    const credentials = `${requiredEnv("WOOCOMMERCE_CONSUMER_KEY")}:${requiredEnv(
      "WOOCOMMERCE_CONSUMER_SECRET",
    )}`
    const headers = { Authorization: `Basic ${Buffer.from(credentials).toString("base64")}` }
    const baseUrl = requiredEnv("WOOCOMMERCE_BASE_URL").replace(/\/+$/u, "")
    const products = await fetchPages(
      `${baseUrl}/wp-json/wc/v3/products`,
      headers,
      ProductSchema,
    )
    let newLinkCount = 0
    let refreshedLinkCount = refreshExistingLinks(database)
    const pending = products.flatMap((product) =>
      product.variations
        .filter(
          (variationId) =>
            database
              .prepare("SELECT 1 FROM woo_variation_offer_links WHERE woo_variation_id = ?")
              .get(variationId) === undefined,
        )
        .map((variationId) => ({ productId: product.id, variationId })),
    )
    for (let offset = 0; offset < pending.length; offset += 12) {
      const batch = await Promise.all(
        pending.slice(offset, offset + 12).map(async ({ productId, variationId }) => ({
          productId,
          variation: VariationSchema.parse(
            await ky
              .get(`${baseUrl}/wp-json/wc/v3/products/${productId}/variations/${variationId}`, {
                headers,
                timeout: 30_000,
                retry: { limit: 1 },
              })
              .json(),
          ),
        })),
      )
      for (const { productId, variation } of batch) {
        const supplierId = meta(variation, [
          "_wholesalehub_selected_supplier_id",
          "_supplier_id",
        ])
        const sourceProductId = meta(variation, [
          "_wholesalehub_source_product_id",
          "_source_product_id",
        ])
        const sourceOptionId = meta(variation, [
          "_wholesalehub_source_option_id",
          "_source_option_id",
        ])
        if (!supplierId || !sourceProductId || !sourceOptionId) continue
        const match = database
          .prepare(
            `SELECT cvo.canonical_variant_id, result.selected_offer_id
             FROM supplier_products AS product
             JOIN supplier_options AS option_row
               ON option_row.supplier_product_id = product.supplier_product_id
             JOIN atomic_supplier_skus AS sku
               ON sku.supplier_product_id = product.supplier_product_id
              AND sku.supplier_option_id = option_row.supplier_option_id
             JOIN normalized_offers AS offer ON offer.atomic_sku_id = sku.atomic_sku_id
             JOIN canonical_variant_offers AS cvo
               ON cvo.normalized_offer_id = offer.normalized_offer_id
             JOIN comparison_variant_results AS result
               ON result.canonical_variant_id = cvo.canonical_variant_id
             JOIN selected_offer_trace AS trace
               ON trace.selected_offer_id = result.selected_offer_id
             WHERE product.supplier_id = ?
               AND product.source_product_id = ?
               AND option_row.source_option_id = ?
               AND trace.is_purchasable = 1
             LIMIT 1`,
          )
          .get(supplierId, sourceProductId, sourceOptionId)
        if (match === undefined) continue
        database
          .prepare(
            `INSERT INTO woo_variation_offer_links (
              woo_variation_id, woo_product_id, canonical_variant_id,
              selected_offer_id, linked_at
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(woo_variation_id) DO UPDATE SET
              woo_product_id=excluded.woo_product_id,
              canonical_variant_id=excluded.canonical_variant_id,
              selected_offer_id=excluded.selected_offer_id,
              linked_at=excluded.linked_at`,
          )
          .run(
            variation.id,
            productId,
            String(match["canonical_variant_id"]),
            String(match["selected_offer_id"]),
            new Date().toISOString(),
          )
        newLinkCount += 1
      }
    }
    refreshedLinkCount += refreshExistingLinks(database)
    console.log(JSON.stringify({ newLinkCount, refreshedLinkCount }))
  } finally {
    database.close()
  }
}

function refreshExistingLinks(database: DatabaseSync): number {
  return Number(
    database
      .prepare(
        `UPDATE woo_variation_offer_links
         SET selected_offer_id = (
           SELECT result.selected_offer_id
           FROM comparison_variant_results AS result
           WHERE result.canonical_variant_id = woo_variation_offer_links.canonical_variant_id
         ),
         linked_at = ?
         WHERE EXISTS (
           SELECT 1
           FROM comparison_variant_results AS result
           JOIN selected_offer_trace AS trace
             ON trace.selected_offer_id = result.selected_offer_id
           WHERE result.canonical_variant_id = woo_variation_offer_links.canonical_variant_id
             AND trace.is_purchasable = 1
             AND result.selected_offer_id != woo_variation_offer_links.selected_offer_id
         )`,
      )
      .run(new Date().toISOString()).changes,
  )
}

async function fetchPages<T extends z.ZodTypeAny>(
  url: string,
  headers: Readonly<Record<string, string>>,
  schema: T,
): Promise<z.infer<T>[]> {
  const rows: z.infer<T>[] = []
  for (let page = 1; ; page += 1) {
    const batch = z
      .array(schema)
      .parse(
        await ky
          .get(url, {
            headers,
            searchParams: { per_page: "100", page: String(page), status: "any" },
            timeout: 60_000,
            retry: { limit: 1 },
          })
          .json(),
      )
    rows.push(...batch)
    if (batch.length < 100) return rows
  }
}

function meta(variation: z.infer<typeof VariationSchema>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = variation.meta_data.find((item) => item.key === key)?.value
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value).trim()
      if (text.length > 0) return text
    }
  }
  return ""
}

function argument(key: string): string | null {
  const index = process.argv.indexOf(key)
  return index < 0 ? null : (process.argv[index + 1] ?? null)
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`${key} is required`)
  return value
}

async function loadDotEnv(): Promise<void> {
  const env = await readFile(".env", "utf8")
  for (const line of env.split(/\r?\n/u)) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line)
    if (match?.[1] !== undefined && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2] ?? ""
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
