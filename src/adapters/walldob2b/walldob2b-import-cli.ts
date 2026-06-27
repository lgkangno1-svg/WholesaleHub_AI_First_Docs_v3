import { mkdir, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { runCollectedProductsPipeline } from "../../application/phase1-pipeline.js"
import { applySchema } from "../../database/apply-schema.js"
import type { CollectedProduct, SupplierConfig } from "../../domain/product.js"
import { RuleBasedProductParser } from "../../normalization/rule-based-parser.js"
import type { Walldob2bLogin } from "./walldob2b-adapter.js"
import type { Walldob2bExcelSkippedRow } from "./walldob2b-excel-download.js"
import {
  fetchWalldob2bProductExcel,
  parseWalldob2bProductExcelHtml,
} from "./walldob2b-excel-download.js"

const OptionsSchema = z.object({
  databasePath: z.string().min(1),
  limit: z.number().int().min(1).max(250),
})

type Options = z.infer<typeof OptionsSchema>

class CliArgumentError extends Error {
  readonly name = "CliArgumentError"

  constructor(readonly argument: string) {
    super(`Invalid or missing CLI argument: ${argument}`)
  }
}

async function main(): Promise<void> {
  await loadDotEnv()
  const options = parseArguments(process.argv.slice(2))
  const login: Walldob2bLogin = {
    username: readRequiredEnv("WALLDOB2B_USERNAME"),
    password: readRequiredEnv("WALLDOB2B_PASSWORD"),
  }
  const excelHtml = await fetchWalldob2bProductExcel(login)
  const parsedExcel = parseWalldob2bProductExcelHtml(excelHtml, options.limit)
  const products: readonly CollectedProduct[] = parsedExcel.products

  const schema = await readFile("sql/schema.sql", "utf8")
  const databasePath = resolve(options.databasePath)
  await mkdir(dirname(databasePath), { recursive: true })
  const database = new DatabaseSync(databasePath)
  try {
    applySchema(database, schema)
    const result = await runCollectedProductsPipeline({
      database,
      config: walldob2bSupplierConfig(),
      products,
      parser: new RuleBasedProductParser(),
    })
    console.log(
      JSON.stringify(
        {
          collectionMethod: "excel_download_html_table",
          parsedRowCount: parsedExcel.totalRows,
          optionCount: products.length,
          skippedRowCount: parsedExcel.skippedRows.length,
          skippedRowsByReason: summarizeSkippedRows(parsedExcel.skippedRows),
          priceExamples: products.slice(0, 3).map((product) => ({
            productName: product.originalProductName,
            optionName: product.originalOptionName,
            price: product.price,
          })),
          rawProductCount: result.rawProductCount,
          normalizedProductCount: result.normalizedProductCount,
          compareProductCount: result.compareProductCount,
          walldob2bCompareCount: countWalldob2bCompareProducts(database),
          sharedCompareGroupCount: countSharedCompareGroups(database),
        },
        null,
        2,
      ),
    )
  } finally {
    database.close()
  }
}

function summarizeSkippedRows(
  skippedRows: readonly Walldob2bExcelSkippedRow[],
): Record<Walldob2bExcelSkippedRow["reason"], number> {
  const summary: Record<Walldob2bExcelSkippedRow["reason"], number> = {
    empty_row: 0,
    missing_product_name: 0,
    missing_option_name: 0,
    missing_price: 0,
    invalid_price: 0,
  }
  for (const row of skippedRows) {
    summary[row.reason] += 1
  }
  return summary
}

function countWalldob2bCompareProducts(database: DatabaseSync): number {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM compare_products WHERE cheapest_supplier_id = ?")
    .get("walldob2b")
  return CountRowSchema.parse(row).count
}

function countSharedCompareGroups(database: DatabaseSync): number {
  const row = database
    .prepare(`
      SELECT COUNT(*) AS count
      FROM normalized_products w
      WHERE w.supplier_id = 'walldob2b'
        AND EXISTS (
          SELECT 1
          FROM normalized_products other
          WHERE other.supplier_id != 'walldob2b'
            AND other.normalized_name = w.normalized_name
            AND other.option_key = w.option_key
        )
    `)
    .get()
  return CountRowSchema.parse(row).count
}

function walldob2bSupplierConfig(): SupplierConfig {
  const sourceUrl = "https://walldob2b.com/theme/jelly/shop/product_excel_download.php"
  return {
    supplierId: "walldob2b",
    supplierName: "walldob2b",
    sourceType: "excel_download",
    enabled: true,
    googleSheet: {
      spreadsheetId: "product_excel_download",
      gid: "product_excel_download",
      sheetUrl: sourceUrl,
      csvExportUrl: sourceUrl,
      accessMode: "csv_export_or_google_oauth",
    },
    schedule: { timezone: "Asia/Seoul", cron: "manual" },
    columnMapping: {
      productNameColumn: "상품명",
      optionColumn: "옵션명",
      priceColumn: "판매가",
      stockColumn: null,
      memoColumn: "배송비/조건",
    },
    collection: {
      playwrightEnabled: false,
      autoOrderEnabled: false,
      dataRetention: "latest_only",
    },
  }
}

function parseArguments(args: readonly string[]): Options {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new CliArgumentError(key ?? "unknown")
    }
    values.set(key, value)
  }
  return OptionsSchema.parse({
    databasePath: values.get("--db") ?? "data/wholesalehub.sqlite",
    limit: Number(values.get("--limit") ?? "50"),
  })
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`)
  }
  return value
}

async function loadDotEnv(): Promise<void> {
  try {
    const env = await readFile(".env", "utf8")
    for (const line of env.split(/\r?\n/u)) {
      const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line)
      if (match?.[1] !== undefined && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2] ?? ""
      }
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return
    }
    throw error
  }
}

const CountRowSchema = z.object({ count: z.number().int() })

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
