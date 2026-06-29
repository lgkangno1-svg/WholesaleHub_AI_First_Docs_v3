import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import ky from "ky"
import { z } from "zod"

const MetaSchema = z.object({ key: z.string(), value: z.unknown() })
const OrderSchema = z.object({
  id: z.number().int(),
  date_created: z.string().default(""),
  status: z.string().default(""),
  billing: z
    .object({ first_name: z.string().default(""), last_name: z.string().default("") })
    .default({ first_name: "", last_name: "" }),
  line_items: z
    .array(
      z.object({
        product_id: z.number().int().default(0),
        variation_id: z.number().int().default(0),
        name: z.string().default(""),
        quantity: z.number().default(0),
        total: z.string().default(""),
        meta_data: z.array(MetaSchema).default([]),
      }),
    )
    .default([]),
})
const ProductSchema = z.object({ id: z.number().int(), meta_data: z.array(MetaSchema).default([]) })
const VariationSchema = z.object({
  id: z.number().int(),
  meta_data: z.array(MetaSchema).default([]),
})

type Credentials = {
  readonly baseUrl: string
  readonly consumerKey: string
  readonly consumerSecret: string
}
type Order = z.infer<typeof OrderSchema>
type LineItem = Order["line_items"][number]
type Meta = z.infer<typeof MetaSchema>
type Row = {
  readonly order_id: number
  readonly order_date: string
  readonly order_status: string
  readonly customer_name: string
  readonly product_id: number
  readonly variation_id: number
  readonly product_name: string
  readonly option_name: string
  readonly quantity: number
  readonly line_total: string
  readonly supplier_id: string
  readonly supplier_label: string
  readonly source_product_id: string
  readonly source_option_id: string
  readonly original_product_name: string
  readonly original_option_name: string
  readonly memo_korean: string
}

type Options = {
  readonly days: number
  readonly from: string | null
  readonly to: string | null
  readonly outputDir: string
}

const COLUMNS = [
  "order_id",
  "order_date",
  "order_status",
  "customer_name",
  "product_id",
  "variation_id",
  "product_name",
  "option_name",
  "quantity",
  "line_total",
  "supplier_id",
  "supplier_label",
  "source_product_id",
  "source_option_id",
  "original_product_name",
  "original_option_name",
  "memo_korean",
] as const

async function main(): Promise<void> {
  await loadDotEnv()
  const options = parseArgs(process.argv.slice(2))
  const credentials = {
    baseUrl: readRequiredEnv("WOOCOMMERCE_BASE_URL"),
    consumerKey: readRequiredEnv("WOOCOMMERCE_CONSUMER_KEY"),
    consumerSecret: readRequiredEnv("WOOCOMMERCE_CONSUMER_SECRET"),
  }
  const rows = await buildOrderSupplierFulfillmentReport(credentials, options)
  await writeReport(rows, options.outputDir, options)
  console.log(
    JSON.stringify(
      {
        rowCount: rows.length,
        supplierCounts: countBy(rows.map((row) => row.supplier_label)),
        outputCsv: `${options.outputDir}/order-supplier-fulfillment-report.csv`,
        outputSummary: `${options.outputDir}/order-supplier-fulfillment-summary.md`,
        wooCommerceChanged: false,
      },
      null,
      2,
    ),
  )
}

async function buildOrderSupplierFulfillmentReport(
  credentials: Credentials,
  options: Options,
): Promise<readonly Row[]> {
  const client = wooClient(credentials)
  const orders = await fetchOrders(client, dateRange(options))
  const fallback = new Map<string, SupplierMeta>()
  const rows: Row[] = []
  for (const order of orders) {
    for (const item of order.line_items) {
      const snapshot = metaFromOrderItem(item.meta_data)
      const hasSnapshot = snapshot.hasSnapshot
      const supplier = hasSnapshot
        ? snapshot
        : await fallbackSupplier(client, fallback, item.product_id, item.variation_id)
      rows.push({
        order_id: order.id,
        order_date: order.date_created,
        order_status: order.status,
        customer_name: [order.billing.last_name, order.billing.first_name]
          .filter(Boolean)
          .join("")
          .trim(),
        product_id: item.product_id,
        variation_id: item.variation_id,
        product_name: item.name,
        option_name: optionName(item),
        quantity: item.quantity,
        line_total: item.total,
        supplier_id: supplier.supplierId,
        supplier_label: supplierLabel(supplier.supplierId),
        source_product_id: supplier.sourceProductId,
        source_option_id: supplier.sourceOptionId,
        original_product_name: supplier.originalProductName,
        original_option_name: supplier.originalOptionName,
        memo_korean: hasSnapshot ? "" : "주문시점 스냅샷 없음, 현재 variation meta 기준",
      })
    }
  }
  return rows
}

type WooClient = { readonly baseUrl: string; readonly headers: Record<string, string> }
type SupplierMeta = {
  readonly supplierId: string
  readonly sourceProductId: string
  readonly sourceOptionId: string
  readonly originalProductName: string
  readonly originalOptionName: string
  readonly hasSnapshot?: boolean
}

function wooClient(credentials: Credentials): WooClient {
  return {
    baseUrl: credentials.baseUrl.replace(/\/$/u, ""),
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.consumerKey}:${credentials.consumerSecret}`).toString("base64")}`,
    },
  }
}

async function fetchOrders(
  client: WooClient,
  range: { readonly after: string; readonly before: string },
): Promise<readonly Order[]> {
  const orders: Order[] = []
  for (let page = 1; ; page += 1) {
    const batch = z.array(OrderSchema).parse(
      await ky
        .get(`${client.baseUrl}/wp-json/wc/v3/orders`, {
          headers: client.headers,
          searchParams: {
            per_page: "100",
            page: String(page),
            after: range.after,
            before: range.before,
            orderby: "date",
            order: "asc",
          },
          timeout: 30_000,
          retry: { limit: 1 },
        })
        .json(),
    )
    orders.push(...batch)
    if (batch.length < 100) break
  }
  return orders
}

async function fallbackSupplier(
  client: WooClient,
  cache: Map<string, SupplierMeta>,
  productId: number,
  variationId: number,
): Promise<SupplierMeta> {
  const key = `${productId}:${variationId}`
  const cached = cache.get(key)
  if (cached) return cached
  const variationMeta =
    variationId > 0 ? await fetchVariationMeta(client, productId, variationId) : []
  const productMeta = await fetchProductMeta(client, productId)
  const result = metaFromVariation([...productMeta, ...variationMeta])
  cache.set(key, result)
  return result
}

async function fetchProductMeta(client: WooClient, productId: number): Promise<readonly Meta[]> {
  if (productId <= 0) return []
  try {
    return ProductSchema.parse(
      await ky
        .get(`${client.baseUrl}/wp-json/wc/v3/products/${productId}`, {
          headers: client.headers,
          timeout: 30_000,
          retry: { limit: 1 },
        })
        .json(),
    ).meta_data
  } catch {
    return []
  }
}
async function fetchVariationMeta(
  client: WooClient,
  productId: number,
  variationId: number,
): Promise<readonly Meta[]> {
  if (productId <= 0 || variationId <= 0) return []
  try {
    return VariationSchema.parse(
      await ky
        .get(`${client.baseUrl}/wp-json/wc/v3/products/${productId}/variations/${variationId}`, {
          headers: client.headers,
          timeout: 30_000,
          retry: { limit: 1 },
        })
        .json(),
    ).meta_data
  } catch {
    return []
  }
}

function metaFromOrderItem(
  meta: readonly Meta[],
): SupplierMeta & { readonly hasSnapshot: boolean } {
  const supplierId = supplierIdFrom(firstMeta(meta, ["_hub_supplier_id"]))
  return {
    supplierId,
    sourceProductId: firstMeta(meta, ["_hub_source_product_id"]),
    sourceOptionId: firstMeta(meta, ["_hub_source_option_id"]),
    originalProductName: firstMeta(meta, ["_hub_original_product_name"]),
    originalOptionName: firstMeta(meta, ["_hub_original_option_name"]),
    hasSnapshot: supplierId !== "unknown" || firstMeta(meta, ["_hub_supplier_label"]).length > 0,
  }
}

function metaFromVariation(meta: readonly Meta[]): SupplierMeta {
  return {
    supplierId: supplierIdFrom(
      firstMeta(meta, [
        "_selected_supplier_id",
        "_wholesalehub_selected_supplier_id",
        "_supplier_id",
        "_wholesalehub_supplier_id",
        "_b2b_source",
      ]),
    ),
    sourceProductId: firstMeta(meta, ["_source_product_id", "_wholesalehub_source_product_id"]),
    sourceOptionId: firstMeta(meta, ["_source_option_id", "_wholesalehub_source_option_id"]),
    originalProductName: firstMeta(meta, [
      "_original_product_name",
      "_wholesalehub_original_product_name",
    ]),
    originalOptionName: firstMeta(meta, [
      "_original_option_name",
      "_wholesalehub_original_option_name",
    ]),
  }
}

function firstMeta(meta: readonly Meta[], keys: readonly string[]): string {
  for (const key of keys) {
    const value = meta.find((item) => item.key === key)?.value
    if (typeof value === "string" && value.trim().length > 0) return value.trim()
    if (typeof value === "number") return String(value)
  }
  return ""
}
function supplierIdFrom(value: string): string {
  const supplier = value.toLowerCase().trim()
  if (supplier.includes("dailyfood") || supplier.includes("daily")) return "dailyfood"
  if (supplier.includes("walldob2b") || supplier.includes("walldo") || supplier.includes("wall"))
    return "walldob2b"
  return "unknown"
}
function supplierLabel(supplierId: string): string {
  if (supplierId === "dailyfood") return "데일리"
  if (supplierId === "walldob2b") return "월억"
  return "미확인"
}
function optionName(item: LineItem): string {
  const candidates = item.meta_data
    .filter((meta) => !meta.key.startsWith("_"))
    .map((meta) =>
      typeof meta.value === "string" || typeof meta.value === "number" ? String(meta.value) : "",
    )
    .filter(Boolean)
  return candidates.join(" / ")
}
function dateRange(options: Options): { readonly after: string; readonly before: string } {
  const now = new Date()
  const from = options.from ? new Date(`${options.from}T00:00:00.000Z`) : new Date(now)
  if (!options.from) from.setUTCDate(from.getUTCDate() - options.days)
  const to = options.to ? new Date(`${options.to}T23:59:59.999Z`) : now
  return { after: from.toISOString(), before: to.toISOString() }
}
function parseArgs(args: readonly string[]): Options {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--"))
      throw new Error(`invalid argument: ${key ?? "unknown"}`)
    values.set(key, value)
    index += 1
  }
  return {
    days: Number.parseInt(values.get("--days") ?? "7", 10),
    from: values.get("--from") ?? null,
    to: values.get("--to") ?? null,
    outputDir: values.get("--out-dir") ?? "reports",
  }
}
async function writeReport(
  rows: readonly Row[],
  outputDir: string,
  options: Options,
): Promise<void> {
  await mkdir(outputDir, { recursive: true })
  const csv = [
    COLUMNS.join(","),
    ...rows.map((row) => COLUMNS.map((column) => csvCell(row[column])).join(",")),
  ].join("\n")
  await writeFile(
    resolve(outputDir, "order-supplier-fulfillment-report.csv"),
    `\uFEFF${csv}\n`,
    "utf8",
  )
  const counts = countBy(rows.map((row) => row.supplier_label))
  await writeFile(
    resolve(outputDir, "order-supplier-fulfillment-summary.md"),
    [
      "# Order Supplier Fulfillment Summary",
      "",
      `- generated_at: ${new Date().toISOString()}`,
      `- range: ${options.from ?? `last_${options.days}_days`} ~ ${options.to ?? "now"}`,
      `- row_count: ${rows.length}`,
      `- 데일리: ${counts["데일리"] ?? 0}`,
      `- 월억: ${counts["월억"] ?? 0}`,
      `- 미확인: ${counts["미확인"] ?? 0}`,
      "- wooCommerceChanged: false",
      "",
    ].join("\n"),
    "utf8",
  )
}
function csvCell(value: string | number): string {
  const text = String(value).replace(/"/gu, '""')
  return /[",\n\r]/u.test(text) ? `"${text}"` : text
}
function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}
async function loadDotEnv(): Promise<void> {
  try {
    const env = await import("node:fs/promises").then((fs) => fs.readFile(".env", "utf8"))
    for (const line of env.split(/\r?\n/u)) {
      const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line)
      if (match?.[1] !== undefined && process.env[match[1]] === undefined)
        process.env[match[1]] = match[2] ?? ""
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
}
function readRequiredEnv(key: string): string {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`${key} is required`)
  return value
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
