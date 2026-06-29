import { mkdir, readFile } from "node:fs/promises"
import ExcelJS from "exceljs"
import ky from "ky"
import { z } from "zod"

const MetaSchema = z.object({ key: z.string(), value: z.unknown() })
const AddressSchema = z
  .object({
    first_name: z.string().default(""),
    last_name: z.string().default(""),
    phone: z.string().default(""),
    postcode: z.string().default(""),
    address_1: z.string().default(""),
    address_2: z.string().default(""),
  })
  .default({ first_name: "", last_name: "", phone: "", postcode: "", address_1: "", address_2: "" })
const OrderSchema = z.object({
  id: z.number().int(),
  date_created: z.string().default(""),
  status: z.string().default(""),
  customer_note: z.string().default(""),
  billing: AddressSchema,
  shipping: AddressSchema,
  line_items: z
    .array(
      z.object({
        product_id: z.number().int().default(0),
        variation_id: z.number().int().default(0),
        name: z.string().default(""),
        quantity: z.number().default(0),
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
type Options = { readonly days: number; readonly from: string | null; readonly to: string | null }
type SupplierMeta = {
  readonly supplierId: string
  readonly sourceProductId: string
  readonly sourceOptionId: string
  readonly originalProductName: string
  readonly originalOptionName: string
}
type ExportRow = {
  readonly order: Order
  readonly item: LineItem
  readonly supplier: SupplierMeta
}
type WooClient = { readonly baseUrl: string; readonly headers: Record<string, string> }

type ExportSummary = {
  readonly walldoRows: number
  readonly dailyfoodRows: number
  readonly walldoPath: string
  readonly dailyfoodPath: string
}

async function main(): Promise<void> {
  await loadDotEnv()
  const options = parseArgs(process.argv.slice(2))
  const credentials = {
    baseUrl: readRequiredEnv("WOOCOMMERCE_BASE_URL"),
    consumerKey: readRequiredEnv("WOOCOMMERCE_CONSUMER_KEY"),
    consumerSecret: readRequiredEnv("WOOCOMMERCE_CONSUMER_SECRET"),
  }
  const summary = await exportSupplierOrderExcels(credentials, options)
  console.log(JSON.stringify({ ...summary, wooCommerceChanged: false }, null, 2))
}

export async function exportSupplierOrderExcels(
  credentials: Credentials,
  options: Options,
): Promise<ExportSummary> {
  const client = wooClient(credentials)
  const orders = await fetchOrders(client, dateRange(options))
  const fallbackCache = new Map<string, SupplierMeta>()
  const rows: ExportRow[] = []
  for (const order of orders) {
    for (const item of order.line_items) {
      const supplier = await supplierForItem(client, fallbackCache, item)
      if (supplier.supplierId === "dailyfood" || supplier.supplierId === "walldob2b") {
        rows.push({ order, item, supplier })
      }
    }
  }
  const walldoRows = rows.filter((row) => row.supplier.supplierId === "walldob2b")
  const dailyRows = rows.filter((row) => row.supplier.supplierId === "dailyfood")
  await mkdir("reports/orders", { recursive: true })
  const walldoPath = "reports/orders/walldo-order.xlsx"
  const dailyfoodPath = "reports/orders/dailyfood-order.xlsx"
  await writeWalldoWorkbook(walldoRows, walldoPath)
  await writeDailyFoodWorkbook(dailyRows, dailyfoodPath)
  return {
    walldoRows: walldoRows.length,
    dailyfoodRows: dailyRows.length,
    walldoPath,
    dailyfoodPath,
  }
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
            status: "any",
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

async function supplierForItem(
  client: WooClient,
  cache: Map<string, SupplierMeta>,
  item: LineItem,
): Promise<SupplierMeta> {
  const snapshot = metaFromOrderItem(item.meta_data)
  if (snapshot.supplierId !== "unknown") return snapshot
  return fallbackSupplier(client, cache, item.product_id, item.variation_id)
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
  const productMeta = await fetchProductMeta(client, productId)
  const variationMeta =
    variationId > 0 ? await fetchVariationMeta(client, productId, variationId) : []
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

function metaFromOrderItem(meta: readonly Meta[]): SupplierMeta {
  return {
    supplierId: supplierIdFrom(firstMeta(meta, ["_hub_supplier_id"])),
    sourceProductId: firstMeta(meta, ["_hub_source_product_id"]),
    sourceOptionId: firstMeta(meta, ["_hub_source_option_id"]),
    originalProductName: firstMeta(meta, ["_hub_original_product_name"]),
    originalOptionName: firstMeta(meta, ["_hub_original_option_name"]),
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

async function writeWalldoWorkbook(rows: readonly ExportRow[], outputPath: string): Promise<void> {
  const template = new ExcelJS.Workbook()
  await template.xlsx.readFile("templates/orders/walldo.sample.xlsx")
  const templateSheet = template.worksheets[0]
  if (!templateSheet) throw new Error("walldo template has no worksheet")
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(templateSheet.name)
  copyHeader(templateSheet, sheet, 11)
  const styleRow = cloneRowStyle(templateSheet.getRow(2), 11)
  rows.forEach((row, index) => {
    const target = sheet.getRow(index + 2)
    applyRowStyle(target, styleRow)
    const shipping = preferredShipping(row.order)
    const billing = row.order.billing
    setText(target.getCell(1), String(row.order.id))
    target.getCell(2).value = row.supplier.originalProductName || row.item.name
    target.getCell(3).value = row.supplier.originalOptionName || optionName(row.item)
    target.getCell(4).value = row.item.quantity
    target.getCell(5).value = personName(shipping)
    setText(target.getCell(6), shipping.phone || billing.phone)
    setText(target.getCell(7), shipping.postcode || billing.postcode)
    target.getCell(8).value = fullAddress(shipping) || fullAddress(billing)
    target.getCell(9).value = row.order.customer_note
    target.getCell(10).value = personName(billing) || personName(shipping)
    setText(target.getCell(11), billing.phone || shipping.phone)
    target.commit()
  })
  await workbook.xlsx.writeFile(outputPath)
}

async function writeDailyFoodWorkbook(
  rows: readonly ExportRow[],
  outputPath: string,
): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile("templates/orders/dailyfood.sample.xlsx")
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error("dailyfood template has no worksheet")
  if (sheet.rowCount > 1) sheet.spliceRows(2, sheet.rowCount - 1)
  rows.forEach((row, index) => {
    const target = sheet.getRow(index + 2)
    const shipping = preferredShipping(row.order)
    const billing = row.order.billing
    target.getCell(1).value = "??? ??? ??? ??? ???? 577, 104?"
    target.getCell(2).value = "????"
    setText(target.getCell(3), "01039998933")
    target.getCell(4).value = fullAddress(shipping) || fullAddress(billing)
    target.getCell(5).value = personName(shipping)
    setText(target.getCell(6), shipping.phone || billing.phone)
    setText(target.getCell(7), billing.phone || shipping.phone)
    target.getCell(8).value = row.item.quantity
    target.getCell(9).value = [
      row.supplier.originalProductName || row.item.name,
      row.supplier.originalOptionName || optionName(row.item),
    ]
      .filter(Boolean)
      .join(" / ")
    target.getCell(10).value = row.order.customer_note
    setText(target.getCell(11), String(row.order.id))
    target.commit()
  })
  await workbook.xlsx.writeFile(outputPath)
}

function copyHeader(source: ExcelJS.Worksheet, target: ExcelJS.Worksheet, columns: number): void {
  for (let column = 1; column <= columns; column += 1) {
    const width = source.getColumn(column).width
    if (width !== undefined) target.getColumn(column).width = width
    const sourceCell = source.getRow(1).getCell(column)
    const targetCell = target.getRow(1).getCell(column)
    targetCell.value = sourceCell.value
    targetCell.style = { ...sourceCell.style }
  }
  const height = source.getRow(1).height
  if (height !== undefined) target.getRow(1).height = height
  target.getRow(1).commit()
}

function cloneRowStyle(row: ExcelJS.Row, columns: number): readonly Partial<ExcelJS.Style>[] {
  const styles: Partial<ExcelJS.Style>[] = []
  for (let column = 1; column <= columns; column += 1) {
    styles.push({ ...row.getCell(column).style })
  }
  return styles
}
function applyRowStyle(row: ExcelJS.Row, styles: readonly Partial<ExcelJS.Style>[]): void {
  styles.forEach((style, index) => {
    row.getCell(index + 1).style = { ...style }
  })
}
function setText(cell: ExcelJS.Cell, value: string): void {
  cell.value = value
  cell.numFmt = "@"
}
function preferredShipping(order: Order): Order["shipping"] {
  return fullAddress(order.shipping).length > 0 || personName(order.shipping).length > 0
    ? order.shipping
    : order.billing
}
function personName(address: Order["billing"]): string {
  return [address.last_name, address.first_name].filter(Boolean).join("").trim()
}
function fullAddress(address: Order["billing"]): string {
  return [address.address_1, address.address_2].filter(Boolean).join(" ").trim()
}
function optionName(item: LineItem): string {
  return item.meta_data
    .filter((meta) => !meta.key.startsWith("_"))
    .map((meta) =>
      typeof meta.value === "string" || typeof meta.value === "number" ? String(meta.value) : "",
    )
    .filter(Boolean)
    .join(" / ")
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
  }
}
function dateRange(options: Options): { readonly after: string; readonly before: string } {
  const now = new Date()
  const from = options.from ? new Date(`${options.from}T00:00:00.000Z`) : new Date(now)
  if (!options.from) from.setUTCDate(from.getUTCDate() - options.days)
  const to = options.to ? new Date(`${options.to}T23:59:59.999Z`) : now
  return { after: from.toISOString(), before: to.toISOString() }
}
async function loadDotEnv(): Promise<void> {
  try {
    const env = await readFile(".env", "utf8")
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
