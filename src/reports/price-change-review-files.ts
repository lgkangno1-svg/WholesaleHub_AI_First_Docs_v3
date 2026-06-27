import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { PriceChangeReviewReport, PriceChangeReviewRow } from "./price-change-review.js"

const HEADER = [
  "product_id",
  "variation_id",
  "woocommerce_product_name",
  "woocommerce_option_name",
  "woocommerce_current_price",
  "new_price",
  "price_diff",
  "price_diff_rate",
  "selected_supplier_id",
  "selected_supplier_original_product_name",
  "selected_supplier_original_option_name",
  "confidence",
  "safety_status",
  "safety_reason",
] as const

export async function writePriceChangeReviewFiles(
  report: PriceChangeReviewReport,
  jsonPath: string,
  csvPath: string,
): Promise<void> {
  await writeOutput(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  await writeOutput(csvPath, toCsv(report.rows))
}

function toCsv(rows: readonly PriceChangeReviewRow[]): string {
  return `${[HEADER, ...rows.map((row) => HEADER.map((field) => row[field]))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n")}\n`
}

function csvCell(value: string | number | null): string {
  return `"${String(value ?? "").replace(/"/gu, '""')}"`
}

async function writeOutput(path: string, value: string): Promise<void> {
  const target = resolve(path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, value, "utf8")
}
