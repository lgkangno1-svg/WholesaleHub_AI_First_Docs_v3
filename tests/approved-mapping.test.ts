import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { applyExactSafeApprovedMappings } from "../src/reports/approved-mapping.js"

describe("applyExactSafeApprovedMappings", () => {
  it("approves only exact-safe high-confidence candidates and preserves disabled mappings", () => {
    // Given
    const database = new DatabaseSync(":memory:")
    database.exec(`
      CREATE TABLE woocommerce_product_mapping (
        compare_key TEXT PRIMARY KEY,
        normalized_name TEXT,
        option_key TEXT,
        woocommerce_product_id INTEGER,
        woocommerce_variation_id INTEGER,
        status TEXT,
        admin_note TEXT,
        updated_at TEXT
      );
      INSERT INTO woocommerce_product_mapping (compare_key, status) VALUES ('disabled-key', 'disabled');
    `)

    // When
    const result = applyExactSafeApprovedMappings(database, [
      {
        compare_key: "safe-key",
        normalized_name: "가정용 성주참외",
        option_key: "원산지미상|등급미상|2kg",
        selected_supplier_id: "dailyfood",
        selected_supplier_original_product_name: "가정용 성주참외",
        selected_supplier_original_option_name: "2kg",
        selected_price: 8000,
        woocommerce_product_id: 10,
        woocommerce_variation_id: 11,
        woocommerce_product_name: "가정용 성주참외",
        woocommerce_option_name: "2kg",
        woocommerce_current_price: "9000",
        woocommerce_product_type: "variable",
        confidence: "high",
      },
      {
        compare_key: "disabled-key",
        normalized_name: "가정용 성주참외",
        option_key: "원산지미상|등급미상|2kg",
        selected_supplier_id: "dailyfood",
        selected_supplier_original_product_name: "가정용 성주참외",
        selected_supplier_original_option_name: "2kg",
        selected_price: 8000,
        woocommerce_product_id: 10,
        woocommerce_variation_id: 11,
        woocommerce_product_name: "가정용 성주참외",
        woocommerce_option_name: "2kg",
        woocommerce_current_price: "9000",
        woocommerce_product_type: "variable",
        confidence: "high",
      },
    ])

    // Then
    expect(result.approved).toHaveLength(1)
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          compare_key: "disabled-key",
          review_status: "existing_mapping_preserved",
        }),
      ]),
    )
    expect(
      database
        .prepare("SELECT status FROM woocommerce_product_mapping WHERE compare_key = ?")
        .get("safe-key"),
    ).toMatchObject({ status: "approved" })
    database.close()
  })
})
