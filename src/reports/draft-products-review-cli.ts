import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { z } from "zod"
import { matchExcludedProduct } from "../exclusions/livestock.js"

const ExecuteLogSchema = z.object({
  entries: z.array(
    z.object({
      action: z.string(),
      product_id: z.number().int(),
      variation_id: z.number().int().nullable(),
      status: z.string(),
    }),
  ),
})
const ProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  status: z.string(),
  type: z.string(),
  permalink: z.string().optional().nullable(),
})
const VariationSchema = z.object({
  id: z.number().int(),
  price: z.string().nullable().optional(),
  regular_price: z.string().nullable().optional(),
  attributes: z.array(z.object({ option: z.string().optional() })).optional(),
})

type ReviewRow = {
  readonly product_id: number
  readonly status: string
  readonly product_name: string
  readonly variation_count: number
  readonly min_price: number | null
  readonly max_price: number | null
  readonly option_names_summary: string
  readonly admin_edit_url: string
  readonly preview_url: string
  readonly has_livestock_keyword: boolean
  readonly has_missing_price: boolean
  readonly has_duplicate_option: boolean
  readonly recommended_action: "ready_to_review" | "fix_needed" | "block"
  readonly memo_korean: string
}

type Credentials = { readonly baseUrl: string; readonly headers: Record<string, string> }

async function main(): Promise<void> {
  await loadDotEnv()
  const credentials = credentialsFromEnv()
  const log = ExecuteLogSchema.parse(
    JSON.parse(await readFile("reports/woocommerce-sync-execute-log.json", "utf8")),
  )
  const productIds = [
    ...new Set(
      log.entries
        .filter(
          (entry) => entry.action === "create_new_variable_product" && entry.status === "created",
        )
        .map((entry) => entry.product_id)
        .filter((id) => id > 0),
    ),
  ]
  const rows: ReviewRow[] = []
  for (const productId of productIds) rows.push(await reviewProduct(credentials, productId))
  rows.sort((left, right) => left.product_name.localeCompare(right.product_name, "ko-KR"))
  await writeCsv("reports/draft-products-review.csv", rows)
  await writeSummary("reports/draft-products-review-summary.md", rows)
  console.log(JSON.stringify(summary(rows), null, 2))
}

function credentialsFromEnv(): Credentials {
  const baseUrl = requiredEnv("WOOCOMMERCE_BASE_URL").replace(/\/$/u, "")
  const token = Buffer.from(
    `${requiredEnv("WOOCOMMERCE_CONSUMER_KEY")}:${requiredEnv("WOOCOMMERCE_CONSUMER_SECRET")}`,
  ).toString("base64")
  return { baseUrl, headers: { Authorization: `Basic ${token}` } }
}

async function reviewProduct(credentials: Credentials, productId: number): Promise<ReviewRow> {
  const product = ProductSchema.parse(
    await wooGet(credentials, `/wp-json/wc/v3/products/${productId}`),
  )
  const variations = z
    .array(VariationSchema)
    .parse(
      await wooGet(credentials, `/wp-json/wc/v3/products/${productId}/variations?per_page=100`),
    )
  const optionNames = variations.map(optionName)
  const prices = variations.map(priceOf).filter((price): price is number => price !== null)
  const duplicateOptions = optionNames.length !== new Set(optionNames.map(clean)).size
  const missingPrice = prices.length !== variations.length
  const livestock = matchExcludedProduct(`${product.name} ${optionNames.join(" ")}`) !== null
  return {
    product_id: product.id,
    status: product.status,
    product_name: product.name,
    variation_count: variations.length,
    min_price: prices.length === 0 ? null : Math.min(...prices),
    max_price: prices.length === 0 ? null : Math.max(...prices),
    option_names_summary: optionNames.slice(0, 12).join("; "),
    admin_edit_url: `${credentials.baseUrl}/wp-admin/post.php?post=${product.id}&action=edit`,
    preview_url: product.permalink ?? `${credentials.baseUrl}/?p=${product.id}&preview=true`,
    has_livestock_keyword: livestock,
    has_missing_price: missingPrice,
    has_duplicate_option: duplicateOptions,
    recommended_action: actionOf(
      product.status,
      livestock,
      missingPrice,
      duplicateOptions,
      product.type,
    ),
    memo_korean: memoOf(product.status, livestock, missingPrice, duplicateOptions, product.type),
  }
}

async function wooGet(credentials: Credentials, path: string): Promise<unknown> {
  const response = await fetch(`${credentials.baseUrl}${path}`, { headers: credentials.headers })
  if (!response.ok) throw new Error(`WooCommerce GET failed: ${response.status}`)
  return response.json() as Promise<unknown>
}

function optionName(variation: z.infer<typeof VariationSchema>): string {
  return (
    variation.attributes
      ?.map((attribute) => attribute.option ?? "")
      .filter(Boolean)
      .join(" / ") ?? ""
  )
}

function priceOf(variation: z.infer<typeof VariationSchema>): number | null {
  const value = variation.regular_price ?? variation.price ?? ""
  return value.length === 0 ? null : Number(value)
}

function actionOf(
  status: string,
  livestock: boolean,
  missingPrice: boolean,
  duplicateOptions: boolean,
  type: string,
): ReviewRow["recommended_action"] {
  if (status !== "draft" && status !== "private") return "block"
  if (livestock) return "block"
  if (type !== "variable" || missingPrice || duplicateOptions) return "fix_needed"
  return "ready_to_review"
}

function memoOf(
  status: string,
  livestock: boolean,
  missingPrice: boolean,
  duplicateOptions: boolean,
  type: string,
): string {
  if (status !== "draft" && status !== "private") return "비공개 검수 상태가 아니므로 공개 전 차단"
  if (livestock) return "축산물 의심 키워드 포함으로 차단"
  if (type !== "variable") return "variable 상품이 아니므로 확인 필요"
  if (missingPrice) return "가격 없는 variation 확인 필요"
  if (duplicateOptions) return "중복 옵션명 확인 필요"
  return "관리자 검수 후 공개 판단 가능"
}

function summary(rows: readonly ReviewRow[]) {
  return {
    draftProducts: rows.filter((row) => row.status === "draft").length,
    privateProducts: rows.filter((row) => row.status === "private").length,
    publicProducts: rows.filter((row) => row.status !== "draft" && row.status !== "private").length,
    variations: rows.reduce((sum, row) => sum + row.variation_count, 0),
    livestockSuspects: rows.filter((row) => row.has_livestock_keyword).length,
    readyToReview: rows.filter((row) => row.recommended_action === "ready_to_review").length,
    fixNeeded: rows.filter((row) => row.recommended_action === "fix_needed").length,
    blocked: rows.filter((row) => row.recommended_action === "block").length,
  }
}

async function writeSummary(path: string, rows: readonly ReviewRow[]): Promise<void> {
  const data = summary(rows)
  const content = [
    "# 신규 draft 상품 검수 요약",
    "",
    `- 확인한 draft 상품 수: ${data.draftProducts}`,
    `- 확인한 private 상품 수: ${data.privateProducts}`,
    `- 공개 상태 상품 수: ${data.publicProducts}`,
    `- 확인한 variation 수: ${data.variations}`,
    `- 축산물 의심 상품 수: ${data.livestockSuspects}`,
    `- ready_to_review: ${data.readyToReview}`,
    `- fix_needed: ${data.fixNeeded}`,
    `- block: ${data.blocked}`,
    "- 이번 리포트 생성 중 WooCommerce 상품/가격/재고 수정 없음.",
  ].join("\n")
  await writeOutput(path, `${content}\n`)
}

async function writeCsv(path: string, rows: readonly ReviewRow[]): Promise<void> {
  const header = [
    "product_id",
    "status",
    "product_name",
    "variation_count",
    "min_price",
    "max_price",
    "option_names_summary",
    "admin_edit_url",
    "preview_url",
    "has_livestock_keyword",
    "has_missing_price",
    "has_duplicate_option",
    "recommended_action",
    "memo_korean",
  ] as const
  const csv = [header, ...rows.map((row) => header.map((field) => row[field]))]
    .map((line) => line.map(csvCell).join(","))
    .join("\n")
  await writeOutput(path, `${csv}\n`)
}

function csvCell(value: string | number | boolean | null): string {
  return `"${String(value ?? "").replace(/"/gu, '""')}"`
}

async function writeOutput(path: string, content: string): Promise<void> {
  const target = resolve(path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, "utf8")
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`)
  return value
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
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return
    throw error
  }
}

function clean(value: string): string {
  return value.replace(/[^가-힣a-zA-Z0-9.]/gu, "").toLowerCase()
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
