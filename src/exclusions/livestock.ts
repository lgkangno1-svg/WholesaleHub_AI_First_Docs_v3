export const LIVESTOCK_KEYWORDS = [
  "갈비세트",
  "LA갈비",
  "갈비",
  "소고기",
  "쇠고기",
  "한우",
  "수입육",
  "돼지고기",
  "삼겹살",
  "목살",
  "제육",
  "돈육",
  "양념육",
  "닭고기",
  "닭갈비",
  "닭가슴살",
  "오리고기",
  "훈제오리",
  "육류",
  "정육",
  "축산물",
  "축산",
  "고기세트",
  "불고기",
  "스테이크",
  "우육",
  "돈까스",
  "돈가스",
] as const

export type ProductExclusionMatch = {
  readonly excludeReason: "livestock"
  readonly matchedKeyword: string
}

export function matchExcludedProduct(value: string): ProductExclusionMatch | null {
  const normalized = clean(value)
  const matched = LIVESTOCK_KEYWORDS.find((keyword) => normalized.includes(clean(keyword)))
  return matched === undefined ? null : { excludeReason: "livestock", matchedKeyword: matched }
}

function clean(value: string): string {
  return value.replace(/[^가-힣a-zA-Z0-9]/gu, "").toLowerCase()
}
