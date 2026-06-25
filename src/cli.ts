import { mkdir, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { fetchDailyFoodCsv } from "./adapters/dailyfood/dailyfood-adapter.js"
import { runPhase1Pipeline } from "./application/phase1-pipeline.js"
import { loadSupplierConfig } from "./config/supplier-config-loader.js"
import { applySchema } from "./database/apply-schema.js"
import { GeminiFlashProductParser } from "./normalization/gemini-flash-parser.js"
import { HybridProductParser } from "./normalization/hybrid-parser.js"

const CliOptionsSchema = z.object({
  command: z.literal("phase1"),
  configPath: z.string().min(1),
  databasePath: z.string().min(1),
  csvPath: z.string().min(1).nullable(),
  marginAmount: z.number().int().nonnegative(),
})

type CliOptions = z.infer<typeof CliOptionsSchema>

class CliArgumentError extends Error {
  readonly name = "CliArgumentError"

  constructor(readonly argument: string) {
    super(`Invalid or missing CLI argument: ${argument}`)
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const config = await loadSupplierConfig(options.configPath)
  const csv =
    options.csvPath === null
      ? await fetchDailyFoodCsv(config)
      : await readFile(options.csvPath, "utf8")
  const schema = await readFile("sql/schema.sql", "utf8")
  const databasePath = resolve(options.databasePath)
  await mkdir(dirname(databasePath), { recursive: true })
  const database = new DatabaseSync(databasePath)
  try {
    applySchema(database, schema)
    const apiKey = process.env["GEMINI_API_KEY"] ?? ""
    const gemini = apiKey.length > 0 ? new GeminiFlashProductParser(apiKey) : null
    const result = await runPhase1Pipeline({
      database,
      config,
      csv,
      parser: new HybridProductParser(gemini),
      marginAmount: options.marginAmount,
    })
    console.log(JSON.stringify({ mode: "woocommerce-dry-run", ...result }, null, 2))
  } finally {
    database.close()
  }
}

function parseArguments(args: readonly string[]): CliOptions {
  if (args[0] !== "phase1") {
    throw new CliArgumentError("command must be phase1")
  }
  const values = new Map<string, string>()
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new CliArgumentError(key ?? "unknown")
    }
    values.set(key, value)
  }
  const marginText = values.get("--margin") ?? "0"
  return CliOptionsSchema.parse({
    command: "phase1",
    configPath: values.get("--config") ?? "config/suppliers/dailyfood.google_sheet.yml",
    databasePath: values.get("--db") ?? "data/wholesalehub.sqlite",
    csvPath: values.get("--csv") ?? null,
    marginAmount: Number(marginText),
  })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
