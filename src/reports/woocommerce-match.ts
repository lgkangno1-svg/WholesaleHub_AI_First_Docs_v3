import { readFile } from "node:fs/promises"
import { z } from "zod"
import { removeMarketingText } from "../normalization/product-name-cleaner.js"
import type { WooCatalogItem } from "../woocommerce/catalog.js"

const ConfidenceSchema = z.enum(["high", "medium", "low", "none"])
const ActionSchema = z.enum([
  "approve_candidate_review",
  "needs_manual_mapping",
  "new_product_candidate",
  "reject",
])
const SellCandidateSchema = z.object({
  compare_key: z.string(),
  normalized_name: z.string(),
  option_key: z.string(),
  selected_supplier_id: z.string(),
  selected_supplier_original_product_name: z.string(),
  selected_supplier_original_option_name: z.string().nullable(),
  selected_price: z.number(),
  supplier_count_for_same_compare_key: z.number().int(),
})
const SellPlanSchema = z.object({ candidates: z.array(SellCandidateSchema) })

type Confidence = z.infer<typeof ConfidenceSchema>
type Action = z.infer<typeof ActionSchema>
type SellCandidate = z.infer<typeof SellCandidateSchema>

export type WooMatchCandidate = {
  readonly compare_key: string
  readonly normalized_name: string
  readonly option_key: string
  readonly selected_supplier_id: string
  readonly selected_supplier_original_product_name: string
  readonly selected_supplier_original_option_name: string | null
  readonly selected_price: number
  readonly supplier_count_for_same_compare_key: number
  readonly woocommerce_product_id: number | null
  readonly woocommerce_variation_id: number | null
  readonly woocommerce_product_name: string | null
  readonly woocommerce_option_name: string | null
  readonly woocommerce_current_price: string | null
  readonly woocommerce_product_type: string | null
  readonly confidence: Confidence
  readonly reason: string
  readonly recommended_action: Action
}

export type WooMatchReport = {
  readonly generatedAt: string
  readonly catalogProductCount: number
  readonly catalogVariationCount: number
  readonly totalSellCandidates: number
  readonly confidenceCounts: Record<Confidence, number>
  readonly actionCounts: Record<Action, number>
  readonly candidates: readonly WooMatchCandidate[]
}

export async function readSellPlan(path: string): Promise<readonly SellCandidate[]> {
  const raw = JSON.parse(await readFile(path, "utf8"))
  return SellPlanSchema.parse(raw).candidates
}

export function buildWooMatchReport(
  sellCandidates: readonly SellCandidate[],
  catalog: readonly WooCatalogItem[],
): WooMatchReport {
  const candidates = sellCandidates.map((candidate) => matchCandidate(candidate, catalog))
  return {
    generatedAt: new Date().toISOString(),
    catalogProductCount: new Set(catalog.map((item) => item.productId)).size,
    catalogVariationCount: catalog.filter((item) => item.variationId !== null).length,
    totalSellCandidates: candidates.length,
    confidenceCounts: countConfidence(candidates),
    actionCounts: countActions(candidates),
    candidates,
  }
}

function matchCandidate(
  candidate: SellCandidate,
  catalog: readonly WooCatalogItem[],
): WooMatchCandidate {
  const best = catalog.map((item) => scoreItem(candidate, item)).sort(compareScores)[0]
  if (best === undefined || best.confidence === "none") {
    return toReportRow(
      candidate,
      null,
      "none",
      "no similar WooCommerce product",
      "new_product_candidate",
    )
  }
  return toReportRow(
    candidate,
    best.item,
    best.confidence,
    best.reason,
    best.confidence === "high" ? "approve_candidate_review" : "needs_manual_mapping",
  )
}

function scoreItem(
  candidate: SellCandidate,
  item: WooCatalogItem,
): {
  readonly item: WooCatalogItem
  readonly confidence: Confidence
  readonly reason: string
  readonly rank: number
} {
  const productHit = textContains(item.productName, candidate.normalized_name)
  const optionHit =
    candidate.selected_supplier_original_option_name === null
      ? false
      : textContains(item.optionName ?? "", candidate.selected_supplier_original_option_name)
  const weightHit =
    optionWeight(candidate.option_key).length > 0 &&
    optionWeight(candidate.option_key) ===
      optionWeight(`${item.productName} ${item.optionName ?? ""}`)
  const walldoMeta =
    candidate.selected_supplier_id === "walldob2b" && item.meta["_b2b_source"] === "walldob2b"
  if ((productHit && (optionHit || weightHit)) || (walldoMeta && productHit)) {
    return { item, confidence: "high", reason: "product and option/source hint match", rank: 3 }
  }
  if (productHit) {
    return { item, confidence: "medium", reason: "product name match only", rank: 2 }
  }
  if (sharedToken(candidate.normalized_name, item.productName)) {
    return { item, confidence: "low", reason: "weak product token overlap", rank: 1 }
  }
  return { item, confidence: "none", reason: "no match", rank: 0 }
}

function toReportRow(
  candidate: SellCandidate,
  item: WooCatalogItem | null,
  confidence: Confidence,
  reason: string,
  action: Action,
): WooMatchCandidate {
  return {
    compare_key: candidate.compare_key,
    normalized_name: candidate.normalized_name,
    option_key: candidate.option_key,
    selected_supplier_id: candidate.selected_supplier_id,
    selected_supplier_original_product_name: candidate.selected_supplier_original_product_name,
    selected_supplier_original_option_name: candidate.selected_supplier_original_option_name,
    selected_price: candidate.selected_price,
    supplier_count_for_same_compare_key: candidate.supplier_count_for_same_compare_key,
    woocommerce_product_id: item?.productId ?? null,
    woocommerce_variation_id: item?.variationId ?? null,
    woocommerce_product_name: item?.productName ?? null,
    woocommerce_option_name: item?.optionName ?? null,
    woocommerce_current_price: item?.price ?? null,
    woocommerce_product_type: item?.type ?? null,
    confidence,
    reason,
    recommended_action: action,
  }
}

function compareScores(
  left: ReturnType<typeof scoreItem>,
  right: ReturnType<typeof scoreItem>,
): number {
  return right.rank - left.rank
}

function textContains(left: string, right: string): boolean {
  const a = clean(left)
  const b = clean(right)
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a))
}

function sharedToken(left: string, right: string): boolean {
  const rightClean = clean(right)
  return clean(left)
    .split(/\s+/u)
    .filter((token) => token.length >= 2)
    .some((token) => rightClean.includes(token))
}

function clean(value: string): string {
  return removeMarketingText(value)
    .value.replace(/[^가-힣a-zA-Z0-9]/gu, "")
    .toLowerCase()
}

function optionWeight(value: string): string {
  return /\d+(?:\.\d+)?kg/iu.exec(value)?.[0]?.toLowerCase() ?? ""
}

function countConfidence(candidates: readonly WooMatchCandidate[]): Record<Confidence, number> {
  return {
    high: candidates.filter((row) => row.confidence === "high").length,
    medium: candidates.filter((row) => row.confidence === "medium").length,
    low: candidates.filter((row) => row.confidence === "low").length,
    none: candidates.filter((row) => row.confidence === "none").length,
  }
}

function countActions(candidates: readonly WooMatchCandidate[]): Record<Action, number> {
  return {
    approve_candidate_review: candidates.filter(
      (row) => row.recommended_action === "approve_candidate_review",
    ).length,
    needs_manual_mapping: candidates.filter(
      (row) => row.recommended_action === "needs_manual_mapping",
    ).length,
    new_product_candidate: candidates.filter(
      (row) => row.recommended_action === "new_product_candidate",
    ).length,
    reject: candidates.filter((row) => row.recommended_action === "reject").length,
  }
}
