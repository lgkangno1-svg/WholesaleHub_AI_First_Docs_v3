import { describe, expect, it } from "vitest"
import {
  buildWooProductSyncPlan,
  summarizeWooProductSyncPlan,
} from "../src/reports/woocommerce-product-sync-plan.js"
import type { WooCatalogItem } from "../src/woocommerce/catalog.js"

describe("buildWooProductSyncPlan", () => {
  it("builds dry-run rows for update, create, add, no-op, and blocked cases", () => {
    // Given
    const groups = [
      {
        product_group_key: "g1",
        display_product_name: "망고스틴",
        matched_woocommerce_product_id: 10,
      },
      {
        product_group_key: "g2",
        display_product_name: "신규 과일",
        matched_woocommerce_product_id: null,
      },
    ]
    const options = [
      option("g1", "망고스틴", "망고스틴 5kg", "원산지미상|등급미상|5kg", 46000),
      option("g1", "망고스틴", "망고스틴 1kg", "원산지미상|등급미상|1kg", 12000),
      option("g1", "망고스틴", "", "원산지미상|등급미상|2kg", 21000),
      option("g2", "신규 과일", "신규 과일 1kg", "원산지미상|등급미상|1kg", 9000),
    ]
    const catalog: WooCatalogItem[] = [
      {
        productId: 10,
        variationId: 11,
        productName: "망고스틴",
        optionName: "망고스틴 5kg",
        price: "49000",
        type: "variable",
        status: "publish",
        meta: {},
      },
    ]

    // When
    const rows = buildWooProductSyncPlan(groups, options, catalog, "all")
    const summary = summarizeWooProductSyncPlan(rows)

    // Then
    expect(summary).toMatchObject({
      totalActionCount: 4,
      updateExistingCount: 3,
      createNewCount: 1,
      addVariationCount: 1,
      updateVariationPriceCount: 1,
      blockedCount: 1,
      reviewNeededCount: 1,
    })
  })
})

function option(
  productGroupKey: string,
  displayProductName: string,
  optionDisplayName: string,
  normalizedOptionKey: string,
  selectedPrice: number,
) {
  return {
    product_group_key: productGroupKey,
    display_product_name: displayProductName,
    option_display_name: optionDisplayName,
    normalized_option_key: normalizedOptionKey,
    selected_supplier_id: "dailyfood",
    selected_supplier_original_product_name: displayProductName,
    selected_supplier_original_option_name: optionDisplayName,
    selected_price: selectedPrice,
    alternative_suppliers_summary: "dailyfood:1000",
    compared_exact_same_option: false,
    recommended_action: "create_variation_candidate" as const,
  }
}
