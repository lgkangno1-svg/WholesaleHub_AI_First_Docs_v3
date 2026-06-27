import { readFile } from "node:fs/promises"
import { z } from "zod"

const PayloadSchema = z.object({
  product_id: z.number().int().optional(),
  variation_id: z.number().int().optional(),
  regular_price: z.string(),
})
const DryRunSchema = z.object({ updatePayloads: z.array(PayloadSchema) })
const MatchCandidateSchema = z.object({
  compare_key: z.string(),
  selected_supplier_id: z.string(),
  selected_supplier_original_product_name: z.string(),
  selected_supplier_original_option_name: z.string().nullable(),
  woocommerce_product_id: z.number().int().nullable(),
  woocommerce_variation_id: z.number().int().nullable(),
  woocommerce_product_name: z.string().nullable(),
  woocommerce_option_name: z.string().nullable(),
  woocommerce_current_price: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low", "none"]),
})
const MatchReportSchema = z.object({ candidates: z.array(MatchCandidateSchema) })
const SafetyStatusSchema = z.enum(["safe", "review_needed", "blocked"])

type Payload = z.infer<typeof PayloadSchema>
type MatchCandidate = z.infer<typeof MatchCandidateSchema>
type SafetyStatus = z.infer<typeof SafetyStatusSchema>

export type PriceChangeReviewRow = {
  readonly product_id: number | null
  readonly variation_id: number | null
  readonly woocommerce_product_name: string | null
  readonly woocommerce_option_name: string | null
  readonly woocommerce_current_price: number | null
  readonly new_price: number | null
  readonly price_diff: number | null
  readonly price_diff_rate: number | null
  readonly selected_supplier_id: string | null
  readonly selected_supplier_original_product_name: string | null
  readonly selected_supplier_original_option_name: string | null
  readonly confidence: string | null
  readonly safety_status: SafetyStatus
  readonly safety_reason: string
}

export type PriceChangeReviewReport = {
  readonly generatedAt: string
  readonly totalPayloads: number
  readonly safetyCounts: Record<SafetyStatus, number>
  readonly rows: readonly PriceChangeReviewRow[]
}

export async function readPriceChangeInputs(
  dryRunPath: string,
  matchPath: string,
): Promise<{ readonly payloads: readonly Payload[]; readonly matches: readonly MatchCandidate[] }> {
  return {
    payloads: DryRunSchema.parse(JSON.parse(await readFile(dryRunPath, "utf8"))).updatePayloads,
    matches: MatchReportSchema.parse(JSON.parse(await readFile(matchPath, "utf8"))).candidates,
  }
}

export function buildPriceChangeReviewReport(
  payloads: readonly Payload[],
  matches: readonly MatchCandidate[],
): PriceChangeReviewReport {
  const rows = payloads.map((payload) => reviewPayload(payload, matches))
  return {
    generatedAt: new Date().toISOString(),
    totalPayloads: rows.length,
    safetyCounts: countSafety(rows),
    rows,
  }
}

function reviewPayload(payload: Payload, matches: readonly MatchCandidate[]): PriceChangeReviewRow {
  const match = findMatch(payload, matches)
  const currentPrice = parsePrice(match?.woocommerce_current_price ?? null)
  const newPrice = parsePrice(payload.regular_price)
  const diff = currentPrice === null || newPrice === null ? null : newPrice - currentPrice
  const diffRate =
    diff === null || currentPrice === null || currentPrice <= 0 ? null : diff / currentPrice
  const safety = classifySafety(payload, match, newPrice, diffRate)
  return {
    product_id: payload.product_id ?? null,
    variation_id: payload.variation_id ?? null,
    woocommerce_product_name: match?.woocommerce_product_name ?? null,
    woocommerce_option_name: match?.woocommerce_option_name ?? null,
    woocommerce_current_price: currentPrice,
    new_price: newPrice,
    price_diff: diff,
    price_diff_rate: diffRate,
    selected_supplier_id: match?.selected_supplier_id ?? null,
    selected_supplier_original_product_name: match?.selected_supplier_original_product_name ?? null,
    selected_supplier_original_option_name: match?.selected_supplier_original_option_name ?? null,
    confidence: match?.confidence ?? null,
    safety_status: safety.status,
    safety_reason: safety.reason,
  }
}

function findMatch(payload: Payload, matches: readonly MatchCandidate[]): MatchCandidate | null {
  return (
    matches.find(
      (match) =>
        match.woocommerce_product_id === (payload.product_id ?? null) &&
        match.woocommerce_variation_id === (payload.variation_id ?? null) &&
        String(match.selected_supplier_id).length > 0,
    ) ?? null
  )
}

function classifySafety(
  payload: Payload,
  match: MatchCandidate | null,
  newPrice: number | null,
  diffRate: number | null,
): { readonly status: SafetyStatus; readonly reason: string } {
  if ((payload.product_id ?? null) === null || (payload.variation_id ?? null) === null) {
    return { status: "blocked", reason: "missing product_id or variation_id" }
  }
  if (newPrice === null || newPrice <= 0) {
    return { status: "blocked", reason: "new price is empty or zero" }
  }
  if (newPrice < 1000) {
    return { status: "blocked", reason: "new price is below 1000" }
  }
  if (match === null || match.confidence !== "high") {
    return { status: "blocked", reason: "payload is not backed by approved high-confidence match" }
  }
  if (
    (match.woocommerce_product_name ?? "").length === 0 ||
    (match.woocommerce_option_name ?? "").length === 0
  ) {
    return { status: "blocked", reason: "WooCommerce product or option name is empty" }
  }
  if (diffRate !== null && diffRate <= -0.7) {
    return { status: "blocked", reason: "price drops by 70% or more" }
  }
  if (diffRate !== null && diffRate >= 2) {
    return { status: "blocked", reason: "price rises by 200% or more" }
  }
  if (diffRate !== null && diffRate <= -0.3) {
    return { status: "review_needed", reason: "price drops by 30% or more" }
  }
  if (diffRate !== null && diffRate >= 0.8) {
    return { status: "review_needed", reason: "price rises by 80% or more" }
  }
  if (!optionLooksClear(match)) {
    return { status: "review_needed", reason: "option match is ambiguous" }
  }
  return { status: "safe", reason: "approved high-confidence match within price-change guardrails" }
}

function optionLooksClear(match: MatchCandidate): boolean {
  const supplierOption =
    match.selected_supplier_original_option_name ?? match.selected_supplier_original_product_name
  const wooOption = match.woocommerce_option_name ?? ""
  const token =
    optionToken(supplierOption) || optionToken(match.selected_supplier_original_product_name)
  return token.length > 0 && clean(wooOption).includes(clean(token))
}

function optionToken(value: string): string {
  return /\d+(?:\.\d+)?\s*(?:kg|g|개|입|과|망|팩|봉)/iu.exec(value)?.[0] ?? ""
}

function clean(value: string): string {
  return value.replace(/[^가-힣a-zA-Z0-9.]/gu, "").toLowerCase()
}

function parsePrice(value: string | null): number | null {
  if (value === null || value.trim().length === 0) {
    return null
  }
  const price = Number(value.replace(/[^\d.]/gu, ""))
  return Number.isFinite(price) && price > 0 ? price : null
}

function countSafety(rows: readonly PriceChangeReviewRow[]): Record<SafetyStatus, number> {
  return {
    safe: rows.filter((row) => row.safety_status === "safe").length,
    review_needed: rows.filter((row) => row.safety_status === "review_needed").length,
    blocked: rows.filter((row) => row.safety_status === "blocked").length,
  }
}
