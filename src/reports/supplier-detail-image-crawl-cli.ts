import { writeFile } from "node:fs/promises"
import ky from "ky"
import { z } from "zod"
import { crawlDailyFoodDirectSite } from "../adapters/dailyfood/dailyfood-direct-site.js"
import { fetchWalldob2bDetailHtml } from "../adapters/walldob2b/walldob2b-adapter.js"

const ProductSchema = z.object({
  id: z.number().int(),
  status: z.string(),
  meta_data: z.array(z.object({ key: z.string(), value: z.unknown() })).default([]),
})

type Product = z.infer<typeof ProductSchema>
type Source = "dailyfood" | "walldob2b"
type ManifestRow = {
  readonly source: Source
  readonly source_id: string
  readonly woocommerce_id: number
  readonly image_urls: readonly string[]
}

const OUTPUT_PATH = "reports/supplier-detail-images.json"

async function main(): Promise<void> {
  const products = await fetchWooProducts()
  const dailyProducts = productsWithSource(products, "dailyfood", "_b2b_dailyfood_pcode")
  const walldoProducts = productsWithSource(products, "walldob2b", "_b2b_walldo_it_id")
  const rows: ManifestRow[] = []
  const failures: string[] = []
  const missing: string[] = []

  if (dailyProducts.length > 0) {
    const browserEndpoint = process.env["ADMINPLUS_BROWSER_ENDPOINT"]?.trim()
    const daily = await crawlDailyFoodDirectSite({
      username: env("DAILYFOOD_USERNAME", "WALLDOB2B_USERNAME"),
      password: env("DAILYFOOD_PASSWORD", "WALLDOB2B_PASSWORD"),
      ...(browserEndpoint ? { browserEndpoint } : {}),
      maxPages: 50,
    })
    const byId = new Map(daily.products.map((product) => [product.sourceProductId, product]))
    for (const product of dailyProducts) {
      const crawled = byId.get(product.sourceId)
      if (!crawled) {
        missing.push(`dailyfood:${product.sourceId}:not_found`)
        continue
      }
      rows.push({
        source: "dailyfood",
        source_id: product.sourceId,
        woocommerce_id: product.woocommerceId,
        image_urls: unique(crawled.detailImageUrls),
      })
    }
    failures.push(...daily.errors.map((error) => `dailyfood:crawl:${error}`))
  }

  for (const product of walldoProducts) {
    try {
      const html = await fetchWalldob2bDetailHtml(product.sourceId, {
        username: env("WALLDOB2B_USERNAME"),
        password: env("WALLDOB2B_PASSWORD"),
      })
      rows.push({
        source: "walldob2b",
        source_id: product.sourceId,
        woocommerce_id: product.woocommerceId,
        image_urls: extractWalldoDetailImages(html),
      })
    } catch (error) {
      failures.push(`walldob2b:${product.sourceId}:${message(error)}`)
    }
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    product_count: products.length,
    dailyfood_product_count: dailyProducts.length,
    walldob2b_product_count: walldoProducts.length,
    rows,
    failures,
    missing,
  }
  await writeFile(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  console.log(
    JSON.stringify({
      output: OUTPUT_PATH,
      rows: rows.length,
      with_images: rows.filter((row) => row.image_urls.length > 0).length,
      images: rows.reduce((sum, row) => sum + row.image_urls.length, 0),
      failures: failures.length,
      missing: missing.length,
    }),
  )
  if (rows.length === 0 || failures.length > Math.max(10, Math.floor(rows.length * 0.2))) {
    throw new Error(
      `supplier detail crawl incomplete: rows=${rows.length} failures=${failures.length}`,
    )
  }
}

async function fetchWooProducts(): Promise<readonly Product[]> {
  const client = ky.create({
    prefixUrl: `${env("WOOCOMMERCE_BASE_URL").replace(/\/$/u, "")}/wp-json/wc/v3`,
    searchParams: {
      consumer_key: env("WOOCOMMERCE_CONSUMER_KEY"),
      consumer_secret: env("WOOCOMMERCE_CONSUMER_SECRET"),
    },
    timeout: 60_000,
    retry: { limit: 2 },
  })
  const products: Product[] = []
  for (let page = 1; ; page += 1) {
    const batch = z
      .array(ProductSchema)
      .parse(
        await client
          .get("products", { searchParams: { status: "any", per_page: 100, page } })
          .json(),
      )
    products.push(...batch.filter((product) => product.status !== "trash"))
    if (batch.length < 100) break
  }
  return products
}

function productsWithSource(
  products: readonly Product[],
  source: Source,
  idKey: string,
): readonly { readonly woocommerceId: number; readonly sourceId: string }[] {
  const output = new Map<string, { readonly woocommerceId: number; readonly sourceId: string }>()
  for (const product of products) {
    const meta = new Map(product.meta_data.map((row) => [row.key, String(row.value ?? "").trim()]))
    if (meta.get("_b2b_source") !== source) continue
    const sourceId = meta.get(idKey) ?? ""
    if (sourceId.length === 0) continue
    output.set(`${product.id}:${sourceId}`, { woocommerceId: product.id, sourceId })
  }
  return [...output.values()]
}

function extractWalldoDetailImages(html: string): readonly string[] {
  const images: string[] = []
  for (const match of html.matchAll(/<img\b[^>]*>/giu)) {
    const raw = match[0].match(/(?:data-original|data-src|src)=["']([^"']+)/iu)?.[1] ?? ""
    if (raw.length === 0) continue
    let url: URL
    try {
      url = new URL(raw, "https://walldob2b.com")
    } catch {
      continue
    }
    if (!/\.(?:jpe?g|png|webp)(?:$|\?)/iu.test(url.toString())) continue
    const isExternalDetail = url.hostname !== "walldob2b.com"
    const isHostedDetail = /^\/data\/(?:editor|file)\//iu.test(url.pathname)
    if (!isExternalDetail && !isHostedDetail) continue
    images.push(url.toString())
  }
  return unique(images)
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => /^https?:\/\//iu.test(value)))]
}

function env(...names: readonly string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim() ?? ""
    if (value.length > 0) return value
  }
  throw new Error(`missing environment variable: ${names.join(" or ")}`)
}

function message(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/\s+/gu, " ").slice(0, 300)
    : String(error).slice(0, 300)
}

await main()
