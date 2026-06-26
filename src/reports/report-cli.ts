import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import {
  buildCompareReport,
  buildMappingReport,
  buildRawProductsReport,
  buildWooCommerceDryRunReport,
} from "./report-data.js"

const ReportKindSchema = z.enum(["raw", "mapping", "compare", "woocommerce-dry-run"])

const ReportOptionsSchema = z.object({
  kind: ReportKindSchema,
  databasePath: z.string().min(1),
  outputPath: z.string().min(1),
  marginAmount: z.number().int().nonnegative(),
})

type ReportOptions = z.infer<typeof ReportOptionsSchema>

const DEFAULT_OUTPUTS = {
  raw: "reports/raw-products.json",
  mapping: "reports/mapping-summary.json",
  compare: "reports/compare-products.json",
  "woocommerce-dry-run": "reports/woocommerce-dry-run.json",
} as const

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const database = new DatabaseSync(resolve(options.databasePath), { readOnly: true })
  try {
    const report = buildReport(database, options)
    const outputPath = resolve(options.outputPath)
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
    console.log(
      JSON.stringify(
        {
          report: options.kind,
          outputPath,
          summary: summarizeReport(report),
        },
        null,
        2,
      ),
    )
  } finally {
    database.close()
  }
}

function buildReport(database: DatabaseSync, options: ReportOptions): unknown {
  switch (options.kind) {
    case "raw":
      return buildRawProductsReport(database)
    case "mapping":
      return buildMappingReport(database)
    case "compare":
      return buildCompareReport(database)
    case "woocommerce-dry-run":
      return buildWooCommerceDryRunReport(database, options.marginAmount)
  }
}

function parseArguments(args: readonly string[]): ReportOptions {
  const kind = ReportKindSchema.parse(args[0])
  const values = new Map<string, string>()
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error(`Invalid report argument: ${key ?? "unknown"}`)
    }
    values.set(key, value)
  }
  return ReportOptionsSchema.parse({
    kind,
    databasePath: values.get("--db") ?? "data/wholesalehub.sqlite",
    outputPath: values.get("--out") ?? DEFAULT_OUTPUTS[kind],
    marginAmount: Number(values.get("--margin") ?? "0"),
  })
}

function summarizeReport(report: unknown): unknown {
  const value = z.record(z.string(), z.unknown()).parse(report)
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => typeof item !== "object" || item === null),
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
