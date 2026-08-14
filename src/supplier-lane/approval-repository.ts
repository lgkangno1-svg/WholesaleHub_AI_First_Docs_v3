/**
 * SQLite repository for the Telegram approval request flow.
 *
 * All writes are idempotent — re-running the same callback never creates
 * duplicate links or Woo products.
 *
 * No production DB is touched here; callers pass a DatabaseSync instance.
 */

import type { DatabaseSync } from "node:sqlite"
import type { P2Supplier } from "../reports/supplier-snapshot-v2.js"
import type {
  ApprovalAuditEntry,
  ApprovalCandidate,
  ApprovalRequest,
  ApprovalStatus,
} from "./approval-request.js"
import { approveParentLink, type ParentLink } from "./repository.js"

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function findApprovalRequest(
  db: DatabaseSync,
  supplierId: P2Supplier,
  sourceProductId: string,
): ApprovalRequest | null {
  const row = db
    .prepare(
      `SELECT * FROM supplier_lane_approval_requests
       WHERE supplier_id = ? AND source_product_id = ?`,
    )
    .get(supplierId, sourceProductId)
  return (row as ApprovalRequest | undefined) ?? null
}

export function getApprovalRequestById(db: DatabaseSync, id: number): ApprovalRequest | null {
  const row = db.prepare(`SELECT * FROM supplier_lane_approval_requests WHERE id = ?`).get(id)
  return (row as ApprovalRequest | undefined) ?? null
}

export function listApprovalRequestsByStatus(
  db: DatabaseSync,
  status: ApprovalStatus,
): readonly ApprovalRequest[] {
  return db
    .prepare(
      `SELECT * FROM supplier_lane_approval_requests
       WHERE status = ? ORDER BY created_at`,
    )
    .all(status) as ApprovalRequest[]
}

export function getCandidatesForRequest(
  db: DatabaseSync,
  requestId: number,
): readonly ApprovalCandidate[] {
  return db
    .prepare(
      `SELECT * FROM supplier_lane_approval_candidates
       WHERE approval_request_id = ? ORDER BY rank`,
    )
    .all(requestId) as ApprovalCandidate[]
}

// ---------------------------------------------------------------------------
// Write (idempotent)
// ---------------------------------------------------------------------------

/**
 * Create or update an approval request for a source product.
 * If a terminal_excluded row already exists, it is never overwritten.
 */
export function upsertApprovalRequest(
  db: DatabaseSync,
  input: {
    readonly supplierId: P2Supplier
    readonly laneCode: "A" | "B"
    readonly sourceProductId: string
    readonly originalProductName: string
    readonly optionSummary: string
    readonly hardSpecFingerprint: string
    readonly status: ApprovalStatus
    readonly now: string
  },
): ApprovalRequest {
  // Atomic insert-or-ignore + conditional update
  db.prepare(
    `INSERT OR IGNORE INTO supplier_lane_approval_requests (
       supplier_id, lane_code, source_product_id,
       original_product_name, option_summary, hard_spec_fingerprint,
       status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.supplierId,
    input.laneCode,
    input.sourceProductId,
    input.originalProductName,
    input.optionSummary,
    input.hardSpecFingerprint,
    input.status,
    input.now,
    input.now,
  )

  db.prepare(
    `UPDATE supplier_lane_approval_requests SET
       original_product_name = ?,
       option_summary = ?,
       hard_spec_fingerprint = ?,
       status = CASE
         WHEN status = 'approved' AND hard_spec_fingerprint = ? THEN 'approved'
         WHEN status = 'approved' AND hard_spec_fingerprint <> ? THEN 'needs_reapproval'
         WHEN status = 'needs_reapproval' AND hard_spec_fingerprint = ? THEN 'needs_reapproval'
         ELSE ?
       END,
       updated_at = ?
     WHERE supplier_id = ? AND source_product_id = ?
       AND status NOT IN ('terminal_excluded')`,
  ).run(
    input.originalProductName,
    input.optionSummary,
    input.hardSpecFingerprint,
    input.hardSpecFingerprint,
    input.hardSpecFingerprint,
    input.hardSpecFingerprint,
    input.status,
    input.now,
    input.supplierId,
    input.sourceProductId,
  )

  const row = db
    .prepare(
      `SELECT * FROM supplier_lane_approval_requests
       WHERE supplier_id = ? AND source_product_id = ?`,
    )
    .get(input.supplierId, input.sourceProductId)
  return row as ApprovalRequest
}

/**
 * Replace the candidate list for a request.
 * Idempotent: re-inserting the same candidates is safe.
 */
export function setCandidates(
  db: DatabaseSync,
  requestId: number,
  candidates: readonly {
    readonly rank: 1 | 2 | 3
    readonly wooParentId: number
    readonly wooProductName: string
    readonly recommendationReason: string
    readonly score: number
  }[],
  now: string,
): void {
  db.prepare(`DELETE FROM supplier_lane_approval_candidates WHERE approval_request_id = ?`).run(
    requestId,
  )
  for (const c of candidates) {
    db.prepare(
      `INSERT INTO supplier_lane_approval_candidates (
         approval_request_id, rank, woo_parent_id, woo_product_name,
         recommendation_reason, score, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(requestId, c.rank, c.wooParentId, c.wooProductName, c.recommendationReason, c.score, now)
  }
}

/** Record that the Telegram message was sent. */
export function markAwaitingApproval(
  db: DatabaseSync,
  requestId: number,
  telegramMessageId: string,
  now: string,
): ApprovalRequest {
  db.prepare(
    `UPDATE supplier_lane_approval_requests SET
       status = 'awaiting_telegram_approval',
       telegram_message_id = ?,
       telegram_sent_at = ?,
       updated_at = ?
     WHERE id = ? AND status IN ('candidate_ready', 'unmapped', 'on_hold', 'needs_reapproval')`,
  ).run(telegramMessageId, now, now, requestId)
  return requireById(db, requestId)
}

export type CallbackOutcome =
  | { readonly kind: "applied"; readonly request: ApprovalRequest }
  | { readonly kind: "already_processed"; readonly request: ApprovalRequest }
  | {
      readonly kind: "conflict"
      readonly request: ApprovalRequest
      readonly existingLink: ParentLink
    }
  | { readonly kind: "not_found" }
  | { readonly kind: "expired_or_invalid" }

/**
 * Idempotent callback handler.
 * Same button press never creates a duplicate link or draft product.
 */
export function resolveCallback(
  db: DatabaseSync,
  input: {
    readonly requestId: number
    readonly action: "link" | "search" | "draft" | "hold" | "exclude"
    readonly candidateRank?: 1 | 2 | 3
    readonly actor: string
    readonly now: string
  },
): CallbackOutcome {
  const request = getApprovalRequestById(db, input.requestId)
  if (request === null) return { kind: "not_found" }

  // Already in a terminal or decided state — idempotent return
  if (
    request.status === "approved" ||
    request.status === "rejected" ||
    request.status === "terminal_excluded"
  ) {
    return { kind: "already_processed", request }
  }

  if (request.status !== "awaiting_telegram_approval") {
    return { kind: "expired_or_invalid" }
  }

  const prevStatus = request.status
  let newStatus: ApprovalStatus
  let approvedWooParentId: number | null = null

  switch (input.action) {
    case "link": {
      if (input.candidateRank === undefined) return { kind: "expired_or_invalid" }
      const candidates = getCandidatesForRequest(db, input.requestId)
      const candidate = candidates.find((c) => c.rank === input.candidateRank)
      if (candidate === undefined) return { kind: "expired_or_invalid" }
      const linkOutcome = approveParentLink(db, {
        wooParentId: candidate.woo_parent_id,
        supplier: request.supplier_id,
        sourceProductId: request.source_product_id,
        actor: input.actor,
        now: input.now,
      })
      if (linkOutcome.kind === "conflict") {
        writeApprovalAudit(db, {
          approval_request_id: input.requestId,
          action: "link_conflict",
          actor: input.actor,
          prev_status: request.status,
          new_status: request.status,
          selected_woo_parent_id: candidate.woo_parent_id,
          detail_json: JSON.stringify({
            candidateRank: input.candidateRank,
            existingSourceProductId: linkOutcome.link.source_product_id,
          }),
          created_at: input.now,
        })
        return { kind: "conflict", request, existingLink: linkOutcome.link }
      }
      newStatus = "approved"
      approvedWooParentId = candidate.woo_parent_id
      break
    }
    case "search":
      // Admin wants to search manually — put back to candidate_ready for next poll
      newStatus = "candidate_ready"
      break
    case "draft":
      // Admin wants a new draft Woo product — approved with no parent id
      // (draft creation is handled separately by Codex Core, we just record intent)
      newStatus = "approved"
      approvedWooParentId = null
      break
    case "hold":
      newStatus = "on_hold"
      break
    case "exclude":
      newStatus = "terminal_excluded"
      break
    default:
      return { kind: "expired_or_invalid" }
  }

  // Apply state change
  db.prepare(
    `UPDATE supplier_lane_approval_requests SET
       status = ?,
       approved_woo_parent_id = ?,
       approved_by = ?,
       approved_at = ?,
       updated_at = ?
     WHERE id = ?`,
  ).run(
    newStatus,
    approvedWooParentId,
    newStatus === "approved" ? input.actor : null,
    newStatus === "approved" ? input.now : null,
    input.now,
    input.requestId,
  )

  // Write audit entry
  writeApprovalAudit(db, {
    approval_request_id: input.requestId,
    action: input.action,
    actor: input.actor,
    prev_status: prevStatus,
    new_status: newStatus,
    selected_woo_parent_id: approvedWooParentId,
    detail_json: JSON.stringify({ candidateRank: input.candidateRank ?? null }),
    created_at: input.now,
  })

  return { kind: "applied", request: requireById(db, input.requestId) }
}

/** Transition a request to needs_reapproval when the spec fingerprint changes. */
export function markNeedsReapproval(
  db: DatabaseSync,
  requestId: number,
  newFingerprint: string,
  actor: string,
  now: string,
): ApprovalRequest {
  const prev = requireById(db, requestId)
  if (
    prev.hard_spec_fingerprint === newFingerprint ||
    (prev.status !== "approved" && prev.status !== "needs_reapproval")
  ) {
    return prev
  }
  db.prepare(
    `UPDATE supplier_lane_approval_requests SET
       status = 'needs_reapproval',
       hard_spec_fingerprint = ?,
       updated_at = ?
     WHERE id = ?`,
  ).run(newFingerprint, now, requestId)
  writeApprovalAudit(db, {
    approval_request_id: requestId,
    action: "needs_reapproval",
    actor,
    prev_status: prev.status,
    new_status: "needs_reapproval",
    selected_woo_parent_id: null,
    detail_json: JSON.stringify({ newFingerprint }),
    created_at: now,
  })
  return requireById(db, requestId)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function requireById(db: DatabaseSync, id: number): ApprovalRequest {
  const row = db.prepare(`SELECT * FROM supplier_lane_approval_requests WHERE id = ?`).get(id)
  if (row === undefined) throw new Error(`approval_request_not_found:${id}`)
  return row as ApprovalRequest
}

function writeApprovalAudit(db: DatabaseSync, entry: ApprovalAuditEntry): void {
  db.prepare(
    `INSERT INTO supplier_lane_approval_audit (
       approval_request_id, action, actor,
       prev_status, new_status, selected_woo_parent_id,
       detail_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.approval_request_id,
    entry.action,
    entry.actor,
    entry.prev_status,
    entry.new_status,
    entry.selected_woo_parent_id,
    entry.detail_json,
    entry.created_at,
  )
}
