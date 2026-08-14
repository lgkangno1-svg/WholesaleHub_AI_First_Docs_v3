import type { DailyFoodDirectSiteResult } from "../adapters/dailyfood/dailyfood-direct-site.js"

export type DailyFoodCrawlHealth = {
  readonly failureReasons: readonly string[]
  readonly detailFailureCount: number
}

export function assessDailyFoodCrawlHealth(
  result: DailyFoodDirectSiteResult,
  primarySheetProductCount: number,
): DailyFoodCrawlHealth {
  const failureReasons: string[] = []
  if (!result.paginationComplete) {
    failureReasons.push("dailyfood pagination did not reach a terminal empty page")
  }
  if (result.errors.length > 0) {
    failureReasons.push(`dailyfood detail fetch failures: ${result.errors.length}`)
  }
  if (result.missingOptionsCount > 0) {
    failureReasons.push(
      `dailyfood detail pages without valid options: ${result.missingOptionsCount}`,
    )
  }
  if (result.detailFetchedProductCount !== result.listedProductCount) {
    failureReasons.push(
      `dailyfood detail coverage incomplete: ${result.detailFetchedProductCount}/${result.listedProductCount}`,
    )
  }
  if (
    primarySheetProductCount > 0 &&
    (result.listedProductCount < Math.floor(primarySheetProductCount * 0.8) ||
      result.listedProductCount > Math.ceil(primarySheetProductCount * 1.2))
  ) {
    failureReasons.push(
      `dailyfood direct-site catalog count differs from primary Google Sheet: ${result.listedProductCount}/${primarySheetProductCount}`,
    )
  }

  return {
    failureReasons,
    detailFailureCount:
      result.errors.length +
      result.missingOptionsCount +
      Math.max(0, result.listedProductCount - result.detailFetchedProductCount),
  }
}
