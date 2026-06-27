import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { applySchema } from "../src/database/apply-schema.js"
import { buildOverlapAuditReport } from "../src/reports/overlap-audit.js"

describe("buildOverlapAuditReport", () => {
  it("reports loose overlap candidates when strict option keys differ", () => {
    // Given
    const database = new DatabaseSync(":memory:")
    applySchema(database, SCHEMA)
    database.exec(`
      INSERT INTO raw_products (id, supplier_id, source_type, original_product_name, original_option_name, price)
      VALUES
        (1, 'dailyfood', 'google_sheet', '가정용 성주참외', '소과 2kg', 7800),
        (2, 'walldob2b', 'excel_download', '가정용 참외', '3kg', 9900);
      INSERT INTO normalized_products (raw_product_id, supplier_id, normalized_name, option_key, price, unit_price)
      VALUES
        (1, 'dailyfood', '성주참외', '원산지미상|등급미상|2kg', 7800, 3900),
        (2, 'walldob2b', '참외', '원산지미상|등급미상|3kg', 9900, 3300);
    `)

    // When
    const report = buildOverlapAuditReport(database)

    // Then
    expect(report).toMatchObject({
      strictSharedCompareKeys: 0,
      looseCandidateCount: 1,
      confidenceCounts: { high: 0, medium: 1, low: 0 },
    })
    database.close()
  })
})

const SCHEMA = `
CREATE TABLE raw_products (
  id INTEGER PRIMARY KEY,
  supplier_id TEXT,
  source_type TEXT,
  original_product_name TEXT,
  original_option_name TEXT,
  price INTEGER
);
CREATE TABLE normalized_products (
  raw_product_id INTEGER,
  supplier_id TEXT,
  normalized_name TEXT,
  option_key TEXT,
  price INTEGER,
  unit_price REAL
);
CREATE TABLE compare_products (
  compare_key TEXT,
  normalized_name TEXT,
  option_key TEXT
);
`
