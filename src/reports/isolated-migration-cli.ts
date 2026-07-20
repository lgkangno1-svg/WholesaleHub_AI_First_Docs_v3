import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

async function main(): Promise<void> {
  const database = new DatabaseSync(resolve(requiredArgument("--db")))
  try {
    database.exec("PRAGMA foreign_keys = ON")
    database.exec("PRAGMA busy_timeout = 5000")
    if (
      database
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='supplier_collection_runs'",
        )
        .get() !== undefined
    ) {
      console.log(JSON.stringify({ migrationApplied: false, reason: "already_applied" }))
      return
    }
    const sql = await readFile(
      resolve(argument("--migration") ?? "migrations/003_daily_pipeline_and_order_snapshot.sql"),
      "utf8",
    )
    database.exec("BEGIN IMMEDIATE")
    try {
      database.exec(sql)
      database.exec("COMMIT")
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    }
    console.log(JSON.stringify({ migrationApplied: true }))
  } finally {
    database.close()
  }
}

function argument(key: string): string | null {
  const index = process.argv.indexOf(key)
  return index < 0 ? null : (process.argv[index + 1] ?? null)
}

function requiredArgument(key: string): string {
  const value = argument(key)
  if (value === null) throw new Error(`${key} is required`)
  return value
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

