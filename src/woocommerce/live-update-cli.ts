import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { z } from "zod"
import { parseReviewRows, runWooCommerceLiveUpdate } from "./live-update.js"

const OptionsSchema = z.object({
  reviewPath: z.string().min(1),
  outputPath: z.string().min(1),
  execute: z.boolean(),
  limit: z.number().int().positive().nullable(),
  confirm: z.string().nullable(),
})

type Options = z.infer<typeof OptionsSchema>

async function main(): Promise<void> {
  await loadDotEnv()
  const options = parseArguments(process.argv.slice(2))
  const review = JSON.parse(await readFile(options.reviewPath, "utf8"))
  const log = await runWooCommerceLiveUpdate(parseReviewRows(review), {
    baseUrl: readRequiredEnv("WOOCOMMERCE_BASE_URL"),
    consumerKey: readRequiredEnv("WOOCOMMERCE_CONSUMER_KEY"),
    consumerSecret: readRequiredEnv("WOOCOMMERCE_CONSUMER_SECRET"),
    execute: options.execute,
    limit: options.limit,
    confirm: options.confirm,
  })
  const outputPath = resolve(options.outputPath)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(log, null, 2)}\n`, "utf8")
  console.log(
    JSON.stringify(
      {
        mode: log.mode,
        selectedCount: log.selectedCount,
        blockedCount: log.blockedCount,
        outputPath,
      },
      null,
      2,
    ),
  )
}

function parseArguments(args: readonly string[]): Options {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    if (key === "--execute") {
      values.set(key, "true")
      continue
    }
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error(`Invalid live update argument: ${key ?? "unknown"}`)
    }
    values.set(key, value)
    index += 1
  }
  return OptionsSchema.parse({
    reviewPath: values.get("--review") ?? "reports/price-change-review.json",
    outputPath: values.get("--out") ?? "reports/woocommerce-live-update-log.json",
    execute: values.get("--execute") === "true",
    limit: values.has("--limit") ? Number(values.get("--limit")) : null,
    confirm: values.get("--confirm") ?? null,
  })
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`)
  }
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
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return
    }
    throw error
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
