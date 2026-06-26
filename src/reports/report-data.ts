import type { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import type { WooCommerceDryRunPayload } from "../domain/product.js"
import { inspectWooCommercePayloadSafety } from "./payload-safety.js"

const CountRowSchema = z.object({ count: z.number().int() })
const SupplierCountRowSchema = z.object({
  supplier_id: z.string(),
  supplier_name: z.string().nullable(),
  count: z.number().int(),
})
const RawSampleRowSchema = z.object({
  id: z.number().int(),
  supplier_id: z.string(),
  supplier_name: z.string().nullable(),
  original_product_name: z.string(),
  original_option_name: z.string().nullable(),
  price: z.number().nullable(),
  stock_status: z.string().nullable(),
  collected_at: z.string().nullable(),
})
const MappingStatusRowSchema = z.object({ status: z.string(), count: z.number().int() })
const MappingSampleRowSchema = z.object({
  id: z.number().int(),
  original_product_name: z.string(),
  original_option_name: z.string().nullable(),
  normalized_name: z.string(),
  option_key: z.string(),
  confidence: z.number().nullable(),
  status: z.string(),
  parser_model: z.string().nullable(),
  created_at: z.string().nullable(),
})
const CompareRowSchema = z.object({
  id: z.number().int(),
  compare_key: z.string(),
  normalized_name: z.string(),
  option_key: z.string(),
  cheapest_supplier_id: z.string(),
  supplier_name: z.string().nullable(),
  cheapest_raw_product_id: z.number().int(),
  cheapest_price: z.number().int(),
  cheapest_unit_price: z.number().nullable(),
  stock_status: z.string().nullable(),
  product_url: z.string().nullable(),
  calculated_at: z.string().nullable(),
})
const WooCommerceDryRunRowSchema = CompareRowSchema.extend({
  woocommerce_product_id: z.number().int().nullable(),
  woocommerce_variation_id: z.number().int().nullable(),
  mapping_status: z.enum(["pending", "approved", "disabled"]).nullable(),
})

type WooCommerceDryRunRow = z.infer<typeof WooCommerceDryRunRowSchema>

type SkippedWooCommerceProduct = {
  readonly compare_key: string
  readonly normalized_name: string
  readonly option_key: string
  readonly reason: "pending" | "disabled" | "missing_mapping"
}

export function buildRawProductsReport(database: DatabaseSync): unknown {
  return {
    generatedAt: new Date().toISOString(),
    totalRawProducts: countTable(database, "raw_products"),
    supplierCounts: z.array(SupplierCountRowSchema).parse(
      database
        .prepare(`
          SELECT r.supplier_id, s.supplier_name, COUNT(*) AS count
          FROM raw_products r
          LEFT JOIN suppliers s ON s.supplier_id = r.supplier_id
          GROUP BY r.supplier_id, s.supplier_name
          ORDER BY count DESC, r.supplier_id
        `)
        .all(),
    ),
    samples: z.array(RawSampleRowSchema).parse(
      database
        .prepare(`
          SELECT r.id, r.supplier_id, s.supplier_name, r.original_product_name,
            r.original_option_name, r.price, r.stock_status, r.collected_at
          FROM raw_products r
          LEFT JOIN suppliers s ON s.supplier_id = r.supplier_id
          ORDER BY r.id
          LIMIT 10
        `)
        .all(),
    ),
    skippedRowsByReason: null,
    note: "skippedRows 사유별 집계는 Phase 1 실행 결과에는 포함되지만 현재 SQLite에는 저장하지 않는다.",
  }
}

export function buildMappingReport(database: DatabaseSync): unknown {
  const byStatusRows = z.array(MappingStatusRowSchema).parse(
    database
      .prepare(`
        SELECT status, COUNT(*) AS count
        FROM product_mapping
        GROUP BY status
        ORDER BY status
      `)
      .all(),
  )
  return {
    generatedAt: new Date().toISOString(),
    totalMappings: countTable(database, "product_mapping"),
    byStatus: {
      approved: byStatusRows.find((row) => row.status === "approved")?.count ?? 0,
      pending: byStatusRows.find((row) => row.status === "pending")?.count ?? 0,
      failed: byStatusRows.find((row) => row.status === "failed")?.count ?? 0,
    },
    lowConfidenceMappings: z.array(MappingSampleRowSchema).parse(
      database
        .prepare(`
          SELECT id, original_product_name, original_option_name, normalized_name,
            option_key, confidence, status, parser_model, created_at
          FROM product_mapping
          WHERE confidence < 0.8 OR status != 'approved'
          ORDER BY confidence ASC, id DESC
          LIMIT 20
        `)
        .all(),
    ),
    recentSamples: z.array(MappingSampleRowSchema).parse(
      database
        .prepare(`
          SELECT id, original_product_name, original_option_name, normalized_name,
            option_key, confidence, status, parser_model, created_at
          FROM product_mapping
          ORDER BY id DESC
          LIMIT 10
        `)
        .all(),
    ),
  }
}

export function buildCompareReport(database: DatabaseSync): unknown {
  return {
    generatedAt: new Date().toISOString(),
    totalCompareProducts: countTable(database, "compare_products"),
    results: readCompareRows(database),
  }
}

export function buildWooCommerceDryRunReport(
  database: DatabaseSync,
  marginAmount: number,
): unknown {
  const rows = readWooCommerceDryRunRows(database)
  const approvedRows = rows.filter(
    (row) => row.mapping_status === "approved" && row.woocommerce_product_id !== null,
  )
  const updatePayloads = approvedRows.map((row) => buildApprovedUpdatePayload(row, marginAmount))
  const skipped = rows
    .filter((row) => row.mapping_status !== "approved" || row.woocommerce_product_id === null)
    .map(toSkippedWooCommerceProduct)
  const safety = inspectWooCommercePayloadSafety(updatePayloads)
  return {
    generatedAt: new Date().toISOString(),
    matchedProducts: updatePayloads.length,
    pendingProducts: skipped.filter((item) => item.reason === "pending").length,
    disabledProducts: skipped.filter((item) => item.reason === "disabled").length,
    missingMappingProducts: skipped.filter((item) => item.reason === "missing_mapping").length,
    skippedProducts: skipped.length,
    skipped,
    payloadSafety: safety,
    updatePayloads,
  }
}

function readCompareRows(database: DatabaseSync): readonly z.infer<typeof CompareRowSchema>[] {
  return z.array(CompareRowSchema).parse(
    database
      .prepare(`
        SELECT c.id, c.compare_key, c.normalized_name, c.option_key,
          c.cheapest_supplier_id, s.supplier_name, c.cheapest_raw_product_id,
          c.cheapest_price, c.cheapest_unit_price, c.stock_status,
          c.product_url, c.calculated_at
        FROM compare_products c
        LEFT JOIN suppliers s ON s.supplier_id = c.cheapest_supplier_id
        ORDER BY c.normalized_name, c.option_key
      `)
      .all(),
  )
}

function countTable(database: DatabaseSync, tableName: string): number {
  return CountRowSchema.parse(database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get())
    .count
}

function readWooCommerceDryRunRows(database: DatabaseSync): readonly WooCommerceDryRunRow[] {
  return z.array(WooCommerceDryRunRowSchema).parse(
    database
      .prepare(`
        SELECT c.id, c.compare_key, c.normalized_name, c.option_key,
          c.cheapest_supplier_id, s.supplier_name, c.cheapest_raw_product_id,
          c.cheapest_price, c.cheapest_unit_price, c.stock_status,
          c.product_url, c.calculated_at, m.woocommerce_product_id,
          m.woocommerce_variation_id, m.status AS mapping_status
        FROM compare_products c
        LEFT JOIN suppliers s ON s.supplier_id = c.cheapest_supplier_id
        LEFT JOIN woocommerce_product_mapping m ON m.compare_key = c.compare_key
        ORDER BY c.normalized_name, c.option_key
      `)
      .all(),
  )
}

function buildApprovedUpdatePayload(
  row: WooCommerceDryRunRow,
  marginAmount: number,
): WooCommerceDryRunPayload {
  if (row.woocommerce_product_id === null) {
    throw new Error(`approved WooCommerce mapping has no product id: ${row.compare_key}`)
  }
  const payload = {
    product_id: row.woocommerce_product_id,
    regular_price: String(row.cheapest_price + marginAmount),
    stock_status: row.stock_status === "out_of_stock" ? "outofstock" : "instock",
    manage_stock: false,
  } satisfies WooCommerceDryRunPayload
  return row.woocommerce_variation_id === null
    ? payload
    : { ...payload, variation_id: row.woocommerce_variation_id }
}

function toSkippedWooCommerceProduct(row: WooCommerceDryRunRow): SkippedWooCommerceProduct {
  return {
    compare_key: row.compare_key,
    normalized_name: row.normalized_name,
    option_key: row.option_key,
    reason: toSkippedReason(row),
  }
}

function toSkippedReason(row: WooCommerceDryRunRow): SkippedWooCommerceProduct["reason"] {
  switch (row.mapping_status) {
    case "pending":
      return "pending"
    case "disabled":
      return "disabled"
    case "approved":
      return "pending"
    case null:
      return "missing_mapping"
  }
}
