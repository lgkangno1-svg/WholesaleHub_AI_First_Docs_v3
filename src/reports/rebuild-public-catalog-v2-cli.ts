import { mkdir, readFile, writeFile } from "node:fs/promises"
import ky from "ky"
import { z } from "zod"
import {
  fetchWalldob2bProductExcel,
  parseWalldob2bProductExcelHtml,
} from "../adapters/walldob2b/walldob2b-excel-download.js"
import { loadSupplierConfig } from "../config/supplier-config-loader.js"
import type { CollectedProduct } from "../domain/product.js"
import { filterDailyFoodVisibleSiteProducts } from "./dailyfood-visible-site-filter.js"

const CONFIRM = "REBUILD_PUBLIC_CATALOG_V2"
const DEFAULT_IMAGE_ID = 2905
const ProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  status: z.string(),
  type: z.string(),
  meta_data: z.array(z.object({ key: z.string(), value: z.unknown() })).default([]),
})
const VariationSchema = z.object({ id: z.number().int() })
const ProductRows = z.array(ProductSchema)
const VariationRows = z.array(VariationSchema)

type Credentials = { baseUrl: string; consumerKey: string; consumerSecret: string }
type Candidate = {
  supplierId: string
  sourceProductId: string
  sourceOptionId: string
  productName: string
  baseName: string
  optionName: string
  cost: number
  sale: number
  productKey: string
  optionKey: string
  raw: CollectedProduct
}
type OptionGroup = { optionName: string; selected: Candidate; candidates: Candidate[] }
type ProductGroup = {
  productName: string
  productKey: string
  options: OptionGroup[]
}
type Entry = {
  product_id?: number
  variation_id?: number
  product_name: string
  option_name?: string
  cost?: number
  sale?: number
  supplier?: string
  status: "created" | "failed" | "skipped"
  reason?: string
}

type Result = {
  summary: {
    deletedProducts: number
    deletedVariations: number
    dailyFoodCount: number
    walldoCount: number
    productCreated: number
    variationCreated: number
    publicCreated: number
    skipped: number
    failed: number
    seafoodExcluded: number
    generatedAt: string
  }
  entries: Entry[]
}

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
  const del = await deleteAllProducts(credentials)
  const daily = await collectDailyFoodDirect()
  const walldo = await collectWalldo()
  if (daily.length < 300 || walldo.length < 180)
    throw new Error(`supplier crawl failed: daily=${daily.length}, walldo=${walldo.length}`)
  const allGroups = buildGroups([...daily, ...walldo])
  const seafoodGroups = allGroups.filter((g) => isSeafood(g.productName)).length
  const groups = allGroups.filter((g) => !isSeafood(g.productName))
  const created = await createPublicCatalog(credentials, groups)
  const publicCreated = await countPublic(credentials)
  const result: Result = {
    summary: {
      deletedProducts: del.products || before.products,
      deletedVariations: del.variations || before.variations,
      dailyFoodCount: daily.length,
      walldoCount: walldo.length,
      productCreated: created.products,
      variationCreated: created.variations,
      publicCreated,
      skipped: created.skipped,
      failed: created.failed,
      seafoodExcluded: seafoodGroups,
      generatedAt: new Date().toISOString(),
    },
    entries: created.entries,
  }
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
async function collectDailyFoodDirect(): Promise<CollectedProduct[]> {
  const cfg = await loadSupplierConfig("config/suppliers/dailyfood.google_sheet.yml")
  const rows = await fetchDailyRows(cfg.googleSheet.sheetUrl)
  return [
    ...filterDailyFoodVisibleSiteProducts(
      rows.map((r, i) => ({
        supplierId: "dailyfood",
        sourceType: "website",
        originalProductName: r.product,
        originalOptionName: r.option || null,
        price: r.price,
        shippingFee: 0,
        stockStatus: "in_stock",
        productUrl: r.link,
        rawJson: JSON.stringify({
          sourceProductId: stableId(r.product),
          sourceOptionId: stableId(r.option || "기본"),
          row: i,
        }),
      })),
    ),
  ]
}
async function collectWalldo() {
  const html = await fetchWalldob2bProductExcel({
    username: env("WALLDOB2B_USERNAME"),
    password: env("WALLDOB2B_PASSWORD"),
  })
  return [...parseWalldob2bProductExcelHtml(html, 10000).products]
}
type DailyRow = {
  product: string
  option: string
  price: number
  link: string | null
}
type Cell = { text: string; href: string | null }
async function fetchDailyRows(rootUrl: string): Promise<DailyRow[]> {
  const root = await ky.get(rootUrl, { timeout: 30000, retry: { limit: 2 } }).text()
  const id = /\/d\/([^/]+)\//u.exec(rootUrl)?.[1]
  const gids = [
    ...new Set(
      [...root.matchAll(/gid: "(\d+)"/gu)]
        .map((m) => m[1])
        .filter((x): x is string => x !== undefined),
    ),
  ]
  const urls =
    id && gids.length
      ? gids.map(
          (g) =>
            `https://docs.google.com/spreadsheets/u/0/d/${id}/htmlview/sheet?headers=true&gid=${g}`,
        )
      : [rootUrl]
  const out: DailyRow[] = []
  for (const url of urls) {
    const html = await ky.get(url, { timeout: 30000, retry: { limit: 2 } }).text()
    out.push(...parseDailyHtml(html))
  }
  return out
}
function parseDailyHtml(html: string): DailyRow[] {
  const rows = parseGrid(html)
  const h = rows.findIndex(
    (r) => r.some((c) => has(c.text, "상품명")) && r.some((c) => has(c.text, "단가")),
  )
  const header = rows[h]
  if (!header) return []
  const idx = {
    photo: find(header, ["품목 사진", "사진"]),
    product: find(header, ["상품명"]),
    option: find(header, ["중량", "옵션"]),
    price: find(header, ["단가", "공급가", "판매가"]),
    link: find(header, ["발주&단가 상담 링크"]),
  }
  const out: DailyRow[] = []
  let curProduct = ""
  for (const row of rows.slice(h + 1)) {
    const prod = cleanText(row[idx.product]?.text)
    if (prod) curProduct = prod
    const opt = cleanText(row[idx.option]?.text)
    const price = parsePrice(row[idx.price]?.text)
    if (!curProduct || price === null) continue
    const link = idx.link < 0 ? null : unwrapGoogleUrl(row[idx.link]?.href ?? "")
    out.push({ product: curProduct, option: opt, price, link })
  }
  return out
}
function parseGrid(html: string): Cell[][] {
  const active = new Map<number, { cell: Cell; remaining: number }>()
  return [...html.matchAll(/<tr\b[\s\S]*?<\/tr>/giu)].map((r) => {
    const row: Cell[] = []
    let col = 0
    for (const m of r[0].matchAll(/<td\b([^>]*)[\s\S]*?<\/td>/giu)) {
      while (active.has(col)) {
        const a = active.get(col)
        if (a === undefined) break
        row[col] = a.cell
        if (a.remaining <= 1) active.delete(col)
        else active.set(col, { cell: a.cell, remaining: a.remaining - 1 })
        col++
      }
      const attrs = m[1] ?? ""
      const raw = m[0]
      const cell = { text: cellText(raw), href: href(raw) }
      const cs = span(attrs, "colspan"),
        rs = span(attrs, "rowspan")
      for (let o = 0; o < cs; o++) {
        row[col + o] = cell
        if (rs > 1) active.set(col + o, { cell, remaining: rs - 1 })
      }
      col += cs
    }
    return row
  })
}
function cellText(cell: string) {
  return decode(cell.replace(/<br\s*\/?\s*>/giu, "\n").replace(/<[^>]+>/gu, " "))
    .replace(/\s+\n/gu, "\n")
    .replace(/\n\s+/gu, "\n")
    .trim()
}
function href(cell: string) {
  const h = /href="([^"]+)"/iu.exec(cell)?.[1]
  return h ? decode(h) : null
}
function span(attrs: string, n: string) {
  const v = new RegExp(`${n}="(\\d+)"`, `iu`).exec(attrs)?.[1]
  return v ? Number.parseInt(v, 10) : 1
}
function find(h: Cell[], names: string[]) {
  return h.findIndex((c) => names.some((n) => norm(c.text).includes(norm(n))))
}
function has(v: string, n: string) {
  return norm(v).includes(norm(n))
}
function norm(v: string) {
  return v.replace(/\s+/gu, " ").trim().toLocaleLowerCase("ko-KR")
}
function cleanText(v: string | undefined) {
  return v?.trim() ?? ""
}
function parsePrice(v: string | undefined) {
  const d = (v ?? "").replace(/[^\d]/gu, "")
  if (!d) return null
  const n = Number.parseInt(d, 10)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}
function decode(v: string) {
  return v
    .replace(/&amp;/gu, "&")
    .replace(/&nbsp;/gu, " ")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&#39;/gu, "'")
    .replace(/&quot;/gu, '"')
}
function unwrapGoogleUrl(u: string | null) {
  if (!u) return null
  try {
    const url = new URL(u)
    return url.searchParams.get("q") ?? u
  } catch {
    return u
  }
}
function buildGroups(products: CollectedProduct[]): ProductGroup[] {
  const map = new Map<string, Candidate[]>()
  for (const p of products) {
    if (p.stockStatus === "out_of_stock") continue
    const c = toCandidate(p)
    const k = `${c.productKey}|${c.optionKey}`
    map.set(k, [...(map.get(k) ?? []), c])
  }
  const pm = new Map<string, ProductGroup>()
  for (const cands of map.values()) {
    const sorted = [...cands].sort(
      (a, b) => a.cost - b.cost || a.supplierId.localeCompare(b.supplierId),
    )
    const s = sorted[0]
    if (!s) continue
    const g = pm.get(s.productKey) ?? {
      productName: s.baseName,
      productKey: s.productKey,
      options: [],
    }
    g.options.push({ optionName: s.optionName, selected: s, candidates: sorted })
    pm.set(s.productKey, g)
  }
  return [...pm.values()]
    .map((g) => ({
      ...g,
      options: g.options.sort((a, b) => a.optionName.localeCompare(b.optionName, "ko-KR")),
    }))
    .sort((a, b) => a.productName.localeCompare(b.productName, "ko-KR"))
}
function toCandidate(p: CollectedProduct): Candidate {
  const raw = safeJson(p.rawJson)
  const base = baseName(p.originalProductName)
  const opt = optionDisplay(p.originalProductName, p.originalOptionName)
  const cost = p.price
  return {
    supplierId: p.supplierId,
    sourceProductId:
      stringValue(raw["sourceProductId"]) ||
      stringValue(raw["walldoItId"]) ||
      stableId(p.originalProductName),
    sourceOptionId: stringValue(raw["sourceOptionId"]) || stableId(opt),
    productName: p.originalProductName,
    baseName: base,
    optionName: opt,
    cost,
    sale: salePrice(cost),
    productKey: clean(base),
    optionKey: clean(opt),
    raw: p,
  }
}
function baseName(v: string) {
  return (
    v
      .replace(/🔥?\s*\d+월\s*추천템/gu, " ")
      .replace(/추천템/gu, " ")
      .replace(/[\n\r]+/gu, " ")
      .replace(/\([^)]*\d[^)]*\)/gu, " ")
      .replace(
        /\d+(?:[~-]\d+)?\s*(?:kg|g|통|개입|개|팩|봉|박스|망|과|cm|센치)\s*(?:내외|이상)?/giu,
        " ",
      )
      .replace(/\s+/gu, " ")
      .trim() || v.trim()
  )
}
function optionDisplay(product: string, opt: string | null) {
  if (opt && opt !== "기본") return opt.trim()
  const m =
    /\d+(?:[~-]\d+)?\s*(?:kg|g|통|개입|개|팩|봉|박스|망|과|cm|센치)\s*(?:내외|이상)?(?:\s*\([^)]*\))?/iu.exec(
      product,
    )
  return m?.[0]?.trim() || "기본"
}
function salePrice(cost: number) {
  return cost + (cost < 10000 ? 1500 : cost < 20000 ? 2000 : cost < 30000 ? 3000 : 4000)
}
function isSeafood(name: string) {
  return /새조개|통멍게|멍게|쭈꾸미|주꾸미|오징어|문어|낙지|갈치|고등어|장어|바지락|전복|새우|꽃게|게|홍합|굴|조개|꼬막|미역|다시마|김\b|해물|수산|생선|명태|동태|황태|코다리|가자미|연어|참치|삼치|꽁치|아귀|대구|우럭|광어|도미|멸치|건어물|어묵|젓갈/u.test(
    name,
  )
}
async function deleteAllProducts(c: Credentials) {
  const client = woo(c)
  let products = 0,
    variations = 0
  for (let loop = 0; loop < 50; loop++) {
    const rows = ProductRows.parse(
      await ky
        .get(`${client.baseUrl}/wp-json/wc/v3/products`, {
          headers: client.headers,
          searchParams: { status: "any", per_page: "100", page: "1" },
          timeout: 60000,
          retry: { limit: 1 },
        })
        .json(),
    )
    if (rows.length === 0) break
    for (const p of rows) {
      if (p.type === "variable") {
        const vs = VariationRows.parse(
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
      const r = await ky.delete(`${client.baseUrl}/wp-json/wc/v3/products/${p.id}`, {
        headers: client.headers,
        searchParams: { force: "true" },
        timeout: 60000,
        retry: { limit: 0 },
        throwHttpErrors: false,
      })
      if (r.status < 400) products++
    }
  }
  return { products, variations }
}
async function createPublicCatalog(c: Credentials, groups: ProductGroup[]) {
  const client = woo(c)
  const entries: Entry[] = []
  let products = 0,
    variations = 0,
    skipped = 0,
    failed = 0
  for (const g of groups) {
    try {
      const p = ProductSchema.parse(
        await ky
          .post(`${client.baseUrl}/wp-json/wc/v3/products`, {
            headers: client.headers,
            json: {
              name: g.productName,
              type: "variable",
              status: "publish",
              catalog_visibility: "visible",
              images: [{ id: DEFAULT_IMAGE_ID }],
              short_description: buildShortDescription(g),
              description: buildDescription(g),
              attributes: [
                {
                  name: "옵션",
                  visible: true,
                  variation: true,
                  options: g.options.map((o) => o.optionName),
                },
              ],
              meta_data: [
                { key: "_wholesalehub_rebuild_v2", value: "yes" },
                { key: "_wholesalehub_product_group_key", value: g.productKey },
              ],
            },
            timeout: 120000,
            retry: { limit: 0 },
          })
          .json(),
      )
      if (p.status !== "publish") throw new Error(`not public: ${p.status}`)
      products++
      for (const o of g.options) {
        const s = o.selected
        const v = VariationSchema.parse(
          await ky
            .post(`${client.baseUrl}/wp-json/wc/v3/products/${p.id}/variations`, {
              headers: client.headers,
              json: {
                regular_price: String(s.sale),
                stock_status: "instock",
                manage_stock: false,
                attributes: [{ name: "옵션", option: o.optionName }],
                meta_data: [
                  { key: "_supplier_id", value: s.supplierId },
                  { key: "_selected_supplier_id", value: s.supplierId },
                  { key: "_source_product_id", value: s.sourceProductId },
                  { key: "_source_option_id", value: s.sourceOptionId },
                  { key: "_original_product_name", value: s.productName },
                  { key: "_original_option_name", value: s.optionName },
                  { key: "_product_group_key", value: s.productKey },
                  { key: "_normalized_option_key", value: s.optionKey },
                  { key: "_wholesalehub_supplier_cost", value: String(s.cost) },
                ],
              },
              timeout: 60000,
              retry: { limit: 0 },
            })
            .json(),
        )
        variations++
        entries.push({
          product_id: p.id,
          variation_id: v.id,
          product_name: g.productName,
          option_name: o.optionName,
          cost: s.cost,
          sale: s.sale,
          supplier: s.supplierId,
          status: "created",
        })
      }
    } catch (e) {
      failed++
      entries.push({ product_name: g.productName, status: "failed", reason: msg(e) })
    }
  }
  return { products, variations, skipped, failed, entries }
}
async function countCatalog(c: Credentials) {
  const client = woo(c)
  let products = 0,
    variations = 0
  for (let page = 1; page <= 30; page++) {
    const rows = ProductRows.parse(
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
        const vs = VariationRows.parse(
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
async function countPublic(c: Credentials) {
  const client = woo(c)
  let total = 0
  for (let page = 1; page <= 30; page++) {
    const rows = ProductRows.parse(
      await ky
        .get(`${client.baseUrl}/wp-json/wc/v3/products`, {
          headers: client.headers,
          searchParams: { status: "publish", per_page: "100", page: String(page) },
          timeout: 60000,
          retry: { limit: 1 },
        })
        .json(),
    )
    total += rows.length
    if (rows.length < 100) break
  }
  return total
}
async function writeReports(r: Result) {
  await mkdir("reports", { recursive: true })
  await writeFile("reports/rebuild-v2-log.json", `${JSON.stringify(r, null, 2)}\n`)
  await writeFile(
    "reports/rebuild-v2-summary.md",
    `# Rebuild V2 Summary\n\n- deleted_products: ${r.summary.deletedProducts}\n- deleted_variations: ${r.summary.deletedVariations}\n- dailyfood_actual_site_products: ${r.summary.dailyFoodCount}\n- walldo_products: ${r.summary.walldoCount}\n- public_products_created: ${r.summary.productCreated}\n- variations_created: ${r.summary.variationCreated}\n- public_created: ${r.summary.publicCreated}\n- skipped: ${r.summary.skipped}\n- failed: ${r.summary.failed}\n- seafood_excluded: ${r.summary.seafoodExcluded}\n`,
  )
}

function buildDescription(group: ProductGroup) {
  const options = group.options
    .map((option) => `<li>${escapeHtml(option.optionName)}</li>`)
    .join("")
  return `<div class="wholesalehub-product-detail"><p>${escapeHtml(group.productName)}</p>${options ? `<ul>${options}</ul>` : ""}</div>`
}

function buildShortDescription(group: ProductGroup) {
  return `${escapeHtml(group.productName)} 옵션 ${group.options.length}개`
}

function escapeHtml(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;")
}

function clean(v: string) {
  return v
    .normalize("NFKC")
    .replace(/&nbsp;/giu, " ")
    .replace(/[^가-힣a-zA-Z0-9.]/gu, "")
    .toLocaleLowerCase("ko-KR")
}
function stableId(v: string) {
  return clean(v).slice(0, 120)
}
function safeJson(v: string) {
  try {
    const p = JSON.parse(v)
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
function stringValue(v: unknown) {
  return typeof v === "string" || typeof v === "number" ? String(v) : ""
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
    const t = await readFile(".env", "utf8")
    for (const line of t.split(/\r?\n/u)) {
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
