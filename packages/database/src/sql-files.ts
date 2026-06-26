import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"

export type SqlFileOptions = {
  readonly schemaPath?: string
  readonly supplierSeedPath?: string
}

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

export class SqlApplicationError extends Error {
  readonly name = "SqlApplicationError"

  constructor(
    readonly sqlPath: string,
    options?: ErrorOptions,
  ) {
    super(`Failed to apply SQL file: ${sqlPath}`, options)
  }
}

export async function applySchema(
  database: DatabaseSync,
  schemaPath = resolve(REPOSITORY_ROOT, "sql/schema.sql"),
): Promise<void> {
  await applySqlFile(database, schemaPath)
}

export async function applySupplierSeed(
  database: DatabaseSync,
  seedPath = resolve(REPOSITORY_ROOT, "sql/seed_suppliers.sql"),
): Promise<void> {
  await applySqlFile(database, seedPath)
}

async function applySqlFile(database: DatabaseSync, sqlPath: string): Promise<void> {
  try {
    database.exec(await readFile(sqlPath, "utf8"))
  } catch (error) {
    throw new SqlApplicationError(sqlPath, { cause: error })
  }
}
