import { z } from "zod"
import { hubSalePriceFromSupplierPrice } from "./mvp-sync-plan.js"

const PRICE_ACTIONS = new Set(["update_price", "switch_supplier_and_update_price"])
const RowSchema = z.object({
  product_id: z.number().int().nullable(),
  variation_id: z.number().int().nullable(),
  current_price: z.string(),
  new_price: z.string(),
  selected_supplier_id: z.string(),
  selected_source_product_id: z.string(),
  selected_source_option_id: z.string(),
  selected_supplier_price: z.number().nullable().optional(),
  baseline_supplier_price: z.number().nullable().optional(),
  source_price_changed: z.boolean().nullable().optional(),
  match_type: z.string().optional(),
  action: z.string(),
})

type PriceRow = z.infer<typeof RowSchema>

export type MvpPricePreflightResult = {
  readonly ok: boolean
  readonly priceActionCount: number
  readonly reasons: readonly string[]
}

export function validateMvpPriceRows(value: unknown): MvpPricePreflightResult {
  const rows = z.array(RowSchema).parse(value)
  const priceRows = rows.filter((row) => PRICE_ACTIONS.has(row.action))
  const reasons: string[] = []
  const targetCounts = new Map<string, number>()

  for (const row of rows) {
    if (row.product_id === null || row.variation_id === null) continue
    if (!PRICE_ACTIONS.has(row.action) && row.action !== "no_op") continue
    const key = targetKey(row)
    targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1)
  }

  for (const row of priceRows) {
    const key = targetKey(row)
    if (row.product_id === null || row.variation_id === null) reasons.push(`missing_target:${key}`)
    if ((targetCounts.get(key) ?? 0) !== 1) reasons.push(`ambiguous_target:${key}`)
    if (row.match_type !== "hard_meta") reasons.push(`non_hard_match:${key}`)
    if (row.source_price_changed !== true) reasons.push(`source_change_unproven:${key}`)
    if (!validPrice(row.selected_supplier_price)) reasons.push(`invalid_supplier_price:${key}`)
    if (!validPrice(row.baseline_supplier_price)) reasons.push(`missing_supplier_baseline:${key}`)
    if (row.selected_source_product_id.trim().length === 0 || row.selected_source_option_id.trim().length === 0)
      reasons.push(`missing_source_identity:${key}`)
    if (validPrice(row.selected_supplier_price)) {
      const expected = hubSalePriceFromSupplierPrice(row.selected_supplier_price)
      if (Number(row.new_price) !== expected) reasons.push(`price_formula_mismatch:${key}`)
    }
  }

  return {
    ok: reasons.length === 0,
    priceActionCount: priceRows.length,
    reasons: [...new Set(reasons)],
  }
}

function targetKey(row: PriceRow): string {
  return `${row.product_id ?? "null"}:${row.variation_id ?? "null"}`
}

function validPrice(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1_000
}
