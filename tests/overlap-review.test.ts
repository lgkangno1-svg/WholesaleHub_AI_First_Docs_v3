import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { applySchema } from "../src/database/apply-schema.js"
import { buildOverlapReviewReport } from "../src/reports/overlap-review.js"

describe("buildOverlapReviewReport", () => {
  it("keeps strict matches and caps high review candidates per side", () => {
    // Given
    const database = new DatabaseSync(":memory:")
    applySchema(database, SCHEMA)
    seedRows(database)

    // When
    const report = buildOverlapReviewReport(database)

    // Then
    expect(report.strictMatchCount).toBe(1)
    expect(report.highSourceCandidates).toBeGreaterThan(3)
    expect(report.reviewCandidateCount).toBe(3)
    expect(report.strictMatches).toHaveLength(1)
    expect(report.candidates.every((candidate) => candidate.recommended_action !== "reject")).toBe(
      true,
    )
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
  option_key TEXT
);
`

function seedRows(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO raw_products VALUES
      (1, 'dailyfood', '가정용 성주참외', '2kg'),
      (2, 'walldob2b', '성주 참외 가정용', '2kg'),
      (3, 'walldob2b', '성주 참외 가정용', '2kg 특가'),
      (4, 'walldob2b', '성주 참외 가정용', '2kg 행사'),
      (5, 'walldob2b', '성주 참외 가정용', '2kg 후보');
    INSERT INTO normalized_products VALUES
      (1, 'dailyfood', '가정용 성주참외', '원산지미상|등급미상|2kg', 8000),
      (2, 'walldob2b', '가정용 성주참외', '원산지미상|등급미상|2kg', 7900),
      (3, 'walldob2b', '가정용 성주참외', '원산지미상|등급미상|2kg', 8100),
      (4, 'walldob2b', '가정용 성주참외', '원산지미상|등급미상|2kg', 8200),
      (5, 'walldob2b', '가정용 성주참외', '원산지미상|등급미상|2kg', 8300);
    INSERT INTO compare_products VALUES
      ('strict-key', '가정용 성주참외', '원산지미상|등급미상|2kg');
  `)
}
