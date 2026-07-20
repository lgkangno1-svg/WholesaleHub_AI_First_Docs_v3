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

  it("does not replace a DailyFood variation with a cheaper Walldo option", () => {
    const report = buildMvpSyncPlanReport({
      dailyFoodProducts: [sourceProduct("dailyfood", "d-1", "흑수박", "흑수박 4-5kg 내외", 20_000)],
      walldob2bProducts: [sourceProduct("walldob2b", "w-1", "흑수박", "흑수박 4-5kg 내외", 17_400)],
      wooProducts: [
        {
          ...wooProduct(),
          name: "흑수박",
          variations: [
            {
              ...variation(8216, "흑수박 4-5kg 내외", "23000"),
              meta_data: [{ key: "_supplier_id", value: "dailyfood" }],
            },
          ],
        },
      ],
    })

    expect(report.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selected_supplier_id: "dailyfood",
          variation_id: 8216,
          new_price: "23000",
        }),
        expect.objectContaining({
          selected_supplier_id: "walldob2b",
          variation_id: null,
          action: "create_draft_product_candidate",
        }),
      ]),
    )
  })

  it("does not match 흑수박 to a generic 수박 product", () => {
    const report = buildMvpSyncPlanReport({
      dailyFoodProducts: [sourceProduct("dailyfood", "d-1", "흑수박", "흑수박 4-5kg 내외", 20_000)],
      walldob2bProducts: [],
      wooProducts: [
        {
          ...wooProduct(),
          name: "수박",
          variations: [variation(8216, "수박 4-5kg 내외", "22000")],
        },
      ],
    })

    expect(report.rows[0]).toMatchObject({
      product_id: null,
      variation_id: null,
      action: "create_draft_product_candidate",
    })
  })

  it("never maps 중 and 대 grapefruit options to the same Woo variation", () => {
    const prices = [9_700, 15_600, 21_500, 28_000, 10_300, 16_700, 23_100, 30_100]
    const options = ["중 5개", "중 10개", "중 15개", "중 20개", "대 5개", "대 10개", "대 15개", "대 20개"]
    const walldob2bProducts = options.map((optionName, index) => ({
      ...sourceProduct("walldob2b", "1768291208", "새콤달콤 고당도 레드루비자몽", optionName, prices[index] ?? 0),
      rawJson: JSON.stringify({ sourceProductId: "1768291208", sourceOptionId: String(index + 1) }),
    }))
    const wooProducts: MvpWooProduct[] = [{
      id: 15009,
      name: "새콤달콤 고당도 레드루비자몽",
      status: "publish",
      type: "variable",
      price: "",
      stock_status: "instock",
      meta_data: [],
      variations: options.slice(4).map((optionName, index) => ({
        id: 15014 + index,
        productId: 15009,
        price: String(hubSalePriceFromSupplierPrice(prices[index + 4] ?? 0)),
        stock_status: "instock",
        attributes: [{ name: "옵션", option: optionName }],
        meta_data: [{ key: "_supplier_id", value: "walldob2b" }],
      })),
    }]

    const report = buildMvpSyncPlanReport({ dailyFoodProducts: [], walldob2bProducts, wooProducts })
    const bySourceOption = new Map(report.rows.map((row) => [row.selected_source_option_id, row]))

    for (const sourceOptionId of ["1", "2", "3", "4"])
      expect(bySourceOption.get(sourceOptionId)?.variation_id).toBeNull()
    for (const [offset, sourceOptionId] of ["5", "6", "7", "8"].entries())
      expect(bySourceOption.get(sourceOptionId)).toMatchObject({ variation_id: 15014 + offset, action: "no_op" })
    expect(new Set(report.rows.map((row) => row.variation_id).filter((id) => id !== null)).size).toBe(4)
  })
})

function sourceProduct(
  supplierId: "dailyfood" | "walldob2b",
  sourceProductId: string,
  productName: string,
  optionName: string,
  price: number,
): CollectedProduct {
  return {
    supplierId,
    sourceType: "website",
    originalProductName: productName,
    originalOptionName: optionName,
    price,
    shippingFee: 0,
    stockStatus: "in_stock",
    productUrl: null,
    rawJson: JSON.stringify({
      sourceProductId,
      sourceOptionId: `${sourceProductId}:${optionName}`,
    }),
  }
}

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
