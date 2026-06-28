import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { z } from "zod"

type ReviewStatus = "pending" | "approve" | "block" | "fix"
type PublishAction = "publish_candidate" | "excluded"

type ReviewRow = {
  readonly product_id: string
  readonly status: string
  readonly product_name: string
  readonly variation_count: string
  readonly min_price: string
  readonly max_price: string
  readonly option_names_summary: string
  readonly admin_edit_url: string
  readonly preview_url: string
  readonly has_livestock_keyword: string
  readonly has_missing_price: string
  readonly has_duplicate_option: string
  readonly recommended_action: string
  readonly memo_korean: string
  readonly review_status: ReviewStatus
}

type PublishPlanRow = {
  readonly product_id: number | null
  readonly product_name: string
  readonly status: string
  readonly review_status: ReviewStatus
  readonly variation_count: number
  readonly min_price: number | null
  readonly action: PublishAction
  readonly eligible: boolean
  readonly exclude_reason: string
  readonly admin_edit_url: string
  readonly preview_url: string
}

const OptionsSchema = z.object({
  input: z.string(),
  execute: z.boolean(),
  confirm: z.string(),
})
type Options = z.infer<typeof OptionsSchema>

async function main(): Promise<void> {
  await loadDotEnv()
  const options = parseArguments(process.argv.slice(2))
  enforceExecuteGuard(options)
  const rows = await readReviewCsv(options.input)
  await writeReviewCsv(options.input, rows)
  const plan = rows.map(toPlanRow)
  const publishCandidates = plan.filter((row) => row.eligible)
  const publishResult = options.execute ? await publishProducts(publishCandidates) : null
  await writePlanFiles(plan, publishResult, options.execute)
  console.log(JSON.stringify(summary(plan, publishResult, options.execute), null, 2))
}

function parseArguments(args: readonly string[]): Options {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    if (key === "--execute") {
      values.set("--execute", "true")
      continue
    }
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error(`Invalid publish plan argument: ${key ?? "unknown"}`)
    }
    values.set(key, value)
    index += 1
  }
  return OptionsSchema.parse({
    input: values.get("--input") ?? "reports/draft-products-review.csv",
    execute: values.get("--execute") === "true",
    confirm: values.get("--confirm") ?? "",
  })
}

function enforceExecuteGuard(options: Options): void {
  if (!options.execute) return
  if (options.confirm !== "PUBLISH_APPROVED_DRAFT_PRODUCTS") {
    throw new Error('--execute requires --confirm "PUBLISH_APPROVED_DRAFT_PRODUCTS"')
  }
}

async function readReviewCsv(path: string): Promise<readonly ReviewRow[]> {
  const rows = parseCsv(await readFile(path, "utf8"))
  return rows.map((row) => ({
    product_id: row["product_id"] ?? "",
    status: row["status"] ?? "",
    product_name: row["product_name"] ?? "",
    variation_count: row["variation_count"] ?? "0",
    min_price: row["min_price"] ?? "",
    max_price: row["max_price"] ?? "",
    option_names_summary: row["option_names_summary"] ?? "",
    admin_edit_url: row["admin_edit_url"] ?? "",
    preview_url: row["preview_url"] ?? "",
    has_livestock_keyword: row["has_livestock_keyword"] ?? "false",
    has_missing_price: row["has_missing_price"] ?? "false",
    has_duplicate_option: row["has_duplicate_option"] ?? "false",
    recommended_action: row["recommended_action"] ?? "",
    memo_korean: row["memo_korean"] ?? "",
    review_status: parseReviewStatus(row["review_status"]),
  }))
}

function parseReviewStatus(value: string | undefined): ReviewStatus {
  if (value === "approve" || value === "block" || value === "fix") return value
  return "pending"
}

function toPlanRow(row: ReviewRow): PublishPlanRow {
  const productId = numberOrNull(row["product_id"])
  const variationCount = Number(row["variation_count"]) || 0
  const minPrice = numberOrNull(row["min_price"])
  const reasons = [
    row["review_status"] !== "approve" ? `review_status=${row["review_status"]}` : "",
    row["status"] !== "draft" ? `status=${row["status"]}` : "",
    row["has_livestock_keyword"] === "true" ? "livestock_keyword" : "",
    row["has_missing_price"] === "true" ? "missing_price" : "",
    row["has_duplicate_option"] === "true" ? "duplicate_option" : "",
    variationCount <= 0 ? "no_variations" : "",
    minPrice === null || minPrice < 1000 ? "price_guard" : "",
    productId === null ? "missing_product_id" : "",
  ].filter(Boolean)
  return {
    product_id: productId,
    product_name: row["product_name"],
    status: row["status"],
    review_status: row["review_status"],
    variation_count: variationCount,
    min_price: minPrice,
    action: reasons.length === 0 ? "publish_candidate" : "excluded",
    eligible: reasons.length === 0,
    exclude_reason: reasons.join("; "),
    admin_edit_url: row["admin_edit_url"],
    preview_url: row["preview_url"],
  }
}

async function publishProducts(
  rows: readonly PublishPlanRow[],
): Promise<readonly PublishPlanRow[]> {
  const baseUrl = requiredEnv("WOOCOMMERCE_BASE_URL").replace(/\/$/u, "")
  const token = Buffer.from(
    `${requiredEnv("WOOCOMMERCE_CONSUMER_KEY")}:${requiredEnv("WOOCOMMERCE_CONSUMER_SECRET")}`,
  ).toString("base64")
  const published: PublishPlanRow[] = []
  for (const row of rows) {
    if (row["product_id"] === null) continue
    const response = await fetch(`${baseUrl}/wp-json/wc/v3/products/${row["product_id"]}`, {
      method: "PUT",
      headers: { Authorization: `Basic ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "publish" }),
    })
    if (!response.ok)
      throw new Error(`publish failed product_id=${row["product_id"]} status=${response.status}`)
    published.push(row)
  }
  return published
}

function summary(
  rows: readonly PublishPlanRow[],
  published: readonly PublishPlanRow[] | null,
  execute: boolean,
) {
  return {
    execute,
    publishCandidates: rows.filter((row) => row.eligible).length,
    excluded: rows.filter((row) => !row.eligible).length,
    errors: 0,
    actuallyPublished: published?.length ?? 0,
  }
}

async function writePlanFiles(
  rows: readonly PublishPlanRow[],
  published: readonly PublishPlanRow[] | null,
  execute: boolean,
): Promise<void> {
  await writeOutput(
    "reports/draft-products-publish-plan.json",
    `${JSON.stringify(rows, null, 2)}\n`,
  )
  await writeOutput("reports/draft-products-publish-plan.csv", toCsv(rows))
  const data = summary(rows, published, execute)
  await writeOutput(
    "reports/draft-products-publish-summary.md",
    `${[
      "# Draft 상품 공개 승인 플랜",
      "",
      `- 실행 모드: ${execute ? "execute" : "dry-run"}`,
      `- 공개 후보 수: ${data.publishCandidates}`,
      `- 제외 수: ${data.excluded}`,
      `- 오류 수: ${data.errors}`,
      `- 실제 공개 수: ${data.actuallyPublished}`,
      "- review_status=approve인 안전 조건 충족 상품만 공개 후보가 된다.",
    ].join("\n")}\n`,
  )
}

async function writeReviewCsv(path: string, rows: readonly ReviewRow[]): Promise<void> {
  await writeOutput(path, toCsv(rows))
}

function toCsv<T extends Record<string, unknown>>(rows: readonly T[]): string {
  const header = rows[0] === undefined ? [] : Object.keys(rows[0])
  return `${[header, ...rows.map((row) => header.map((field) => row[field]))]
    .map((line) => line.map(csvCell).join(","))
    .join("\n")}\n`
}

function parseCsv(content: string): readonly Record<string, string>[] {
  const lines = content.trim().split(/\r?\n/u)
  if (lines.length === 0) return []
  const header = parseCsvLine(lines[0] ?? "")
  return lines
    .slice(1)
    .map((line) =>
      Object.fromEntries(
        parseCsvLine(line).map((value, index) => [header[index] ?? `col_${index}`, value]),
      ),
    )
}

function parseCsvLine(line: string): readonly string[] {
  const cells: string[] = []
  let current = ""
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (char === '"' && quoted && next === '"') {
      current += '"'
      index += 1
    } else if (char === '"') quoted = !quoted
    else if (char === "," && !quoted) {
      cells.push(current)
      current = ""
    } else current += char
  }
  cells.push(current)
  return cells
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/gu, '""')}"`
}

function numberOrNull(value: string): number | null {
  if (value.trim().length === 0) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
