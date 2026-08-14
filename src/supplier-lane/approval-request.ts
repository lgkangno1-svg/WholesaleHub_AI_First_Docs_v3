/**
 * Domain types and pure logic for the Supplier Lane Telegram approval flow.
 *
 * Rules:
 * - A=dailyfood, B=walldob2b. Never mix.
 * - terminal_excluded rows (incl. 천반도) are never re-queried.
 * - Price/stock-only changes do NOT create new approval requests.
 * - Core spec changes (item·weight·count·species·processing) → needs_reapproval.
 * - No Woo writes, no variation creation, no publish before approved status.
 */

import { createHash } from "node:crypto"
import type { P2Supplier } from "../reports/supplier-snapshot-v2.js"
import { cleanProductText } from "../normalization/product-name-cleaner.js"

/** All valid states in the approval state machine. */
export type ApprovalStatus =
  | "unmapped"
  | "candidate_ready"
  | "awaiting_telegram_approval"
  | "approved"
  | "rejected"
  | "on_hold"
  | "terminal_excluded"
  | "needs_reapproval"

/** Persisted approval request row. */
export type ApprovalRequest = {
  readonly id: number
  readonly supplier_id: P2Supplier
  readonly lane_code: "A" | "B"
  readonly source_product_id: string
  readonly original_product_name: string
  readonly option_summary: string
  readonly hard_spec_fingerprint: string
  readonly status: ApprovalStatus
  readonly approved_woo_parent_id: number | null
  readonly approved_by: string | null
  readonly approved_at: string | null
  readonly telegram_message_id: string | null
  readonly telegram_sent_at: string | null
  readonly created_at: string
  readonly updated_at: string
}

/** One ranked Woo parent candidate for a request. */
export type ApprovalCandidate = {
  readonly id: number
  readonly approval_request_id: number
  readonly rank: number
  readonly woo_parent_id: number
  readonly woo_product_name: string
  readonly recommendation_reason: string
  readonly score: number
  readonly created_at: string
}

/** Audit record for every callback or state transition. */
export type ApprovalAuditEntry = {
  readonly approval_request_id: number
  readonly action: string
  readonly actor: string
  readonly prev_status: ApprovalStatus | null
  readonly new_status: ApprovalStatus
  readonly selected_woo_parent_id: number | null
  readonly detail_json: string
  readonly created_at: string
}

/**
 * Typed union of all valid callback payloads.
 * callback_data format: `slta:{requestId}:{action}[:{candidateRank}]`
 */
export type ApprovalCallbackPayload =
  | { readonly kind: "link"; readonly requestId: number; readonly candidateRank: 1 | 2 | 3 }
  | { readonly kind: "search"; readonly requestId: number }
  | { readonly kind: "draft"; readonly requestId: number }
  | { readonly kind: "hold"; readonly requestId: number }
  | { readonly kind: "exclude"; readonly requestId: number }

/** Parse a raw Telegram callback_data string into a typed payload. */
export function parseCallbackData(data: string): ApprovalCallbackPayload | null {
  const parts = data.split(":")
  if (parts[0] !== "slta" || parts.length < 3) return null
  const requestId = Number(parts[1])
  if (!Number.isFinite(requestId) || requestId <= 0) return null
  const action = parts[2]
  if (action === "link") {
    const rank = Number(parts[3])
    if (rank !== 1 && rank !== 2 && rank !== 3) return null
    return { kind: "link", requestId, candidateRank: rank as 1 | 2 | 3 }
  }
  if (action === "search") return { kind: "search", requestId }
  if (action === "draft") return { kind: "draft", requestId }
  if (action === "hold") return { kind: "hold", requestId }
  if (action === "exclude") return { kind: "exclude", requestId }
  return null
}

/**
 * Build a deterministic fingerprint for core product specs:
 * item name (normalized), weight/count/unit tokens, species/processing markers.
 * Used to detect needs_reapproval when the spec changes but price/stock haven't.
 */
export function buildHardSpecFingerprint(
  productName: string,
  optionName: string | null,
): string {
  const cleaned = cleanProductText(productName, optionName)
  const combined = [cleaned.productName, cleaned.optionName ?? ""].join("|")
  const normalized = combined
    .replace(/\s+/gu, " ")
    .toLowerCase()
    .trim()
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32)
}

/**
 * Returns true if a fingerprint change represents a core spec change
 * that requires re-approval (not just price or stock).
 */
export function isSpecChanged(prev: string, next: string): boolean {
  return prev !== next
}

/** States from which no further action is taken (terminal). */
const TERMINAL_STATES: readonly ApprovalStatus[] = ["terminal_excluded"]

/** States that cannot be overwritten by a new incoming source product. */
const LOCKED_STATES: readonly ApprovalStatus[] = ["approved", "terminal_excluded"]

export function isTerminalExcluded(status: ApprovalStatus): boolean {
  return TERMINAL_STATES.includes(status)
}

export function isLockedState(status: ApprovalStatus): boolean {
  return LOCKED_STATES.includes(status)
}

/**
 * Determine whether a source product with a given fingerprint should
 * trigger a new approval request, given the existing request state.
 * Returns:
 *   'skip'            — do nothing (terminal_excluded or approved same spec)
 *   'needs_reapproval' — spec changed on an approved link
 *   'new'             — create/upsert request
 */
export function classifyIncomingProduct(
  existing: ApprovalRequest | null,
  incomingFingerprint: string,
): "skip" | "needs_reapproval" | "new" {
  if (existing === null) return "new"
  if (isTerminalExcluded(existing.status)) return "skip"
  if (existing.status === "approved") {
    if (isSpecChanged(existing.hard_spec_fingerprint, incomingFingerprint)) {
      return "needs_reapproval"
    }
    // price/stock change only — skip re-question
    return "skip"
  }
  return "new"
}

/** Produce the Telegram inline keyboard for an approval request. */
export function buildApprovalKeyboard(
  requestId: number,
  candidates: readonly ApprovalCandidate[],
): readonly { readonly text: string; readonly callback_data: string }[][] {
  const rows: { readonly text: string; readonly callback_data: string }[][] = []
  for (const c of candidates) {
    rows.push([
      {
        text: `${c.rank}. ${c.woo_product_name} (#${c.woo_parent_id})`,
        callback_data: `slta:${requestId}:link:${c.rank}`,
      },
    ])
  }
  rows.push([
    { text: "🔍 다른 상품 검색", callback_data: `slta:${requestId}:search` },
    { text: "📋 새 draft 생성", callback_data: `slta:${requestId}:draft` },
  ])
  rows.push([
    { text: "⏸ 보류", callback_data: `slta:${requestId}:hold` },
    { text: "🚫 판매 제외", callback_data: `slta:${requestId}:exclude` },
  ])
  return rows
}

/** Produce the Telegram message text for an approval request. */
export function buildApprovalMessageText(
  request: ApprovalRequest,
  candidates: readonly ApprovalCandidate[],
  supplierDisplayName: string,
): string {
  const header = [
    `🏭 *공급사*: ${supplierDisplayName} (Lane ${request.lane_code})`,
    `📦 *Source Product ID*: \`${request.source_product_id}\``,
    `📝 *원본 상품명*: ${request.original_product_name}`,
    `🔢 *옵션 요약*: ${request.option_summary || "(없음)"}`,
    `🔑 *Fingerprint*: \`${request.hard_spec_fingerprint}\``,
    ``,
    `*추천 Woo 상품 (최대 3개):*`,
  ].join("\n")

  const candidateLines = candidates.map(
    (c) =>
      `${c.rank}. *${c.woo_product_name}* (#${c.woo_parent_id})\n   └ ${c.recommendation_reason}`,
  )

  return [header, ...candidateLines, "", "연결할 상품을 선택하거나 다른 작업을 선택하세요."].join("\n")
}
