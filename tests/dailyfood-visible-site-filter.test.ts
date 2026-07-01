import { describe, expect, it } from "vitest"
import type { CollectedProduct } from "../src/domain/product.js"
import { filterDailyFoodVisibleSiteProducts } from "../src/reports/dailyfood-visible-site-filter.js"

function product(name: string): CollectedProduct {
  return {
    supplierId: "dailyfood",
    sourceType: "google_sheet_htmlview",
    originalProductName: name,
    originalOptionName: null,
    price: 10000,
    shippingFee: 0,
    stockStatus: "in_stock",
    productUrl: null,
    rawJson: "{}",
  }
}

describe("filterDailyFoodVisibleSiteProducts", () => {
  it("removes DailyFood rows known to have no current site option/price data", () => {
    const filtered = filterDailyFoodVisibleSiteProducts([
      product("산딸기 250G (250G*1팩)"),
      product("설향 메론 랜덤과 1kg"),
      product("[제스프리] 골드키위 대과 5과 [개당 110g 내외]"),
    ])

    expect(filtered.map((row) => row.originalProductName)).toEqual([
      "[제스프리] 골드키위 대과 5과 [개당 110g 내외]",
    ])
  })
})
