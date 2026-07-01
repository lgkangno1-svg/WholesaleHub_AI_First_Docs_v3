import type { CollectedProduct } from "../domain/product.js"

const HIDDEN_ON_DAILYFOOD_SITE = [/골드\s*망고/u]

export function filterDailyFoodVisibleSiteProducts(
  products: readonly CollectedProduct[],
): readonly CollectedProduct[] {
  return products.filter((product) => !isHiddenOnDailyFoodSite(product))
}

export function isHiddenOnDailyFoodSite(product: CollectedProduct): boolean {
  if (product.supplierId !== "dailyfood") return false
  const text = `${product.originalProductName} ${product.originalOptionName ?? ""}`
  return HIDDEN_ON_DAILYFOOD_SITE.some((pattern) => pattern.test(text))
}
