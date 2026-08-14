import type { DatabaseSync } from "node:sqlite"
import type { P2Supplier } from "../reports/supplier-snapshot-v2.js"
import { laneForSupplier, type SupplierLaneCode } from "./model.js"

export type ParentLinkStatus = "pending" | "approved" | "rejected" | "terminal"

export type ParentLink = {
  readonly id: number
  readonly woo_parent_id: number
  readonly supplier_id: P2Supplier
  readonly lane_code: SupplierLaneCode
  readonly source_product_id: string
  readonly status: ParentLinkStatus
  readonly approved_by: string | null
  readonly approved_at: string | null
  readonly created_at: string
  readonly updated_at: string
}

export type ApproveParentLinkOutcome =
  | { readonly kind: "approved"; readonly link: ParentLink }
  | { readonly kind: "already_approved"; readonly link: ParentLink }
  | { readonly kind: "conflict"; readonly link: ParentLink }

export function listParentLinks(
  database: DatabaseSync,
  status?: ParentLinkStatus,
): readonly ParentLink[] {
  const sql = `SELECT id, woo_parent_id, supplier_id, lane_code, source_product_id,
      status, approved_by, approved_at, created_at, updated_at
    FROM supplier_lane_parent_links
    ${status === undefined ? "" : "WHERE status = ?"}
    ORDER BY woo_parent_id, lane_code`
  return (
    status === undefined ? database.prepare(sql).all() : database.prepare(sql).all(status)
  ) as ParentLink[]
}

export function proposeParentLink(
  database: DatabaseSync,
  input: {
    readonly wooParentId: number
    readonly supplier: P2Supplier
    readonly sourceProductId: string
    readonly actor: string
    readonly now: string
  },
): ParentLink {
  database
    .prepare(
      `INSERT INTO supplier_lane_parent_links(
        woo_parent_id, supplier_id, lane_code, source_product_id, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?)
      ON CONFLICT(woo_parent_id, lane_code) DO UPDATE SET
        source_product_id = excluded.source_product_id,
        supplier_id = excluded.supplier_id,
        status = 'pending',
        approved_by = NULL,
        approved_at = NULL,
        updated_at = excluded.updated_at`,
    )
    .run(
      input.wooParentId,
      input.supplier,
      laneForSupplier(input.supplier),
      input.sourceProductId,
      input.now,
      input.now,
    )
  const link = requireParentLink(database, input.wooParentId, laneForSupplier(input.supplier))
  audit(database, "parent_link", link.id, "proposed", input.actor, input, input.now)
  return link
}

export function decideParentLink(
  database: DatabaseSync,
  id: number,
  decision: "approved" | "rejected",
  actor: string,
  now: string,
): ParentLink {
  const result = database
    .prepare(
      `UPDATE supplier_lane_parent_links SET
        status = ?, approved_by = ?, approved_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'`,
    )
    .run(decision, actor, decision === "approved" ? now : null, now, id)
  if (result.changes !== 1) throw new Error("parent_link_not_pending")
  audit(database, "parent_link", id, decision, actor, {}, now)
  return requireParentLinkById(database, id)
}

export function approveParentLink(
  database: DatabaseSync,
  input: {
    readonly wooParentId: number
    readonly supplier: P2Supplier
    readonly sourceProductId: string
    readonly actor: string
    readonly now: string
  },
): ApproveParentLinkOutcome {
  const lane = laneForSupplier(input.supplier)
  const existing = findParentLink(database, input.wooParentId, lane)
  if (existing?.status === "approved") {
    return existing.supplier_id === input.supplier &&
      existing.source_product_id === input.sourceProductId
      ? { kind: "already_approved", link: existing }
      : { kind: "conflict", link: existing }
  }

  database
    .prepare(
      `INSERT INTO supplier_lane_parent_links(
        woo_parent_id, supplier_id, lane_code, source_product_id, status,
        approved_by, approved_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'approved', ?, ?, ?, ?)
      ON CONFLICT(woo_parent_id, lane_code) DO UPDATE SET
        source_product_id = excluded.source_product_id,
        supplier_id = excluded.supplier_id,
        status = 'approved',
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        updated_at = excluded.updated_at
      WHERE supplier_lane_parent_links.status <> 'approved'`,
    )
    .run(
      input.wooParentId,
      input.supplier,
      lane,
      input.sourceProductId,
      input.actor,
      input.now,
      input.now,
      input.now,
    )
  const link = requireParentLink(database, input.wooParentId, lane)
  audit(database, "parent_link", link.id, "approved", input.actor, input, input.now)
  return { kind: "approved", link }
}

export function unlinkParentLink(
  database: DatabaseSync,
  id: number,
  actor: string,
  now: string,
): ParentLink {
  const result = database
    .prepare(
      `UPDATE supplier_lane_parent_links
       SET status = 'terminal', updated_at = ?
       WHERE id = ? AND status <> 'terminal'`,
    )
    .run(now, id)
  if (result.changes !== 1) throw new Error("parent_link_not_active")
  audit(database, "parent_link", id, "unlinked", actor, {}, now)
  return requireParentLinkById(database, id)
}

function requireParentLink(
  database: DatabaseSync,
  parentId: number,
  lane: SupplierLaneCode,
): ParentLink {
  const row = database
    .prepare(
      `SELECT id, woo_parent_id, supplier_id, lane_code, source_product_id,
        status, approved_by, approved_at, created_at, updated_at
       FROM supplier_lane_parent_links WHERE woo_parent_id = ? AND lane_code = ?`,
    )
    .get(parentId, lane)
  if (row === undefined) throw new Error("parent_link_not_found")
  return row as ParentLink
}

function findParentLink(
  database: DatabaseSync,
  parentId: number,
  lane: SupplierLaneCode,
): ParentLink | null {
  const row = database
    .prepare(
      `SELECT id, woo_parent_id, supplier_id, lane_code, source_product_id,
        status, approved_by, approved_at, created_at, updated_at
       FROM supplier_lane_parent_links WHERE woo_parent_id = ? AND lane_code = ?`,
    )
    .get(parentId, lane)
  return (row as ParentLink | undefined) ?? null
}

function requireParentLinkById(database: DatabaseSync, id: number): ParentLink {
  const row = database
    .prepare(
      `SELECT id, woo_parent_id, supplier_id, lane_code, source_product_id,
        status, approved_by, approved_at, created_at, updated_at
       FROM supplier_lane_parent_links WHERE id = ?`,
    )
    .get(id)
  if (row === undefined) throw new Error("parent_link_not_found")
  return row as ParentLink
}

function audit(
  database: DatabaseSync,
  entityType: "parent_link" | "offer",
  entityId: number,
  action: string,
  actor: string,
  detail: unknown,
  now: string,
): void {
  database
    .prepare(
      `INSERT INTO supplier_lane_audit_history(
        entity_type, entity_id, action, actor, detail_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(entityType, entityId, action, actor, JSON.stringify(detail), now)
}
