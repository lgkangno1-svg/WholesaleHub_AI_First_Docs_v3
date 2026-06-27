import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type {
  WooProductSyncPlanRow,
  WooProductSyncSummary,
} from "./woocommerce-product-sync-plan.js"

const HEADER = [
  "mode",
  "product_group_key",
  "display_product_name",
  "matched_woocommerce_product_id",
  "action",
  "option_display_name",
  "selected_supplier_id",
  "selected_supplier_original_product_name",
  "selected_supplier_original_option_name",
  "selected_price",
  "current_woocommerce_price",
  "current_woocommerce_variation_id",
  "compared_exact_same_option",
  "safety_status",
  "safety_reason",
  "internal_supplier_meta_plan",
] as const

export async function writeWooProductSyncPlanFiles(
  rows: readonly WooProductSyncPlanRow[],
  summary: WooProductSyncSummary,
): Promise<void> {
  await writeOutput("reports/woocommerce-sync-plan.json", JSON.stringify(rows, null, 2))
  await writeOutput("reports/woocommerce-sync-plan.csv", toCsv(rows))
  await writeOutput("reports/woocommerce-sync-summary.json", JSON.stringify(summary, null, 2))
}

function toCsv(rows: readonly WooProductSyncPlanRow[]): string {
  return `${[HEADER, ...rows.map((row) => HEADER.map((field) => cellValue(row, field)))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n")}\n`
}

function cellValue(
  row: WooProductSyncPlanRow,
  field: (typeof HEADER)[number],
): string | number | boolean | null {
  if (field === "internal_supplier_meta_plan") return row.internal_supplier_meta_plan.join("; ")
  return row[field]
}

function csvCell(value: string | number | boolean | null): string {
  return `"${String(value ?? "").replace(/"/gu, '""')}"`
}

async function writeOutput(path: string, value: string): Promise<void> {
  const target = resolve(path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${value}\n`, "utf8")
}
