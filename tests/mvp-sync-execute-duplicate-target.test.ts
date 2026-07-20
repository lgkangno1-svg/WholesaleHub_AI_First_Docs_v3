import { describe, expect, it } from "vitest"
import { buildExecutionSelection } from "../src/reports/mvp-sync-execute.js"

describe("MVP sync duplicate target safety", () => {
  it("holds every candidate when multiple source rows target one live variation", () => {
    const rows = [
      row("no_op", "14900"),
      row("update_price", "12900"),
      row("update_price", "18300"),
    ] as const
    const catalog = [
      {
        id: 14906,
        name: "포슬포슬 햇감자 시즌시작!",
        status: "publish",
        type: "variable",
        price: "",
        stock_status: "instock",
        meta_data: [],
        variations: [
          {
            id: 14930,
            productId: 14906,
            price: "14900",
            stock_status: "instock",
            attributes: [{ name: "옵션", option: "왕특10kg" }],
            meta_data: [{ key: "_supplier_id", value: "walldob2b" }],
          },
        ],
      },
    ]

    const selection = buildExecutionSelection(rows, catalog)

    expect(selection.selectedRows).toHaveLength(0)
    expect(selection.consolidatedTargets).toEqual([
      expect.objectContaining({
        decision: "hold",
        reasons: expect.arrayContaining(["ambiguous_duplicate_target"]),
        source_row_count: 3,
      }),
    ])
  })
})

function row(action: "no_op" | "update_price", newPrice: string) {
  return {
    product_id: 14906,
    variation_id: 14930,
    woocommerce_product_name: "포슬포슬 햇감자 시즌시작!",
    woocommerce_option_name: "왕특10kg",
    current_price: "14900",
    new_price: newPrice,
    current_stock_status: "instock",
    new_stock_status: "instock" as const,
    selected_supplier_id: "walldob2b",
    selected_source_product_id: "source-product",
    selected_source_option_id: "source-option",
    selected_source_image_url: "https://example.test/source.jpg",
    supplier_candidates_summary: `walldob2b:${newPrice}`,
    action,
    safety_status: "review_needed",
    match_type: "soft_normalized",
  }
}
