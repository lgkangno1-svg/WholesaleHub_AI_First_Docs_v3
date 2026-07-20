import { describe, expect, it } from "vitest"
import { buildVariationUpdate } from "../src/reports/mvp-sync-execute.js"

const row = {
  product_id: 10,
  variation_id: 11,
  woocommerce_product_name: "상품",
  woocommerce_option_name: "옵션",
  current_price: "10000",
  new_price: "9000",
  current_stock_status: "outofstock",
  new_stock_status: "instock" as const,
  selected_supplier_id: "supplier",
  selected_source_product_id: "product",
  selected_source_option_id: "option",
  selected_source_image_url: "https://example.test/image.jpg",
  action: "update_price",
  safety_status: "safe",
}

describe("MVP sync price-only payload", () => {
  it("never sends stock_status in price-only mode", () => {
    expect(buildVariationUpdate(row, true)).not.toHaveProperty("stock_status")
  })

  it("never rewrites source mapping metadata for an unverified soft match", () => {
    expect(buildVariationUpdate(row, true)).toEqual({ id: 11, regular_price: "9000" })
  })

  it("keeps the legacy stock payload outside price-only mode", () => {
    expect(buildVariationUpdate(row, false)).toHaveProperty("stock_status", "instock")
  })

  it("stores the supplier baseline only for a hard-matched price update", () => {
    const update = buildVariationUpdate({
      ...row,
      match_type: "hard_meta",
      selected_supplier_price: 7_500,
      baseline_supplier_price: 8_000,
      source_price_changed: true,
    }, true)
    expect(update).not.toHaveProperty("stock_status")
    expect(update).toHaveProperty("meta_data", expect.arrayContaining([
      { key: "_wholesalehub_supplier_price", value: "7500" },
    ]))
  })
})
