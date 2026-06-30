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

const CONFIRM = "REBUILD_DRAFT_CATALOG_FROM_SUPPLIERS"
const ProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  status: z.string(),
  type: z.string(),
})
const VariationSchema = z.object({ id: z.number().int() })
type Candidate = {
  supplierId: string
  sourceProductId: string
  sourceOptionId: string
  productName: string
  optionName: string
  price: number
  stockStatus: CollectedProduct["stockStatus"]
  productGroupKey: string
  optionKey: string
  raw: CollectedProduct
}
type RebuildEntry = {
  product_id?: number
  variation_id?: number
  product_name: string
  option_name?: string
  price?: number
  supplier?: string
  status: "created" | "failed"
  candidate_count?: number
  error?: string
}
type RebuildResult = {
  summary: {
    dailyFoodCount: number
    walldoCount: number
    groupCount: number
    productCreated: number
    variationCreated: number
    publicCreated: number
    afterProducts: number
    afterVariations: number
    failed: number
    generatedAt: string
  }
  entries: RebuildEntry[]
}
type Group = {
  productKey: string
  productName: string
  options: { optionKey: string; optionName: string; selected: Candidate; candidates: Candidate[] }[]
}

type Credentials = { baseUrl: string; consumerKey: string; consumerSecret: string }
async function main() {
  await loadDotEnv()
  const args = parseArgs(process.argv.slice(2))
  if (!args.execute || args.confirm !== CONFIRM)
    throw new Error(`--execute --confirm "${CONFIRM}" is required`)
  const credentials = {
    baseUrl: env("WOOCOMMERCE_BASE_URL"),
    consumerKey: env("WOOCOMMERCE_CONSUMER_KEY"),
    consumerSecret: env("WOOCOMMERCE_CONSUMER_SECRET"),
  }
  const before = await countCatalog(credentials)
  if (before.products !== 0 || before.variations !== 0)
    throw new Error(
      `WooCommerce catalog is not empty: products=${before.products}, variations=${before.variations}`,
    )
  const daily = await collectDaily()
  const walldo = await collectWalldo()
  if (daily.length < 400 || walldo.length < 180)
    throw new Error(`supplier collection failed: daily=${daily.length}, walldo=${walldo.length}`)
  const groups = groupProducts([...daily, ...walldo])
  const result = await createDraftCatalog(credentials, groups, daily.length, walldo.length)
  await writeReports(result)
  console.log(JSON.stringify(result.summary, null, 2))
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
async function collectDaily() {
  const cfg = await loadSupplierConfig("config/suppliers/dailyfood.google_sheet.yml")
  const csv = (await fetchDailyFoodHtmlViewAsCsv(cfg.googleSheet.sheetUrl)).csv
  const products = [...parseDailyFoodCsv(csv, cfg).products]
  await mkdir("reports/snapshots", { recursive: true })
  await writeFile(
    "reports/snapshots/dailyfood-latest-success.json",
    `${JSON.stringify({ createdAt: new Date().toISOString(), products }, null, 2)}\n`,
  )
  return products
}
async function collectWalldo() {
  const html = await fetchWalldob2bProductExcel({
    username: env("WALLDOB2B_USERNAME"),
    password: env("WALLDOB2B_PASSWORD"),
  })
  return [...parseWalldob2bProductExcelHtml(html, 10000).products]
}
function groupProducts(products: CollectedProduct[]): Group[] {
  const optionGroups = new Map<string, Candidate[]>()
  for (const p of products) {
    const c = toCandidate(p)
    if (c.stockStatus === "out_of_stock") continue
    const k = `${c.productGroupKey}|${c.optionKey}`
    optionGroups.set(k, [...(optionGroups.get(k) ?? []), c])
  }
  const productMap = new Map<string, Group>()
  for (const [_, cands] of optionGroups) {
    const sorted = [...cands].sort(
      (a, b) => a.price - b.price || a.supplierId.localeCompare(b.supplierId),
    )
    const s = sorted[0]
    if (!s) continue
    const g = productMap.get(s.productGroupKey) ?? {
      productKey: s.productGroupKey,
      productName: s.productName,
      options: [],
    }
    g.options.push({
      optionKey: s.optionKey,
      optionName: s.optionName,
      selected: s,
      candidates: sorted,
    })
    productMap.set(s.productGroupKey, g)
  }
  return [...productMap.values()]
    .map((g) => ({
      ...g,
      options: g.options.sort((a, b) => a.optionName.localeCompare(b.optionName, "ko-KR")),
    }))
    .sort((a, b) => a.productName.localeCompare(b.productName, "ko-KR"))
}
function toCandidate(p: CollectedProduct): Candidate {
  const raw = safeJson(p.rawJson)
  const opt = p.originalOptionName ?? "기본"
  return {
    supplierId: p.supplierId,
    sourceProductId:
      stringValue(raw.sourceProductId) ||
      stringValue(raw.walldoItId) ||
      stableId(p.originalProductName),
    sourceOptionId: stringValue(raw.sourceOptionId) || stableId(opt),
    productName: p.originalProductName,
    optionName: opt,
    price: p.price,
    stockStatus: p.stockStatus,
    productGroupKey: productGroupKey(p.originalProductName),
    optionKey: opt === "기본" ? clean(opt) : optionKey(`${p.originalProductName} ${opt}`),
    raw: p,
  }
}
async function createDraftCatalog(
  credentials: Credentials,
  groups: Group[],
  dailyCount: number,
  walldoCount: number,
) {
  const client = woo(credentials)
  const entries: RebuildEntry[] = []
  let productCreated = 0,
    variationCreated = 0
  for (const group of groups) {
    try {
      const product = ProductSchema.parse(
        await ky
          .post(`${client.baseUrl}/wp-json/wc/v3/products`, {
            headers: client.headers,
            json: {
              name: group.productName,
              type: "variable",
              status: "draft",
              catalog_visibility: "hidden",
              attributes: [
                {
                  name: "옵션",
                  visible: true,
                  variation: true,
                  options: group.options.map((o) => o.optionName),
                },
              ],
              meta_data: [
                { key: "_wholesalehub_rebuilt_from_suppliers", value: "yes" },
                { key: "_wholesalehub_product_group_key", value: group.productKey },
              ],
            },
            timeout: 60000,
            retry: { limit: 0 },
          })
          .json(),
      )
      if (product.status !== "draft" && product.status !== "private")
        throw new Error(`created product public: ${product.id}:${product.status}`)
      productCreated++
      for (const opt of group.options) {
        const s = opt.selected
        const variation = VariationSchema.parse(
          await ky
            .post(`${client.baseUrl}/wp-json/wc/v3/products/${product.id}/variations`, {
              headers: client.headers,
              json: {
                regular_price: String(s.price),
                stock_status: "instock",
                manage_stock: false,
                attributes: [{ name: "옵션", option: opt.optionName }],
                meta_data: [
                  { key: "_supplier_id", value: s.supplierId },
                  { key: "_selected_supplier_id", value: s.supplierId },
                  { key: "_wholesalehub_selected_supplier_id", value: s.supplierId },
                  { key: "_source_product_id", value: s.sourceProductId },
                  { key: "_source_option_id", value: s.sourceOptionId },
                  { key: "_original_product_name", value: s.productName },
                  { key: "_original_option_name", value: s.optionName },
                  { key: "_product_group_key", value: s.productGroupKey },
                  { key: "_normalized_option_key", value: s.optionKey },
                ],
              },
              timeout: 60000,
              retry: { limit: 0 },
            })
            .json(),
        )
        variationCreated++
        entries.push({
          product_id: product.id,
          variation_id: variation.id,
          product_name: group.productName,
          option_name: opt.optionName,
          price: s.price,
          supplier: s.supplierId,
          status: "created",
          candidate_count: opt.candidates.length,
        })
      }
    } catch (e) {
      entries.push({ product_name: group.productName, status: "failed", error: msg(e) })
    }
  }
  const after = await countCatalog(credentials)
  const publicCount = await countPublic(credentials)
  return {
    summary: {
      dailyFoodCount: dailyCount,
      walldoCount,
      groupCount: groups.length,
      productCreated,
      variationCreated,
      publicCreated: publicCount,
      afterProducts: after.products,
      afterVariations: after.variations,
      failed: entries.filter((e) => e.status === "failed").length,
      generatedAt: new Date().toISOString(),
    },
    entries,
  }
}
async function countCatalog(c: Credentials): Promise<{ products: number; variations: number }> {
  const client = woo(c)
  let products = 0,
    variations = 0
  for (let page = 1; page <= 20; page++) {
    const rows = z.array(ProductSchema).parse(
      await ky
        .get(`${client.baseUrl}/wp-json/wc/v3/products`, {
          headers: client.headers,
          searchParams: { status: "any", per_page: "100", page: String(page) },
          timeout: 60000,
          retry: { limit: 1 },
        })
        .json(),
    )
    products += rows.length
    for (const p of rows)
      if (p.type === "variable") {
        const vs = z.array(VariationSchema).parse(
          await ky
            .get(`${client.baseUrl}/wp-json/wc/v3/products/${p.id}/variations`, {
              headers: client.headers,
              searchParams: { status: "any", per_page: "100" },
              timeout: 60000,
              retry: { limit: 1 },
            })
            .json(),
        )
        variations += vs.length
      }
    if (rows.length < 100) break
  }
  return { products, variations }
}
async function countPublic(c: Credentials): Promise<number> {
  const client = woo(c)
  const rows = z.array(ProductSchema).parse(
    await ky
      .get(`${client.baseUrl}/wp-json/wc/v3/products`, {
        headers: client.headers,
        searchParams: { status: "publish", per_page: "100" },
        timeout: 60000,
        retry: { limit: 1 },
      })
      .json(),
  )
  return rows.length
}
async function writeReports(result: RebuildResult) {
  await mkdir("reports", { recursive: true })
  await writeFile("reports/rebuild-draft-catalog-log.json", `${JSON.stringify(result, null, 2)}\n`)
  await writeFile(
    "reports/rebuild-draft-catalog-summary.md",
    `# Rebuild Draft Catalog Summary\n\n- dailyfood_count: ${result.summary.dailyFoodCount}\n- walldo_count: ${result.summary.walldoCount}\n- product_created: ${result.summary.productCreated}\n- variation_created: ${result.summary.variationCreated}\n- public_created: ${result.summary.publicCreated}\n- failed: ${result.summary.failed}\n`,
  )
}
function productGroupKey(v: string) {
  return clean(
    v
      .replace(/\[[^\]]*\]|\([^)]*\)/gu, " ")
      .replace(/\d+(?:\.\d+)?\s*(?:kg|g|개입|개|팩|봉|박스|망|과|R|cm|센치)/giu, " "),
  )
}
function optionKey(v: string) {
  const m = [...v.matchAll(/\d+(?:\.\d+)?\s*(?:kg|g|개입|개|팩|봉|박스|망|과|R|cm|센치)/giu)].map(
    (x) => clean(x[0] ?? ""),
  )
  return m.length ? m.join("|") : clean(v)
}
function clean(v: string) {
  return v
    .normalize("NFKC")
    .replace(/&nbsp;/giu, " ")
    .replace(/[^가-힣a-zA-Z0-9.]/gu, "")
    .toLocaleLowerCase("ko-KR")
}
function safeJson(v: string) {
  try {
    const p = JSON.parse(v)
    return p && typeof p === "object" && !Array.isArray(p) ? p : {}
  } catch {
    return {}
  }
}
function stringValue(v: unknown) {
  return typeof v === "string" || typeof v === "number" ? String(v) : ""
}
function stableId(v: string) {
  return clean(v).slice(0, 120)
}
function woo(c: Credentials) {
  return {
    baseUrl: c.baseUrl.replace(/\/$/u, ""),
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.consumerKey}:${c.consumerSecret}`).toString("base64")}`,
    },
  }
}
async function loadDotEnv() {
  try {
    const envText = await readFile(".env", "utf8")
    for (const line of envText.split(/\r?\n/u)) {
      const m = /^([A-Z0-9_]+)=(.*)$/u.exec(line)
      if (m?.[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? ""
    }
  } catch (e) {
    if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e
  }
}
function env(k: string) {
  const v = process.env[k]?.trim()
  if (!v) throw new Error(`${k} is required`)
  return v
}
function msg(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}
main().catch((e) => {
  console.error(msg(e))
  process.exitCode = 1
})
