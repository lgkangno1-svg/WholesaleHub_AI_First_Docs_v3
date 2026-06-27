import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { writeOverlapReviewReport } from "./overlap-review.js"

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
    const report = await writeOverlapReviewReport(database, options.jsonPath, options.csvPath)
    console.log(
      JSON.stringify(
        {
          jsonPath: options.jsonPath,
          csvPath: options.csvPath,
          highSourceCandidates: report.highSourceCandidates,
          reviewCandidateCount: report.reviewCandidateCount,
          strictMatchCount: report.strictMatchCount,
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
      throw new Error(`Invalid overlap review argument: ${key ?? "unknown"}`)
    }
    values.set(key, value)
  }
  return OptionsSchema.parse({
    databasePath: values.get("--db") ?? "data/wholesalehub.sqlite",
    jsonPath: values.get("--json") ?? "reports/overlap-review.json",
    csvPath: values.get("--csv") ?? "reports/overlap-review.csv",
  })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
