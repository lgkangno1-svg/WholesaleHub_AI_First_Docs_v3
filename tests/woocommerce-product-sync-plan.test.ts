import { describe, expect, it } from "vitest"
import { selectExecutableSyncRows } from "../src/reports/woocommerce-product-sync-execute.js"
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
  it("selects only unique safe update_variation_price rows for execution", () => {
    // Given
    const rows = [
      syncRow("update_variation_price", "safe", 1),
      syncRow("update_variation_price", "safe", 1),
      syncRow("update_variation_price", "safe", 4),
      syncRow("add_variation", "safe", null),
      syncRow("update_variation_price", "review_needed", 2),
      syncRow("blocked", "blocked", 3),
    ]

    // When
    const selected = selectExecutableSyncRows(rows, 10)

    // Then
    expect(selected).toEqual([
      expect.objectContaining({
        action: "update_variation_price",
        current_woocommerce_variation_id: 4,
      }),
    ])
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

function syncRow(
  action: "update_variation_price" | "add_variation" | "blocked",
  safety: "safe" | "review_needed" | "blocked",
  variationId: number | null,
) {
  return {
    mode: "update-existing" as const,
    product_group_key: "g1",
    display_product_name: "망고스틴",
    matched_woocommerce_product_id: 10,
    action,
    option_display_name: "망고스틴 5kg",
    selected_supplier_id: "dailyfood",
    selected_supplier_original_product_name: "망고스틴",
    selected_supplier_original_option_name: "망고스틴 5kg",
    selected_price: 46000,
    current_woocommerce_price: "49000",
    current_woocommerce_variation_id: variationId,
    compared_exact_same_option: false,
    safety_status: safety,
    safety_reason: "test",
    internal_supplier_meta_plan: [],
  }
}
