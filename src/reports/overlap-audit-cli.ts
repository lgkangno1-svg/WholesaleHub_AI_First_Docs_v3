import { z } from "zod"
import { writeOverlapAuditReport } from "./overlap-audit.js"

const OptionsSchema = z.object({
  databasePath: z.string().min(1),
  outputPath: z.string().min(1),
})

type Options = z.infer<typeof OptionsSchema>

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const report = await writeOverlapAuditReport(options.databasePath, options.outputPath)
  const summary = z
    .object({
      strictSharedCompareKeys: z.number().int(),
      looseCandidateCount: z.number().int(),
      confidenceCounts: z.record(z.string(), z.number().int()),
      dailyfoodSource: z.unknown(),
    })
    .parse(report)
  console.log(JSON.stringify({ outputPath: options.outputPath, summary }, null, 2))
}

function parseArguments(args: readonly string[]): Options {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error(`Invalid overlap audit argument: ${key ?? "unknown"}`)
    }
    values.set(key, value)
  }
  return OptionsSchema.parse({
    databasePath: values.get("--db") ?? "data/wholesalehub.sqlite",
    outputPath: values.get("--out") ?? "reports/overlap-audit.json",
  })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
