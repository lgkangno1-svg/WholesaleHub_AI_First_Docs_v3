import type {
  AuditClass,
  MatchCandidate,
  ReviewRow,
  SellPlanRow,
} from "./update-candidate-audit-inputs.js"

type AuditRow = {
  readonly product_id: number | null
  readonly variation_id: number | null
  readonly woocommerce_product_name: string | null
  readonly woocommerce_option_name: string | null
  readonly selected_supplier_id: string | null
  readonly supplier_product_name: string | null
  readonly supplier_option_name: string | null
  readonly normalized_name: string | null
  readonly option_key: string | null
  readonly audit_class: AuditClass
  readonly product_group: string
  readonly already_updated: boolean
  readonly reason: string
}

type GroupSummary = {
  readonly group: string
  readonly safe_count: number
  readonly dailyfood_exists: boolean
  readonly walldob2b_exists: boolean
  readonly strict_compared_count: number
  readonly single_supplier_count: number
  readonly suspicious_count: number
  readonly note: string
}

export type UpdateCandidateAuditReport = {
  readonly generatedAt: string
  readonly safeCount: number
  readonly classCounts: Record<AuditClass, number>
  readonly updatedRows: readonly AuditRow[]
  readonly groupSummaries: readonly GroupSummary[]
  readonly rows: readonly AuditRow[]
}

export function buildUpdateCandidateAuditReport(
  reviewRows: readonly ReviewRow[],
  sellRows: readonly SellPlanRow[],
  matchRows: readonly MatchCandidate[],
  updatedKeys: ReadonlySet<string>,
): UpdateCandidateAuditReport {
  const rows = reviewRows
    .filter((row) => row.safety_status === "safe")
    .map((row) => toAuditRow(row, sellRows, matchRows, updatedKeys))
  return {
    generatedAt: new Date().toISOString(),
    safeCount: rows.length,
    classCounts: countClasses(rows),
    updatedRows: rows.filter((row) => row.already_updated),
    groupSummaries: buildGroupSummaries(rows, sellRows),
    rows,
  }
}

function toAuditRow(
  review: ReviewRow,
  sellRows: readonly SellPlanRow[],
  matchRows: readonly MatchCandidate[],
  updatedKeys: ReadonlySet<string>,
): AuditRow {
  const match = findMatchCandidate(review, matchRows)
  const sell = findSellRow(match, sellRows)
  const auditClass = classify(review, sell, sellRows)
  return {
    product_id: review.product_id,
    variation_id: review.variation_id,
    woocommerce_product_name: review.woocommerce_product_name,
    woocommerce_option_name: review.woocommerce_option_name,
    selected_supplier_id: review.selected_supplier_id,
    supplier_product_name: review.selected_supplier_original_product_name,
    supplier_option_name: review.selected_supplier_original_option_name,
    normalized_name: sell?.normalized_name ?? null,
    option_key: sell?.option_key ?? null,
    audit_class: auditClass,
    product_group: productGroup(
      `${sell?.normalized_name ?? ""} ${review.woocommerce_product_name ?? ""}`,
    ),
    already_updated:
      review.product_id !== null &&
      review.variation_id !== null &&
      updatedKeys.has(keyOf(review.product_id, review.variation_id)),
    reason: reasonFor(auditClass, sell),
  }
}

function findMatchCandidate(
  review: ReviewRow,
  matchRows: readonly MatchCandidate[],
): MatchCandidate | null {
  if (review.product_id === null || review.variation_id === null) return null
  const key = keyOf(review.product_id, review.variation_id)
  return (
    matchRows.find(
      (row) =>
        row.confidence === "high" &&
        row.selected_supplier_id === review.selected_supplier_id &&
        row.woocommerce_product_id !== null &&
        row.woocommerce_variation_id !== null &&
        keyOf(row.woocommerce_product_id, row.woocommerce_variation_id) === key,
    ) ?? null
  )
}

function findSellRow(
  match: MatchCandidate | null,
  sellRows: readonly SellPlanRow[],
): SellPlanRow | null {
  return match === null
    ? null
    : (sellRows.find((row) => row.compare_key === match.compare_key) ?? null)
}

function classify(
  review: ReviewRow,
  sell: SellPlanRow | null,
  sellRows: readonly SellPlanRow[],
): AuditClass {
  if (sell?.compared_with_other_supplier === true) return "strict_compared"
  if (
    sell !== null &&
    isWatchedGroup(productGroup(sell.normalized_name)) &&
    hasSimilarOtherSupplier(sell, sellRows)
  ) {
    return "suspicious"
  }
  if (review.selected_supplier_id !== null && sell !== null) return "single_supplier"
  return "suspicious"
}

function hasSimilarOtherSupplier(row: SellPlanRow, sellRows: readonly SellPlanRow[]): boolean {
  const group = productGroup(row.normalized_name)
  return sellRows.some(
    (candidate) =>
      candidate.selected_supplier_id !== row.selected_supplier_id &&
      productGroup(candidate.normalized_name) === group,
  )
}

function productGroup(value: string): string {
  const text = value.replace(/\s/gu, "")
  if (/성주?참외|참외/u.test(text)) return "참외/성주참외"
  if (/수박/u.test(text)) return "수박"
  if (/신비|천도|복숭아/u.test(text)) return "복숭아/신비복숭아/천도"
  if (/홍감자|감자/u.test(text)) return "감자/홍감자"
  if (/망고스틴|망고/u.test(text)) return "망고/망고스틴"
  if (/체리/u.test(text)) return "체리"
  if (/옥수수/u.test(text)) return "옥수수"
  return "기타"
}

function isWatchedGroup(group: string): boolean {
  return group !== "기타"
}

function buildGroupSummaries(
  rows: readonly AuditRow[],
  sellRows: readonly SellPlanRow[],
): readonly GroupSummary[] {
  const groups = [
    "참외/성주참외",
    "수박",
    "복숭아/신비복숭아/천도",
    "감자/홍감자",
    "망고/망고스틴",
    "체리",
    "옥수수",
    "기타",
  ] as const
  return groups.map((group) => {
    const groupRows = rows.filter((row) => row.product_group === group)
    const sourceRows = sellRows.filter((row) => productGroup(row.normalized_name) === group)
    const suppliers = new Set(sourceRows.map((row) => row.selected_supplier_id))
    const strictCount = groupRows.filter((row) => row.audit_class === "strict_compared").length
    const suspicious = groupRows.filter((row) => row.audit_class === "suspicious").length
    return {
      group,
      safe_count: groupRows.length,
      dailyfood_exists: suppliers.has("dailyfood"),
      walldob2b_exists: suppliers.has("walldob2b"),
      strict_compared_count: strictCount,
      single_supplier_count: groupRows.filter((row) => row.audit_class === "single_supplier")
        .length,
      suspicious_count: suspicious,
      note: groupNote(group, suppliers, strictCount, suspicious),
    }
  })
}

function groupNote(
  group: string,
  suppliers: ReadonlySet<string>,
  strictCount: number,
  suspicious: number,
): string {
  if (
    isWatchedGroup(group) &&
    suppliers.has("dailyfood") &&
    suppliers.has("walldob2b") &&
    strictCount === 0
  ) {
    return "양쪽 공급처 존재하지만 strict 비교 없음: 옵션/중량/입수 차이 또는 정규화 확인 필요"
  }
  if (suspicious > 0) return "유사 상품군이 있어 대량 업데이트 전 샘플 검수 권장"
  return "단독 또는 strict 비교 기준으로 처리됨"
}

function reasonFor(auditClass: AuditClass, sell: SellPlanRow | null): string {
  switch (auditClass) {
    case "strict_compared":
      return "DailyFood/walldob2b same strict compare_key; cheapest selected"
    case "single_supplier":
      return "only one supplier in strict sell-plan group"
    case "suspicious":
      return sell === null
        ? "sell-plan row not found from WooCommerce match candidate"
        : "watched product group exists in another supplier but strict option_key differs"
  }
}

function countClasses(rows: readonly AuditRow[]): Record<AuditClass, number> {
  return {
    strict_compared: rows.filter((row) => row.audit_class === "strict_compared").length,
    single_supplier: rows.filter((row) => row.audit_class === "single_supplier").length,
    suspicious: rows.filter((row) => row.audit_class === "suspicious").length,
  }
}

function keyOf(productId: number, variationId: number): string {
  return `${productId}:${variationId}`
}
