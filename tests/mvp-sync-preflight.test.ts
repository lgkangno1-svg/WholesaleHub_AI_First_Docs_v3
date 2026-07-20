import { describe, expect, it } from "vitest"
import { validateMvpSyncPreflight } from "../src/reports/mvp-sync-preflight.js"

const healthy = {
  summary: {
    runFailed: false,
    failureReasons: [],
    dailyFoodOptionCount: 379,
    walldob2bOptionCount: 204,
    wooProductCount: 106,
    wooVariationCount: 431,
  },
}

describe("MVP sync preflight", () => {
  it("allows a healthy non-destructive crawl", () => {
    expect(validateMvpSyncPreflight(healthy, { destructive: false }).ok).toBe(true)
  })

  it("requires the stricter source count before destructive maintenance", () => {
    const result = validateMvpSyncPreflight(healthy, { destructive: true })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain("dailyfood_options_below_380")
  })

  it("blocks all writes when WooCommerce or a source crawl is incomplete", () => {
    const result = validateMvpSyncPreflight(
      {
        summary: {
          ...healthy.summary,
          runFailed: true,
          failureReasons: ["dailyfood collection failed"],
          wooVariationCount: 0,
        },
      },
      { destructive: false },
    )
    expect(result.ok).toBe(false)
    expect(result.reasons).toEqual(
      expect.arrayContaining(["dailyfood collection failed", "woocommerce_variations_empty"]),
    )
  })
})
