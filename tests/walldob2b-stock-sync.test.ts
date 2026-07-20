import { describe, expect, it } from "vitest"
import {
  buildWalldob2bStockSyncRows,
  type Walldob2bStockTarget,
} from "../src/reports/walldob2b-stock-sync-cli.js"

const target: Walldob2bStockTarget = {
  productId: 100,
  variationId: 200,
  productName: "속 빨간 피자두",
  optionName: "기본",
  sourceProductId: "1783870330",
  currentStockStatus: "instock",
}

describe("Walldo confirmed stock-out sync", () => {
  it("marks only explicitly unavailable supplier products out of stock", () => {
    const rows = buildWalldob2bStockSyncRows(
      [target],
      new Map([
        [
          "1783870330",
          {
            soldOut: true,
            evidence: ["insufficient_stock_message", "sold_out_badge"],
          },
        ],
      ]),
    )

    expect(rows).toEqual([
      {
        ...target,
        evidence: ["insufficient_stock_message", "sold_out_badge"],
        action: "mark_outofstock",
      },
    ])
  })

  it("never marks an available product out of stock", () => {
    const rows = buildWalldob2bStockSyncRows(
      [target],
      new Map([["1783870330", { soldOut: false, evidence: [] }]]),
    )

    expect(rows[0]?.action).toBe("available")
  })

  it("keeps an already unavailable Hub variation unchanged", () => {
    const rows = buildWalldob2bStockSyncRows(
      [{ ...target, currentStockStatus: "outofstock" }],
      new Map([
        ["1783870330", { soldOut: true, evidence: ["insufficient_stock_message"] }],
      ]),
    )

    expect(rows[0]?.action).toBe("already_outofstock")
  })
})
