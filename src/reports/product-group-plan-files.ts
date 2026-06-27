import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { ProductGroupPlanReport } from "./product-group-plan.js"

const GROUP_HEADER = [
  "product_group_key",
  "display_product_name",
  "category",
  "family",
  "included_supplier_count",
  "option_count",
  "recommended_action",
  "matched_woocommerce_product_id",
  "reason",
] as const

const OPTION_HEADER = [
  "product_group_key",
  "display_product_name",
  "option_display_name",
  "normalized_option_key",
  "selected_supplier_id",
  "selected_supplier_original_product_name",
  "selected_supplier_original_option_name",
  "selected_price",
  "alternative_suppliers_summary",
  "compared_exact_same_option",
  "recommended_action",
] as const

export async function writeProductGroupPlanFiles(report: ProductGroupPlanReport): Promise<void> {
  await writeOutput(
    "reports/product-group-plan.json",
    JSON.stringify(report.productGroups, null, 2),
  )
  await writeOutput("reports/product-group-plan.csv", toCsv(GROUP_HEADER, report.productGroups))
  await writeOutput(
    "reports/product-option-plan.json",
    JSON.stringify(report.productOptions, null, 2),
  )
  await writeOutput("reports/product-option-plan.csv", toCsv(OPTION_HEADER, report.productOptions))
  await writeOutput(
    "reports/woocommerce-product-create-plan.json",
    JSON.stringify(report.wooCreatePlans, null, 2),
  )
  await writeOutput(
    "reports/woocommerce-product-update-plan.json",
    JSON.stringify(report.wooUpdatePlans, null, 2),
  )
}

type CsvValue = string | number | boolean | null

function toCsv<T extends Record<string, CsvValue>>(
  header: readonly string[],
  rows: readonly T[],
): string {
  const csvRows = [header, ...rows.map((row) => header.map((field) => row[field] ?? null))]
  return `${csvRows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`
}

function csvCell(value: CsvValue): string {
  return `"${String(value ?? "").replace(/"/gu, '""')}"`
}

async function writeOutput(path: string, value: string): Promise<void> {
  const target = resolve(path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${value}\n`, "utf8")
}
