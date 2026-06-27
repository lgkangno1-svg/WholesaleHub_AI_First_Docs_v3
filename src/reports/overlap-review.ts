import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { removeMarketingText } from "../normalization/product-name-cleaner.js"

const ProductRowSchema = z.object({
  raw_product_id: z.number().int(),
  supplier_id: z.string(),
  original_product_name: z.string(),
  original_option_name: z.string().nullable(),
  normalized_name: z.string(),
  option_key: z.string(),
  price: z.number().int(),
  compare_key: z.string().nullable(),
})

const ConfidenceSchema = z.enum(["high", "medium", "low"])
const ReviewActionSchema = z.enum(["review_only", "possible_alias", "reject"])

type ProductRow = z.infer<typeof ProductRowSchema>
type Confidence = z.infer<typeof ConfidenceSchema>
type ReviewAction = z.infer<typeof ReviewActionSchema>

type ReviewCandidate = {
  readonly group_id: string
  readonly confidence: Confidence
  readonly reason: string
  readonly dailyfood: ProductRow
  readonly walldob2b: ProductRow
  readonly price_diff: number
  readonly price_diff_rate: number
  readonly strict_compare_key_match: boolean
  readonly recommended_action: ReviewAction
}

type ReviewReport = {
  readonly generatedAt: string
  readonly highSourceCandidates: number
  readonly reviewCandidateCount: number
  readonly strictMatchCount: number
  readonly strictMatches: readonly ReviewCandidate[]
  readonly candidates: readonly ReviewCandidate[]
}

export function buildOverlapReviewReport(database: DatabaseSync): ReviewReport {
  const sourceCandidates = buildSourceCandidates(database)
  const highCandidates = sourceCandidates.filter((candidate) => candidate.confidence === "high")
  const candidates = limitPerSide(highCandidates).map((candidate, index) => ({
    ...candidate,
    group_id: `overlap-${String(index + 1).padStart(4, "0")}`,
  }))
  return {
    generatedAt: new Date().toISOString(),
    highSourceCandidates: highCandidates.length,
    reviewCandidateCount: candidates.length,
    strictMatchCount: countStrictGroups(database),
    strictMatches: uniqueStrictMatches(candidates),
    candidates,
  }
}

export async function writeOverlapReviewReport(
  database: DatabaseSync,
  jsonPath: string,
  csvPath: string,
): Promise<ReviewReport> {
  const report = buildOverlapReviewReport(database)
  await writeOutput(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  await writeOutput(csvPath, toCsv(report.candidates))
  return report
}

function buildSourceCandidates(database: DatabaseSync): readonly ReviewCandidate[] {
  const dailyRows = readSupplierRows(database, "dailyfood")
  const walldoRows = readSupplierRows(database, "walldob2b")
  const candidates: ReviewCandidate[] = []
  for (const daily of dailyRows) {
    for (const walldo of walldoRows) {
      const confidence = scoreCandidate(daily, walldo)
      if (confidence === null) {
        continue
      }
      candidates.push(toCandidate(daily, walldo, confidence))
    }
  }
  return candidates.sort(compareCandidates)
}

function readSupplierRows(database: DatabaseSync, supplierId: string): readonly ProductRow[] {
  return z.array(ProductRowSchema).parse(
    database
      .prepare(`
        SELECT r.id AS raw_product_id, r.supplier_id, r.original_product_name,
          r.original_option_name, n.normalized_name, n.option_key, n.price, c.compare_key
        FROM raw_products r
        JOIN normalized_products n ON n.raw_product_id = r.id
        LEFT JOIN compare_products c ON c.normalized_name = n.normalized_name AND c.option_key = n.option_key
        WHERE r.supplier_id = ?
        ORDER BY n.normalized_name, n.option_key, n.price
      `)
      .all(supplierId),
  )
}

function scoreCandidate(daily: ProductRow, walldo: ProductRow): Confidence | null {
  if (canonicalName(daily) !== canonicalName(walldo)) {
    return null
  }
  const dailyWeight = optionWeight(daily)
  const walldoWeight = optionWeight(walldo)
  if (dailyWeight.length > 0 && walldoWeight.length > 0 && dailyWeight !== walldoWeight) {
    return null
  }
  const priceRate = priceDiffRate(daily.price, walldo.price)
  if (priceRate > 1) {
    return "medium"
  }
  return daily.option_key === walldo.option_key ? "high" : "high"
}

function toCandidate(
  daily: ProductRow,
  walldo: ProductRow,
  confidence: Confidence,
): ReviewCandidate {
  const diff = walldo.price - daily.price
  const strictMatch =
    daily.normalized_name === walldo.normalized_name && daily.option_key === walldo.option_key
  return {
    group_id: "pending",
    confidence,
    reason: strictMatch
      ? "strict compare_key match"
      : `same canonical product: ${canonicalName(daily)}`,
    dailyfood: daily,
    walldob2b: walldo,
    price_diff: diff,
    price_diff_rate: priceDiffRate(daily.price, walldo.price),
    strict_compare_key_match: strictMatch,
    recommended_action: strictMatch ? "review_only" : "possible_alias",
  }
}

function uniqueStrictMatches(candidates: readonly ReviewCandidate[]): readonly ReviewCandidate[] {
  const seen = new Set<string>()
  const matches: ReviewCandidate[] = []
  for (const candidate of candidates) {
    if (!candidate.strict_compare_key_match) {
      continue
    }
    const key = `${candidate.dailyfood.normalized_name}|${candidate.dailyfood.option_key}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    matches.push(candidate)
  }
  return matches
}

function limitPerSide(candidates: readonly ReviewCandidate[]): readonly ReviewCandidate[] {
  const dailyCounts = new Map<number, number>()
  const walldoCounts = new Map<number, number>()
  const kept: ReviewCandidate[] = []
  for (const candidate of candidates) {
    const dailyCount = dailyCounts.get(candidate.dailyfood.raw_product_id) ?? 0
    const walldoCount = walldoCounts.get(candidate.walldob2b.raw_product_id) ?? 0
    if (dailyCount >= 3 || walldoCount >= 3) {
      continue
    }
    dailyCounts.set(candidate.dailyfood.raw_product_id, dailyCount + 1)
    walldoCounts.set(candidate.walldob2b.raw_product_id, walldoCount + 1)
    kept.push(candidate)
  }
  return kept
}

function compareCandidates(left: ReviewCandidate, right: ReviewCandidate): number {
  if (left.strict_compare_key_match !== right.strict_compare_key_match) {
    return left.strict_compare_key_match ? -1 : 1
  }
  return (
    left.price_diff_rate - right.price_diff_rate ||
    Math.abs(left.price_diff) - Math.abs(right.price_diff)
  )
}

function canonicalName(row: ProductRow): string {
  const cleaned = removeMarketingText(row.normalized_name).value.replace(/\s/gu, "")
  if (cleaned.includes("가정용") && cleaned.includes("성주") && cleaned.includes("참외")) {
    return "가정용성주참외"
  }
  if (cleaned.includes("성주") && cleaned.includes("참외")) {
    return "성주참외"
  }
  if (cleaned.includes("참외")) {
    return "참외"
  }
  return cleaned
}

function optionWeight(row: ProductRow): string {
  return /\d+(?:\.\d+)?kg/iu.exec(row.option_key)?.[0]?.toLowerCase() ?? ""
}

function priceDiffRate(leftPrice: number, rightPrice: number): number {
  return Math.abs(rightPrice - leftPrice) / Math.max(Math.min(leftPrice, rightPrice), 1)
}

function countStrictGroups(database: DatabaseSync): number {
  const row = database
    .prepare(`
      SELECT COUNT(*) AS count
      FROM (
        SELECT normalized_name, option_key
        FROM normalized_products
        WHERE supplier_id IN ('dailyfood', 'walldob2b')
        GROUP BY normalized_name, option_key
        HAVING COUNT(DISTINCT supplier_id) = 2
      )
    `)
    .get()
  return z.object({ count: z.number().int() }).parse(row).count
}

async function writeOutput(path: string, value: string): Promise<void> {
  const target = resolve(path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, value, "utf8")
}

function toCsv(candidates: readonly ReviewCandidate[]): string {
  const header = [
    "group_id",
    "confidence",
    "reason",
    "dailyfood_original_product_name",
    "dailyfood_original_option_name",
    "dailyfood_normalized_name",
    "dailyfood_option_key",
    "dailyfood_price",
    "walldob2b_original_product_name",
    "walldob2b_original_option_name",
    "walldob2b_normalized_name",
    "walldob2b_option_key",
    "walldob2b_price",
    "price_diff",
    "price_diff_rate",
    "strict_compare_key_match",
    "recommended_action",
  ]
  const rows = candidates.map(toCsvRow)
  return `${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`
}

function toCsvRow(candidate: ReviewCandidate): readonly (string | number | boolean | null)[] {
  return [
    candidate.group_id,
    candidate.confidence,
    candidate.reason,
    candidate.dailyfood.original_product_name,
    candidate.dailyfood.original_option_name,
    candidate.dailyfood.normalized_name,
    candidate.dailyfood.option_key,
    candidate.dailyfood.price,
    candidate.walldob2b.original_product_name,
    candidate.walldob2b.original_option_name,
    candidate.walldob2b.normalized_name,
    candidate.walldob2b.option_key,
    candidate.walldob2b.price,
    candidate.price_diff,
    candidate.price_diff_rate.toFixed(4),
    candidate.strict_compare_key_match,
    candidate.recommended_action,
  ]
}

function csvCell(value: string | number | boolean | null): string {
  return `"${String(value ?? "").replace(/"/gu, '""')}"`
}
