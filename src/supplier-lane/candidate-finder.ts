/**
 * Pure candidate-finding logic: no live Woo API calls.
 * Takes already-fetched Woo products (or a static list) and scores them
 * against the source product name to return the top 3 matches.
 *
 * Scoring algorithm:
 *   1. Normalize both names via product-name-cleaner.
 *   2. Tokenize into Korean/Latin words.
 *   3. Count matching tokens (intersection / union = Jaccard-like score).
 *   4. Boost if sku contains the source product id.
 *
 * This is intentionally simple (no Gemini call) to stay responsive.
 */

import { cleanProductText } from "../normalization/product-name-cleaner.js"
import type { ApprovalCandidate } from "./approval-request.js"

export type WooCandidateProduct = {
  readonly woo_parent_id: number
  readonly name: string
  readonly sku?: string | null
}

export type RankedCandidate = Omit<ApprovalCandidate, "id" | "approval_request_id" | "created_at">

/**
 * Score and rank up to 3 Woo products for a given source product name.
 * Pure function — no DB, no network.
 */
export function findTopCandidates(
  sourceProductName: string,
  wooProducts: readonly WooCandidateProduct[],
  sourceProductId?: string,
): readonly RankedCandidate[] {
  const cleanedSource = cleanProductText(sourceProductName, null).productName
  const sourceTokens = tokenize(cleanedSource)

  const scored = wooProducts.map((p) => {
    const cleanedWoo = cleanProductText(p.name, null).productName
    const wooTokens = tokenize(cleanedWoo)
    let score = jaccardScore(sourceTokens, wooTokens)
    // Small boost if sku includes source product id fragment
    if (
      sourceProductId &&
      p.sku &&
      p.sku.toLowerCase().includes(sourceProductId.toLowerCase().slice(0, 6))
    ) {
      score += 0.1
    }
    return { product: p, score, wooName: p.name }
  })

  const top3 = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  return top3.map((s, index) => ({
    rank: (index + 1) as 1 | 2 | 3,
    woo_parent_id: s.product.woo_parent_id,
    woo_product_name: s.wooName,
    recommendation_reason: buildReason(s.score, sourceTokens, tokenize(cleanProductText(s.wooName, null).productName)),
    score: s.score,
  }))
}

function tokenize(text: string): readonly string[] {
  return (
    text
      .replace(/[^\uAC00-\uD7A3\u1100-\u11FFa-zA-Z0-9]/gu, " ")
      .split(/\s+/u)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0)
  )
}

function jaccardScore(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  const intersection = [...setA].filter((t) => setB.has(t)).length
  const union = new Set([...setA, ...setB]).size
  return union === 0 ? 0 : intersection / union
}

function buildReason(
  score: number,
  sourceTokens: readonly string[],
  wooTokens: readonly string[],
): string {
  const setA = new Set(sourceTokens)
  const shared = [...new Set(wooTokens)].filter((t) => setA.has(t))
  const pct = Math.round(score * 100)
  if (shared.length === 0) return `유사도 ${pct}%`
  return `공통 키워드: ${shared.slice(0, 5).join(", ")} (유사도 ${pct}%)`
}
