import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import ky from "ky"
import { z } from "zod"

const CONFIRM = "DELETE_SOURCE_ABSENT_NON_GROUPBUY_PRODUCTS"
const GROUPBUY_CATEGORY = "공동구매"
const MIN_DAILYFOOD_OPTIONS = 380
const MIN_WALLDO_OPTIONS = 180

type Credentials = { baseUrl: string; consumerKey: string; consumerSecret: string }
type WooClient = ReturnType<typeof woo>
type DeleteRow = {
  product_id: number
  variation_id: number | null
  product_name: string
  option_name: string
  status_before: string
  categories: string
  action:
    | "delete_product"
    | "delete_variation"
    | "delete_product_empty_after_variations"
    | "keep"
    | "skip_groupbuy"
  deleted: "yes" | "no" | "skipped"
  reason_korean: string
}

const PlanSchema = z.object({
  summary: z.object({
    runFailed: z.boolean(),
    dailyFoodOptionCount: z.number().int(),
    walldob2bOptionCount: z.number().int(),
    failureReasons: z.array(z.string()).default([]),
  }),
  rows: z.array(
    z.object({
      product_id: z.number().int().nullable(),
      variation_id: z.number().int().nullable(),
      available_supplier_count: z.number().int(),
      action: z.string(),
    }),
  ),
})

const ProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  status: z.string(),
  type: z.string().default(""),
  meta_data: z.array(z.object({ key: z.string(), value: z.unknown() })).default([]),
  categories: z
    .array(z.object({ id: z.number().int(), name: z.string(), slug: z.string() }))
    .default([]),
})
const VariationSchema = z.object({
  id: z.number().int(),
  attributes: z
    .array(z.object({ name: z.string().default(""), option: z.string().default("") }))
    .default([]),
})
const ProductsSchema = z.array(ProductSchema)
const VariationsSchema = z.array(VariationSchema)

type Product = z.infer<typeof ProductSchema>
type Variation = z.infer<typeof VariationSchema>

type Args = { execute: boolean; confirm: string; planPath: string; outDir: string }

async function main(): Promise<void> {
  await loadDotEnv()
  const args = parseArgs(process.argv.slice(2))
  if (!args.execute || args.confirm !== CONFIRM) {
    throw new Error(`--execute --confirm "${CONFIRM}" is required`)
  }
  const plan = PlanSchema.parse(JSON.parse(await readFile(args.planPath, "utf8")))
  validatePlan(plan)
  const keep = keepSets(plan.rows)
  const credentials = {
    baseUrl: env("WOOCOMMERCE_BASE_URL"),
    consumerKey: env("WOOCOMMERCE_CONSUMER_KEY"),
    consumerSecret: env("WOOCOMMERCE_CONSUMER_SECRET"),
  }
  const client = woo(credentials)
  const products = (await fetchProducts(client)).filter((product) => product.status !== "trash")
  const rows: DeleteRow[] = []
  let deletedProducts = 0
  let deletedVariations = 0
  let skippedGroupbuy = 0
  let keptProducts = 0
  for (const product of products) {
    const categories = product.categories.map((category) => category.name)
    if (categories.includes(GROUPBUY_CATEGORY)) {
      skippedGroupbuy += 1
      rows.push(
        row(
          product,
          null,
          "skip_groupbuy",
          "skipped",
          "공동구매 상품은 DailyFood/월억 자동동기화 삭제 대상에서 제외",
        ),
      )
      continue
    }
    if (isMvpCreatedProduct(product)) {
      keptProducts += 1
      rows.push(
        row(
          product,
          null,
          "keep",
          "skipped",
          "n8n MVP가 생성한 검토 상품은 발행 후에도 source plan 재매칭 전까지 유지",
        ),
      )
      continue
    }
    if (!keep.products.has(product.id)) {
      const variations =
        product.type === "variable" ? await fetchVariations(client, product.id) : []
      await deleteProduct(client, product.id)
      deletedProducts += 1
      deletedVariations += variations.length
      rows.push(
        row(
          product,
          null,
          "delete_product",
          "yes",
          "최신 DailyFood/월억 source plan에 상품군 없음",
        ),
      )
      continue
    }
    if (product.type !== "variable") {
      keptProducts += 1
      rows.push(row(product, null, "keep", "skipped", "최신 source plan에 유지 대상 상품으로 존재"))
      continue
    }
    const variations = await fetchVariations(client, product.id)
    for (const variation of variations) {
      if (keep.variations.has(variation.id)) continue
      await deleteVariation(client, product.id, variation.id)
      deletedVariations += 1
      rows.push(
        row(
          product,
          variation,
          "delete_variation",
          "yes",
          "최신 DailyFood/월억 source plan에 해당 옵션 없음",
        ),
      )
    }
    const remaining = await fetchVariations(client, product.id)
    if (remaining.length === 0) {
      await deleteProduct(client, product.id)
      deletedProducts += 1
      rows.push(
        row(
          product,
          null,
          "delete_product_empty_after_variations",
          "yes",
          "source 없는 옵션 삭제 후 남은 옵션 없음",
        ),
      )
    } else {
      keptProducts += 1
    }
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    planRows: plan.rows.length,
    dailyFoodOptions: plan.summary.dailyFoodOptionCount,
    walldoOptions: plan.summary.walldob2bOptionCount,
    keepProducts: keep.products.size,
    keepVariations: keep.variations.size,
    scannedProducts: products.length,
    skippedGroupbuy,
    keptProducts,
    deletedProducts,
    deletedVariations,
    wooCommerceChanged: deletedProducts > 0 || deletedVariations > 0,
    rule: "DailyFood/월억 최신 source plan에 없는 비공동구매 상품/옵션은 삭제",
  }
  await writeReports(args.outDir, summary, rows)
  console.log(JSON.stringify(summary, null, 2))
}

function isMvpCreatedProduct(product: Product): boolean {
  return product.meta_data.some(
    (item) => item.key === "_wholesalehub_mvp_created" && item.value === "draft_candidate",
  )
}

function validatePlan(plan: z.infer<typeof PlanSchema>): void {
  if (plan.summary.runFailed) {
    throw new Error(
      `source absence delete blocked: plan failed (${plan.summary.failureReasons.join("; ")})`,
    )
  }
  if (plan.summary.dailyFoodOptionCount < MIN_DAILYFOOD_OPTIONS) {
    throw new Error(
      `source absence delete blocked: dailyfood option count too low (${plan.summary.dailyFoodOptionCount})`,
    )
  }
  if (plan.summary.walldob2bOptionCount < MIN_WALLDO_OPTIONS) {
    throw new Error(
      `source absence delete blocked: walldo option count too low (${plan.summary.walldob2bOptionCount})`,
    )
  }
  if (plan.rows.length === 0) throw new Error("source absence delete blocked: empty plan rows")
}

function keepSets(rows: readonly z.infer<typeof PlanSchema>["rows"][number][]) {
  const products = new Set<number>()
  const variations = new Set<number>()
  for (const planRow of rows) {
    if (planRow.available_supplier_count <= 0) continue
    if (["create_draft_product_candidate", "add_variation_candidate"].includes(planRow.action))
      continue
    if (planRow.product_id !== null) products.add(planRow.product_id)
    if (planRow.variation_id !== null) variations.add(planRow.variation_id)
  }
  return { products, variations }
}

function parseArgs(args: readonly string[]): Args {
  const map = new Map<string, string>()
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i]
    if (key === "--execute") {
      map.set(key, "true")
      continue
    }
    const value = args[i + 1]
    if (!key || !value || !key.startsWith("--"))
      throw new Error(`invalid argument: ${key ?? "unknown"}`)
    map.set(key, value)
    i += 1
  }
  return {
    execute: map.get("--execute") === "true",
    confirm: map.get("--confirm") ?? "",
    planPath: map.get("--plan") ?? "reports/mvp-sync-plan.json",
    outDir: map.get("--out-dir") ?? "reports",
  }
}

async function fetchProducts(client: WooClient): Promise<Product[]> {
  const rows: Product[] = []
  for (let page = 1; page <= 50; page += 1) {
    const pageRows = ProductsSchema.parse(
      await ky
        .get(`${client.baseUrl}/wp-json/wc/v3/products`, {
          headers: client.headers,
          searchParams: { status: "any", per_page: "100", page: String(page) },
          timeout: 60000,
          retry: { limit: 1 },
        })
        .json(),
    )
    rows.push(...pageRows)
    if (pageRows.length < 100) break
  }
  return rows
}

async function fetchVariations(client: WooClient, productId: number): Promise<Variation[]> {
  const rows: Variation[] = []
  for (let page = 1; page <= 20; page += 1) {
    const pageRows = VariationsSchema.parse(
      await ky
        .get(`${client.baseUrl}/wp-json/wc/v3/products/${productId}/variations`, {
          headers: client.headers,
          searchParams: { status: "any", per_page: "100", page: String(page) },
          timeout: 60000,
          retry: { limit: 1 },
        })
        .json(),
    )
    rows.push(...pageRows)
    if (pageRows.length < 100) break
  }
  return rows
}

async function deleteVariation(
  client: WooClient,
  productId: number,
  variationId: number,
): Promise<void> {
  await ky
    .delete(`${client.baseUrl}/wp-json/wc/v3/products/${productId}/variations/${variationId}`, {
      headers: client.headers,
      searchParams: { force: "true" },
      timeout: 60000,
      retry: { limit: 0 },
    })
    .json()
}

async function deleteProduct(client: WooClient, productId: number): Promise<void> {
  await ky
    .delete(`${client.baseUrl}/wp-json/wc/v3/products/${productId}`, {
      headers: client.headers,
      searchParams: { force: "true" },
      timeout: 60000,
      retry: { limit: 0 },
    })
    .json()
}

function row(
  product: Product,
  variation: Variation | null,
  action: DeleteRow["action"],
  deleted: DeleteRow["deleted"],
  reason: string,
): DeleteRow {
  return {
    product_id: product.id,
    variation_id: variation?.id ?? null,
    product_name: product.name,
    option_name: variation === null ? "" : optionName(variation),
    status_before: product.status,
    categories: product.categories.map((category) => category.name).join("|"),
    action,
    deleted,
    reason_korean: reason,
  }
}

function optionName(variation: Variation): string {
  return variation.attributes
    .map((attribute) => attribute.option || attribute.name)
    .filter(Boolean)
    .join(" / ")
}

async function writeReports(
  outDir: string,
  summary: unknown,
  rows: readonly DeleteRow[],
): Promise<void> {
  const dir = resolve(outDir)
  await mkdir(dir, { recursive: true })
  await Promise.all([
    writeFile(
      resolve(dir, "source-absence-delete-summary.json"),
      `${JSON.stringify({ summary, rows }, null, 2)}\n`,
      "utf8",
    ),
    writeFile(resolve(dir, "source-absence-delete-report.csv"), toCsv(rows), "utf8"),
    writeFile(
      resolve(dir, "source-absence-delete-final-summary.md"),
      markdown(summary as Record<string, unknown>),
      "utf8",
    ),
  ])
}

function toCsv(rows: readonly DeleteRow[]): string {
  const headers = [
    "product_id",
    "variation_id",
    "product_name",
    "option_name",
    "status_before",
    "categories",
    "action",
    "deleted",
    "reason_korean",
  ] as const
  return `${headers.join(",")}\n${rows.map((row) => headers.map((header) => csvCell(String(row[header] ?? ""))).join(",")).join("\n")}\n`
}

function markdown(summary: Record<string, unknown>): string {
  return `${[
    "# Source Absence Delete Summary",
    "",
    `- generated_at: ${summary["generatedAt"]}`,
    `- dailyfood_options: ${summary["dailyFoodOptions"]}`,
    `- walldo_options: ${summary["walldoOptions"]}`,
    `- scanned_products: ${summary["scannedProducts"]}`,
    `- skipped_groupbuy: ${summary["skippedGroupbuy"]}`,
    `- kept_products: ${summary["keptProducts"]}`,
    `- deleted_products: ${summary["deletedProducts"]}`,
    `- deleted_variations: ${summary["deletedVariations"]}`,
    `- rule: ${summary["rule"]}`,
    "- source failure safety: plan runFailed/low option count blocks deletion",
  ].join("\n")}\n`
}

function csvCell(value: string): string {
  return `"${value.replace(/"/gu, '""')}"`
}

function woo(credentials: Credentials) {
  const baseUrl = credentials.baseUrl.replace(/\/$/u, "")
  return {
    baseUrl,
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
  const value = (process.env[key] ?? "").trim()
  if (!value) throw new Error(`${key} is required`)
  return value
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
