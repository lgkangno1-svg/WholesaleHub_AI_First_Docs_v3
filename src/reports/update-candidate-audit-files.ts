import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { UpdateCandidateAuditReport } from "./update-candidate-audit.js"

const HEADER = [
  "product_id",
  "variation_id",
  "woocommerce_product_name",
  "woocommerce_option_name",
  "selected_supplier_id",
  "supplier_product_name",
  "supplier_option_name",
  "normalized_name",
  "option_key",
  "audit_class",
  "product_group",
  "already_updated",
  "reason",
] as const

export async function writeUpdateCandidateAuditFiles(
  report: UpdateCandidateAuditReport,
  jsonPath: string,
  csvPath: string,
): Promise<void> {
  await writeOutput(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  await writeOutput(csvPath, toCsv(report.rows))
}

function toCsv(rows: UpdateCandidateAuditReport["rows"]): string {
  return `${[HEADER, ...rows.map((row) => HEADER.map((field) => row[field]))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n")}\n`
}

function csvCell(value: string | number | boolean | null): string {
  return `"${String(value ?? "").replace(/"/gu, '""')}"`
}

async function writeOutput(path: string, value: string): Promise<void> {
  const target = resolve(path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, value, "utf8")
}
