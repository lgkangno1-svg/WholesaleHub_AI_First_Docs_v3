import ky from "ky"
import { z } from "zod"
import type { ParsedProduct, ProductParser } from "../domain/product.js"

const OpenRouterGeminiProductSchema = z.object({
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

const OpenRouterChatResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().min(1) }) })).min(1),
})

const OPENROUTER_PRODUCT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
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
    normalized_name: { type: "string" },
    category: { type: ["string", "null"] },
    grade: { type: ["string", "null"] },
    origin: { type: ["string", "null"] },
    quantity: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
    weight_value: { type: ["number", "null"] },
    weight_unit: { type: ["string", "null"] },
    option_key: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string" },
  },
} as const

export class OpenRouterGeminiConfigurationError extends Error {
  readonly name = "OpenRouterGeminiConfigurationError"

  constructor() {
    super("OPENROUTER_API_KEY or GEMINI_API_KEY is required for OpenRouter Gemini")
  }
}

export class OpenRouterGeminiResponseError extends Error {
  readonly name = "OpenRouterGeminiResponseError"

  constructor(
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`OpenRouter Gemini response could not be parsed: ${reason}`, options)
  }
}

export class OpenRouterGeminiProductParser implements ProductParser {
  readonly modelName: string
  private readonly apiKey: string
  private readonly endpoint: string

  constructor(options: {
    readonly apiKey: string
    readonly modelName?: string
    readonly endpoint?: string
  }) {
    if (options.apiKey.trim().length === 0) {
      throw new OpenRouterGeminiConfigurationError()
    }
    this.apiKey = options.apiKey
    this.modelName = options.modelName ?? "google/gemini-2.5-flash"
    this.endpoint = options.endpoint ?? "https://openrouter.ai/api/v1/chat/completions"
  }

  static fromEnvironment(environment: NodeJS.ProcessEnv): OpenRouterGeminiProductParser {
    const apiKey = environment["OPENROUTER_API_KEY"]?.trim()
      ? environment["OPENROUTER_API_KEY"]
      : (environment["GEMINI_API_KEY"] ?? "")
    return new OpenRouterGeminiProductParser({
      apiKey,
      modelName: environment["OPENROUTER_MODEL"] ?? "google/gemini-2.5-flash",
    })
  }

  async parse(productName: string, optionName: string | null): Promise<ParsedProduct> {
    const response = await ky
      .post(this.endpoint, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "HTTP-Referer": "https://hub.avocadoss.co.kr",
          "X-OpenRouter-Title": "WholesaleHub",
        },
        retry: { limit: 1 },
        timeout: 30_000,
        json: {
          model: this.modelName,
          messages: [
            { role: "system", content: buildSystemPrompt() },
            {
              role: "user",
              content: [
                `원상품명: ${productName}`,
                `옵션명: ${optionName ?? ""}`,
                "normalized_name, category, grade, origin, quantity, unit, weight_value, weight_unit, option_key, confidence, reason을 추출해줘.",
              ].join("\n"),
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "wholesale_product_normalization",
              strict: true,
              schema: OPENROUTER_PRODUCT_JSON_SCHEMA,
            },
          },
        },
      })
      .json()
    return parseOpenRouterGeminiResponse(response, this.modelName)
  }
}

export function parseOpenRouterGeminiResponse(response: unknown, modelName: string): ParsedProduct {
  try {
    const envelope = OpenRouterChatResponseSchema.parse(response)
    const content = envelope.choices[0]?.message.content
    if (content === undefined) {
      throw new OpenRouterGeminiResponseError("message content is missing")
    }
    const value = OpenRouterGeminiProductSchema.parse(JSON.parse(content))
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
    if (error instanceof OpenRouterGeminiResponseError) {
      throw error
    }
    throw new OpenRouterGeminiResponseError("invalid JSON or schema", { cause: error })
  }
}

function buildSystemPrompt(): string {
  return [
    "너는 한국 농산물 도매 상품명을 표준 상품명과 옵션 정보로 정규화한다.",
    "반드시 JSON만 반환하고, 모르는 값은 null로 둔다.",
    "normalized_name에는 프로모션, 날짜, 시즌, 이모지, 마케팅 문구를 절대 넣지 않는다.",
    "제거 대상 예: 🔥, ★, 추천템, 특가, 실중량, 2026, 햇, 5 6월, 6월, 7월, 행사, 한정, MD추천, md 추천.",
    "normalized_name은 순수 상품명만 남긴다. 예: '🔥7월 추천템 2026 햇 미백찰옥수수'는 '미백 찰옥수수'.",
    "option_key는 원산지|등급|수량/중량 순서로 구성한다. 모르면 원산지미상, 등급미상.",
  ].join("\n")
}
