import { describe, expect, it } from "vitest"
import { buildWooMatchReport } from "../src/reports/woocommerce-match.js"
import type { WooCatalogItem } from "../src/woocommerce/catalog.js"

describe("buildWooMatchReport", () => {
  it("classifies sell-plan rows against a read-only WooCommerce catalog", () => {
    // Given
    const catalog: readonly WooCatalogItem[] = [
      {
        productId: 10,
        variationId: 11,
        productName: "가정용 성주참외",
        optionName: "2kg",
        price: "9900",
        type: "variable",
        status: "publish",
        meta: {},
      },
    ]
    const sellCandidates = [
      {
        compare_key: "a",
        normalized_name: "가정용 성주참외",
        option_key: "원산지미상|등급미상|2kg",
        selected_supplier_id: "dailyfood",
        selected_supplier_original_product_name: "가정용 성주참외",
        selected_supplier_original_option_name: "2kg",
        selected_price: 8000,
        supplier_count_for_same_compare_key: 2,
      },
      {
        compare_key: "b",
        normalized_name: "미백찰옥수수",
        option_key: "원산지미상|특품|10개",
        selected_supplier_id: "dailyfood",
        selected_supplier_original_product_name: "미백찰옥수수",
        selected_supplier_original_option_name: "10개",
        selected_price: 10000,
        supplier_count_for_same_compare_key: 1,
      },
    ]

    // When
    const report = buildWooMatchReport(sellCandidates, catalog)

    // Then
    expect(report).toMatchObject({
      totalSellCandidates: 2,
      confidenceCounts: { high: 1, medium: 0, low: 0, none: 1 },
      actionCounts: {
        approve_candidate_review: 1,
        needs_manual_mapping: 0,
        new_product_candidate: 1,
        reject: 0,
      },
    })
  })
})
