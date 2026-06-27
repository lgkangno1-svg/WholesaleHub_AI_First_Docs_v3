import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { ApprovedMappingResult } from "./approved-mapping.js"

export async function writeApprovedMappingReports(
  result: ApprovedMappingResult,
  jsonPath: string,
  csvPath: string,
  newProductsPath: string,
): Promise<void> {
  await writeOutput(jsonPath, `${JSON.stringify(result, null, 2)}\n`)
  await writeOutput(csvPath, toApprovedCsv(result))
  await writeOutput(newProductsPath, toNewProductsCsv(result))
}

function toApprovedCsv(result: ApprovedMappingResult): string {
  const header = [
    "compare_key",
    "normalized_name",
    "option_key",
    "selected_supplier_id",
    "woocommerce_product_id",
    "woocommerce_variation_id",
    "reason",
    "status",
  ]
  const rows = result.approved.map((row) => [
    row.compare_key,
    row.normalized_name,
    row.option_key,
    row.selected_supplier_id,
    row.woocommerce_product_id,
    row.woocommerce_variation_id,
    row.reason,
    row.status,
  ])
  return toCsv([header, ...rows])
}

function toNewProductsCsv(result: ApprovedMappingResult): string {
  const header = [
    "compare_key",
    "normalized_name",
    "option_key",
    "selected_supplier_id",
    "selected_price",
  ]
  const rows = result.newProducts.map((row) => [
    row.compare_key,
    row.normalized_name,
    row.option_key,
    row.selected_supplier_id,
    row.selected_price,
  ])
  return toCsv([header, ...rows])
}

function toCsv(rows: readonly (readonly (string | number | null)[])[]): string {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`
}

function csvCell(value: string | number | null): string {
  return `"${String(value ?? "").replace(/"/gu, '""')}"`
}

async function writeOutput(path: string, value: string): Promise<void> {
  const target = resolve(path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, value, "utf8")
}
