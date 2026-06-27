import type { ParsedProduct, ProductParser } from "../domain/product.js"
import { cleanProductText, normalizeWhitespace } from "./product-name-cleaner.js"

const ORIGIN_PATTERN = /(국내산|국산|수입산|미국산|중국산|제주산|성주산|금산)/u
const GRADE_PATTERN = /(가정용|선물용|정품|특품|상품|상급|중품|소과|중과|대과|못난이|프리미엄)/u
const QUANTITY_PATTERN = /(\d+(?:\.\d+)?)\s*(개입|개|입|망|봉|박스|과|팩)/u
const WEIGHT_PATTERN = /(\d+(?:\.\d+)?)\s*(kg|g|킬로|그램)/iu
const AMBIGUOUS_COUNT_PATTERN =
  /\d+(?:\.\d+)?\s*[-~]\s*\d+(?:\.\d+)?\s*(?:과|개|입|망)|\d+\s*과수내외|랜덤과|랜덤|혼합/giu
const PRODUCT_NOISE_PATTERN = /(이미지|내외|17센치 이상|16-22센치|센치)/gu

export class RuleBasedProductParser implements ProductParser {
  readonly modelName = "rule-based-v2"

  async parse(productName: string, optionName: string | null): Promise<ParsedProduct> {
    const cleaned = cleanProductText(productName, optionName)
    const combined = `${cleaned.productName} ${cleaned.optionName ?? ""}`
    const origin = normalizeOrigin(ORIGIN_PATTERN.exec(combined)?.[1] ?? null)
    const grade = GRADE_PATTERN.exec(combined)?.[1] ?? null
    const weightMatch = WEIGHT_PATTERN.exec(combined)
    const quantityMatch = QUANTITY_PATTERN.exec(combined.replace(AMBIGUOUS_COUNT_PATTERN, " "))
    const quantity = quantityMatch?.[1] === undefined ? null : Number(quantityMatch[1])
    const unit = normalizeQuantityUnit(quantityMatch?.[2] ?? null)
    const rawWeightValue = weightMatch?.[1] === undefined ? null : Number(weightMatch[1])
    const rawWeightUnit = weightMatch?.[2] ?? null
    const weightUnit = normalizeWeightUnit(rawWeightUnit)
    const weightValue = normalizeWeightValue(rawWeightValue, rawWeightUnit)
    const normalizedName = normalizeName(cleaned.productName, cleaned.optionName)
    const optionKey = [
      origin ?? "원산지미상",
      grade ?? "등급미상",
      shouldIncludeQuantity(quantity, unit, weightValue) ? `${quantity}${unit ?? ""}` : null,
      weightValue === null ? null : `${formatNumber(weightValue)}${weightUnit ?? ""}`,
      quantity === null && weightValue === null ? normalizeOption(cleaned.optionName) : null,
    ]
      .filter((value) => value !== null && value.length > 0)
      .join("|")

    return {
      normalizedName,
      category: null,
      grade,
      origin,
      quantity,
      unit,
      weightValue,
      weightUnit,
      optionKey,
      confidence: normalizedName.length > 0 && optionKey.length > 0 ? 0.9 : 0.5,
      parserModel: this.modelName,
      parserReason: `Rule-based extraction after marketing cleanup: ${cleaned.removedTerms.join(", ")}`,
    }
  }
}

function normalizeName(productName: string, optionName: string | null): string {
  const optionCore = stripStructuredParts(optionName ?? "")
  const productCore = stripStructuredParts(productName)
  if (
    optionCore.length > 0 &&
    productCore.replace(/\s/gu, "").includes(optionCore.replace(/\s/gu, ""))
  ) {
    return optionCore
  }
  return productCore
}

function stripStructuredParts(value: string): string {
  return normalizeProductAlias(
    normalizeWhitespace(
      value
        .replace(AMBIGUOUS_COUNT_PATTERN, " ")
        .replace(/\([^)]*\d[^)]*\)/gu, " ")
        .replace(/\[[^\]]*\d[^\]]*\]/gu, " ")
        .replace(/\d+(?:\.\d+)?\s*g\s*\*\s*\d+\s*망/giu, " ")
        .replace(ORIGIN_PATTERN, " ")
        .replace(GRADE_PATTERN, " ")
        .replace(QUANTITY_PATTERN, " ")
        .replace(WEIGHT_PATTERN, " ")
        .replace(PRODUCT_NOISE_PATTERN, " ")
        .replace(/[()[\],/]/gu, " "),
    ),
  )
}

function normalizeProductAlias(value: string): string {
  const compact = value.replace(/\s/gu, "")
  if (compact.includes("가정용") && compact.includes("성주") && compact.includes("참외")) {
    return "성주참외"
  }
  if (compact.includes("신비") && compact.includes("복숭아")) {
    return "신비복숭아"
  }
  if (compact.includes("미백") && compact.includes("찰") && compact.includes("옥수수")) {
    return "미백 찰옥수수"
  }
  if (compact.includes("망고스틴")) {
    return "망고스틴"
  }
  if (compact.includes("무지개망고") || compact.includes("마하차녹망고")) {
    return "무지개망고"
  }
  if (compact.includes("홍감자")) {
    return "홍감자"
  }
  return value
}

function normalizeOption(value: string | null): string {
  return value === null ? "기본" : normalizeWhitespace(value)
}

function normalizeOrigin(value: string | null): string | null {
  if (value === null) {
    return null
  }
  return value === "국산" ? "국내산" : value
}

function normalizeQuantityUnit(value: string | null): string | null {
  if (value === null) {
    return null
  }
  return value === "개입" || value === "입" ? "개" : value
}

function normalizeWeightUnit(value: string | null): string | null {
  if (value === null) {
    return null
  }
  return "kg"
}

function normalizeWeightValue(value: number | null, rawUnit: string | null): number | null {
  if (value === null) {
    return null
  }
  return /g|그램/iu.test(rawUnit ?? "") && !/kg/iu.test(rawUnit ?? "") ? value / 1000 : value
}

function shouldIncludeQuantity(
  quantity: number | null,
  unit: string | null,
  weightValue: number | null,
): boolean {
  if (quantity === null) {
    return false
  }
  if (weightValue !== null && (unit === "망" || unit === "과")) {
    return false
  }
  return true
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(value).replace(/0+$/u, "").replace(/\.$/u, "")
}
