import { z } from "zod"
import { buildPriceChangeReviewReport, readPriceChangeInputs } from "./price-change-review.js"
import { writePriceChangeReviewFiles } from "./price-change-review-files.js"

const OptionsSchema = z.object({
  dryRunPath: z.string(),
  matchPath: z.string(),
  jsonPath: z.string(),
  csvPath: z.string(),
})

type Options = z.infer<typeof OptionsSchema>

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const input = await readPriceChangeInputs(options.dryRunPath, options.matchPath)
  const report = buildPriceChangeReviewReport(input.payloads, input.matches)
  await writePriceChangeReviewFiles(report, options.jsonPath, options.csvPath)
  console.log(
    JSON.stringify(
      {
        totalPayloads: report.totalPayloads,
        safetyCounts: report.safetyCounts,
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
      throw new Error(`Invalid price review argument: ${key ?? "unknown"}`)
    }
    values.set(key, value)
  }
  return OptionsSchema.parse({
    dryRunPath: values.get("--dry-run") ?? "reports/woocommerce-dry-run.json",
    matchPath: values.get("--match") ?? "reports/woocommerce-match-candidates.json",
    jsonPath: values.get("--json") ?? "reports/price-change-review.json",
    csvPath: values.get("--csv") ?? "reports/price-change-review.csv",
  })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
