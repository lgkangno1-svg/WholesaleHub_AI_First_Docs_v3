import { readFile } from "node:fs/promises"
import { z } from "zod"

const ReviewRowSchema = z.object({
  product_id: z.number().int().nullable(),
  variation_id: z.number().int().nullable(),
  woocommerce_product_name: z.string().nullable(),
  woocommerce_option_name: z.string().nullable(),
  selected_supplier_id: z.string().nullable(),
  selected_supplier_original_product_name: z.string().nullable(),
  selected_supplier_original_option_name: z.string().nullable(),
  safety_status: z.enum(["safe", "review_needed", "blocked"]),
})
const ReviewSchema = z.object({ rows: z.array(ReviewRowSchema) })
const SellPlanRowSchema = z.object({
  compare_key: z.string(),
  normalized_name: z.string(),
  option_key: z.string(),
  selected_supplier_id: z.string(),
  selected_supplier_original_product_name: z.string(),
  selected_supplier_original_option_name: z.string().nullable(),
  supplier_count_for_same_compare_key: z.number().int(),
  compared_with_other_supplier: z.boolean(),
  alternative_suppliers_summary: z.string(),
})
const SellPlanSchema = z.object({ candidates: z.array(SellPlanRowSchema) })
const MatchCandidateSchema = z.object({
  compare_key: z.string(),
  woocommerce_product_id: z.number().int().nullable(),
  woocommerce_variation_id: z.number().int().nullable(),
  confidence: z.string(),
  selected_supplier_id: z.string(),
})
const MatchSchema = z.object({ candidates: z.array(MatchCandidateSchema) })
const LiveLogSchema = z.object({
  entries: z.array(
    z.object({ product_id: z.number().int(), variation_id: z.number().int(), status: z.string() }),
  ),
})

export const AuditClassSchema = z.enum(["strict_compared", "single_supplier", "suspicious"])

export type ReviewRow = z.infer<typeof ReviewRowSchema>
export type SellPlanRow = z.infer<typeof SellPlanRowSchema>
export type MatchCandidate = z.infer<typeof MatchCandidateSchema>
export type AuditClass = z.infer<typeof AuditClassSchema>

export async function readUpdateAuditInputs(
  reviewPath: string,
  sellPlanPath: string,
  matchPath: string,
  liveLogPath: string,
): Promise<{
  readonly reviewRows: readonly ReviewRow[]
  readonly sellRows: readonly SellPlanRow[]
  readonly matchRows: readonly MatchCandidate[]
  readonly updatedKeys: ReadonlySet<string>
}> {
  const review = ReviewSchema.parse(JSON.parse(await readFile(reviewPath, "utf8"))).rows
  const sellRows = SellPlanSchema.parse(JSON.parse(await readFile(sellPlanPath, "utf8"))).candidates
  const matchRows = MatchSchema.parse(JSON.parse(await readFile(matchPath, "utf8"))).candidates
  const liveLog = LiveLogSchema.parse(JSON.parse(await readFile(liveLogPath, "utf8")))
  return {
    reviewRows: review,
    sellRows,
    matchRows,
    updatedKeys: new Set(
      liveLog.entries.map((entry) => keyOf(entry.product_id, entry.variation_id)),
    ),
  }
}

function keyOf(productId: number, variationId: number): string {
  return `${productId}:${variationId}`
}
