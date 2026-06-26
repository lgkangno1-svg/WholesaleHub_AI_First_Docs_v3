import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { readDatabaseUrl, resolveDatabasePath } from "./database-url.js"
import { applySchema, applySupplierSeed } from "./sql-files.js"

export type InitializeDatabaseOptions = {
  readonly workingDirectory?: string
  readonly schemaPath?: string
  readonly supplierSeedPath?: string
}

export type DatabaseInitializationResult = {
  readonly databasePath: string
}

export async function initializeDatabase(
  environment: NodeJS.ProcessEnv,
  options: InitializeDatabaseOptions = {},
): Promise<DatabaseInitializationResult> {
  const databasePath = resolveDatabasePath(readDatabaseUrl(environment), options.workingDirectory)
  if (databasePath !== ":memory:") {
    await mkdir(dirname(databasePath), { recursive: true })
  }
  const database = new DatabaseSync(databasePath)
  try {
    await applySchema(database, options.schemaPath)
    await applySupplierSeed(database, options.supplierSeedPath)
  } finally {
    database.close()
  }
  return { databasePath }
}
