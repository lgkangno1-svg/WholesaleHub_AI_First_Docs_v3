export type CleanedProductText = {
  readonly productName: string
  readonly optionName: string | null
  readonly removedTerms: readonly string[]
}

const PROMOTION_TERMS = [
  "🔥",
  "★",
  "추천템",
  "특가",
  "초특가",
  "실중량",
  "2026",
  "햇",
  "행사",
  "한정",
  "시즌오픈",
  "첫출시",
  "첫출고",
  "고당도",
  "가성비",
  "MD추천",
  "md 추천",
  "MD 추천",
  "데일리푸드",
  "Bset",
] as const

const SEASONAL_PATTERNS = [
  /[0-9]+\s*월\s*말\s*~\s*[0-9]+\s*월\s*초/gu,
  /[0-9]+\s*~\s*[0-9]+\s*월/gu,
  /[0-9]+\s*,\s*[0-9]+\s*월/gu,
  /[0-9]+\s+[0-9]+\s*월/gu,
  /[0-9]+\s*월/gu,
  /여름\s*복날\s*추천템/gu,
  /여름\s*추천템/gu,
] as const

export function cleanProductText(
  productName: string,
  optionName: string | null,
): CleanedProductText {
  const product = removeMarketingText(productName)
  return {
    productName: removeLeadingOrphanNumber(product.value),
    optionName: optionName === null ? null : removeMarketingText(optionName).value,
    removedTerms: product.removedTerms,
  }
}

export function removeMarketingText(value: string): {
  readonly value: string
  readonly removedTerms: readonly string[]
} {
  let text = value
  const removedTerms: string[] = []
  for (const pattern of SEASONAL_PATTERNS) {
    const matches = text.match(pattern) ?? []
    if (matches.length > 0) {
      removedTerms.push(...matches)
      text = text.replace(pattern, " ")
    }
  }
  for (const term of PROMOTION_TERMS) {
    if (text.includes(term)) {
      removedTerms.push(term)
      text = text.split(term).join(" ")
    }
  }
  return {
    value: normalizeWhitespace(text.replace(/[()[\],/]/gu, " ")),
    removedTerms,
  }
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim()
}

function removeLeadingOrphanNumber(value: string): string {
  return normalizeWhitespace(value.replace(/^\d+\s+/u, " "))
}
