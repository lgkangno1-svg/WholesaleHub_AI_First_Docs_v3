import { mkdir, writeFile } from "node:fs/promises"
import {
  buildCanonicalHierarchy,
  buildComparisonCoverage,
  buildReviewDetails,
  buildUnmatchedReasons,
} from "../atomic-sku/analysis.js"
import type { AtomicComparisonReport, NormalizedOffer } from "../atomic-sku/types.js"

export async function writeAtomicSkuAnalysisReports(input: {
  readonly offers: readonly NormalizedOffer[]
  readonly report: AtomicComparisonReport
  readonly outputDirectory?: string
}): Promise<void> {
  const outputDirectory = input.outputDirectory ?? "reports/atomic-sku"
  const coverage = buildComparisonCoverage(input.offers, input.report)
  const reviews = buildReviewDetails(input.report)
  const hierarchy = buildCanonicalHierarchy(input.offers, input.report)
  const unmatched = buildUnmatchedReasons(input.offers, input.report)
  await mkdir(outputDirectory, { recursive: true })
  await Promise.all([
    writeJson(`${outputDirectory}/comparison-coverage.json`, coverage),
    writeFile(`${outputDirectory}/comparison-coverage.md`, renderCoverage(coverage), "utf8"),
    writeJson(`${outputDirectory}/review-questions.json`, reviews),
    writeFile(`${outputDirectory}/review-questions.md`, renderReviews(reviews), "utf8"),
    writeJson(`${outputDirectory}/canonical-hierarchy.json`, hierarchy),
    writeFile(`${outputDirectory}/canonical-hierarchy.md`, renderHierarchy(hierarchy), "utf8"),
    writeJson(`${outputDirectory}/unmatched-reasons.json`, unmatched),
    writeFile(`${outputDirectory}/unmatched-reasons.md`, renderUnmatched(unmatched), "utf8"),
  ])
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function renderCoverage(coverage: ReturnType<typeof buildComparisonCoverage>): string {
  const lines = [
    "# Atomic SKU comparison coverage",
    "",
    `생성시각: ${coverage.generatedAt}`,
    "",
    `비교 커버리지 정의: ${coverage.definition}`,
    "",
    `- 전체 active canonical variant: ${coverage.overall.activeCanonicalVariantCount}`,
    `- 2개 이상 active 공급처 연결 variant: ${coverage.overall.multiSupplierLinkedVariantCount}`,
    `- 실제 비교 수행 variant: ${coverage.overall.actuallyComparedVariantCount}`,
    `- 비교 커버리지: ${(coverage.overall.comparisonCoverageRatio * 100).toFixed(2)}%`,
    "",
    "| product_family | atomic SKU | canonical product | canonical variant | 2+ supplier variant | single source | comparison winner | backup | review | promotion | missing spec | supplier atomic SKU |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  ]
  for (const row of coverage.rows) {
    lines.push(
      `| ${row.productFamily} | ${row.atomicSkuCount} | ${row.canonicalProductCount} | ${row.canonicalVariantCount} | ${row.multiSupplierVariantCount} | ${row.singleSourceVariantCount} | ${row.comparisonWinnerCount} | ${row.backupCount} | ${row.reviewNeededCount} | ${row.promotionCount} | ${row.missingSpecCount} | ${Object.entries(
        row.atomicSkuCountBySupplier,
      )
        .map(([supplier, count]) => `${supplier}:${count}`)
        .join(", ")} |`,
    )
  }
  return `${lines.join("\n")}\n`
}

function renderReviews(reviews: ReturnType<typeof buildReviewDetails>): string {
  const lines = ["# Atomic SKU review queue 상세", "", `총 질문 수: ${reviews.length}`, ""]
  reviews.forEach((review, index) => {
    lines.push(
      `## ${index + 1}. ${String(review["productFamily"] ?? "unknown")}`,
      "",
      `- review key: ${String(review["reviewKey"] ?? "")}`,
      `- 공급처: ${toInlineJson(review["suppliers"])}`,
      `- 충돌 필드: ${toInlineJson(review["conflictFields"])}`,
      `- 자동 병합 차단 이유: ${String(review["autoMergeBlockedReason"] ?? "")}`,
      `- AI 권장 결정: ${String(review["aiRecommendedDecision"] ?? "")}`,
      `- 관리자 선택: ${toInlineJson(review["allowedAdminDecisions"])}`,
      "",
      "### 검토 데이터",
      "",
      "```json",
      JSON.stringify(review, null, 2),
      "```",
      "",
    )
  })
  return `${lines.join("\n")}\n`
}

function renderHierarchy(hierarchy: ReturnType<typeof buildCanonicalHierarchy>): string {
  const lines = [
    "# Canonical product hierarchy",
    "",
    `canonical product 수: ${hierarchy.length}`,
    "",
  ]
  for (const product of hierarchy) {
    lines.push(
      `- ${product.canonicalProductKey}`,
      `  - 분리 수준: ${product.separationLevel}`,
      `  - 설명: ${product.separationExplanation}`,
      `  - grade_group: ${product.gradeGroup}`,
      `  - usage_group: ${product.usageGroup}`,
    )
    for (const variant of product.variants) {
      lines.push(
        `    - ${variant.canonicalVariantKey}`,
        `      - comparison_status: ${variant.comparisonStatus}`,
        `      - selection_type: ${variant.selectionType ?? "none"}`,
      )
      for (const offer of variant.supplierOffers) {
        lines.push(
          `        - ${offer.supplierId}: ${offer.originalProductTitle} / ${offer.originalOptionName} / ${offer.finalCost}원 / ${offer.status}`,
        )
      }
    }
  }
  return `${lines.join("\n")}\n`
}

function renderUnmatched(unmatched: ReturnType<typeof buildUnmatchedReasons>): string {
  const lines = [
    "# Single-source unmatched reason 상위 30",
    "",
    "| 순번 | product_family | canonical_variant | 공급처 | 이유 | active offer |",
    "|---:|---|---|---|---|---:|",
  ]
  unmatched.forEach((item, index) => {
    lines.push(
      `| ${index + 1} | ${item.productFamily} | ${item.canonicalVariantKey} | ${item.sourceSuppliers.join(", ")} | ${item.unmatchedReason} | ${item.activeOfferCount} |`,
    )
  })
  return `${lines.join("\n")}\n`
}

function toInlineJson(value: unknown): string {
  return JSON.stringify(value)
}
