import { describe, expect, it } from "vitest"
import type { DailyFoodDirectSiteResult } from "../src/adapters/dailyfood/dailyfood-direct-site.js"
import { assessDailyFoodCrawlHealth } from "../src/reports/dailyfood-crawl-health.js"

function result(overrides: Partial<DailyFoodDirectSiteResult> = {}): DailyFoodDirectSiteResult {
  return {
    crawledAt: "2026-07-26T02:00:00.000Z",
    products: [],
    errors: [],
    paginationComplete: true,
    listedProductCount: 137,
    detailFetchedProductCount: 137,
    missingOptionsCount: 0,
    ...overrides,
  }
}

describe("assessDailyFoodCrawlHealth", () => {
  it("accepts a complete crawl aligned with the primary sheet", () => {
    expect(assessDailyFoodCrawlHealth(result(), 137)).toEqual({
      failureReasons: [],
      detailFailureCount: 0,
    })
  })

  it("blocks a crawl when detail pages silently contain no options", () => {
    const health = assessDailyFoodCrawlHealth(
      result({
        errors: ["detail response contained no options"],
        missingOptionsCount: 1,
      }),
      137,
    )

    expect(health.failureReasons).toContain("dailyfood detail pages without valid options: 1")
    expect(health.detailFailureCount).toBeGreaterThan(0)
  })

  it("blocks incomplete detail coverage and a large sheet mismatch", () => {
    const health = assessDailyFoodCrawlHealth(
      result({
        listedProductCount: 70,
        detailFetchedProductCount: 67,
      }),
      137,
    )

    expect(health.failureReasons).toContain("dailyfood detail coverage incomplete: 67/70")
    expect(health.failureReasons).toContain(
      "dailyfood direct-site catalog count differs from primary Google Sheet: 70/137",
    )
  })
})
