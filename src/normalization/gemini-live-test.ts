import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { fetchDailyFoodCsv, parseDailyFoodCsv } from "../adapters/dailyfood/dailyfood-adapter.js"
import { loadSupplierConfig } from "../config/supplier-config-loader.js"
import { applySchema } from "../database/apply-schema.js"
import { Phase1Repository } from "../database/phase1-repository.js"
import type { ParsedProduct, RawProductRecord } from "../domain/product.js"
import { OpenRouterGeminiProductParser } from "./openrouter-gemini-parser.js"

const LiveTestOptionsSchema = z.object({
  configPath: z.string().min(1),
  databasePath: z.string().min(1),
  limit: z.number().int().min(1).max(5),
})

type LiveTestOptions = z.infer<typeof LiveTestOptionsSchema>

type TestedProduct = {
  readonly originalProductName: string
  readonly originalOptionName: string | null
  readonly schemaValid: boolean
  readonly savedToProductMapping: boolean
  readonly cacheHitOnSecondRead: boolean
  readonly parsed: Pick<
    ParsedProduct,
    | "normalizedName"
    | "optionKey"
    | "quantity"
    | "unit"
    | "weightValue"
    | "weightUnit"
    | "confidence"
    | "parserModel"
  >
}

type FailedProduct = {
  readonly originalProductName: string
  readonly originalOptionName: string | null
  readonly reason: string
}

async function main(): Promise<void> {
  await loadDotEnv(".env")
  const options = parseArguments(process.argv.slice(2))
  const apiKey = process.env["OPENROUTER_API_KEY"]?.trim()
    ? process.env["OPENROUTER_API_KEY"]
    : (process.env["GEMINI_API_KEY"] ?? "")
  if (apiKey.trim().length === 0) {
    throw new Error("GEMINI_API_KEY or OPENROUTER_API_KEY is required")
  }

  const config = await loadSupplierConfig(options.configPath)
  const csv = await fetchDailyFoodCsv(config)
  const schema = await readFile("sql/schema.sql", "utf8")
  const databasePath = resolve(options.databasePath)
  await mkdir(dirname(databasePath), { recursive: true })
  const database = new DatabaseSync(databasePath)
  const parser = OpenRouterGeminiProductParser.fromEnvironment(process.env)

  try {
    applySchema(database, schema)
    const repository = new Phase1Repository(database)
    repository.upsertSupplier(config)
    const parsedCsv = parseDailyFoodCsv(csv, config)
    const rawProducts = repository.replaceRawProducts(config, parsedCsv.products)
    const candidates = rawProducts
      .filter((raw) => repository.findMapping(createMappingKey(raw)) === null)
      .slice(0, options.limit)
    const tested: TestedProduct[] = []
    const failures: FailedProduct[] = []

    for (const raw of candidates) {
      const mappingKey = createMappingKey(raw)
      try {
        const parsed = await parser.parse(raw.originalProductName, raw.originalOptionName)
        repository.saveMapping(mappingKey, raw, parsed)
        const saved = repository.findMapping(mappingKey)
        tested.push({
          originalProductName: raw.originalProductName,
          originalOptionName: raw.originalOptionName,
          schemaValid: true,
          savedToProductMapping: saved !== null,
          cacheHitOnSecondRead: repository.findMapping(mappingKey) !== null,
          parsed: {
            normalizedName: parsed.normalizedName,
            optionKey: parsed.optionKey,
            quantity: parsed.quantity,
            unit: parsed.unit,
            weightValue: parsed.weightValue,
            weightUnit: parsed.weightUnit,
            confidence: parsed.confidence,
            parserModel: parsed.parserModel,
          },
        })
      } catch (error) {
        failures.push({
          originalProductName: raw.originalProductName,
          originalOptionName: raw.originalOptionName,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const mappingCount = z
      .object({ count: z.number().int() })
      .parse(database.prepare("SELECT COUNT(*) AS count FROM product_mapping").get()).count
    console.log(
      JSON.stringify(
        {
          apiKeyPresent: true,
          apiKeyValuePrinted: false,
          model: parser.modelName,
          requestedLimit: options.limit,
          actualGeminiCalls: candidates.length,
          testedProducts: tested,
          failures,
          productMappingCount: mappingCount,
          cacheHitsOnSecondRead: tested.filter((item) => item.cacheHitOnSecondRead).length,
        },
        null,
        2,
      ),
    )
    if (failures.length > 0) {
      process.exitCode = 1
    }
  } finally {
    database.close()
  }
}

function parseArguments(args: readonly string[]): LiveTestOptions {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error(`Invalid argument: ${key ?? "unknown"}`)
    }
    values.set(key, value)
  }
  return LiveTestOptionsSchema.parse({
    configPath: values.get("--config") ?? "config/suppliers/dailyfood.google_sheet.yml",
    databasePath: values.get("--db") ?? "data/gemini-live.sqlite",
    limit: Number(values.get("--limit") ?? "5"),
  })
}

async function loadDotEnv(path: string): Promise<void> {
  if (!existsSync(path)) {
    return
  }
  const content = await readFile(path, "utf8")
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue
    }
    const separatorIndex = trimmed.indexOf("=")
    if (separatorIndex < 1) {
      continue
    }
    const key = trimmed.slice(0, separatorIndex)
    const value = trimmed.slice(separatorIndex + 1)
    if (process.env[key] === undefined || process.env[key]?.trim().length === 0) {
      process.env[key] = value
    }
  }
}

function createMappingKey(raw: RawProductRecord): string {
  return createHash("sha256")
    .update(`${raw.originalProductName.trim()}|${raw.originalOptionName?.trim() ?? ""}`)
    .digest("hex")
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
