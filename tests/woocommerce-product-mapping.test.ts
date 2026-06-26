import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { applySchema } from "../src/database/apply-schema.js"
import { buildWooCommerceDryRunReport } from "../src/reports/report-data.js"
import {
  approveWooCommerceMapping,
  disableWooCommerceMapping,
  listWooCommerceMappings,
  seedPendingWooCommerceMappings,
} from "../src/woocommerce/product-mapping.js"

describe("WooCommerce product mapping", () => {
  it("seeds pending mappings without overwriting existing mappings", () => {
    // Given
    const database = createDatabase()

    // When
    const firstSeed = seedPendingWooCommerceMappings(database)
    const secondSeed = seedPendingWooCommerceMappings(database)

    // Then
    expect(firstSeed).toEqual({ inserted: 3, existing: 0 })
    expect(secondSeed).toEqual({ inserted: 0, existing: 3 })
    expect(listWooCommerceMappings(database).map((mapping) => mapping.status)).toEqual([
      "pending",
      "pending",
      "pending",
    ])
    database.close()
  })

  it("approves and disables mappings by compare key", () => {
    // Given
    const database = createDatabase()
    seedPendingWooCommerceMappings(database)

    // When
    const approved = approveWooCommerceMapping(database, "approved-key", 123, 456)
    const disabled = disableWooCommerceMapping(database, "disabled-key")

    // Then
    expect(approved).toMatchObject({
      compare_key: "approved-key",
      woocommerce_product_id: 123,
      woocommerce_variation_id: 456,
      status: "approved",
    })
    expect(disabled).toMatchObject({
      compare_key: "disabled-key",
      status: "disabled",
    })
    database.close()
  })

  it("builds dry-run update payloads only for approved mappings", () => {
    // Given
    const database = createDatabase()
    seedPendingWooCommerceMappings(database)
    approveWooCommerceMapping(database, "approved-key", 123, null)
    disableWooCommerceMapping(database, "disabled-key")
    database
      .prepare("DELETE FROM woocommerce_product_mapping WHERE compare_key = ?")
      .run("missing-key")

    // When
    const report = buildWooCommerceDryRunReport(database, 1500)

    // Then
    expect(report).toMatchObject({
      matchedProducts: 1,
      pendingProducts: 0,
      disabledProducts: 1,
      missingMappingProducts: 1,
      skippedProducts: 2,
      payloadSafety: { safe: true, forbiddenFieldHits: [] },
      updatePayloads: [
        {
          product_id: 123,
          regular_price: "11500",
          stock_status: "instock",
          manage_stock: false,
        },
      ],
    })
    expect(JSON.stringify(report)).not.toMatch(
      /supplier_id|supplier_name|source_url|raw_cost|forwardFilled|cheapest_supplier_id/,
    )
    expect(JSON.stringify((report as { updatePayloads: unknown }).updatePayloads)).not.toMatch(
      /compare_key|normalized_name|option_key/,
    )
    database.close()
  })
})

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:")
  applySchema(database, SCHEMA)
  database.exec(`
    INSERT INTO suppliers (supplier_id, supplier_name, enabled)
    VALUES ('dailyfood', 'DailyFood', 1);

    INSERT INTO compare_products (
      compare_key, normalized_name, option_key, cheapest_supplier_id,
      cheapest_raw_product_id, cheapest_price, cheapest_unit_price,
      stock_status, product_url, calculated_at
    ) VALUES
      ('approved-key', 'corn', '10ea', 'dailyfood', 1, 10000, 1000, 'in_stock', NULL, CURRENT_TIMESTAMP),
      ('disabled-key', 'corn', '20ea', 'dailyfood', 2, 20000, 1000, 'in_stock', NULL, CURRENT_TIMESTAMP),
      ('missing-key', 'corn', '30ea', 'dailyfood', 3, 30000, 1000, 'out_of_stock', NULL, CURRENT_TIMESTAMP);
  `)
  return database
}

const SCHEMA = `
CREATE TABLE suppliers (
  supplier_id TEXT PRIMARY KEY,
  supplier_name TEXT,
  enabled INTEGER
);
CREATE TABLE compare_products (
  id INTEGER PRIMARY KEY,
  compare_key TEXT UNIQUE,
  normalized_name TEXT,
  option_key TEXT,
  cheapest_supplier_id TEXT,
  cheapest_raw_product_id INTEGER,
  cheapest_price INTEGER,
  cheapest_unit_price REAL,
  stock_status TEXT,
  product_url TEXT,
  calculated_at TEXT
);
CREATE TABLE woocommerce_product_mapping (
  id INTEGER PRIMARY KEY,
  compare_key TEXT UNIQUE,
  normalized_name TEXT,
  option_key TEXT,
  woocommerce_product_id INTEGER,
  woocommerce_variation_id INTEGER,
  status TEXT,
  admin_note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`
