import { readFile } from "node:fs/promises"
import { z } from "zod"
import { fetchWooCommerceCatalog } from "../woocommerce/catalog.js"
import { buildWooMatchReport, readSellPlan } from "./woocommerce-match.js"
import { writeWooMatchFiles } from "./woocommerce-match-files.js"

const OptionsSchema = z.object({
  sellPlanPath: z.string().min(1),
  jsonPath: z.string().min(1),
  csvPath: z.string().min(1),
})

type Options = z.infer<typeof OptionsSchema>

async function main(): Promise<void> {
  await loadDotEnv()
  const options = parseArguments(process.argv.slice(2))
  const catalog = await fetchWooCommerceCatalog({
    baseUrl: readRequiredEnv("WOOCOMMERCE_BASE_URL"),
    consumerKey: readRequiredEnv("WOOCOMMERCE_CONSUMER_KEY"),
    consumerSecret: readRequiredEnv("WOOCOMMERCE_CONSUMER_SECRET"),
  })
  const report = buildWooMatchReport(await readSellPlan(options.sellPlanPath), catalog)
  await writeWooMatchFiles(report, options.jsonPath, options.csvPath)
  console.log(
    JSON.stringify(
      {
        jsonPath: options.jsonPath,
        csvPath: options.csvPath,
        catalogProductCount: report.catalogProductCount,
        catalogVariationCount: report.catalogVariationCount,
        totalSellCandidates: report.totalSellCandidates,
        confidenceCounts: report.confidenceCounts,
        actionCounts: report.actionCounts,
      },
      null,
      2,
    ),
  )
}

function parseArguments(args: readonly string[]): Options {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error(`Invalid WooCommerce match argument: ${key ?? "unknown"}`)
    }
    values.set(key, value)
  }
  return OptionsSchema.parse({
    sellPlanPath: values.get("--sell-plan") ?? "reports/sell-plan.json",
    jsonPath: values.get("--json") ?? "reports/woocommerce-match-candidates.json",
    csvPath: values.get("--csv") ?? "reports/woocommerce-match-candidates.csv",
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
