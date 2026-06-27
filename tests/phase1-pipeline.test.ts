import { readFile } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { parseWalldob2bDetailHtml } from "../src/adapters/walldob2b/walldob2b-adapter.js"
import {
  runCollectedProductsPipeline,
  runPhase1Pipeline,
} from "../src/application/phase1-pipeline.js"
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

  it("stores a walldob2b sample product in the shared comparison pipeline", async () => {
    // Given
    const database = new DatabaseSync(":memory:")
    applySchema(database, await readFile("sql/schema.sql", "utf8"))
    const html = await readFile("tests/fixtures/walldob2b-JW000038.html", "utf8")
    const products = parseWalldob2bDetailHtml(html, {
      wooProductId: 1158,
      productName: "태국 항공직송 생 망고스틴",
      itId: "JW000038",
      sourceUrl: "https://walldob2b.com/shop/item.php?it_id=JW000038",
    }).filter((product) => product.originalOptionName === "망고스틴5kg(500g*10망)")

    // When
    const result = await runCollectedProductsPipeline({
      database,
      config: {
        supplierId: "walldob2b",
        supplierName: "walldob2b",
        sourceType: "website",
        enabled: true,
        googleSheet: {
          spreadsheetId: "JW000038",
          gid: "JW000038",
          sheetUrl: "https://walldob2b.com/shop/item.php?it_id=JW000038",
          csvExportUrl: "https://walldob2b.com/shop/item.php?it_id=JW000038",
          accessMode: "csv_export_or_google_oauth",
        },
        schedule: { timezone: "Asia/Seoul", cron: "manual" },
        columnMapping: {
          productNameColumn: "상품명",
          optionColumn: "옵션",
          priceColumn: "가격",
          stockColumn: null,
          memoColumn: "메모",
        },
        collection: {
          playwrightEnabled: false,
          autoOrderEnabled: false,
          dataRetention: "latest_only",
        },
      },
      products,
      parser: new RuleBasedProductParser(),
    })
    const normalized = database
      .prepare(
        "SELECT normalized_name, option_key, price FROM normalized_products WHERE supplier_id = ?",
      )
      .get("walldob2b")
    const compare = database
      .prepare(
        "SELECT cheapest_supplier_id, cheapest_price FROM compare_products WHERE cheapest_supplier_id = ?",
      )
      .get("walldob2b")

    // Then
    expect(result.rawProductCount).toBe(1)
    expect(normalized).toMatchObject({
      normalized_name: "망고스틴",
      option_key: "원산지미상|등급미상|10망|5kg",
      price: 46_000,
    })
    expect(compare).toMatchObject({ cheapest_supplier_id: "walldob2b", cheapest_price: 46_000 })
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
