import { mkdir, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { runCollectedProductsPipeline } from "../../application/phase1-pipeline.js"
import { applySchema } from "../../database/apply-schema.js"
import type { SupplierConfig } from "../../domain/product.js"
import { RuleBasedProductParser } from "../../normalization/rule-based-parser.js"
import {
  fetchWalldob2bCandidatesFromWooCommerce,
  fetchWalldob2bDetailHtml,
  parseWalldob2bDetailHtml,
} from "./walldob2b-adapter.js"

const OptionsSchema = z.object({
  databasePath: z.string().min(1),
  limit: z.number().int().min(1).max(5),
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
  const candidates = await fetchWalldob2bCandidatesFromWooCommerce({
    baseUrl: readRequiredEnv("WOOCOMMERCE_BASE_URL"),
    consumerKey: readRequiredEnv("WOOCOMMERCE_CONSUMER_KEY"),
    consumerSecret: readRequiredEnv("WOOCOMMERCE_CONSUMER_SECRET"),
    limit: options.limit,
  })
  const login = {
    username: readRequiredEnv("WALLDOB2B_USERNAME"),
    password: readRequiredEnv("WALLDOB2B_PASSWORD"),
  }
  const products = []
  const failedCandidates = []
  for (const candidate of candidates) {
    try {
      const html = await fetchWalldob2bDetailHtml(candidate.itId, login)
      products.push(...parseWalldob2bDetailHtml(html, candidate))
    } catch (error) {
      failedCandidates.push({
        itId: candidate.itId,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

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
          candidateCount: candidates.length,
          optionCount: products.length,
          failedCandidateCount: failedCandidates.length,
          failedCandidates,
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
  const sourceUrl = "https://walldob2b.com"
  return {
    supplierId: "walldob2b",
    supplierName: "walldob2b",
    sourceType: "website",
    enabled: true,
    googleSheet: {
      spreadsheetId: "woocommerce-meta",
      gid: "woocommerce-meta",
      sheetUrl: sourceUrl,
      csvExportUrl: sourceUrl,
      accessMode: "csv_export_or_google_oauth",
    },
    schedule: { timezone: "Asia/Seoul", cron: "manual" },
    columnMapping: {
      productNameColumn: "상품명",
      optionColumn: "옵션",
      priceColumn: "가격",
      stockColumn: null,
      memoColumn: "메모",
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
    limit: Number(values.get("--limit") ?? "5"),
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
