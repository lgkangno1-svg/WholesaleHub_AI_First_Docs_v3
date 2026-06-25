import { spawnSync } from "node:child_process"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { z } from "zod"

const CliOutputSchema = z.object({
  mode: z.literal("woocommerce-dry-run"),
  rawProductCount: z.number().int(),
  compareProductCount: z.number().int(),
  dryRunPayloads: z.array(
    z.object({
      lookupKey: z.string(),
      name: z.string(),
      regular_price: z.string(),
      stock_status: z.enum(["instock", "outofstock"]),
      manage_stock: z.literal(false),
    }),
  ),
})

describe("Phase 1 CLI", () => {
  it("runs the fixture through SQLite and emits WooCommerce dry-run JSON", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "wholesalehub-"))
    const databasePath = join(directory, "phase1.sqlite")

    // When
    const execution = spawnSync(
      process.execPath,
      [
        "dist/cli.js",
        "phase1",
        "--csv",
        "tests/fixtures/dailyfood.csv",
        "--db",
        databasePath,
        "--margin",
        "1500",
      ],
      { encoding: "utf8" },
    )

    // Then
    expect(execution.status).toBe(0)
    const output = CliOutputSchema.parse(JSON.parse(execution.stdout))
    expect(output.rawProductCount).toBe(3)
    expect(output.compareProductCount).toBe(2)
    expect(output.dryRunPayloads.map((payload) => payload.regular_price).sort()).toEqual([
      "12500",
      "7500",
    ])
    expect(JSON.stringify(output)).not.toContain("supplier")

    const database = new DatabaseSync(databasePath, { readOnly: true })
    const count = database.prepare("SELECT COUNT(*) AS count FROM raw_products").get()
    database.close()
    expect(z.object({ count: z.number() }).parse(count).count).toBe(3)
    expect(await readFile(databasePath)).not.toHaveLength(0)
  })
})
