import { describe, expect, it } from "vitest"
import type { CollectedProduct } from "../src/domain/product.js"
import { filterDailyFoodVisibleSiteProducts } from "../src/reports/dailyfood-visible-site-filter.js"

function product(
  name: string,
  option: string | null = "옵션",
  supplierId: "dailyfood" | "walldob2b" = "dailyfood",
): CollectedProduct {
  return {
    supplierId,
    sourceType: "google_sheet_htmlview",
    originalProductName: name,
    originalOptionName: option,
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

  it("removes DailyFood rows with no option data", () => {
    const filtered = filterDailyFoodVisibleSiteProducts([
      product("설향메론 랜덤과", null),
      product("골드키위", "대과 5과"),
    ])

    expect(filtered.map((row) => row.originalProductName)).toEqual(["골드키위"])
  })

  it("removes global hub exclusions from both suppliers", () => {
    const filtered = filterDailyFoodVisibleSiteProducts([
      product("아보카도 대과 10입", "기본", "walldob2b"),
      product("제스프리 루비레드키위 중과", "5과", "dailyfood"),
      product("제스프리 골드키위 대과", "5과", "walldob2b"),
    ])

    expect(filtered.map((row) => row.originalProductName)).toEqual(["제스프리 골드키위 대과"])
  })
})
