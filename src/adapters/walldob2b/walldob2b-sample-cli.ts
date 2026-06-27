import { mkdir, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { runCollectedProductsPipeline } from "../../application/phase1-pipeline.js"
import { applySchema } from "../../database/apply-schema.js"
import type { SupplierConfig } from "../../domain/product.js"
import { RuleBasedProductParser } from "../../normalization/rule-based-parser.js"
import {
  fetchWalldob2bDetailHtml,
  parseWalldob2bDetailHtml,
  type Walldob2bCandidate,
} from "./walldob2b-adapter.js"

const CliOptionsSchema = z.object({
  databasePath: z.string().min(1),
  htmlPath: z.string().min(1).nullable(),
  itId: z.string().min(1),
  optionName: z.string().min(1),
})

type CliOptions = z.infer<typeof CliOptionsSchema>

class CliArgumentError extends Error {
  readonly name = "CliArgumentError"

  constructor(readonly argument: string) {
    super(`Invalid or missing CLI argument: ${argument}`)
  }
}

const PRODUCT_URL = "https://walldob2b.com/shop/item.php?it_id=JW000038"

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const candidate: Walldob2bCandidate = {
    wooProductId: 1158,
    productName: "태국 항공직송 생 망고스틴",
    itId: options.itId,
    sourceUrl: PRODUCT_URL,
  }
  const html = await readWalldob2bHtml(options)
  const products = parseWalldob2bDetailHtml(html, candidate).filter(
    (product) => product.originalOptionName === options.optionName,
  )
  if (products.length !== 1) {
    throw new CliArgumentError("--option")
  }

  const schema = await readFile("sql/schema.sql", "utf8")
  const databasePath = resolve(options.databasePath)
  await mkdir(dirname(databasePath), { recursive: true })
  const database = new DatabaseSync(databasePath)
  try {
    applySchema(database, schema)
    const result = await runCollectedProductsPipeline({
      database,
      config: walldob2bSupplierConfig(options.itId),
      products,
      parser: new RuleBasedProductParser(),
    })
    const normalized = database
      .prepare(
        "SELECT normalized_name, option_key FROM normalized_products WHERE supplier_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get("walldob2b")
    const compare = database
      .prepare(
        "SELECT compare_key, cheapest_supplier_id, cheapest_price FROM compare_products WHERE cheapest_supplier_id = ? ORDER BY calculated_at DESC LIMIT 1",
      )
      .get("walldob2b")
    console.log(JSON.stringify({ ...result, normalized, compare }, null, 2))
  } finally {
    database.close()
  }
}

async function readWalldob2bHtml(options: CliOptions): Promise<string> {
  if (options.htmlPath !== null) {
    return readFile(options.htmlPath, "utf8")
  }

  const username = process.env["WALLDOB2B_USERNAME"]?.trim()
  const password = process.env["WALLDOB2B_PASSWORD"]?.trim()
  if (
    username === undefined ||
    password === undefined ||
    username.length === 0 ||
    password.length === 0
  ) {
    throw new CliArgumentError("WALLDOB2B_USERNAME/WALLDOB2B_PASSWORD or --html")
  }

  return fetchWalldob2bDetailHtml(options.itId, { username, password })
}

function walldob2bSupplierConfig(itId: string): SupplierConfig {
  return {
    supplierId: "walldob2b",
    supplierName: "walldob2b",
    sourceType: "website",
    enabled: true,
    googleSheet: {
      spreadsheetId: itId,
      gid: itId,
      sheetUrl: PRODUCT_URL,
      csvExportUrl: PRODUCT_URL,
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

function parseArguments(args: readonly string[]): CliOptions {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new CliArgumentError(key ?? "unknown")
    }
    values.set(key, value)
  }
  return CliOptionsSchema.parse({
    databasePath: values.get("--db") ?? "data/wholesalehub.sqlite",
    htmlPath: values.get("--html") ?? null,
    itId: values.get("--it-id") ?? "JW000038",
    optionName: values.get("--option") ?? "망고스틴5kg(500g*10망)",
  })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
