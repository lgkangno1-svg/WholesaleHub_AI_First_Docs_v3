import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { applyExactSafeApprovedMappings, parseMatchReport } from "./approved-mapping.js"
import { writeApprovedMappingReports } from "./approved-mapping-files.js"

const OptionsSchema = z.object({
  databasePath: z.string().min(1),
  matchPath: z.string().min(1),
  jsonPath: z.string().min(1),
  csvPath: z.string().min(1),
  newProductsPath: z.string().min(1),
})

type Options = z.infer<typeof OptionsSchema>

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const matchReport = JSON.parse(await readFile(options.matchPath, "utf8"))
  const database = new DatabaseSync(resolve(options.databasePath))
  try {
    const result = applyExactSafeApprovedMappings(database, parseMatchReport(matchReport))
    await writeApprovedMappingReports(
      result,
      options.jsonPath,
      options.csvPath,
      options.newProductsPath,
    )
    console.log(
      JSON.stringify(
        {
          approved: result.approved.length,
          reviewPending: result.skipped.filter((row) => row.review_status === "review_pending")
            .length,
          newProducts: result.newProducts.length,
          jsonPath: options.jsonPath,
          csvPath: options.csvPath,
          newProductsPath: options.newProductsPath,
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
      throw new Error(`Invalid approved mapping argument: ${key ?? "unknown"}`)
    }
    values.set(key, value)
  }
  return OptionsSchema.parse({
    databasePath: values.get("--db") ?? "data/wholesalehub.sqlite",
    matchPath: values.get("--match") ?? "reports/woocommerce-match-candidates.json",
    jsonPath: values.get("--json") ?? "reports/approved-mapping-summary.json",
    csvPath: values.get("--csv") ?? "reports/approved-mapping-summary.csv",
    newProductsPath: values.get("--new-products") ?? "reports/new-product-candidates.csv",
  })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
