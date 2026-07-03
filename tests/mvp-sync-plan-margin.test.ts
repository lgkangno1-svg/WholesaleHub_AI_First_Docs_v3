import { describe, expect, it } from "vitest"
import type { CollectedProduct } from "../src/domain/product.js"
import {
  buildMvpSyncPlanReport,
  hubSalePriceFromSupplierPrice,
  type MvpWooProduct,
} from "../src/reports/mvp-sync-plan.js"

describe("MVP sync plan margin pricing", () => {
  it.each([
    [8_500, 10_000],
    [10_000, 12_000],
    [20_000, 23_000],
    [30_000, 34_000],
  ])("converts supplier price %i to hub sale price %i", (supplierPrice, salePrice) => {
    expect(hubSalePriceFromSupplierPrice(supplierPrice)).toBe(salePrice)
  })

  it("uses margin-adjusted hub prices for existing DailyFood variations", () => {
    const report = buildMvpSyncPlanReport({
      dailyFoodProducts: [
        collected("유럽쌈채소 (1kg)", 10_000),
        collected("유럽쌈채소 (800g)", 8_500),
      ],
      walldob2bProducts: [],
      wooProducts: [wooProduct()],
    })

    expect(report.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variation_id: 8216,
          current_price: "10000",
          new_price: "12000",
          action: "update_price",
          supplier_candidates_summary: "dailyfood:10000->12000:in_stock",
        }),
        expect.objectContaining({
          variation_id: 8217,
          current_price: "8500",
          new_price: "10000",
          action: "update_price",
          supplier_candidates_summary: "dailyfood:8500->10000:in_stock",
        }),
      ]),
    )
  })
})

function collected(optionName: string, price: number): CollectedProduct {
  return {
    supplierId: "dailyfood",
    sourceType: "website",
    originalProductName: "GAP 인증 유럽채소",
    originalOptionName: optionName,
    price,
    shippingFee: 0,
    stockStatus: "in_stock",
    productUrl: null,
    rawJson: JSON.stringify({
      sourceProductId: "10000130",
      sourceOptionId: `10000130:${optionName}`,
    }),
  }
}

function wooProduct(): MvpWooProduct {
  return {
    id: 8215,
    name: "GAP 인증 유럽채소",
    status: "publish",
    type: "variable",
    price: "",
    stock_status: "instock",
    meta_data: [],
    variations: [
      variation(8216, "유럽쌈채소 (1kg)", "10000"),
      variation(8217, "유럽쌈채소 (800g)", "8500"),
    ],
  }
}

function variation(
  id: number,
  optionName: string,
  price: string,
): MvpWooProduct["variations"][number] {
  return {
    id,
    productId: 8215,
    price,
    stock_status: "instock",
    attributes: [{ name: "옵션", option: optionName }],
    meta_data: [
      { key: "_supplier_id", value: "dailyfood" },
      { key: "_source_product_id", value: "10000130" },
      { key: "_source_option_id", value: `10000130:${optionName}` },
    ],
  }
}
