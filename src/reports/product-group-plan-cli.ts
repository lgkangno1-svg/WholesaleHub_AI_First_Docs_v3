import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { fetchWooCommerceCatalog } from "../woocommerce/catalog.js"
import { buildProductGroupPlanReport } from "./product-group-plan.js"
import { writeProductGroupPlanFiles } from "./product-group-plan-files.js"

const OptionsSchema = z.object({ databasePath: z.string().min(1) })
type Options = z.infer<typeof OptionsSchema>

async function main(): Promise<void> {
  await loadDotEnv()
  const options = parseArguments(process.argv.slice(2))
  const catalog = await fetchWooCommerceCatalog({
    baseUrl: readRequiredEnv("WOOCOMMERCE_BASE_URL"),
    consumerKey: readRequiredEnv("WOOCOMMERCE_CONSUMER_KEY"),
    consumerSecret: readRequiredEnv("WOOCOMMERCE_CONSUMER_SECRET"),
  })
  const database = new DatabaseSync(resolve(options.databasePath), { readOnly: true })
  try {
    const report = buildProductGroupPlanReport(database, catalog)
    await writeProductGroupPlanFiles(report)
    console.log(
      JSON.stringify(
        {
          supplierOptionCount: report.supplierOptionCount,
          productGroupCount: report.productGroups.length,
          optionCandidateCount: report.productOptions.length,
          updateGroupCount: report.wooUpdatePlans.length,
          createGroupCount: report.wooCreatePlans.length,
          exactComparedOptionCount: report.exactComparedOptionCount,
          reviewNeededGroupCount: report.productGroups.filter(
            (row) => row.recommended_action === "review_needed",
          ).length,
        },
        null,
        2,
      ),
    )
  } finally {
    database.close()
  }
}

function parseArguments(args: readonly string[]): Options {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error(`Invalid product group plan argument: ${key ?? "unknown"}`)
    }
    values.set(key, value)
  }
  return OptionsSchema.parse({ databasePath: values.get("--db") ?? "data/wholesalehub.sqlite" })
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`)
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
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return
    throw error
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
