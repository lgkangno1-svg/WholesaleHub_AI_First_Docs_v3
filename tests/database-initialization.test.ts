import { spawnSync } from "node:child_process"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  applySchema,
  applySupplierSeed,
  initializeDatabase,
  resolveDatabasePath,
} from "../packages/database/src/index.js"

const CountRowSchema = z.object({ count: z.number().int() })
const InitializationOutputSchema = z.object({
  status: z.literal("initialized"),
  databasePath: z.string(),
})

describe("database initialization", () => {
  it("resolves DATABASE_URL relative to the working directory", () => {
    // Given
    const workingDirectory = join("C:", "workspace")

    // When
    const databasePath = resolveDatabasePath("data/test.sqlite", workingDirectory)

    // Then
    expect(databasePath).toBe(join(workingDirectory, "data/test.sqlite"))
  })

  it("applies schema and supplier seeds to a real SQLite file", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "wholesalehub-database-"))
    const databasePath = join(directory, "database.sqlite")
    const database = new DatabaseSync(databasePath)

    // When
    await applySchema(database)
    await applySupplierSeed(database)

    // Then
    const tableCount = CountRowSchema.parse(
      database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'").get(),
    )
    const supplierCount = CountRowSchema.parse(
      database.prepare("SELECT COUNT(*) AS count FROM suppliers").get(),
    )
    database.close()
    expect(tableCount.count).toBeGreaterThan(0)
    expect(supplierCount.count).toBe(2)
  })

  it("initializes from DATABASE_URL and remains idempotent", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "wholesalehub-initialize-"))
    const databaseUrl = join(directory, "database.sqlite")

    // When
    await initializeDatabase({ DATABASE_URL: databaseUrl })
    await initializeDatabase({ DATABASE_URL: databaseUrl })

    // Then
    const database = new DatabaseSync(databaseUrl, { readOnly: true })
    const supplierCount = CountRowSchema.parse(
      database.prepare("SELECT COUNT(*) AS count FROM suppliers").get(),
    )
    database.close()
    expect(supplierCount.count).toBe(2)
  })
})

describe("database test initialization command", () => {
  it("initializes the DATABASE_URL file through npm", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "wholesalehub-database-cli-"))
    const databasePath = join(directory, "test.sqlite")
    const npmCliPath = z.string().min(1).parse(process.env["npm_execpath"])

    // When
    const execution = spawnSync(process.execPath, [npmCliPath, "run", "db:test:init"], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: databasePath },
    })

    // Then
    expect(execution.status).toBe(0)
    const outputLine = execution.stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith('{"status":"initialized"'))
    const output = InitializationOutputSchema.parse(JSON.parse(outputLine ?? ""))
    expect(output.databasePath).toBe(databasePath)
    const database = new DatabaseSync(databasePath, { readOnly: true })
    const supplierCount = CountRowSchema.parse(
      database.prepare("SELECT COUNT(*) AS count FROM suppliers").get(),
    )
    database.close()
    expect(supplierCount.count).toBe(2)
  }, 15_000)
})
