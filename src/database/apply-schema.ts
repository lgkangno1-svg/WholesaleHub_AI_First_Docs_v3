import type { DatabaseSync } from "node:sqlite"

export function applySchema(database: DatabaseSync, schema: string): void {
  database.exec(schema)
}
