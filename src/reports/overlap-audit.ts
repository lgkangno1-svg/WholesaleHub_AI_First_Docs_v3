import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { removeMarketingText } from "../normalization/product-name-cleaner.js"

const KEYWORDS = ["신비", "복숭아", "천도", "참외", "성주참외", "홍감자", "망고"] as const
const ConfidenceSchema = z.enum(["high", "medium", "low"])

const ProductRowSchema = z.object({
  supplier_id: z.string(),
  original_product_name: z.string(),
  original_option_name: z.string().nullable(),
  price: z.number().nullable(),
  normalized_name: z.string().nullable(),
  option_key: z.string().nullable(),
  compare_key: z.string().nullable(),
})

const SourceRowSchema = z.object({
  supplier_id: z.string(),
  source_type: z.string(),
  count: z.number().int(),
})

type ProductRow = z.infer<typeof ProductRowSchema>
type Confidence = z.infer<typeof ConfidenceSchema>

type LooseCandidate = {
  readonly dailyfood: ProductRow
  readonly walldob2b: ProductRow
  readonly reason: string
  readonly strictMismatchReason: string
  readonly confidence: Confidence
}

export function buildOverlapAuditReport(database: DatabaseSync): unknown {
  const keywordMatches = KEYWORDS.map((keyword) => ({
    keyword,
    suppliers: suppliersForKeyword(database, keyword),
    samples: readKeywordRows(database, keyword, 20),
  }))
  const candidates = buildLooseCandidates(database)
  return {
    generatedAt: new Date().toISOString(),
    dailyfoodSource:
      readSourceRows(database).find((row) => row.supplier_id === "dailyfood") ?? null,
    keywordMatches,
    strictSharedCompareKeys: countStrictSharedCompareKeys(database),
    probableCause: inferCause(keywordMatches, candidates),
    looseCandidateCount: candidates.length,
    confidenceCounts: countByConfidence(candidates),
    looseCandidates: candidates.slice(0, 50),
  }
}

export async function writeOverlapAuditReport(
  databasePath: string,
  outputPath: string,
): Promise<unknown> {
  const database = new DatabaseSync(resolve(databasePath), { readOnly: true })
  try {
    const report = buildOverlapAuditReport(database)
    const target = resolve(outputPath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8")
    return report
  } finally {
    database.close()
  }
}

function readKeywordRows(
  database: DatabaseSync,
  keyword: string,
  limit: number,
): readonly ProductRow[] {
  return z.array(ProductRowSchema).parse(
    database
      .prepare(`
        SELECT r.supplier_id, r.original_product_name, r.original_option_name, r.price,
          n.normalized_name, n.option_key, c.compare_key
        FROM raw_products r
        LEFT JOIN normalized_products n ON n.raw_product_id = r.id
        LEFT JOIN compare_products c ON c.normalized_name = n.normalized_name AND c.option_key = n.option_key
        WHERE r.original_product_name LIKE ? OR COALESCE(r.original_option_name, '') LIKE ?
          OR COALESCE(n.normalized_name, '') LIKE ? OR COALESCE(n.option_key, '') LIKE ?
        ORDER BY r.supplier_id, r.original_product_name, r.original_option_name
        LIMIT ?
      `)
      .all(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, limit),
  )
}

function suppliersForKeyword(database: DatabaseSync, keyword: string): readonly string[] {
  return [...new Set(readKeywordRows(database, keyword, 100).map((row) => row.supplier_id))]
}

function readSourceRows(database: DatabaseSync): readonly z.infer<typeof SourceRowSchema>[] {
  return z.array(SourceRowSchema).parse(
    database
      .prepare(`
        SELECT r.supplier_id, r.source_type, COUNT(*) AS count
        FROM raw_products r
        GROUP BY r.supplier_id, r.source_type
        ORDER BY r.supplier_id
      `)
      .all(),
  )
}

function buildLooseCandidates(database: DatabaseSync): readonly LooseCandidate[] {
  const daily = readSupplierRows(database, "dailyfood")
  const walldo = readSupplierRows(database, "walldob2b")
  const candidates: LooseCandidate[] = []
  const seen = new Set<string>()
  for (const left of daily) {
    for (const right of walldo) {
      const confidence = compareLoose(left, right)
      if (confidence === null) {
        continue
      }
      const key = `${left.original_product_name}|${left.original_option_name ?? ""}|${right.original_product_name}|${right.original_option_name ?? ""}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      candidates.push({
        dailyfood: left,
        walldob2b: right,
        reason: `loose name family: ${canonicalName(left)} ≈ ${canonicalName(right)}`,
        strictMismatchReason: strictMismatchReason(left, right),
        confidence,
      })
    }
  }
  return candidates.sort(
    (left, right) => confidenceRank(right.confidence) - confidenceRank(left.confidence),
  )
}

function readSupplierRows(database: DatabaseSync, supplierId: string): readonly ProductRow[] {
  return z.array(ProductRowSchema).parse(
    database
      .prepare(`
        SELECT r.supplier_id, r.original_product_name, r.original_option_name, r.price,
          n.normalized_name, n.option_key, c.compare_key
        FROM raw_products r
        JOIN normalized_products n ON n.raw_product_id = r.id
        LEFT JOIN compare_products c ON c.normalized_name = n.normalized_name AND c.option_key = n.option_key
        WHERE r.supplier_id = ?
        ORDER BY n.normalized_name, n.option_key
      `)
      .all(supplierId),
  )
}

function compareLoose(left: ProductRow, right: ProductRow): Confidence | null {
  const leftName = canonicalName(left)
  const rightName = canonicalName(right)
  if (leftName.length === 0 || rightName.length === 0) {
    return null
  }
  if (leftName === rightName && left.option_key === right.option_key) {
    return "high"
  }
  if (leftName === rightName) {
    return optionWeight(left) === optionWeight(right) ? "high" : "medium"
  }
  if (leftName.includes(rightName) || rightName.includes(leftName)) {
    return "low"
  }
  return null
}

function canonicalName(row: ProductRow): string {
  const rawName = row.normalized_name ?? row.original_product_name
  const cleaned = removeMarketingText(rawName).value.replace(/\s/gu, "")
  if (/성주?참외|참외/u.test(cleaned)) {
    return "참외"
  }
  if (/신비.*복숭아|신비/u.test(cleaned)) {
    return "신비복숭아"
  }
  if (/복숭아|대극천/u.test(cleaned)) {
    return "복숭아"
  }
  if (/홍감자/u.test(cleaned)) {
    return "홍감자"
  }
  if (/망고스틴/u.test(cleaned)) {
    return "망고스틴"
  }
  if (/무지개망고/u.test(cleaned)) {
    return "무지개망고"
  }
  if (/망고/u.test(cleaned)) {
    return "망고"
  }
  return cleaned
}

function optionWeight(row: ProductRow): string {
  return /\d+(?:\.\d+)?kg/iu.exec(row.option_key ?? "")?.[0]?.toLowerCase() ?? ""
}

function strictMismatchReason(left: ProductRow, right: ProductRow): string {
  if (left.normalized_name !== right.normalized_name) {
    return "normalized_name mismatch"
  }
  if (left.option_key !== right.option_key) {
    return "option_key mismatch"
  }
  return "strict key already matches"
}

function countStrictSharedCompareKeys(database: DatabaseSync): number {
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

function countByConfidence(candidates: readonly LooseCandidate[]): Record<Confidence, number> {
  return {
    high: candidates.filter((candidate) => candidate.confidence === "high").length,
    medium: candidates.filter((candidate) => candidate.confidence === "medium").length,
    low: candidates.filter((candidate) => candidate.confidence === "low").length,
  }
}

function confidenceRank(confidence: Confidence): number {
  switch (confidence) {
    case "high":
      return 3
    case "medium":
      return 2
    case "low":
      return 1
  }
}

function inferCause(
  keywordMatches: readonly { readonly suppliers: readonly string[] }[],
  candidates: readonly LooseCandidate[],
): string {
  const bothSupplierKeywords = keywordMatches.filter(
    (item) => item.suppliers.includes("dailyfood") && item.suppliers.includes("walldob2b"),
  ).length
  if (bothSupplierKeywords === 0) {
    return "A/D: DailyFood Google Sheet 88행 범위와 walldob2b 상품군이 대부분 다르다."
  }
  if (candidates.length > 0) {
    return "B/C/D: 이름 정규화와 option_key가 strict compare_key에서 너무 엄격하다."
  }
  return "D: 상품명은 일부 유사하지만 옵션 중량/단위가 달라 strict compare_key로는 분리된다."
}
