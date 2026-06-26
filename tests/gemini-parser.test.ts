import { describe, expect, it } from "vitest"
import { parseGeminiResponse } from "../src/normalization/gemini-flash-parser.js"
import { parseOpenRouterGeminiResponse } from "../src/normalization/openrouter-gemini-parser.js"

describe("parseGeminiResponse", () => {
  it("parses structured Gemini JSON into a normalized product", () => {
    // Given
    const response = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  normalized_name: "미백 찰옥수수",
                  category: "농산물",
                  grade: "특품",
                  origin: "국내산",
                  quantity: 5,
                  unit: "개",
                  weight_value: null,
                  weight_unit: null,
                  option_key: "국내산|특품|5개",
                  confidence: 0.95,
                  reason: "상품명과 규격에서 추출",
                }),
              },
            ],
          },
        },
      ],
    }

    // When
    const result = parseGeminiResponse(response, "gemini-2.5-flash")

    // Then
    expect(result.optionKey).toBe("국내산|특품|5개")
    expect(result.parserModel).toBe("gemini-2.5-flash")
  })
})

describe("parseOpenRouterGeminiResponse", () => {
  it("parses structured OpenRouter Gemini JSON into a normalized product", () => {
    // Given
    const response = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              normalized_name: "미백 찰옥수수",
              category: "농산물",
              grade: "특품",
              origin: "국내산",
              quantity: 10,
              unit: "개입",
              weight_value: null,
              weight_unit: null,
              option_key: "국내산|특품|10개입",
              confidence: 0.95,
              reason: "상품명과 옵션명에서 추출",
            }),
          },
        },
      ],
    }

    // When
    const result = parseOpenRouterGeminiResponse(response, "google/gemini-2.5-flash")

    // Then
    expect(result).toMatchObject({
      normalizedName: "미백 찰옥수수",
      optionKey: "국내산|특품|10개입",
      quantity: 10,
      unit: "개입",
      weightValue: null,
      weightUnit: null,
      confidence: 0.95,
      parserModel: "google/gemini-2.5-flash",
    })
  })
})
