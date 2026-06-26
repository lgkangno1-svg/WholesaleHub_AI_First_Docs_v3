import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { applySchema } from "../database/apply-schema.js"

const OptionsSchema = z.object({
  databasePath: z.string().min(1),
  supplierId: z.string().min(1),
})

type Options = z.infer<typeof OptionsSchema>

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const database = new DatabaseSync(resolve(options.databasePath))
  try {
    applySchema(database, readFileSync("sql/schema.sql", "utf8"))
    const result = resetSupplierMappings(database, options.supplierId)
    console.log(JSON.stringify(result, null, 2))
  } finally {
    database.close()
  }
}

export function resetSupplierMappings(database: DatabaseSync, supplierId: string): unknown {
  const before = countRows(database)
  database.exec("BEGIN")
  try {
    database.prepare("DELETE FROM woocommerce_product_mapping").run()
    database.prepare("DELETE FROM compare_products").run()
    database.prepare("DELETE FROM normalized_products WHERE supplier_id = ?").run(supplierId)
    database
      .prepare(`
        DELETE FROM product_mapping
        WHERE EXISTS (
          SELECT 1
          FROM raw_products r
          WHERE r.supplier_id = ?
            AND r.original_product_name = product_mapping.original_product_name
            AND COALESCE(r.original_option_name, '') =
              COALESCE(product_mapping.original_option_name, '')
        )
      `)
      .run(supplierId)
    database.exec("COMMIT")
  } catch (error) {
    database.exec("ROLLBACK")
    throw error
  }
  return { supplierId, before, after: countRows(database) }
}

function parseArguments(args: readonly string[]): Options {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error(`Invalid reset argument: ${key ?? "unknown"}`)
    }
    values.set(key, value)
  }
  return OptionsSchema.parse({
    databasePath: values.get("--db") ?? "data/wholesalehub.sqlite",
    supplierId: values.get("--supplier-id") ?? "dailyfood",
  })
}

function countRows(database: DatabaseSync): Record<string, number> {
  return {
    product_mapping: countTable(database, "product_mapping"),
    normalized_products: countTable(database, "normalized_products"),
    compare_products: countTable(database, "compare_products"),
    woocommerce_product_mapping: countTable(database, "woocommerce_product_mapping"),
  }
}

function countTable(database: DatabaseSync, tableName: string): number {
  return z
    .object({ count: z.number().int() })
    .parse(database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get()).count
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
