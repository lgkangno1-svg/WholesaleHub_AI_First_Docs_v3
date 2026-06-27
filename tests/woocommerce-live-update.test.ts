import { describe, expect, it } from "vitest"
import { runWooCommerceLiveUpdate } from "../src/woocommerce/live-update.js"

describe("runWooCommerceLiveUpdate", () => {
  it("previews safe rows in dry-run mode without requiring execute guards", async () => {
    // Given / When
    const log = await runWooCommerceLiveUpdate(
      [
        {
          product_id: 1,
          variation_id: 2,
          woocommerce_product_name: "상품",
          woocommerce_option_name: "2kg",
          woocommerce_current_price: 10000,
          new_price: 10500,
          safety_status: "safe",
        },
      ],
      {
        baseUrl: "https://example.com",
        consumerKey: "ck",
        consumerSecret: "cs",
        execute: false,
        limit: null,
        confirm: null,
      },
    )

    // Then
    expect(log).toMatchObject({
      mode: "dry-run",
      selectedCount: 1,
      entries: [{ status: "preview" }],
    })
  })

  it("requires explicit limit and confirmation for execute mode", async () => {
    // Given / When / Then
    await expect(
      runWooCommerceLiveUpdate([], {
        baseUrl: "https://example.com",
        consumerKey: "ck",
        consumerSecret: "cs",
        execute: true,
        limit: null,
        confirm: "UPDATE_WOOCOMMERCE_PRICES",
      }),
    ).rejects.toThrow("--execute requires --limit")
  })
})
