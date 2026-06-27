import { z } from "zod"
import { buildUpdateCandidateAuditReport } from "./update-candidate-audit.js"
import { writeUpdateCandidateAuditFiles } from "./update-candidate-audit-files.js"
import { readUpdateAuditInputs } from "./update-candidate-audit-inputs.js"

const OptionsSchema = z.object({
  reviewPath: z.string(),
  sellPath: z.string(),
  matchPath: z.string(),
  liveLogPath: z.string(),
  jsonPath: z.string(),
  csvPath: z.string(),
})

type Options = z.infer<typeof OptionsSchema>

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const input = await readUpdateAuditInputs(
    options.reviewPath,
    options.sellPath,
    options.matchPath,
    options.liveLogPath,
  )
  const report = buildUpdateCandidateAuditReport(
    input.reviewRows,
    input.sellRows,
    input.matchRows,
    input.updatedKeys,
  )
  await writeUpdateCandidateAuditFiles(report, options.jsonPath, options.csvPath)
  console.log(
    JSON.stringify(
      {
        safeCount: report.safeCount,
        classCounts: report.classCounts,
        jsonPath: options.jsonPath,
        csvPath: options.csvPath,
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
      throw new Error(`Invalid update audit argument: ${key ?? "unknown"}`)
    }
    values.set(key, value)
  }
  return OptionsSchema.parse({
    reviewPath: values.get("--review") ?? "reports/price-change-review.json",
    sellPath: values.get("--sell-plan") ?? "reports/sell-plan.json",
    matchPath: values.get("--match") ?? "reports/woocommerce-match-candidates.json",
    liveLogPath: values.get("--live-log") ?? "reports/woocommerce-live-update-log.json",
    jsonPath: values.get("--json") ?? "reports/update-candidate-audit.json",
    csvPath: values.get("--csv") ?? "reports/update-candidate-audit.csv",
  })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
