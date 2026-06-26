import { readFile } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { runPhase1Pipeline } from "../src/application/phase1-pipeline.js"
import { loadSupplierConfig } from "../src/config/supplier-config-loader.js"
import { applySchema } from "../src/database/apply-schema.js"
import { RuleBasedProductParser } from "../src/normalization/rule-based-parser.js"

describe("runPhase1Pipeline", () => {
  it("stores, normalizes, compares, and creates supplier-safe dry-run payloads", async () => {
    // Given
    const database = new DatabaseSync(":memory:")
    applySchema(database, await readFile("sql/schema.sql", "utf8"))
    const config = await loadSupplierConfig("config/suppliers/dailyfood.google_sheet.yml")
    const csv = await readFile("tests/fixtures/dailyfood.csv", "utf8")

    // When
    const result = await runPhase1Pipeline({
      database,
      config,
      csv,
      parser: new RuleBasedProductParser(),
    })

    // Then
    expect(result.rawProductCount).toBe(4)
    expect(result.normalizedProductCount).toBe(4)
    expect(result.compareProductCount).toBe(4)
    expect(result.skippedRowsByReason).toMatchObject({
      invalid_price: 1,
      empty_row: 1,
    })
    expect(result.dryRunPayloads[0]).not.toHaveProperty("supplierId")
    expect(result.dryRunPayloads[0]).not.toHaveProperty("rawCost")
    expect(result.dryRunPayloads[0]).not.toHaveProperty("forwardFilled")
  })

  it("reuses product_mapping without invoking the parser again", async () => {
    // Given
    const database = new DatabaseSync(":memory:")
    applySchema(database, await readFile("sql/schema.sql", "utf8"))
    const config = await loadSupplierConfig("config/suppliers/dailyfood.google_sheet.yml")
    const csv = await readFile("tests/fixtures/dailyfood.csv", "utf8")
    const parser = new RuleBasedProductParser()
    await runPhase1Pipeline({ database, config, csv, parser })

    // When
    const secondRun = await runPhase1Pipeline({ database, config, csv, parser })

    // Then
    expect(secondRun.mappingCacheHits).toBe(4)
    expect(secondRun.parserCalls).toBe(0)
  })
})
