import type { ParsedProduct, ProductParser } from "../domain/product.js"

const ORIGIN_PATTERN = /(국내산|국산|수입산|미국산|중국산|호주산)/
const GRADE_PATTERN = /(특품|상품|상급|중품|실속|프리미엄)/
const QUANTITY_PATTERN = /(\d+(?:\.\d+)?)\s*(개입|개|입|망|팩|봉|박스|과)/
const WEIGHT_PATTERN = /(\d+(?:\.\d+)?)\s*(kg|g|킬로|그램)/i

export class RuleBasedProductParser implements ProductParser {
  readonly modelName = "rule-based-v1"

  async parse(productName: string, optionName: string | null): Promise<ParsedProduct> {
    const combined = `${productName} ${optionName ?? ""}`
    const origin = ORIGIN_PATTERN.exec(combined)?.[1] ?? null
    const grade = GRADE_PATTERN.exec(combined)?.[1] ?? null
    const quantityMatch = QUANTITY_PATTERN.exec(combined)
    const weightMatch = WEIGHT_PATTERN.exec(combined)
    const quantity = quantityMatch?.[1] === undefined ? null : Number(quantityMatch[1])
    const unit = quantityMatch?.[2] ?? null
    const weightValue = weightMatch?.[1] === undefined ? null : Number(weightMatch[1])
    const weightUnit = normalizeWeightUnit(weightMatch?.[2] ?? null)
    const normalizedName = normalizeName(productName)
    const optionKey = [
      origin ?? "원산지미상",
      grade ?? "등급미상",
      quantity === null ? null : `${quantity}${unit ?? ""}`,
      weightValue === null ? null : `${weightValue}${weightUnit ?? ""}`,
      quantity === null && weightValue === null ? normalizeOption(optionName) : null,
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
      parserReason: "Rule-based extraction of origin, grade, quantity, and weight",
    }
  }
}

function normalizeName(value: string): string {
  return value
    .replace(/[🔥⭐✅✨💥]/gu, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\b햇\b/g, " ")
    .replace(ORIGIN_PATTERN, " ")
    .replace(GRADE_PATTERN, " ")
    .replace(QUANTITY_PATTERN, " ")
    .replace(WEIGHT_PATTERN, " ")
    .replace(/[()[\],/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeOption(value: string | null): string {
  return value?.replace(/\s+/g, " ").trim() ?? "기본"
}

function normalizeWeightUnit(value: string | null): string | null {
  if (value === null) {
    return null
  }
  return /kg|킬로/i.test(value) ? "kg" : "g"
}
