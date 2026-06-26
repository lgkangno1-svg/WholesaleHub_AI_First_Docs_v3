import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { applySchema } from "../database/apply-schema.js"
import {
  approveWooCommerceMapping,
  countWooCommerceMappingsByStatus,
  disableWooCommerceMapping,
  listWooCommerceMappings,
  seedPendingWooCommerceMappings,
} from "./product-mapping.js"

const CommandSchema = z.enum(["list", "seed-pending", "approve", "disable"])

const OptionsSchema = z.object({
  command: CommandSchema,
  databasePath: z.string().min(1),
  compareKey: z.string().min(1).nullable(),
  productId: z.number().int().positive().nullable(),
  variationId: z.number().int().positive().nullable(),
})

type Options = z.infer<typeof OptionsSchema>

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const database = new DatabaseSync(resolve(options.databasePath))
  try {
    applySchema(database, readFileSync("sql/schema.sql", "utf8"))
    const result = runCommand(database, options)
    console.log(JSON.stringify(result, null, 2))
  } finally {
    database.close()
  }
}

function runCommand(database: DatabaseSync, options: Options): unknown {
  switch (options.command) {
    case "list": {
      const mappings = listWooCommerceMappings(database)
      return {
        total: mappings.length,
        byStatus: countWooCommerceMappingsByStatus(database),
        samples: mappings.slice(0, 20),
      }
    }
    case "seed-pending":
      return {
        ...seedPendingWooCommerceMappings(database),
        byStatus: countWooCommerceMappingsByStatus(database),
      }
    case "approve":
      if (options.compareKey === null || options.productId === null) {
        throw new Error("approve requires --compare-key and --product-id")
      }
      return approveWooCommerceMapping(
        database,
        options.compareKey,
        options.productId,
        options.variationId,
      )
    case "disable":
      if (options.compareKey === null) {
        throw new Error("disable requires --compare-key")
      }
      return disableWooCommerceMapping(database, options.compareKey)
  }
}

function parseArguments(args: readonly string[]): Options {
  const command = CommandSchema.parse(args[0])
  const values = new Map<string, string>()
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error(`Invalid mapping argument: ${key ?? "unknown"}`)
    }
    values.set(key, value)
  }
  return OptionsSchema.parse({
    command,
    databasePath: values.get("--db") ?? "data/wholesalehub.sqlite",
    compareKey: values.get("--compare-key") ?? null,
    productId: parseOptionalPositiveInteger(values.get("--product-id")),
    variationId: parseOptionalPositiveInteger(values.get("--variation-id")),
  })
}

function parseOptionalPositiveInteger(value: string | undefined): number | null {
  if (value === undefined) {
    return null
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`Expected a positive integer, received: ${value}`)
  }
  return Number(value)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
