import { describe, expect, it } from "vitest"
import { cleanProductText } from "../src/normalization/product-name-cleaner.js"
import { RuleBasedProductParser } from "../src/normalization/rule-based-parser.js"

describe("DailyFood product name cleaner", () => {
  it("removes promotion, date, emoji, and marketing text before normalization", () => {
    // Given
    const productName = "🔥7월 추천템 2026 햇 미백찰옥수수"
    const optionName = "미백 찰옥수수 특품 10개입"

    // When
    const cleaned = cleanProductText(productName, optionName)

    // Then
    expect(cleaned.productName).toBe("미백찰옥수수")
    expect(cleaned.optionName).toBe("미백 찰옥수수 특품 10개입")
    expect(cleaned.removedTerms).toEqual(["7월", "🔥", "추천템", "2026", "햇"])
  })
})

describe("RuleBasedProductParser", () => {
  it("normalizes corn promotion rows into a clean product name and option key", async () => {
    // Given
    const parser = new RuleBasedProductParser()

    // When
    const parsed = await parser.parse(
      "🔥7월 추천템 2026 햇 미백찰옥수수",
      "미백 찰옥수수 특품 10개입",
    )

    // Then
    expect(parsed).toMatchObject({
      normalizedName: "미백 찰옥수수",
      grade: "특품",
      quantity: 10,
      unit: "개",
      optionKey: "원산지미상|특품|10개",
    })
  })

  it("normalizes melon promotion rows into a clean product name and weight option", async () => {
    // Given
    const parser = new RuleBasedProductParser()

    // When
    const parsed = await parser.parse("5 6월 추천템 특가 실중량 ★ 가정용 성주참외", "성주참외 10kg")

    // Then
    expect(parsed).toMatchObject({
      normalizedName: "성주참외",
      quantity: null,
      weightValue: 10,
      weightUnit: "kg",
      optionKey: "원산지미상|등급미상|10kg",
    })
  })
})
