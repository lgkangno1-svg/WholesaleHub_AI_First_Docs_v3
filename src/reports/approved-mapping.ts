import type { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { removeMarketingText } from "../normalization/product-name-cleaner.js"

const MatchRowSchema = z.object({
  compare_key: z.string(),
  normalized_name: z.string(),
  option_key: z.string(),
  selected_supplier_id: z.string(),
  selected_supplier_original_product_name: z.string(),
  selected_supplier_original_option_name: z.string().nullable(),
  selected_price: z.number(),
  woocommerce_product_id: z.number().int().nullable(),
  woocommerce_variation_id: z.number().int().nullable(),
  woocommerce_product_name: z.string().nullable(),
  woocommerce_option_name: z.string().nullable(),
  woocommerce_current_price: z.string().nullable(),
  woocommerce_product_type: z.string().nullable().optional(),
  confidence: z.enum(["high", "medium", "low", "none"]),
})
const MatchReportSchema = z.object({ candidates: z.array(MatchRowSchema) })
const ExistingMappingSchema = z.object({ status: z.enum(["pending", "approved", "disabled"]) })

type MatchRow = z.infer<typeof MatchRowSchema>

type ApprovedRow = {
  readonly compare_key: string
  readonly normalized_name: string
  readonly option_key: string
  readonly selected_supplier_id: string
  readonly woocommerce_product_id: number
  readonly woocommerce_variation_id: number | null
  readonly reason: string
  readonly status: "approved"
}

type SkippedRow = {
  readonly compare_key: string
  readonly normalized_name: string
  readonly reason: string
  readonly review_status: "review_pending" | "new_product_candidate" | "existing_mapping_preserved"
}

export type ApprovedMappingResult = {
  readonly approved: readonly ApprovedRow[]
  readonly skipped: readonly SkippedRow[]
  readonly newProducts: readonly MatchRow[]
}

export function parseMatchReport(value: unknown): readonly MatchRow[] {
  return MatchReportSchema.parse(value).candidates
}

export function applyExactSafeApprovedMappings(
  database: DatabaseSync,
  candidates: readonly MatchRow[],
): ApprovedMappingResult {
  const approved: ApprovedRow[] = []
  const skipped: SkippedRow[] = []
  const newProducts: MatchRow[] = []
  database.exec("BEGIN")
  try {
    for (const candidate of candidates) {
      const existing = readExistingMapping(database, candidate.compare_key)
      if (existing?.status === "approved" || existing?.status === "disabled") {
        skipped.push(
          toSkipped(
            candidate,
            "existing_mapping_preserved",
            `existing ${existing.status} mapping preserved`,
          ),
        )
        continue
      }
      if (candidate.confidence === "none") {
        newProducts.push(candidate)
        skipped.push(toSkipped(candidate, "new_product_candidate", "no WooCommerce match"))
        continue
      }
      const reason = exactSafeReason(candidate)
      if (reason === null) {
        skipped.push(toSkipped(candidate, "review_pending", "not exact-safe"))
        continue
      }
      if (candidate.woocommerce_product_id === null) {
        skipped.push(toSkipped(candidate, "new_product_candidate", "missing product_id"))
        continue
      }
      upsertApprovedMapping(database, candidate)
      approved.push({
        compare_key: candidate.compare_key,
        normalized_name: candidate.normalized_name,
        option_key: candidate.option_key,
        selected_supplier_id: candidate.selected_supplier_id,
        woocommerce_product_id: candidate.woocommerce_product_id,
        woocommerce_variation_id: candidate.woocommerce_variation_id,
        reason,
        status: "approved",
      })
    }
    database.exec("COMMIT")
  } catch (error) {
    database.exec("ROLLBACK")
    throw error
  }
  return { approved, skipped, newProducts }
}

function exactSafeReason(candidate: MatchRow): string | null {
  if (candidate.confidence !== "high" || candidate.woocommerce_product_id === null) {
    return null
  }
  if (
    candidate.woocommerce_product_type === "variable" &&
    candidate.woocommerce_variation_id === null
  ) {
    return null
  }
  if (!nameMatches(candidate)) {
    return null
  }
  if (!optionMatches(candidate)) {
    return null
  }
  return "high confidence exact name and option match"
}

function nameMatches(candidate: MatchRow): boolean {
  const left = clean(candidate.normalized_name)
  const right = clean(candidate.woocommerce_product_name ?? "")
  return left.length >= 2 && right.length >= 2 && (left.includes(right) || right.includes(left))
}

function optionMatches(candidate: MatchRow): boolean {
  const expected = optionToken(candidate.option_key)
  if (expected.length === 0) {
    return false
  }
  const wooText = `${candidate.woocommerce_product_name ?? ""} ${candidate.woocommerce_option_name ?? ""}`
  return clean(wooText).includes(clean(expected))
}

function optionToken(value: string): string {
  return /\d+(?:\.\d+)?\s*(?:kg|g|개|입|과|망|팩|봉)/iu.exec(value)?.[0] ?? ""
}

function clean(value: string): string {
  return removeMarketingText(value)
    .value.replace(/[^가-힣a-zA-Z0-9.]/gu, "")
    .toLowerCase()
}

function readExistingMapping(
  database: DatabaseSync,
  compareKey: string,
): z.infer<typeof ExistingMappingSchema> | null {
  const row = database
    .prepare("SELECT status FROM woocommerce_product_mapping WHERE compare_key = ?")
    .get(compareKey)
  return row === undefined ? null : ExistingMappingSchema.parse(row)
}

function upsertApprovedMapping(database: DatabaseSync, candidate: MatchRow): void {
  database
    .prepare(`
      INSERT INTO woocommerce_product_mapping (
        compare_key, normalized_name, option_key, woocommerce_product_id,
        woocommerce_variation_id, status, admin_note, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'approved', 'exact-safe generated; dry-run only', CURRENT_TIMESTAMP)
      ON CONFLICT(compare_key) DO UPDATE SET
        woocommerce_product_id = excluded.woocommerce_product_id,
        woocommerce_variation_id = excluded.woocommerce_variation_id,
        status = 'approved',
        admin_note = excluded.admin_note,
        updated_at = CURRENT_TIMESTAMP
      WHERE woocommerce_product_mapping.status = 'pending'
    `)
    .run(
      candidate.compare_key,
      candidate.normalized_name,
      candidate.option_key,
      candidate.woocommerce_product_id,
      candidate.woocommerce_variation_id,
    )
}

function toSkipped(
  candidate: MatchRow,
  reviewStatus: SkippedRow["review_status"],
  reason: string,
): SkippedRow {
  return {
    compare_key: candidate.compare_key,
    normalized_name: candidate.normalized_name,
    reason,
    review_status: reviewStatus,
  }
}
