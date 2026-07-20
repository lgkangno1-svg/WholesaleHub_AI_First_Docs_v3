import { describe, expect, it } from "vitest"
import { buildMvpPriceChangeTelegramReport } from "../src/reports/mvp-price-change-telegram.js"

describe("buildMvpPriceChangeTelegramReport", () => {
  it("reports only verified option price changes with product and option names", () => {
    const report = buildMvpPriceChangeTelegramReport({
      requestedAt: "2026-07-13T06:03:20.632Z",
      generatedAt: "2026-07-13T06:04:00.000Z",
      planRows: [
        {
          product_id: 10,
          variation_id: 11,
          woocommerce_product_name: "수박",
          woocommerce_option_name: "3kg 내외",
        },
        {
          product_id: 10,
          variation_id: 12,
          woocommerce_product_name: "수박",
          woocommerce_option_name: "4kg 내외",
        },
      ],
      entries: [
        entry(11, "update_price", "10000", "15700", "15700", "verified"),
        entry(12, "mark_instock", "12000", "12000", "12000", "verified"),
        entry(13, "update_price", "13000", "14000", "14000", "failed"),
      ],
    })

    expect(report).toMatchObject({ product_count: 1, change_count: 1 })
    expect(report.changes).toEqual([
      {
        product_id: 10,
        variation_id: 11,
        product_name: "수박",
        option_name: "3kg 내외",
        before_price: 10000,
        after_price: 15700,
        difference: 5700,
      },
    ])
  })

  it("keeps the report id stable for an identical execution retry", () => {
    const input = {
      requestedAt: "2026-07-13T06:03:20.632Z",
      planRows: [
        {
          product_id: 10,
          variation_id: 11,
          woocommerce_product_name: "수박",
          woocommerce_option_name: "3kg 내외",
        },
      ],
      entries: [entry(11, "update_price", "10000", "15700", "15700", "verified")],
    }
    expect(
      buildMvpPriceChangeTelegramReport({ ...input, generatedAt: "2026-07-13T06:04:00Z" })
        .report_id,
    ).toBe(
      buildMvpPriceChangeTelegramReport({ ...input, generatedAt: "2026-07-13T06:05:00Z" })
        .report_id,
    )
  })
})

function entry(
  variationId: number,
  action: string,
  beforePrice: string,
  afterPrice: string,
  expectedPrice: string,
  status: string,
) {
  return {
    product_id: 10,
    variation_id: variationId,
    action,
    before_price: beforePrice,
    after_price: afterPrice,
    expected_price: expectedPrice,
    status,
  }
}
