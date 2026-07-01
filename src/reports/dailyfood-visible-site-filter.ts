import type { CollectedProduct } from "../domain/product.js"

const HIDDEN_ON_DAILYFOOD_SITE = [/골드\s*망고/u, /산\s*딸기/u, /설향\s*메론\s*랜덤과/u]

export function filterDailyFoodVisibleSiteProducts(
  products: readonly CollectedProduct[],
): readonly CollectedProduct[] {
  return products.filter((product) => !isHiddenOnDailyFoodSite(product))
}

export function isHiddenOnDailyFoodSite(product: CollectedProduct): boolean {
  if (product.supplierId !== "dailyfood") return false

  // 규칙: 사이트에 숨겨진 특정 상품 제외
  const text = `${product.originalProductName} ${product.originalOptionName ?? ""}`
  if (HIDDEN_ON_DAILYFOOD_SITE.some((pattern) => pattern.test(text))) return true

  // 규칙: DailyFood 상품 중 옵션(중량/규격)이 전혀 없는 항목은 hub에 등록하지 않는다.
  // originalOptionName이 null이거나 빈 문자열이면 해당 상품을 제외한다.
  if (isDailyFoodNoOption(product)) return true

  return false
}

/**
 * DailyFood 상품의 원본 옵션이 완전히 비어있는지 확인한다.
 * originalOptionName === null 또는 빈 문자열인 경우 true를 반환한다.
 * 이 상품들은 공급처에서 옵션 정보를 제공하지 않아 hub에 등록할 수 없다.
 */
export function isDailyFoodNoOption(product: CollectedProduct): boolean {
  if (product.supplierId !== "dailyfood") return false
  const optionName = product.originalOptionName
  return optionName === null || optionName.trim() === ""
}
