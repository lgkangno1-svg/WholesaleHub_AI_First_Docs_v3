import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"
import { buildMvpPriceChangeTelegramReport } from "./mvp-price-change-telegram.js"

const PlanSchema = z.object({
  rows: z.array(
    z.object({
      product_id: z.number().int().nullable(),
      variation_id: z.number().int().nullable(),
      woocommerce_product_name: z.string(),
      woocommerce_option_name: z.string(),
    }),
  ),
})
const ExecuteLogSchema = z.object({
  requestedAt: z.string(),
  entries: z.array(
    z.object({
      product_id: z.number().int(),
      variation_id: z.number().int(),
      action: z.string(),
      before_price: z.string(),
      after_price: z.string().nullable(),
      expected_price: z.string(),
      status: z.string(),
    }),
  ),
})

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const plan = PlanSchema.parse(JSON.parse(await readFile(options.planPath, "utf8")))
  const log = ExecuteLogSchema.parse(JSON.parse(await readFile(options.logPath, "utf8")))
  const report = buildMvpPriceChangeTelegramReport({
    requestedAt: log.requestedAt,
    planRows: plan.rows,
    entries: log.entries,
  })
  await mkdir(dirname(options.outputPath), { recursive: true })
  await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  console.log(
    JSON.stringify({
      reportPath: options.outputPath,
      productCount: report.product_count,
      changeCount: report.change_count,
    }),
  )
}

function parseArgs(args: readonly string[]): {
  readonly planPath: string
  readonly logPath: string
  readonly outputPath: string
} {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--"))
      throw new Error(`invalid argument: ${key ?? "unknown"}`)
    values.set(key, value)
  }
  return {
    planPath: values.get("--plan") ?? "reports/mvp-sync-plan.json",
    logPath: values.get("--log") ?? "reports/mvp-sync-execute-log.json",
    outputPath: values.get("--out") ?? "reports/mvp-price-change-telegram-report.json",
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
