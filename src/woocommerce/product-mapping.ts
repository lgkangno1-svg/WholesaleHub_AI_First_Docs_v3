import type { DatabaseSync } from "node:sqlite"
import { z } from "zod"

const MappingStatusSchema = z.enum(["pending", "approved", "disabled"])

const MappingRowSchema = z.object({
  id: z.number().int(),
  compare_key: z.string(),
  normalized_name: z.string(),
  option_key: z.string(),
  woocommerce_product_id: z.number().int().nullable(),
  woocommerce_variation_id: z.number().int().nullable(),
  status: MappingStatusSchema,
  admin_note: z.string().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
})

const CountRowSchema = z.object({ count: z.number().int() })

export type WooCommerceProductMapping = z.infer<typeof MappingRowSchema>

export type SeedPendingResult = {
  readonly inserted: number
  readonly existing: number
}

export type MappingStatusCounts = {
  readonly pending: number
  readonly approved: number
  readonly disabled: number
}

export function seedPendingWooCommerceMappings(database: DatabaseSync): SeedPendingResult {
  const before = countMappings(database)
  database.exec(`
    INSERT INTO woocommerce_product_mapping (compare_key, normalized_name, option_key, status)
    SELECT c.compare_key, c.normalized_name, c.option_key, 'pending'
    FROM compare_products c
    LEFT JOIN woocommerce_product_mapping m ON m.compare_key = c.compare_key
    WHERE m.compare_key IS NULL
  `)
  const after = countMappings(database)
  return { inserted: after - before, existing: before }
}

export function approveWooCommerceMapping(
  database: DatabaseSync,
  compareKey: string,
  productId: number,
  variationId: number | null,
): WooCommerceProductMapping {
  const existing = findMapping(database, compareKey)
  if (existing === null) {
    insertMappingFromCompare(database, compareKey)
  }
  database
    .prepare(`
      UPDATE woocommerce_product_mapping
      SET status = 'approved',
        woocommerce_product_id = ?,
        woocommerce_variation_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE compare_key = ?
    `)
    .run(productId, variationId, compareKey)
  return requireMapping(database, compareKey)
}

export function disableWooCommerceMapping(
  database: DatabaseSync,
  compareKey: string,
): WooCommerceProductMapping {
  const existing = findMapping(database, compareKey)
  if (existing === null) {
    insertMappingFromCompare(database, compareKey)
  }
  database
    .prepare(`
      UPDATE woocommerce_product_mapping
      SET status = 'disabled', updated_at = CURRENT_TIMESTAMP
      WHERE compare_key = ?
    `)
    .run(compareKey)
  return requireMapping(database, compareKey)
}

export function listWooCommerceMappings(
  database: DatabaseSync,
): readonly WooCommerceProductMapping[] {
  return z.array(MappingRowSchema).parse(
    database
      .prepare(`
        SELECT id, compare_key, normalized_name, option_key,
          woocommerce_product_id, woocommerce_variation_id, status,
          admin_note, created_at, updated_at
        FROM woocommerce_product_mapping
        ORDER BY status, normalized_name, option_key
      `)
      .all(),
  )
}

export function countWooCommerceMappingsByStatus(database: DatabaseSync): MappingStatusCounts {
  const rows = z.array(z.object({ status: MappingStatusSchema, count: z.number().int() })).parse(
    database
      .prepare(`
          SELECT status, COUNT(*) AS count
          FROM woocommerce_product_mapping
          GROUP BY status
        `)
      .all(),
  )
  return {
    pending: rows.find((row) => row.status === "pending")?.count ?? 0,
    approved: rows.find((row) => row.status === "approved")?.count ?? 0,
    disabled: rows.find((row) => row.status === "disabled")?.count ?? 0,
  }
}

function insertMappingFromCompare(database: DatabaseSync, compareKey: string): void {
  const result = database
    .prepare(`
      INSERT INTO woocommerce_product_mapping (compare_key, normalized_name, option_key, status)
      SELECT compare_key, normalized_name, option_key, 'pending'
      FROM compare_products
      WHERE compare_key = ?
    `)
    .run(compareKey)
  if (result.changes === 0) {
    throw new Error(`compare_key not found: ${compareKey}`)
  }
}

function findMapping(database: DatabaseSync, compareKey: string): WooCommerceProductMapping | null {
  const row = database
    .prepare(`
      SELECT id, compare_key, normalized_name, option_key,
        woocommerce_product_id, woocommerce_variation_id, status,
        admin_note, created_at, updated_at
      FROM woocommerce_product_mapping
      WHERE compare_key = ?
    `)
    .get(compareKey)
  return row === undefined ? null : MappingRowSchema.parse(row)
}

function requireMapping(database: DatabaseSync, compareKey: string): WooCommerceProductMapping {
  const mapping = findMapping(database, compareKey)
  if (mapping === null) {
    throw new Error(`woocommerce mapping not found after update: ${compareKey}`)
  }
  return mapping
}

function countMappings(database: DatabaseSync): number {
  return CountRowSchema.parse(
    database.prepare("SELECT COUNT(*) AS count FROM woocommerce_product_mapping").get(),
  ).count
}
