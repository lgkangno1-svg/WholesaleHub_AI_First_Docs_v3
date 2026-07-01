import { mkdir, readFile, writeFile } from "node:fs/promises"
import ky from "ky"
import { z } from "zod"
import { parseDailyFoodCsv } from "../adapters/dailyfood/dailyfood-adapter.js"
import { fetchDailyFoodHtmlViewAsCsv } from "../adapters/dailyfood/dailyfood-htmlview.js"
import {
  fetchWalldob2bProductExcel,
  parseWalldob2bProductExcelHtml,
} from "../adapters/walldob2b/walldob2b-excel-download.js"
import { loadSupplierConfig } from "../config/supplier-config-loader.js"
import type { CollectedProduct } from "../domain/product.js"

const CONFIRM = "HIDE_UNSOLD_PUBLIC_VARIATIONS"
const ProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  status: z.string(),
  catalog_visibility: z.string().default("visible"),
})
const VariationSchema = z.object({
  id: z.number().int(),
  stock_status: z.string().default(""),
  attributes: z
    .array(z.object({ name: z.string().default(""), option: z.string().default("") }))
    .default([]),
  meta_data: z.array(z.object({ key: z.string(), value: z.unknown() })).default([]),
})
const ProductsSchema = z.array(ProductSchema)
const VariationsSchema = z.array(VariationSchema)

type Credentials = { baseUrl: string; consumerKey: string; consumerSecret: string }
type WooClient = ReturnType<typeof woo>
type Product = z.infer<typeof ProductSchema>
type Variation = z.infer<typeof VariationSchema>
type Row = {
  product_id: number
  variation_id: number
  product_name: string
  option_name: string
  supplier_id: string
  source_product_id: string
  source_option_id: string
  current_stock_status: string
  new_stock_status: string
  action: "mark_outofstock" | "mark_instock" | "no_op" | "review_needed"
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
  const daily = await collectDaily()
  const walldo = await collectWalldo()
  if (daily.length < 400) throw new Error(`dailyfood crawl failed or too low: ${daily.length}`)
  if (walldo.length < 180) throw new Error(`walldo crawl failed or too low: ${walldo.length}`)
  const available = availableKeys([...daily, ...walldo])
  const products = await fetchProducts(client)
  const rows: Row[] = []
  let productHidden = 0
  let productVisible = 0
  for (const product of products) {
    const variations = await fetchVariations(client, product.id)
    const expectedStatuses: string[] = []
    for (const variation of variations) {
      const meta = metaMap(variation)
      const supplierId =
        stringMeta(meta, "_selected_supplier_id") || stringMeta(meta, "_supplier_id")
      const sourceProductId = stringMeta(meta, "_source_product_id")
      const sourceOptionId = stringMeta(meta, "_source_option_id")
      const option = optionName(variation)
      if (!supplierId || !sourceProductId || !sourceOptionId) {
        rows.push({
          product_id: product.id,
          variation_id: variation.id,
          product_name: product.name,
          option_name: option,
          supplier_id: supplierId,
          source_product_id: sourceProductId,
          source_option_id: sourceOptionId,
          current_stock_status: variation.stock_status,
          new_stock_status: "review",
          action: "review_needed",
          reason_korean: "공급처 추적 meta 부족으로 자동 품절 판단 보류",
        })
        expectedStatuses.push(variation.stock_status)
        continue
      }
      const isAvailable = available.has(sourceKey(supplierId, sourceProductId, sourceOptionId))
      const expected = isAvailable ? "instock" : "outofstock"
      expectedStatuses.push(expected)
      if (variation.stock_status === expected) {
        rows.push({
          product_id: product.id,
          variation_id: variation.id,
          product_name: product.name,
          option_name: option,
          supplier_id: supplierId,
          source_product_id: sourceProductId,
          source_option_id: sourceOptionId,
          current_stock_status: variation.stock_status,
          new_stock_status: expected,
          action: "no_op",
          reason_korean: isAvailable ? "공급처 최신 수집에 판매중으로 존재" : "이미 품절 처리됨",
        })
        continue
      }
      await updateVariationStock(client, product.id, variation.id, expected)
      rows.push({
        product_id: product.id,
        variation_id: variation.id,
        product_name: product.name,
        option_name: option,
        supplier_id: supplierId,
        source_product_id: sourceProductId,
        source_option_id: sourceOptionId,
        current_stock_status: variation.stock_status,
        new_stock_status: expected,
        action: expected === "instock" ? "mark_instock" : "mark_outofstock",
        reason_korean: isAvailable
          ? "공급처 최신 수집에 판매중으로 존재하여 instock 보정"
          : "선택 공급처 최신 수집에서 사라져 품절/미판매로 판단",
      })
    }
    const hasInstock = expectedStatuses.includes("instock")
    const expectedVisibility = hasInstock ? "visible" : "hidden"
    if (product.catalog_visibility !== expectedVisibility) {
      await updateProductVisibility(client, product.id, expectedVisibility)
      if (expectedVisibility === "hidden") productHidden++
      else productVisible++
    }
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    dailyfoodOptions: daily.length,
    walldoOptions: walldo.length,
    publicProducts: products.length,
    verifiedVariations: rows.length,
    markOutofstock: rows.filter((row) => row.action === "mark_outofstock").length,
    markInstock: rows.filter((row) => row.action === "mark_instock").length,
    reviewNeeded: rows.filter((row) => row.action === "review_needed").length,
    productHidden,
    productVisible,
    goldMango: rows.filter((row) => row.product_name.includes("골드망고")),
  }
  await writeReports(summary, rows)
  console.log(JSON.stringify(summary, null, 2))
}

function parseArgs(args: readonly string[]) {
  const m = new Map<string, string>()
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (key === "--execute") {
      m.set(key, "true")
      continue
    }
    const value = args[i + 1]
    if (!key || !value || !key.startsWith("--"))
      throw new Error(`invalid argument: ${key ?? "unknown"}`)
    m.set(key, value)
    i++
  }
  return { execute: m.get("--execute") === "true", confirm: m.get("--confirm") ?? "" }
}

async function collectDaily(): Promise<readonly CollectedProduct[]> {
  const config = await loadSupplierConfig("config/suppliers/dailyfood.google_sheet.yml")
  const csv = (await fetchDailyFoodHtmlViewAsCsv(config.googleSheet.sheetUrl)).csv
  return parseDailyFoodCsv(csv, config).products
}

async function collectWalldo(): Promise<readonly CollectedProduct[]> {
  const html = await fetchWalldob2bProductExcel({
    username: env("WALLDOB2B_USERNAME"),
    password: env("WALLDOB2B_PASSWORD"),
  })
  return parseWalldob2bProductExcelHtml(html, 10000).products
}

function availableKeys(products: readonly CollectedProduct[]): Set<string> {
  const out = new Set<string>()
  for (const product of products) {
    if (product.stockStatus === "out_of_stock") continue
    const ids = sourceIds(product)
    out.add(sourceKey(product.supplierId, ids.sourceProductId, ids.sourceOptionId))
  }
  return out
}

function sourceIds(product: CollectedProduct): { sourceProductId: string; sourceOptionId: string } {
  const raw = safeJson(product.rawJson)
  const sourceProductId =
    stringValue(raw["sourceProductId"]) ||
    stringValue(raw["walldoItId"]) ||
    stableId(product.originalProductName)
  const sourceOptionId =
    stringValue(raw["sourceOptionId"]) || stableId(product.originalOptionName ?? "기본")
  return { sourceProductId, sourceOptionId }
}

async function fetchProducts(client: WooClient): Promise<Product[]> {
  const products: Product[] = []
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

async function fetchVariations(client: WooClient, productId: number): Promise<Variation[]> {
  return VariationsSchema.parse(
    await ky
      .get(`${client.baseUrl}/wp-json/wc/v3/products/${productId}/variations`, {
        headers: client.headers,
        searchParams: { status: "any", per_page: "100" },
        timeout: 60000,
        retry: { limit: 1 },
      })
      .json(),
  )
}

async function updateVariationStock(
  client: WooClient,
  productId: number,
  variationId: number,
  stockStatus: string,
): Promise<void> {
  await ky.put(`${client.baseUrl}/wp-json/wc/v3/products/${productId}/variations/${variationId}`, {
    headers: client.headers,
    json: { stock_status: stockStatus },
    timeout: 60000,
    retry: { limit: 0 },
  })
}

async function updateProductVisibility(
  client: WooClient,
  productId: number,
  visibility: string,
): Promise<void> {
  await ky.put(`${client.baseUrl}/wp-json/wc/v3/products/${productId}`, {
    headers: client.headers,
    json: { catalog_visibility: visibility },
    timeout: 60000,
    retry: { limit: 0 },
  })
}

function optionName(variation: Variation): string {
  return (
    variation.attributes
      .map((attribute) => attribute.option)
      .filter(Boolean)
      .join(" / ") || "기본"
  )
}

function metaMap(variation: Variation): Map<string, unknown> {
  return new Map(variation.meta_data.map((item) => [item.key, item.value]))
}

function stringMeta(meta: Map<string, unknown>, key: string): string {
  return stringValue(meta.get(key)).trim()
}

function sourceKey(supplierId: string, productId: string, optionId: string): string {
  return `${supplierId}|${productId}|${optionId}`
}

function stableId(value: string): string {
  return clean(value).slice(0, 120)
}

function clean(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/&nbsp;/giu, " ")
    .replace(/[^가-힣a-zA-Z0-9.]/gu, "")
    .toLocaleLowerCase("ko-KR")
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : ""
}

async function writeReports(summary: unknown, rows: readonly Row[]): Promise<void> {
  await mkdir("reports", { recursive: true })
  await writeFile(
    "reports/public-unsold-visibility-audit.json",
    `${JSON.stringify({ summary, rows }, null, 2)}\n`,
  )
  await writeFile("reports/public-unsold-visibility-audit.csv", toCsv(rows))
  const s = summary as {
    dailyfoodOptions: number
    walldoOptions: number
    verifiedVariations: number
    markOutofstock: number
    markInstock: number
    reviewNeeded: number
    productHidden: number
    productVisible: number
  }
  await writeFile(
    "reports/public-unsold-visibility-audit-summary.md",
    [
      "# Public Unsold Visibility Audit",
      "",
      `- dailyfood_options: ${s.dailyfoodOptions}`,
      `- walldo_options: ${s.walldoOptions}`,
      `- verified_variations: ${s.verifiedVariations}`,
      `- mark_outofstock: ${s.markOutofstock}`,
      `- mark_instock: ${s.markInstock}`,
      `- review_needed: ${s.reviewNeeded}`,
      `- products_hidden: ${s.productHidden}`,
      `- products_visible_restored: ${s.productVisible}`,
      "- product_name/price/category/image/description/order data changed: no",
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
    "source_product_id",
    "source_option_id",
    "current_stock_status",
    "new_stock_status",
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

function woo(credentials: Credentials) {
  return {
    baseUrl: credentials.baseUrl.replace(/\/$/u, ""),
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.consumerKey}:${credentials.consumerSecret}`).toString("base64")}`,
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
