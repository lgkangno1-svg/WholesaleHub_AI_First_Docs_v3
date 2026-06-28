import { readFile } from "node:fs/promises"
import { z } from "zod"
import { fetchWooCommerceCatalog } from "../woocommerce/catalog.js"
import { executeWooProductSyncSafeCatalogChanges } from "./woocommerce-product-sync-execute.js"
import {
  buildWooProductSyncPlan,
  readProductPlans,
  summarizeWooProductSyncPlan,
} from "./woocommerce-product-sync-plan.js"
import { writeWooProductSyncPlanFiles } from "./woocommerce-product-sync-plan-files.js"

const OptionsSchema = z.object({
  mode: z.enum(["update-existing", "create-new", "all"]),
  groupPath: z.string(),
  optionPath: z.string(),
  execute: z.boolean(),
  limit: z.number().int().positive().nullable(),
  confirm: z.string(),
})
type Options = z.infer<typeof OptionsSchema>

async function main(): Promise<void> {
  await loadDotEnv()
  const options = parseArguments(process.argv.slice(2))
  enforceExecutionGuards(options)
  const credentials = {
    baseUrl: readRequiredEnv("WOOCOMMERCE_BASE_URL"),
    consumerKey: readRequiredEnv("WOOCOMMERCE_CONSUMER_KEY"),
    consumerSecret: readRequiredEnv("WOOCOMMERCE_CONSUMER_SECRET"),
  }
  const catalog = await fetchWooCommerceCatalog(credentials)
  const plans = await readProductPlans(options.groupPath, options.optionPath)
  const rows = buildWooProductSyncPlan(plans.groups, plans.options, catalog, options.mode)
  const summary = summarizeWooProductSyncPlan(rows)
  await writeWooProductSyncPlanFiles(rows, summary)
  const executeLog = options.execute
    ? await executeWooProductSyncSafeCatalogChanges(rows, {
        ...credentials,
        limit: options.limit ?? 0,
        outputPath: "reports/woocommerce-sync-execute-log.json",
      })
    : null
  console.log(
    JSON.stringify(
      {
        ...summary,
        execute: options.execute,
        changed: executeLog === null ? false : executeLog.updatedCount > 0,
        executeLog:
          executeLog === null
            ? null
            : {
                attemptedCount: executeLog.attemptedCount,
                updatedCount: executeLog.updatedCount,
                createdCount: executeLog.createdCount,
                productCreatedCount: executeLog.productCreatedCount,
                noOpCount: executeLog.noOpCount,
                failedCount: executeLog.failedCount,
                outputPath: "reports/woocommerce-sync-execute-log.json",
              },
      },
      null,
      2,
    ),
  )
}

function enforceExecutionGuards(options: Options): void {
  if (!options.execute) return
  if (options.mode !== "update-existing" && options.mode !== "all")
    throw new Error("--execute requires --mode update-existing or --mode all")
  if (options.limit === null) throw new Error("--execute requires --limit")
  if (options.confirm !== "SYNC_WOOCOMMERCE_PRODUCTS") {
    throw new Error('--execute requires --confirm "SYNC_WOOCOMMERCE_PRODUCTS"')
  }
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
      throw new Error(`Invalid sync plan argument: ${key ?? "unknown"}`)
    }
    values.set(key, value)
    index += 1
  }
  return OptionsSchema.parse({
    mode: values.get("--mode") ?? "all",
    groupPath: values.get("--groups") ?? "reports/product-group-plan.json",
    optionPath: values.get("--options") ?? "reports/product-option-plan.json",
    execute: values.get("--execute") === "true",
    limit: values.has("--limit") ? Number(values.get("--limit")) : null,
    confirm: values.get("--confirm") ?? "",
  })
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`)
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
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return
    throw error
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
