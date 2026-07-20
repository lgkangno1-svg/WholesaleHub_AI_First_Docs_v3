import { describe, expect, it } from "vitest"
import { validateMvpPriceRows } from "../src/reports/mvp-price-preflight.js"

describe("MVP price preflight", () => {
  it("blocks a price row when another source option targets the same variation", () => {
    const result = validateMvpPriceRows([
      row({ action: "update_price", sourceOptionId: "middle-20", supplierPrice: 28_000, newPrice: "31000" }),
      row({ action: "no_op", sourceOptionId: "large-20", supplierPrice: 30_100, newPrice: "34100" }),
    ])

    expect(result.ok).toBe(false)
    expect(result.reasons).toContain("ambiguous_target:15009:15017")
  })

  it("blocks recalculation when the supplier price change is not proven", () => {
    const result = validateMvpPriceRows([
      row({ sourceChanged: false, supplierPrice: 30_100, newPrice: "34100" }),
    ])

    expect(result.ok).toBe(false)
    expect(result.reasons).toContain("source_change_unproven:15009:15017")
  })

  it("accepts one hard-matched option with a changed supplier baseline and valid formula", () => {
    const result = validateMvpPriceRows([
      row({ baselinePrice: 30_100, supplierPrice: 31_000, newPrice: "35000" }),
    ])

    expect(result).toMatchObject({ ok: true, priceActionCount: 1, reasons: [] })
  })
})

function row(input: {
  action?: string
  sourceOptionId?: string
  baselinePrice?: number
  supplierPrice: number
  sourceChanged?: boolean
  newPrice: string
}) {
  return {
    product_id: 15009,
    variation_id: 15017,
    current_price: "34100",
    new_price: input.newPrice,
    selected_supplier_id: "walldob2b",
    selected_source_product_id: "1768291208",
    selected_source_option_id: input.sourceOptionId ?? "large-20",
    selected_supplier_price: input.supplierPrice,
    baseline_supplier_price: input.baselinePrice ?? 30_100,
    source_price_changed: input.sourceChanged ?? true,
    match_type: "hard_meta",
    action: input.action ?? "update_price",
  }
}
