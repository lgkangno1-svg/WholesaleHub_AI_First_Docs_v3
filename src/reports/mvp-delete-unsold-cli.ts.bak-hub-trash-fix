import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
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
import { fetchMvpWooCatalog, type MvpWooProduct, type MvpWooVariation } from "./mvp-sync-plan.js"

const CONFIRM = "PERMANENT_DELETE_UNSOLD_VARIATIONS_ONLY"
const OrderSchema = z.object({
  line_items: z.array(z.object({ product_id: z.number().int(), variation_id: z.number().int() })),
})
type Credentials = { baseUrl: string; consumerKey: string; consumerSecret: string }
type Row = {
  product_id: number
  variation_id: number | null
  product_name: string
  option_name: string
  action: "delete_variation" | "delete_product" | "hold"
  status: "deleted" | "held" | "failed"
  reason: string
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
  const failures: string[] = []
  const daily = await collectDaily(failures)
  const walldo = await collectWalldo(failures)
  if (failures.length > 0) throw new Error(`delete blocked: ${failures.join("; ")}`)
  const before = await fetchMvpWooCatalog(credentials)
  const orderLinks = await fetchOrderLinks(credentials)
  const result = await deleteUnsold({
    credentials,
    before,
    daily,
    walldo,
    orderLinks,
    outDir: args.outDir,
  })
  console.log(
    JSON.stringify(
      {
        variationDeleted: result.variationDeleted,
        productDeleted: result.productDeleted,
        held: result.held,
        targets: result.targets,
      },
      null,
      2,
    ),
  )
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
  return {
    execute: m.get("--execute") === "true",
    confirm: m.get("--confirm") ?? "",
    outDir: m.get("--out-dir") ?? "reports",
  }
}
async function collectDaily(failures: string[]): Promise<CollectedProduct[]> {
  try {
    const cfg = await loadSupplierConfig("config/suppliers/dailyfood.google_sheet.yml")
    const path = "reports/snapshots/dailyfood-latest-success.json"
    const csv = (await fetchDailyFoodHtmlViewAsCsv(cfg.googleSheet.sheetUrl)).csv
    const products = [...parseDailyFoodCsv(csv, cfg).products]
    await mkdir("reports/snapshots", { recursive: true })
    await writeFile(
      path,
      JSON.stringify({ createdAt: new Date().toISOString(), products }, null, 2),
    )
    return products
  } catch (e) {
    failures.push(`dailyfood actual-site failed: ${msg(e)}`)
    return []
  }
}
async function collectWalldo(failures: string[]): Promise<CollectedProduct[]> {
  try {
    const html = await fetchWalldob2bProductExcel({
      username: env("WALLDOB2B_USERNAME"),
      password: env("WALLDOB2B_PASSWORD"),
    })
    const p = [...parseWalldob2bProductExcelHtml(html, 10000).products]
    if (p.length < 180) throw new Error(`walldo count too low: ${p.length}`)
    return p
  } catch (e) {
    failures.push(`walldo failed: ${msg(e)}`)
    return []
  }
}

async function deleteUnsold(input: {
  credentials: Credentials
  before: readonly MvpWooProduct[]
  daily: readonly CollectedProduct[]
  walldo: readonly CollectedProduct[]
  orderLinks: Set<string>
  outDir: string
}) {
  const available = new Set(
    [...input.daily, ...input.walldo]
      .filter((p) => p.stockStatus !== "out_of_stock")
      .map(
        (p) =>
          `${productGroupKey(p.originalProductName)}|${optionKey(`${p.originalProductName} ${p.originalOptionName ?? ""}`)}`,
      ),
  )
  const client = woo(input.credentials)
  const rows: Row[] = []
  const deletedByProduct = new Map<number, number>()
  for (const product of input.before.filter((p) => p.status !== "trash")) {
    for (const v of product.variations) {
      const opt = optionName(v)
      const key = variationKey(product, v)
      const target = /통멍게|쭈꾸미|새조개/u.test(`${product.name} ${opt}`)
      if (input.orderLinks.has(`p:${product.id}`) || input.orderLinks.has(`v:${v.id}`)) {
        if (target) rows.push(row(product, v, "hold", "held", "주문 연결 있음"))
        continue
      }
      if (available.has(key)) continue
      const hard = hasTracking(v)
      if (!hard) {
        if (target) rows.push(row(product, v, "hold", "held", "매칭 애매함"))
        continue
      }
      try {
        await ky
          .delete(`${client.baseUrl}/wp-json/wc/v3/products/${product.id}/variations/${v.id}`, {
            headers: client.headers,
            searchParams: { force: "true" },
            timeout: 60000,
            retry: { limit: 0 },
          })
          .json()
        rows.push(row(product, v, "delete_variation", "deleted", "두 공급처 모두 판매중 아님"))
        deletedByProduct.set(product.id, (deletedByProduct.get(product.id) ?? 0) + 1)
      } catch (e) {
        rows.push(row(product, v, "delete_variation", "failed", msg(e)))
      }
    }
  }
  for (const product of input.before.filter(
    (p) => p.status !== "trash" && p.variations.length > 0,
  )) {
    if ((deletedByProduct.get(product.id) ?? 0) !== product.variations.length) continue
    if (input.orderLinks.has(`p:${product.id}`)) {
      rows.push({
        product_id: product.id,
        variation_id: null,
        product_name: product.name,
        option_name: "",
        action: "hold",
        status: "held",
        reason: "product 주문 연결 있음",
      })
      continue
    }
    try {
      await ky
        .delete(`${client.baseUrl}/wp-json/wc/v3/products/${product.id}`, {
          headers: client.headers,
          searchParams: { force: "true" },
          timeout: 60000,
          retry: { limit: 0 },
        })
        .json()
      rows.push({
        product_id: product.id,
        variation_id: null,
        product_name: product.name,
        option_name: "",
        action: "delete_product",
        status: "deleted",
        reason: "모든 variation 영구삭제 완료",
      })
    } catch (e) {
      rows.push({
        product_id: product.id,
        variation_id: null,
        product_name: product.name,
        option_name: "",
        action: "delete_product",
        status: "failed",
        reason: msg(e),
      })
    }
  }
  await writeReports(input.outDir, rows, input.daily.length, input.walldo.length)
  return {
    variationDeleted: rows.filter((r) => r.action === "delete_variation" && r.status === "deleted")
      .length,
    productDeleted: rows.filter((r) => r.action === "delete_product" && r.status === "deleted")
      .length,
    held: rows.filter((r) => r.status === "held").length,
    targets: targetSummary(rows),
  }
}
function row(
  p: MvpWooProduct,
  v: MvpWooVariation,
  action: Row["action"],
  status: Row["status"],
  reason: string,
): Row {
  return {
    product_id: p.id,
    variation_id: v.id,
    product_name: p.name,
    option_name: optionName(v),
    action,
    status,
    reason,
  }
}
function targetSummary(rows: readonly Row[]) {
  const names = ["통멍게", "쭈꾸미", "새조개"]
  return Object.fromEntries(
    names.map((n) => [
      n,
      rows
        .filter((r) => `${r.product_name} ${r.option_name}`.includes(n))
        .map((r) => `${r.action}:${r.status}:${r.product_id}:${r.variation_id ?? ""}`)
        .join(" | ") || "대상 없음/판매중 유지",
    ]),
  )
}
function variationKey(p: MvpWooProduct, v: MvpWooVariation) {
  const meta = v.meta_data
  const g =
    metaVal(meta, "_product_group_key") ||
    metaVal(meta, "_wholesalehub_product_group_key") ||
    productGroupKey(p.name)
  const o =
    metaVal(meta, "_normalized_option_key") ||
    metaVal(meta, "_wholesalehub_normalized_option_key") ||
    optionKey(`${p.name} ${optionName(v)}`)
  return `${g}|${o}`
}
function hasTracking(v: MvpWooVariation) {
  return [
    "_product_group_key",
    "_normalized_option_key",
    "_supplier_id",
    "_source_product_id",
    "_source_option_id",
    "_wholesalehub_supplier_id",
  ].some((k) => metaVal(v.meta_data, k).length > 0)
}
async function fetchOrderLinks(c: Credentials) {
  const client = woo(c)
  const links = new Set<string>()
  for (let page = 1; page <= 50; page++) {
    const res = await ky.get(`${client.baseUrl}/wp-json/wc/v3/orders`, {
      headers: client.headers,
      searchParams: { per_page: "100", page: String(page), status: "any" },
      timeout: 60000,
      retry: { limit: 1 },
    })
    const data = z.array(OrderSchema).parse(await res.json())
    for (const o of data)
      for (const li of o.line_items) {
        links.add(`p:${li.product_id}`)
        if (li.variation_id > 0) links.add(`v:${li.variation_id}`)
      }
    if (data.length < 100) break
  }
  return links
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
function optionName(v: MvpWooVariation) {
  return v.attributes
    .map((a) => a.option ?? "")
    .filter(Boolean)
    .join(" / ")
}
function metaVal(meta: readonly { key: string; value: unknown }[], key: string) {
  const v = meta.find((x) => x.key === key)?.value
  return typeof v === "string" || typeof v === "number" ? String(v).trim() : ""
}
function woo(c: Credentials) {
  return {
    baseUrl: c.baseUrl.replace(/\/$/u, ""),
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.consumerKey}:${c.consumerSecret}`).toString("base64")}`,
    },
  }
}
async function writeReports(outDir: string, rows: readonly Row[], daily: number, walldo: number) {
  const dir = resolve(outDir)
  await mkdir(dir, { recursive: true })
  const summary = `# Unsold Permanent Delete Summary\n\n- generated_at: ${new Date().toISOString()}\n- dailyfood_options: ${daily}\n- walldo_options: ${walldo}\n- deleted_variations: ${rows.filter((r) => r.action === "delete_variation" && r.status === "deleted").length}\n- deleted_products: ${rows.filter((r) => r.action === "delete_product" && r.status === "deleted").length}\n- held: ${rows.filter((r) => r.status === "held").length}\n- failed: ${rows.filter((r) => r.status === "failed").length}\n`
  await Promise.all([
    writeFile(resolve(dir, "mvp-unsold-delete-log.json"), JSON.stringify({ rows }, null, 2)),
    writeFile(resolve(dir, "mvp-unsold-delete-summary.md"), summary),
    writeFile(resolve(dir, "mvp-unsold-delete.csv"), csv(rows)),
  ])
}
function csv(rows: readonly Row[]) {
  const cols = [
    "product_id",
    "variation_id",
    "product_name",
    "option_name",
    "action",
    "status",
    "reason",
  ] as const
  return `${cols.join(",")}\n${rows.map((r) => cols.map((c) => cell(String(r[c] ?? ""))).join(",")).join("\n")}\n`
}
function cell(v: string) {
  return /[",\n\r]/u.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
async function loadDotEnv() {
  try {
    const env = await readFile(".env", "utf8")
    for (const line of env.split(/\r?\n/u)) {
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
