import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { applySchema } from "../src/database/apply-schema.js"
import { buildSellPlanReport } from "../src/reports/sell-plan.js"

describe("buildSellPlanReport", () => {
  it("keeps single-supplier candidates and marks approved mappings as dry-run eligible", () => {
    // Given
    const database = new DatabaseSync(":memory:")
    applySchema(database, SCHEMA)
    seedRows(database)

    // When
    const report = buildSellPlanReport(database)

    // Then
    expect(report).toMatchObject({
      totalCandidates: 2,
      comparedCandidateCount: 1,
      singleSupplierCandidateCount: 1,
      selectedSupplierCounts: { walldob2b: 1, dailyfood: 1 },
      mappingStatusCounts: {
        approved_mapping_exists: 1,
        pending_mapping_exists: 0,
        no_mapping: 1,
      },
    })
    expect(report.candidates[0]?.recommended_action).toBe("update_existing_dry_run_only")
    expect(report.candidates[1]?.recommended_action).toBe("new_product_candidate")
    database.close()
  })
})

const SCHEMA = `
CREATE TABLE raw_products (
  id INTEGER PRIMARY KEY,
  supplier_id TEXT,
  original_product_name TEXT,
  original_option_name TEXT
);
CREATE TABLE normalized_products (
  raw_product_id INTEGER,
  supplier_id TEXT,
  normalized_name TEXT,
  option_key TEXT,
  price INTEGER
);
CREATE TABLE compare_products (
  compare_key TEXT,
  normalized_name TEXT,
  option_key TEXT,
  cheapest_supplier_id TEXT,
  cheapest_raw_product_id INTEGER,
  cheapest_price INTEGER
);
CREATE TABLE woocommerce_product_mapping (
  compare_key TEXT,
  woocommerce_product_id INTEGER,
  woocommerce_variation_id INTEGER,
  status TEXT
);
`

function seedRows(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO raw_products VALUES
      (1, 'dailyfood', '가정용 성주참외', '2kg'),
      (2, 'walldob2b', '성주 참외 가정용', '2kg'),
      (3, 'dailyfood', '미백찰옥수수', '10개');
    INSERT INTO normalized_products VALUES
      (1, 'dailyfood', '가정용 성주참외', '원산지미상|등급미상|2kg', 8000),
      (2, 'walldob2b', '가정용 성주참외', '원산지미상|등급미상|2kg', 7900),
      (3, 'dailyfood', '미백찰옥수수', '원산지미상|특품|10개', 10000);
    INSERT INTO compare_products VALUES
      ('strict-key', '가정용 성주참외', '원산지미상|등급미상|2kg', 'walldob2b', 2, 7900),
      ('single-key', '미백찰옥수수', '원산지미상|특품|10개', 'dailyfood', 3, 10000);
    INSERT INTO woocommerce_product_mapping VALUES ('strict-key', 123, NULL, 'approved');
  `)
}
