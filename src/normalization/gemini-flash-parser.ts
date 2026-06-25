import ky from "ky"
import { z } from "zod"
import type { ParsedProduct, ProductParser } from "../domain/product.js"

const GeminiProductSchema = z.object({
  normalized_name: z.string().min(1),
  category: z.string().nullable(),
  grade: z.string().nullable(),
  origin: z.string().nullable(),
  quantity: z.number().positive().nullable(),
  unit: z.string().nullable(),
  weight_value: z.number().positive().nullable(),
  weight_unit: z.string().nullable(),
  option_key: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
})

const GeminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({
          parts: z.array(z.object({ text: z.string() })).min(1),
        }),
      }),
    )
    .min(1),
})

export class GeminiConfigurationError extends Error {
  readonly name = "GeminiConfigurationError"

  constructor() {
    super("GEMINI_API_KEY is required to use GeminiFlashProductParser")
  }
}

export class GeminiResponseError extends Error {
  readonly name = "GeminiResponseError"

  constructor(
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`Gemini response could not be parsed: ${reason}`, options)
  }
}

export class GeminiFlashProductParser implements ProductParser {
  readonly modelName: string

  constructor(
    private readonly apiKey: string,
    modelName = "gemini-2.5-flash",
  ) {
    if (apiKey.length === 0) {
      throw new GeminiConfigurationError()
    }
    this.modelName = modelName
  }

  async parse(productName: string, optionName: string | null): Promise<ParsedProduct> {
    const response = await ky
      .post(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent`,
        {
          searchParams: { key: this.apiKey },
          retry: { limit: 2 },
          timeout: 30_000,
          json: {
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: buildPrompt(productName, optionName),
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                required: [
                  "normalized_name",
                  "category",
                  "grade",
                  "origin",
                  "quantity",
                  "unit",
                  "weight_value",
                  "weight_unit",
                  "option_key",
                  "confidence",
                  "reason",
                ],
                properties: {
                  normalized_name: { type: "STRING" },
                  category: { type: ["STRING", "NULL"] },
                  grade: { type: ["STRING", "NULL"] },
                  origin: { type: ["STRING", "NULL"] },
                  quantity: { type: ["NUMBER", "NULL"] },
                  unit: { type: ["STRING", "NULL"] },
                  weight_value: { type: ["NUMBER", "NULL"] },
                  weight_unit: { type: ["STRING", "NULL"] },
                  option_key: { type: "STRING" },
                  confidence: { type: "NUMBER" },
                  reason: { type: "STRING" },
                },
              },
            },
          },
        },
      )
      .json()
    return parseGeminiResponse(response, this.modelName)
  }
}

export function parseGeminiResponse(response: unknown, modelName: string): ParsedProduct {
  try {
    const envelope = GeminiResponseSchema.parse(response)
    const text = envelope.candidates[0]?.content.parts[0]?.text
    if (text === undefined) {
      throw new GeminiResponseError("response text is missing")
    }
    const value = GeminiProductSchema.parse(JSON.parse(text))
    return {
      normalizedName: value.normalized_name,
      category: value.category,
      grade: value.grade,
      origin: value.origin,
      quantity: value.quantity,
      unit: value.unit,
      weightValue: value.weight_value,
      weightUnit: value.weight_unit,
      optionKey: value.option_key,
      confidence: value.confidence,
      parserModel: modelName,
      parserReason: value.reason,
    }
  } catch (error) {
    if (error instanceof GeminiResponseError) {
      throw error
    }
    throw new GeminiResponseError("invalid JSON or schema", { cause: error })
  }
}

function buildPrompt(productName: string, optionName: string | null): string {
  return [
    "한국 농수산물 도매 상품명을 동일 상품 비교용으로 정규화하세요.",
    "홍보 문구, 연도, 이모지를 제거하고 원산지·등급·수량·중량을 분리하세요.",
    "option_key는 원산지|등급|수량 또는 중량 순서의 안정적인 문자열이어야 합니다.",
    `상품명: ${productName}`,
    `옵션: ${optionName ?? ""}`,
  ].join("\n")
}
