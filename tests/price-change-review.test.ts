import { describe, expect, it } from "vitest"
import { buildPriceChangeReviewReport } from "../src/reports/price-change-review.js"

describe("buildPriceChangeReviewReport", () => {
  it("classifies safe, review-needed, and blocked price changes", () => {
    // Given
    const matches = [
      {
        compare_key: "a",
        selected_supplier_id: "dailyfood",
        selected_supplier_original_product_name: "가정용 성주참외",
        selected_supplier_original_option_name: "2kg",
        woocommerce_product_id: 1,
        woocommerce_variation_id: 2,
        woocommerce_product_name: "가정용 성주참외",
        woocommerce_option_name: "2kg",
        woocommerce_current_price: "10000",
        confidence: "high" as const,
      },
    ]

    // When
    const report = buildPriceChangeReviewReport(
      [
        { product_id: 1, variation_id: 2, regular_price: "10500" },
        { product_id: 1, variation_id: 2, regular_price: "6000" },
        { product_id: 1, regular_price: "500" },
      ],
      matches,
    )

    // Then
    expect(report.safetyCounts).toEqual({ safe: 1, review_needed: 1, blocked: 1 })
  })
})
