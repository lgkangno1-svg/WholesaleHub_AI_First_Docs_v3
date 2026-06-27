import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { SellPlanCandidate, SellPlanReport } from "./sell-plan.js"

const CSV_HEADER = [
  "compare_key",
  "normalized_name",
  "option_key",
  "selected_supplier_id",
  "selected_supplier_original_product_name",
  "selected_supplier_original_option_name",
  "selected_price",
  "supplier_count_for_same_compare_key",
  "compared_with_other_supplier",
  "alternative_suppliers_summary",
  "woocommerce_mapping_status",
  "woocommerce_product_id",
  "woocommerce_variation_id",
  "recommended_action",
  "note",
] as const

export async function writeSellPlanFiles(
  report: SellPlanReport,
  jsonPath: string,
  csvPath: string,
): Promise<void> {
  await writeOutput(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  await writeOutput(csvPath, toCsv(report.candidates))
}

function toCsv(candidates: readonly SellPlanCandidate[]): string {
  const rows = candidates.map((candidate) => CSV_HEADER.map((field) => candidate[field]))
  return `${[CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`
}

function csvCell(value: string | number | boolean | null): string {
  return `"${String(value ?? "").replace(/"/gu, '""')}"`
}

async function writeOutput(path: string, value: string): Promise<void> {
  const target = resolve(path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, value, "utf8")
}
