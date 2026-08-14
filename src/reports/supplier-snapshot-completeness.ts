export type SupplierSnapshotCompletenessInput = {
  readonly currentCount: number
  readonly previousSuccessfulCount: number | null
  readonly absoluteMinimum: number
  readonly bootstrapMaximum: number
  readonly authVerified: boolean
  readonly paginationComplete: boolean
  readonly detailRequestCount: number
  readonly detailSuccessCount: number
  readonly parseFailureCount: number
  readonly schemaInvalidCount: number
  readonly duplicateSourceIdCount: number
  readonly createdAtMs: number
  readonly nowMs: number
  readonly maxAgeMs: number
}

export type SupplierSnapshotCompletenessResult = {
  readonly complete: boolean
  readonly reasons: readonly string[]
  readonly minimumExpectedCount: number
  readonly maximumExpectedCount: number
  readonly detailSuccessRate: number
}

const MINIMUM_RETAINED_RATIO = 0.8
const MAXIMUM_GROWTH_RATIO = 1.5
const MINIMUM_DETAIL_SUCCESS_RATE = 0.99

export function evaluateSupplierSnapshotCompleteness(
  input: SupplierSnapshotCompletenessInput,
): SupplierSnapshotCompletenessResult {
  const minimumExpectedCount = Math.max(
    input.absoluteMinimum,
    input.previousSuccessfulCount === null
      ? input.absoluteMinimum
      : Math.floor(input.previousSuccessfulCount * MINIMUM_RETAINED_RATIO),
  )
  const maximumExpectedCount =
    input.previousSuccessfulCount === null
      ? input.bootstrapMaximum
      : Math.ceil(input.previousSuccessfulCount * MAXIMUM_GROWTH_RATIO)
  const detailSuccessRate =
    input.detailRequestCount === 0 ? 1 : input.detailSuccessCount / input.detailRequestCount
  const reasons: string[] = []

  if (!input.authVerified) reasons.push("authentication_not_verified")
  if (!input.paginationComplete) reasons.push("pagination_incomplete")
  if (input.currentCount < minimumExpectedCount) reasons.push("count_drop_anomaly")
  if (input.currentCount > maximumExpectedCount) reasons.push("count_growth_anomaly")
  if (detailSuccessRate < MINIMUM_DETAIL_SUCCESS_RATE)
    reasons.push("detail_success_rate_below_99_percent")
  if (input.parseFailureCount > 0) reasons.push("parse_failures_present")
  if (input.schemaInvalidCount > 0) reasons.push("schema_invalid_rows_present")
  if (input.duplicateSourceIdCount > 0) reasons.push("duplicate_source_ids_present")
  if (
    !Number.isFinite(input.createdAtMs) ||
    input.createdAtMs > input.nowMs ||
    input.nowMs - input.createdAtMs > input.maxAgeMs
  ) {
    reasons.push("snapshot_not_fresh")
  }

  return {
    complete: reasons.length === 0,
    reasons,
    minimumExpectedCount,
    maximumExpectedCount,
    detailSuccessRate,
  }
}
