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
  it("standardizes weight options and does not let pack counts split same kg options", async () => {
    // Given
    const parser = new RuleBasedProductParser()

    // When
    const parsed = await parser.parse("태국 항공직송 생 망고스틴", "망고스틴5kg(500g*10망)")

    // Then
    expect(parsed).toMatchObject({
      normalizedName: "망고스틴",
      weightValue: 5,
      weightUnit: "kg",
      optionKey: "원산지미상|등급미상|5kg",
    })
  })

  it("keeps mango and mangosteen as different product names", async () => {
    // Given
    const parser = new RuleBasedProductParser()

    // When
    const mango = await parser.parse("마하차녹 무지개망고 시즌오픈 특가", "4kg (14과수내외)")
    const mangosteen = await parser.parse("태국 항공직송 생 망고스틴", "망고스틴 4kg")

    // Then
    expect(mango.normalizedName).toBe("무지개망고")
    expect(mangosteen.normalizedName).toBe("망고스틴")
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
      optionKey: "원산지미상|가정용|10kg",
    })
  })
  it("canonicalizes obvious supplier name aliases", async () => {
    // Given
    const parser = new RuleBasedProductParser()

    // When
    const result = await parser.parse("성주 참외 가정용", "대과 10kg")

    // Then
    expect(result.normalizedName).toBe("성주 참외")
  })
})
