import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { buildProductGroupPlanReport } from "../src/reports/product-group-plan.js"

describe("buildProductGroupPlanReport", () => {
  it("keeps all options, separates mango from mangosteen, and selects cheapest exact option", () => {
    // Given
    const database = new DatabaseSync(":memory:")
    database.exec(`
      CREATE TABLE raw_products (
        id INTEGER PRIMARY KEY,
        supplier_id TEXT NOT NULL,
        original_product_name TEXT NOT NULL,
        original_option_name TEXT,
        raw_json TEXT
      );
      CREATE TABLE normalized_products (
        raw_product_id INTEGER NOT NULL,
        normalized_name TEXT NOT NULL,
        option_key TEXT NOT NULL,
        price INTEGER NOT NULL,
        weight_value REAL,
        quantity REAL,
        stock_status TEXT
      );
    `)
    insertRow(
      database,
      1,
      "dailyfood",
      "망고스틴",
      "망고스틴 5kg",
      "망고스틴",
      "원산지미상|등급미상|5kg",
      49000,
    )
    insertRow(
      database,
      2,
      "walldob2b",
      "태국 항공직송 생 망고스틴",
      "망고스틴5kg(500g*10망)",
      "망고스틴",
      "원산지미상|등급미상|5kg",
      46000,
    )
    insertRow(
      database,
      3,
      "walldob2b",
      "마하차녹 무지개망고",
      "4kg",
      "무지개망고",
      "원산지미상|등급미상|4kg",
      25000,
    )

    // When
    const report = buildProductGroupPlanReport(database, [])

    // Then
    database.close()
    expect(report.supplierOptionCount).toBe(3)
    expect(report.productGroups.map((row) => row.display_product_name).sort()).toEqual([
      "망고스틴",
      "무지개망고",
    ])
    expect(report.exactComparedOptionCount).toBe(1)
    expect(report.productOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          display_product_name: "망고스틴",
          selected_supplier_id: "walldob2b",
          selected_price: 46000,
          compared_exact_same_option: true,
        }),
      ]),
    )
  })
})

function insertRow(
  database: DatabaseSync,
  id: number,
  supplierId: string,
  productName: string,
  optionName: string,
  normalizedName: string,
  optionKey: string,
  price: number,
): void {
  database
    .prepare(
      "INSERT INTO raw_products (id, supplier_id, original_product_name, original_option_name, raw_json) VALUES (?, ?, ?, ?, '{}')",
    )
    .run(id, supplierId, productName, optionName)
  database
    .prepare(
      "INSERT INTO normalized_products (raw_product_id, normalized_name, option_key, price, weight_value, quantity, stock_status) VALUES (?, ?, ?, ?, NULL, NULL, 'in_stock')",
    )
    .run(id, normalizedName, optionKey, price)
}
