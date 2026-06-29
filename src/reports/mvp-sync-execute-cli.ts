import { readFile } from "node:fs/promises"
import { z } from "zod"
import { executeMvpSyncPlan } from "./mvp-sync-execute.js"

const OptionsSchema = z.object({
  execute: z.boolean(),
  confirm: z.string(),
  planPath: z.string(),
  outputDir: z.string(),
})

type Options = z.infer<typeof OptionsSchema>

async function main(): Promise<void> {
  await loadDotEnv()
  const options = parseArgs(process.argv.slice(2))
  const result = await executeMvpSyncPlan({
    planPath: options.planPath,
    outputDir: options.outputDir,
    execute: options.execute,
    confirm: options.confirm,
    credentials: {
      baseUrl: readRequiredEnv("WOOCOMMERCE_BASE_URL"),
      consumerKey: readRequiredEnv("WOOCOMMERCE_CONSUMER_KEY"),
      consumerSecret: readRequiredEnv("WOOCOMMERCE_CONSUMER_SECRET"),
    },
  })
  console.log(
    JSON.stringify(
      {
        selectedCount: result.log.selectedCount,
        actionCounts: result.log.actionCounts,
        failedCount: result.log.failedCount,
        verificationSuccessCount: result.verification.successCount,
        newProductCreated: false,
        newVariationCreated: false,
        draftPublished: false,
      },
      null,
      2,
    ),
  )
}

function parseArgs(args: readonly string[]): Options {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    if (key === "--execute") {
      values.set(key, "true")
      continue
    }
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error(`invalid argument: ${key ?? "unknown"}`)
    }
    values.set(key, value)
    index += 1
  }
  return OptionsSchema.parse({
    execute: values.get("--execute") === "true",
    confirm: values.get("--confirm") ?? "",
    planPath: values.get("--plan") ?? "reports/mvp-sync-plan.json",
    outputDir: values.get("--out-dir") ?? "reports",
  })
}

function readRequiredEnv(key: string): string {
  const value = process.env[key]?.trim()
  if (value === undefined || value.length === 0) throw new Error(`${key} is required`)
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
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
