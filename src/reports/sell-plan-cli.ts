import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { buildSellPlanReport } from "./sell-plan.js"
import { writeSellPlanFiles } from "./sell-plan-files.js"

const OptionsSchema = z.object({
  databasePath: z.string().min(1),
  jsonPath: z.string().min(1),
  csvPath: z.string().min(1),
})

type Options = z.infer<typeof OptionsSchema>

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const database = new DatabaseSync(resolve(options.databasePath), { readOnly: true })
  try {
    const report = buildSellPlanReport(database)
    await writeSellPlanFiles(report, options.jsonPath, options.csvPath)
    console.log(
      JSON.stringify(
        {
          jsonPath: options.jsonPath,
          csvPath: options.csvPath,
          totalCandidates: report.totalCandidates,
          comparedCandidateCount: report.comparedCandidateCount,
          singleSupplierCandidateCount: report.singleSupplierCandidateCount,
          selectedSupplierCounts: report.selectedSupplierCounts,
          mappingStatusCounts: report.mappingStatusCounts,
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
      throw new Error(`Invalid sell-plan argument: ${key ?? "unknown"}`)
    }
    values.set(key, value)
  }
  return OptionsSchema.parse({
    databasePath: values.get("--db") ?? "data/wholesalehub.sqlite",
    jsonPath: values.get("--json") ?? "reports/sell-plan.json",
    csvPath: values.get("--csv") ?? "reports/sell-plan.csv",
  })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
