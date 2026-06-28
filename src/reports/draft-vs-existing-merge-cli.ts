import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { z } from "zod"

const ExecuteLogSchema = z.object({
  entries: z.array(
    z.object({
      action: z.string(),
      product_id: z.number().int(),
      status: z.string(),
    }),
  ),
})
const ProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  status: z.string(),
  type: z.string(),
})
const VariationSchema = z.object({
  id: z.number().int(),
  attributes: z.array(z.object({ option: z.string().optional() })).optional(),
})

type Product = z.infer<typeof ProductSchema>
type Variation = z.infer<typeof VariationSchema>
type ProductWithOptions = Product & { readonly options: readonly string[] }

type MergeRow = {
  readonly draft_product_id: number
  readonly draft_product_name: string
  readonly draft_status: string
  readonly draft_variation_count: number
  readonly matched_existing_product_id: number | null
  readonly matched_existing_product_name: string
  readonly existing_status: string
  readonly existing_variation_count: number
  readonly match_status:
    | "duplicate_existing_product"
    | "partial_missing_options"
    | "unique_new_product"
    | "review_needed"
  readonly duplicate_option_count: number
  readonly missing_option_count: number
  readonly missing_options_summary: string
  readonly recommended_action:
    | "hold_duplicate_draft"
    | "add_missing_variations_to_existing"
    | "publish_later_after_review"
    | "review_manually"
  readonly memo_korean: string
}

type Credentials = { readonly baseUrl: string; readonly headers: Record<string, string> }

async function main(): Promise<void> {
  await loadDotEnv()
  const credentials = credentialsFromEnv()
  const draftIds = await readDraftProductIds()
  const allProducts = await fetchAllProducts(credentials)
  const draftProductIds = Array.from(draftIds)
  const draftProducts = await Promise.all(
    draftProductIds.map((id) => fetchProductWithOptions(credentials, id)),
  )
  const existingProducts = allProducts.filter((product) => !draftIds.has(product.id))
  const existingWithOptions = await Promise.all(
    existingProducts.map((product) => fetchProductWithOptions(credentials, product.id)),
  )
  const rows = draftProducts.map((draft) => toMergeRow(draft, existingWithOptions))
  rows.sort((left, right) =>
    left.draft_product_name.localeCompare(right.draft_product_name, "ko-KR"),
  )
  await writeCsv("reports/draft-vs-existing-merge-plan.csv", rows)
  await writeSummary("reports/draft-vs-existing-merge-summary.md", rows, existingWithOptions)
  console.log(JSON.stringify(summary(rows, existingWithOptions), null, 2))
}

async function readDraftProductIds(): Promise<ReadonlySet<number>> {
  const log = ExecuteLogSchema.parse(
    JSON.parse(await readFile("reports/woocommerce-sync-execute-log.json", "utf8")),
  )
  return new Set(
    log.entries
      .filter(
        (entry) => entry.action === "create_new_variable_product" && entry.status === "created",
      )
      .map((entry) => entry.product_id)
      .filter((id) => id > 0),
  )
}

function credentialsFromEnv(): Credentials {
  const baseUrl = requiredEnv("WOOCOMMERCE_BASE_URL").replace(/\/$/u, "")
  const token = Buffer.from(
    `${requiredEnv("WOOCOMMERCE_CONSUMER_KEY")}:${requiredEnv("WOOCOMMERCE_CONSUMER_SECRET")}`,
  ).toString("base64")
  return { baseUrl, headers: { Authorization: `Basic ${token}` } }
}

async function fetchAllProducts(credentials: Credentials): Promise<readonly Product[]> {
  const products: Product[] = []
  for (let page = 1; ; page += 1) {
    const rows = z
      .array(ProductSchema)
      .parse(
        await wooGet(credentials, `/wp-json/wc/v3/products?per_page=100&page=${page}&status=any`),
      )
    products.push(...rows)
    if (rows.length < 100) break
  }
  return products
}

async function fetchProductWithOptions(
  credentials: Credentials,
  productId: number,
): Promise<ProductWithOptions> {
  const product = ProductSchema.parse(
    await wooGet(credentials, `/wp-json/wc/v3/products/${productId}`),
  )
  const variations = z
    .array(VariationSchema)
    .parse(
      await wooGet(credentials, `/wp-json/wc/v3/products/${productId}/variations?per_page=100`),
    )
  return { ...product, options: variations.map(optionName).filter((option) => option.length > 0) }
}

async function wooGet(credentials: Credentials, path: string): Promise<unknown> {
  const response = await fetch(`${credentials.baseUrl}${path}`, { headers: credentials.headers })
  if (!response.ok) throw new Error(`WooCommerce GET failed: ${response.status}`)
  return response.json() as Promise<unknown>
}

function toMergeRow(
  draft: ProductWithOptions,
  existingProducts: readonly ProductWithOptions[],
): MergeRow {
  const match = bestMatch(draft, existingProducts)
  if (match === null) return uniqueRow(draft)
  const duplicateOptions = draft.options.filter((option) =>
    hasOption(match.product.options, option),
  )
  const missingOptions = draft.options.filter((option) => !hasOption(match.product.options, option))
  const matchStatus = statusOf(match.score, duplicateOptions.length, missingOptions.length)
  return {
    draft_product_id: draft.id,
    draft_product_name: draft.name,
    draft_status: draft.status,
    draft_variation_count: draft.options.length,
    matched_existing_product_id: match.product.id,
    matched_existing_product_name: match.product.name,
    existing_status: match.product.status,
    existing_variation_count: match.product.options.length,
    match_status: matchStatus,
    duplicate_option_count: duplicateOptions.length,
    missing_option_count: missingOptions.length,
    missing_options_summary: missingOptions.slice(0, 20).join("; "),
    recommended_action: actionOf(matchStatus),
    memo_korean: memoOf(matchStatus),
  }
}

function uniqueRow(draft: ProductWithOptions): MergeRow {
  return {
    draft_product_id: draft.id,
    draft_product_name: draft.name,
    draft_status: draft.status,
    draft_variation_count: draft.options.length,
    matched_existing_product_id: null,
    matched_existing_product_name: "",
    existing_status: "",
    existing_variation_count: 0,
    match_status: "unique_new_product",
    duplicate_option_count: 0,
    missing_option_count: draft.options.length,
    missing_options_summary: draft.options.slice(0, 20).join("; "),
    recommended_action: "publish_later_after_review",
    memo_korean: "기존 상품과 명확한 중복을 찾지 못함. 별도 검수 후 공개 후보로 유지",
  }
}

function bestMatch(
  draft: ProductWithOptions,
  existingProducts: readonly ProductWithOptions[],
): { readonly product: ProductWithOptions; readonly score: number } | null {
  const scored = existingProducts
    .map((product) => ({ product, score: nameScore(draft.name, product.name) }))
    .filter((item) => item.score >= 0.55)
    .sort((left, right) => right.score - left.score)
  return scored[0] ?? null
}

function nameScore(left: string, right: string): number {
  const leftClean = clean(left)
  const rightClean = clean(right)
  if (
    leftClean.length > 0 &&
    rightClean.length > 0 &&
    (leftClean.includes(rightClean) || rightClean.includes(leftClean))
  )
    return 1
  const leftFamily = family(left)
  const rightFamily = family(right)
  if (leftFamily.length > 0 && leftFamily === rightFamily) return 0.75
  const leftTokens = tokens(left)
  const rightTokens = tokens(right)
  const overlap = leftTokens.filter((token) => rightTokens.includes(token)).length
  return overlap / Math.max(1, Math.min(leftTokens.length, rightTokens.length))
}

function statusOf(
  score: number,
  duplicateCount: number,
  missingCount: number,
): MergeRow["match_status"] {
  if (score < 0.65) return "review_needed"
  if (missingCount === 0 && duplicateCount > 0) return "duplicate_existing_product"
  if (duplicateCount > 0 || missingCount > 0) return "partial_missing_options"
  return "review_needed"
}

function actionOf(status: MergeRow["match_status"]): MergeRow["recommended_action"] {
  if (status === "duplicate_existing_product") return "hold_duplicate_draft"
  if (status === "partial_missing_options") return "add_missing_variations_to_existing"
  if (status === "unique_new_product") return "publish_later_after_review"
  return "review_manually"
}

function memoOf(status: MergeRow["match_status"]): string {
  if (status === "duplicate_existing_product") return "기존 상품에 동일 옵션이 있어 draft 공개 금지"
  if (status === "partial_missing_options")
    return "기존 상품에 없는 옵션만 add_variation 후보로 검토"
  if (status === "unique_new_product") return "완전 신규 후보. 공개 전 별도 검수 필요"
  return "상품명/옵션 유사도 애매함. 수동 검토 필요"
}

function hasOption(existingOptions: readonly string[], candidate: string): boolean {
  const candidateKey = optionKey(candidate)
  return existingOptions.some(
    (option) =>
      optionKey(option) === candidateKey ||
      clean(option).includes(clean(candidate)) ||
      clean(candidate).includes(clean(option)),
  )
}

function optionKey(value: string): string {
  const weight = /((?:\d+)(?:\.\d+)?)\s*(kg|g)/iu.exec(value)
  const count = /(\d+)\s*(개|입|과|망|팩|박스)/u.exec(value)
  return [
    family(value),
    weight ? `${weight[1]}${weight[2]?.toLowerCase()}` : "",
    count ? `${count[1]}${count[2]}` : "",
    clean(value),
  ].join("|")
}

function optionName(variation: Variation): string {
  return (
    variation.attributes
      ?.map((attribute) => attribute.option ?? "")
      .filter(Boolean)
      .join(" / ") ?? ""
  )
}

function family(value: string): string {
  const text = clean(value)
  if (text.includes("망고스틴")) return "망고스틴"
  if (text.includes("망고")) return "망고"
  if (text.includes("참외")) return "참외"
  if (text.includes("수박")) return "수박"
  if (text.includes("복숭아") || text.includes("천도")) return "복숭아"
  if (text.includes("감자")) return "감자"
  if (text.includes("체리")) return "체리"
  if (text.includes("옥수수")) return "옥수수"
  return ""
}

function tokens(value: string): readonly string[] {
  return clean(value).match(/[가-힣a-zA-Z0-9]{2,}/gu) ?? []
}

function summary(rows: readonly MergeRow[], existingProducts: readonly ProductWithOptions[]) {
  return {
    existingProducts: existingProducts.length,
    existingVariations: existingProducts.reduce((sum, product) => sum + product.options.length, 0),
    draftProducts: rows.length,
    publicDraftProducts: rows.filter((row) => row.draft_status === "publish").length,
    duplicateExistingProduct: rows.filter(
      (row) => row.match_status === "duplicate_existing_product",
    ).length,
    partialMissingOptions: rows.filter((row) => row.match_status === "partial_missing_options")
      .length,
    uniqueNewProduct: rows.filter((row) => row.match_status === "unique_new_product").length,
    reviewNeeded: rows.filter((row) => row.match_status === "review_needed").length,
    addVariationCandidates: rows.reduce((sum, row) => sum + row.missing_option_count, 0),
  }
}

async function writeSummary(
  path: string,
  rows: readonly MergeRow[],
  existingProducts: readonly ProductWithOptions[],
): Promise<void> {
  const data = summary(rows, existingProducts)
  await writeOutput(
    path,
    `${[
      "# Draft vs 기존 상품 병합 플랜",
      "",
      `- 기존 상품 수: ${data.existingProducts}`,
      `- 기존 variation 수: ${data.existingVariations}`,
      `- draft 상품 수: ${data.draftProducts}`,
      `- 공개된 draft 상품 수: ${data.publicDraftProducts}`,
      `- duplicate_existing_product: ${data.duplicateExistingProduct}`,
      `- partial_missing_options: ${data.partialMissingOptions}`,
      `- unique_new_product: ${data.uniqueNewProduct}`,
      `- review_needed: ${data.reviewNeeded}`,
      `- add_variation 후보 수: ${data.addVariationCandidates}`,
      "- 이번 작업에서는 WooCommerce 데이터 변경 없음.",
    ].join("\n")}\n`,
  )
}

async function writeCsv(path: string, rows: readonly MergeRow[]): Promise<void> {
  const header = [
    "draft_product_id",
    "draft_product_name",
    "draft_status",
    "draft_variation_count",
    "matched_existing_product_id",
    "matched_existing_product_name",
    "existing_status",
    "existing_variation_count",
    "match_status",
    "duplicate_option_count",
    "missing_option_count",
    "missing_options_summary",
    "recommended_action",
    "memo_korean",
  ] as const
  await writeOutput(
    path,
    `${[header, ...rows.map((row) => header.map((field) => row[field]))]
      .map((line) => line.map(csvCell).join(","))
      .join("\n")}\n`,
  )
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
