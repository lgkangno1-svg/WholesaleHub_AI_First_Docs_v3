import { mkdir, readFile, writeFile } from "node:fs/promises"
import ky from "ky"
import { z } from "zod"

const CONFIRM = "AUDIT_PUBLIC_VARIATION_PRICES"
const ProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  status: z.string(),
  type: z.string(),
})
const VariationSchema = z.object({
  id: z.number().int(),
  regular_price: z.string().default(""),
  stock_status: z.string().default(""),
  attributes: z
    .array(z.object({ name: z.string().default(""), option: z.string().default("") }))
    .default([]),
  meta_data: z
    .array(z.object({ key: z.string(), value: z.unknown(), id: z.number().optional() }))
    .default([]),
})
const ProductsSchema = z.array(ProductSchema)
const VariationsSchema = z.array(VariationSchema)

type Credentials = { baseUrl: string; consumerKey: string; consumerSecret: string }
type Row = {
  product_id: number
  variation_id: number
  product_name: string
  option_name: string
  supplier_id: string
  cost_before: number | ""
  cost_used: number | ""
  price_before: number
  price_after: number | ""
  action: "updated" | "no_op" | "blocked"
  reason_korean: string
}

async function main(): Promise<void> {
  await loadDotEnv()
  const args = parseArgs(process.argv.slice(2))
  if (!args.execute || args.confirm !== CONFIRM) {
    throw new Error(`--execute --confirm "${CONFIRM}" is required`)
  }
  const credentials = {
    baseUrl: env("WOOCOMMERCE_BASE_URL"),
    consumerKey: env("WOOCOMMERCE_CONSUMER_KEY"),
    consumerSecret: env("WOOCOMMERCE_CONSUMER_SECRET"),
  }
  const client = woo(credentials)
  const products = await fetchProducts(client)
  const rows: Row[] = []
  for (const product of products) {
    const variations = await fetchVariations(client, product.id)
    for (const variation of variations) {
      const option = optionName(variation)
      const meta = metaMap(variation)
      const currentPrice = toNumber(variation.regular_price)
      const currentCost = toNumber(meta.get("_wholesalehub_supplier_cost"))
      const overrideCost = cherryCostOverride(product.name, option)
      const cost = overrideCost ?? currentCost
      if (!Number.isFinite(cost) || cost <= 0) {
        rows.push({
          product_id: product.id,
          variation_id: variation.id,
          product_name: product.name,
          option_name: option,
          supplier_id: String(meta.get("_supplier_id") ?? meta.get("_selected_supplier_id") ?? ""),
          cost_before: Number.isFinite(currentCost) ? currentCost : "",
          cost_used: "",
          price_before: currentPrice,
          price_after: "",
          action: "blocked",
          reason_korean: "공급처 원가 meta 없음 또는 비정상",
        })
        continue
      }
      const expected = salePrice(cost)
      if (
        currentPrice === expected &&
        (overrideCost === undefined || currentCost === overrideCost)
      ) {
        rows.push({
          product_id: product.id,
          variation_id: variation.id,
          product_name: product.name,
          option_name: option,
          supplier_id: String(meta.get("_supplier_id") ?? meta.get("_selected_supplier_id") ?? ""),
          cost_before: currentCost,
          cost_used: cost,
          price_before: currentPrice,
          price_after: expected,
          action: "no_op",
          reason_korean: "rules.md 마진 규칙과 일치",
        })
        continue
      }
      const metaData =
        overrideCost === undefined
          ? undefined
          : [{ key: "_wholesalehub_supplier_cost", value: String(overrideCost) }]
      await ky.put(
        `${client.baseUrl}/wp-json/wc/v3/products/${product.id}/variations/${variation.id}`,
        {
          headers: client.headers,
          json: { regular_price: String(expected), ...(metaData ? { meta_data: metaData } : {}) },
          timeout: 60000,
          retry: { limit: 0 },
        },
      )
      rows.push({
        product_id: product.id,
        variation_id: variation.id,
        product_name: product.name,
        option_name: option,
        supplier_id: String(meta.get("_supplier_id") ?? meta.get("_selected_supplier_id") ?? ""),
        cost_before: Number.isFinite(currentCost) ? currentCost : "",
        cost_used: cost,
        price_before: currentPrice,
        price_after: expected,
        action: "updated",
        reason_korean:
          overrideCost === undefined
            ? "공급처 원가 meta 기준 rules.md 마진 규칙으로 보정"
            : "체리 공급처 최신 확인 원가 기준 rules.md 마진 규칙으로 보정",
      })
    }
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    publicProductCount: products.length,
    verifiedVariationCount: rows.length,
    updatedVariationCount: rows.filter((row) => row.action === "updated").length,
    blockedCount: rows.filter((row) => row.action === "blocked").length,
    cherryRows: rows.filter((row) => row.product_name.includes("체리")),
  }
  await writeReports(summary, rows)
  console.log(JSON.stringify(summary, null, 2))
  if (summary.blockedCount > 0) throw new Error(`price audit blocked: ${summary.blockedCount}`)
}

function parseArgs(args: readonly string[]) {
  const m = new Map<string, string>()
  for (let i = 0; i < args.length; i++) {
    const k = args[i]
    if (k === "--execute") {
      m.set(k, "true")
      continue
    }
    const v = args[i + 1]
    if (!k || !v || !k.startsWith("--")) throw new Error(`invalid argument: ${k ?? "unknown"}`)
    m.set(k, v)
    i++
  }
  return { execute: m.get("--execute") === "true", confirm: m.get("--confirm") ?? "" }
}

function cherryCostOverride(productName: string, optionNameValue: string): number | undefined {
  if (!productName.includes("체리")) return undefined
  const normalized = optionNameValue.replace(/\s+/gu, "")
  if (normalized.includes("특대과") && normalized.includes("1kg")) return 26000
  if (normalized.includes("특대과") && normalized.includes("2kg")) return 44500
  if (normalized.includes("대과") && !normalized.includes("특대과") && normalized.includes("1kg"))
    return 24000
  if (normalized.includes("대과") && !normalized.includes("특대과") && normalized.includes("2kg"))
    return 40500
  return undefined
}

function salePrice(cost: number): number {
  return cost + (cost < 10000 ? 1500 : cost < 20000 ? 2000 : cost < 30000 ? 3000 : 4000)
}

function optionName(variation: z.infer<typeof VariationSchema>): string {
  return (
    variation.attributes
      .map((attribute) => attribute.option)
      .filter(Boolean)
      .join(" / ") || "기본"
  )
}

function metaMap(variation: z.infer<typeof VariationSchema>): Map<string, unknown> {
  return new Map(variation.meta_data.map((item) => [item.key, item.value]))
}

function toNumber(value: unknown): number {
  const numberValue =
    typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.]/gu, ""))
  return Number.isFinite(numberValue) ? numberValue : Number.NaN
}

async function fetchProducts(client: ReturnType<typeof woo>) {
  const products: z.infer<typeof ProductSchema>[] = []
  for (let page = 1; page <= 30; page++) {
    const rows = ProductsSchema.parse(
      await ky
        .get(`${client.baseUrl}/wp-json/wc/v3/products`, {
          headers: client.headers,
          searchParams: { status: "publish", per_page: "100", page: String(page) },
          timeout: 60000,
          retry: { limit: 1 },
        })
        .json(),
    )
    products.push(...rows)
    if (rows.length < 100) break
  }
  return products
}

async function fetchVariations(client: ReturnType<typeof woo>, productId: number) {
  const rows = VariationsSchema.parse(
    await ky
      .get(`${client.baseUrl}/wp-json/wc/v3/products/${productId}/variations`, {
        headers: client.headers,
        searchParams: { status: "any", per_page: "100" },
        timeout: 60000,
        retry: { limit: 1 },
      })
      .json(),
  )
  return rows
}

async function writeReports(summary: unknown, rows: readonly Row[]): Promise<void> {
  await mkdir("reports", { recursive: true })
  await writeFile(
    "reports/public-variation-price-audit.json",
    `${JSON.stringify({ summary, rows }, null, 2)}\n`,
  )
  await writeFile("reports/public-variation-price-audit.csv", toCsv(rows))
  const s = summary as {
    verifiedVariationCount: number
    updatedVariationCount: number
    blockedCount: number
  }
  await writeFile(
    "reports/public-variation-price-audit-summary.md",
    [
      "# Public Variation Price Audit",
      "",
      `- verified_variations: ${s.verifiedVariationCount}`,
      `- updated_variations: ${s.updatedVariationCount}`,
      `- blocked: ${s.blockedCount}`,
      "- rule: rules.md fixed margin only",
      "- product_name/option/stock/image/description/category/order data changed: no",
    ].join("\n"),
  )
}

function toCsv(rows: readonly Row[]): string {
  const header = [
    "product_id",
    "variation_id",
    "product_name",
    "option_name",
    "supplier_id",
    "cost_before",
    "cost_used",
    "price_before",
    "price_after",
    "action",
    "reason_korean",
  ] as const
  return `${[header, ...rows.map((row) => header.map((field) => row[field]))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n")}\n`
}

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/gu, '""')}"`
}

function woo(c: Credentials) {
  return {
    baseUrl: c.baseUrl.replace(/\/$/u, ""),
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.consumerKey}:${c.consumerSecret}`).toString("base64")}`,
    },
  }
}

async function loadDotEnv(): Promise<void> {
  try {
    const text = await readFile(".env", "utf8")
    for (const line of text.split(/\r?\n/u)) {
      const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line)
      if (match?.[1] && process.env[match[1]] === undefined) process.env[match[1]] = match[2] ?? ""
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
}

function env(key: string): string {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`${key} is required`)
  return value
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
