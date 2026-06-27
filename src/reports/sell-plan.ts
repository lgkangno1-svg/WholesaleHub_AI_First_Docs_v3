import type { DatabaseSync } from "node:sqlite"
import { z } from "zod"

const MappingStatusSchema = z.enum([
  "approved_mapping_exists",
  "pending_mapping_exists",
  "no_mapping",
])
const ActionSchema = z.enum([
  "update_existing_dry_run_only",
  "needs_manual_mapping",
  "new_product_candidate",
])

const SellPlanRowSchema = z.object({
  compare_key: z.string(),
  normalized_name: z.string(),
  option_key: z.string(),
  selected_supplier_id: z.string(),
  selected_supplier_original_product_name: z.string(),
  selected_supplier_original_option_name: z.string().nullable(),
  selected_price: z.number().int(),
  supplier_count_for_same_compare_key: z.number().int(),
  alternative_suppliers_summary: z.string(),
  raw_mapping_status: z.enum(["pending", "approved", "disabled"]).nullable(),
  woocommerce_product_id: z.number().int().nullable(),
  woocommerce_variation_id: z.number().int().nullable(),
})

type MappingStatus = z.infer<typeof MappingStatusSchema>
type RecommendedAction = z.infer<typeof ActionSchema>
type SellPlanRow = z.infer<typeof SellPlanRowSchema>

export type SellPlanCandidate = {
  readonly compare_key: string
  readonly normalized_name: string
  readonly option_key: string
  readonly selected_supplier_id: string
  readonly selected_supplier_original_product_name: string
  readonly selected_supplier_original_option_name: string | null
  readonly selected_price: number
  readonly supplier_count_for_same_compare_key: number
  readonly compared_with_other_supplier: boolean
  readonly alternative_suppliers_summary: string
  readonly woocommerce_mapping_status: MappingStatus
  readonly woocommerce_product_id: number | null
  readonly woocommerce_variation_id: number | null
  readonly recommended_action: RecommendedAction
  readonly note: string
}

export type SellPlanReport = {
  readonly generatedAt: string
  readonly totalCandidates: number
  readonly comparedCandidateCount: number
  readonly singleSupplierCandidateCount: number
  readonly selectedSupplierCounts: Record<string, number>
  readonly mappingStatusCounts: Record<MappingStatus, number>
  readonly candidates: readonly SellPlanCandidate[]
}

export function buildSellPlanReport(database: DatabaseSync): SellPlanReport {
  const candidates = readRows(database).map(toCandidate)
  return {
    generatedAt: new Date().toISOString(),
    totalCandidates: candidates.length,
    comparedCandidateCount: candidates.filter((row) => row.compared_with_other_supplier).length,
    singleSupplierCandidateCount: candidates.filter((row) => !row.compared_with_other_supplier)
      .length,
    selectedSupplierCounts: countBy(candidates.map((row) => row.selected_supplier_id)),
    mappingStatusCounts: countMappingStatuses(candidates),
    candidates,
  }
}

function readRows(database: DatabaseSync): readonly SellPlanRow[] {
  return z.array(SellPlanRowSchema).parse(
    database
      .prepare(`
        SELECT c.compare_key, c.normalized_name, c.option_key,
          c.cheapest_supplier_id AS selected_supplier_id,
          r.original_product_name AS selected_supplier_original_product_name,
          r.original_option_name AS selected_supplier_original_option_name,
          c.cheapest_price AS selected_price,
          COALESCE(sg.supplier_count, 1) AS supplier_count_for_same_compare_key,
          COALESCE(ag.alternative_suppliers_summary, '') AS alternative_suppliers_summary,
          wm.status AS raw_mapping_status,
          wm.woocommerce_product_id,
          wm.woocommerce_variation_id
        FROM compare_products c
        JOIN raw_products r ON r.id = c.cheapest_raw_product_id
        LEFT JOIN woocommerce_product_mapping wm ON wm.compare_key = c.compare_key
        LEFT JOIN (
          SELECT normalized_name, option_key, COUNT(DISTINCT supplier_id) AS supplier_count
          FROM normalized_products
          GROUP BY normalized_name, option_key
        ) sg ON sg.normalized_name = c.normalized_name AND sg.option_key = c.option_key
        LEFT JOIN (
          SELECT normalized_name, option_key,
            group_concat(supplier_id || ':' || price, '; ') AS alternative_suppliers_summary
          FROM normalized_products
          GROUP BY normalized_name, option_key
        ) ag ON ag.normalized_name = c.normalized_name AND ag.option_key = c.option_key
        ORDER BY c.normalized_name, c.option_key
      `)
      .all(),
  )
}

function toCandidate(row: SellPlanRow): SellPlanCandidate {
  const mappingStatus = toMappingStatus(row.raw_mapping_status)
  return {
    compare_key: row.compare_key,
    normalized_name: row.normalized_name,
    option_key: row.option_key,
    selected_supplier_id: row.selected_supplier_id,
    selected_supplier_original_product_name: row.selected_supplier_original_product_name,
    selected_supplier_original_option_name: row.selected_supplier_original_option_name,
    selected_price: row.selected_price,
    supplier_count_for_same_compare_key: row.supplier_count_for_same_compare_key,
    compared_with_other_supplier: row.supplier_count_for_same_compare_key > 1,
    alternative_suppliers_summary: row.alternative_suppliers_summary,
    woocommerce_mapping_status: mappingStatus,
    woocommerce_product_id: row.woocommerce_product_id,
    woocommerce_variation_id: row.woocommerce_variation_id,
    recommended_action: toRecommendedAction(mappingStatus),
    note: toNote(mappingStatus, row.supplier_count_for_same_compare_key),
  }
}

function toMappingStatus(status: SellPlanRow["raw_mapping_status"]): MappingStatus {
  switch (status) {
    case "approved":
      return "approved_mapping_exists"
    case "pending":
    case "disabled":
      return "pending_mapping_exists"
    case null:
      return "no_mapping"
  }
}

function toRecommendedAction(status: MappingStatus): RecommendedAction {
  switch (status) {
    case "approved_mapping_exists":
      return "update_existing_dry_run_only"
    case "pending_mapping_exists":
      return "needs_manual_mapping"
    case "no_mapping":
      return "new_product_candidate"
  }
}

function toNote(status: MappingStatus, supplierCount: number): string {
  const sourceNote =
    supplierCount > 1 ? "strict compare matched; cheapest selected" : "single supplier candidate"
  return status === "approved_mapping_exists" ? `${sourceNote}; dry-run eligible` : sourceNote
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1
  }
  return counts
}

function countMappingStatuses(
  candidates: readonly SellPlanCandidate[],
): Record<MappingStatus, number> {
  return {
    approved_mapping_exists: candidates.filter(
      (row) => row.woocommerce_mapping_status === "approved_mapping_exists",
    ).length,
    pending_mapping_exists: candidates.filter(
      (row) => row.woocommerce_mapping_status === "pending_mapping_exists",
    ).length,
    no_mapping: candidates.filter((row) => row.woocommerce_mapping_status === "no_mapping").length,
  }
}
