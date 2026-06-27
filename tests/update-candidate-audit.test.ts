import { describe, expect, it } from "vitest"
import { buildUpdateCandidateAuditReport } from "../src/reports/update-candidate-audit.js"

describe("buildUpdateCandidateAuditReport", () => {
  it("classifies safe candidates by strict comparison and single supplier status", () => {
    // Given
    const reviewRows = [
      {
        product_id: 1,
        variation_id: 2,
        woocommerce_product_name: "가정용 성주참외",
        woocommerce_option_name: "2kg",
        selected_supplier_id: "dailyfood",
        selected_supplier_original_product_name: "가정용 성주참외",
        selected_supplier_original_option_name: "2kg",
        safety_status: "safe" as const,
      },
    ]
    const sellRows = [
      {
        compare_key: "a",
        normalized_name: "가정용 성주참외",
        option_key: "원산지미상|등급미상|2kg",
        selected_supplier_id: "dailyfood",
        selected_supplier_original_product_name: "가정용 성주참외",
        selected_supplier_original_option_name: "2kg",
        supplier_count_for_same_compare_key: 2,
        compared_with_other_supplier: true,
        alternative_suppliers_summary: "dailyfood:8000; walldob2b:8500",
      },
    ]
    const matchRows = [
      {
        compare_key: "a",
        woocommerce_product_id: 1,
        woocommerce_variation_id: 2,
        confidence: "high",
        selected_supplier_id: "dailyfood",
      },
    ]

    // When
    const report = buildUpdateCandidateAuditReport(
      reviewRows,
      sellRows,
      matchRows,
      new Set(["1:2"]),
    )

    // Then
    expect(report).toMatchObject({
      safeCount: 1,
      classCounts: { strict_compared: 1, single_supplier: 0, suspicious: 0 },
      updatedRows: [expect.objectContaining({ product_id: 1, audit_class: "strict_compared" })],
    })
  })
})
