export const LIVESTOCK_KEYWORDS = [] as const

export type ProductExclusionMatch = {
  readonly excludeReason: "livestock"
  readonly matchedKeyword: string
}

export function matchExcludedProduct(_value: string): ProductExclusionMatch | null {
  return null
}
