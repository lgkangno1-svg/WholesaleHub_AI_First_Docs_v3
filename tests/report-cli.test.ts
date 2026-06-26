import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { applySchema } from "../src/database/apply-schema.js"
import { inspectWooCommercePayloadSafety } from "../src/reports/payload-safety.js"
import {
  buildCompareReport,
  buildMappingReport,
  buildRawProductsReport,
  buildWooCommerceDryRunReport,
} from "../src/reports/report-data.js"

describe("operator reports", () => {
  it("summarizes raw, mapping, compare, and supplier-safe WooCommerce dry-run data", () => {
    // Given
    const database = new DatabaseSync(":memory:")
    applySchema(database, SCHEMA)
    seedReportData(database)

    // When
    const rawReport = buildRawProductsReport(database)
    const mappingReport = buildMappingReport(database)
    const compareReport = buildCompareReport(database)
    const wooReport = buildWooCommerceDryRunReport(database, 1500)

    // Then
    expect(rawReport).toMatchObject({
      totalRawProducts: 1,
      skippedRowsByReason: null,
    })
    expect(mappingReport).toMatchObject({
      totalMappings: 1,
      byStatus: { approved: 1, pending: 0, failed: 0 },
    })
    expect(compareReport).toMatchObject({ totalCompareProducts: 1 })
    expect(wooReport).toMatchObject({
      matchedProducts: 0,
      pendingProducts: 0,
      disabledProducts: 0,
      missingMappingProducts: 1,
      skippedProducts: 1,
      payloadSafety: { safe: true, forbiddenFieldHits: [] },
    })
    expect(JSON.stringify(wooReport)).not.toMatch(
      /supplier_id|supplier_name|source_url|raw_cost|forwardFilled|cheapest_supplier_id/,
    )
    expect(JSON.stringify((wooReport as { updatePayloads: unknown }).updatePayloads)).not.toMatch(
      /compare_key|normalized_name|option_key/,
    )
    database.close()
  })
})

describe("inspectWooCommercePayloadSafety", () => {
  it("finds forbidden fields recursively", () => {
    // Given
    const payload = { meta: { supplier_id: "dailyfood" }, forwardFilled: true }

    // When
    const safety = inspectWooCommercePayloadSafety(payload)

    // Then
    expect(safety.safe).toBe(false)
    expect(safety.forbiddenFieldHits).toEqual(["$.meta.supplier_id", "$.forwardFilled"])
  })
})

const SCHEMA = `
CREATE TABLE suppliers (
  supplier_id TEXT PRIMARY KEY,
  supplier_name TEXT,
  enabled INTEGER
);
CREATE TABLE raw_products (
  id INTEGER PRIMARY KEY,
  supplier_id TEXT,
  source_type TEXT,
  original_product_name TEXT,
  original_option_name TEXT,
  price INTEGER,
  shipping_fee INTEGER,
  stock_status TEXT,
  product_url TEXT,
  collected_at TEXT,
  raw_json TEXT
);
CREATE TABLE product_mapping (
  id INTEGER PRIMARY KEY,
  mapping_key TEXT,
  original_product_name TEXT,
  original_option_name TEXT,
  normalized_name TEXT,
  option_key TEXT,
  confidence REAL,
  status TEXT,
  parser_model TEXT,
  created_at TEXT
);
CREATE TABLE compare_products (
  id INTEGER PRIMARY KEY,
  compare_key TEXT,
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
  compare_key TEXT,
  normalized_name TEXT,
  option_key TEXT,
  woocommerce_product_id INTEGER,
  woocommerce_variation_id INTEGER,
  status TEXT,
  admin_note TEXT,
  created_at TEXT,
  updated_at TEXT
);
`

function seedReportData(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO suppliers (supplier_id, supplier_name, enabled)
    VALUES ('dailyfood', '데일리푸드', 1);
    INSERT INTO raw_products (
      id, supplier_id, source_type, original_product_name, original_option_name,
      price, shipping_fee, stock_status, product_url, collected_at, raw_json
    ) VALUES (
      1, 'dailyfood', 'google_sheet', '미백찰옥수수', '10개입',
      10000, 0, 'in_stock', NULL, CURRENT_TIMESTAMP, '{"forwardFilled":true}'
    );
    INSERT INTO product_mapping (
      id, mapping_key, original_product_name, original_option_name, normalized_name,
      option_key, confidence, status, parser_model, created_at
    ) VALUES (
      1, 'mapping-1', '미백찰옥수수', '10개입', '미백찰옥수수',
      '국내산|특품|10개입', 0.95, 'approved', 'test-parser', CURRENT_TIMESTAMP
    );
    INSERT INTO compare_products (
      id, compare_key, normalized_name, option_key, cheapest_supplier_id,
      cheapest_raw_product_id, cheapest_price, cheapest_unit_price,
      stock_status, product_url, calculated_at
    ) VALUES (
      1, 'compare-1', '미백찰옥수수', '국내산|특품|10개입', 'dailyfood',
      1, 10000, 1000, 'in_stock', NULL, CURRENT_TIMESTAMP
    );
  `)
}
