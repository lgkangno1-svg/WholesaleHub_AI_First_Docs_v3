import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { WooMatchCandidate, WooMatchReport } from "./woocommerce-match.js"

const CSV_HEADER = [
  "compare_key",
  "normalized_name",
  "option_key",
  "selected_supplier_id",
  "selected_supplier_original_product_name",
  "selected_supplier_original_option_name",
  "selected_price",
  "supplier_count_for_same_compare_key",
  "woocommerce_product_id",
  "woocommerce_variation_id",
  "woocommerce_product_name",
  "woocommerce_option_name",
  "woocommerce_current_price",
  "confidence",
  "reason",
  "recommended_action",
] as const

export async function writeWooMatchFiles(
  report: WooMatchReport,
  jsonPath: string,
  csvPath: string,
): Promise<void> {
  await writeOutput(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  await writeOutput(csvPath, toCsv(report.candidates))
}

function toCsv(candidates: readonly WooMatchCandidate[]): string {
  const rows = candidates.map((candidate) => CSV_HEADER.map((field) => candidate[field]))
  return `${[CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`
}

function csvCell(value: string | number | null): string {
  return `"${String(value ?? "").replace(/"/gu, '""')}"`
}

async function writeOutput(path: string, value: string): Promise<void> {
  const target = resolve(path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, value, "utf8")
}
