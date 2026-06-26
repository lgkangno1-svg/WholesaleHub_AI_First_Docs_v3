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
  skippedRowsByReason: z.object({
    empty_product_name_without_context: z.number().int(),
    missing_price: z.number().int(),
    invalid_price: z.number().int(),
    empty_row: z.number().int(),
    etc: z.number().int(),
  }),
  dryRunPayloads: z.array(
    z.object({
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
    expect(output.rawProductCount).toBe(4)
    expect(output.compareProductCount).toBe(4)
    expect(output.skippedRowsByReason).toMatchObject({
      invalid_price: 1,
      empty_row: 1,
    })
    expect(
      output.dryRunPayloads
        .map((payload) => Number(payload.regular_price))
        .sort((left, right) => left - right),
    ).toEqual([7500, 9300, 11600, 18300])
    expect(JSON.stringify(output)).not.toContain("supplier")
    expect(JSON.stringify(output)).not.toContain("forwardFilled")

    const database = new DatabaseSync(databasePath, { readOnly: true })
    const count = database.prepare("SELECT COUNT(*) AS count FROM raw_products").get()
    database.close()
    expect(z.object({ count: z.number() }).parse(count).count).toBe(4)
    expect(await readFile(databasePath)).not.toHaveLength(0)
  })

  it("runs through the documented npm phase1 script", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "wholesalehub-npm-"))
    const databasePath = join(directory, "phase1.sqlite")
    const npmCliPath = z.string().min(1).parse(process.env["npm_execpath"])
    const commandArguments = [
      npmCliPath,
      "run",
      "phase1",
      "--",
      "--csv",
      "tests/fixtures/dailyfood.csv",
      "--db",
      databasePath,
      "--margin",
      "1500",
    ]

    // When
    const execution = spawnSync(process.execPath, commandArguments, { encoding: "utf8" })

    // Then
    expect(execution.status).toBe(0)
    expect(execution.stderr).not.toContain("MODULE_NOT_FOUND")
    expect(execution.stdout).toContain('"mode": "woocommerce-dry-run"')
  }, 45_000)
})
