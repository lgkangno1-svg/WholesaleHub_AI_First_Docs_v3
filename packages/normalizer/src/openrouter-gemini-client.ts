import ky from "ky"
import { z } from "zod"
import {
  NORMALIZED_PRODUCT_JSON_SCHEMA,
  OpenRouterNormalizedProductSchema,
  OpenRouterResponseSchema,
} from "./openrouter-schema.js"
import type {
  NormalizedProduct,
  ProductNormalizationInput,
  ProductNormalizerClient,
} from "./types.js"

const OpenRouterConfigSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().min(1).default("google/gemini-3.5-flash"),
  endpoint: z.url().default("https://openrouter.ai/api/v1/chat/completions"),
})

export type OpenRouterGeminiFlashConfig = z.input<typeof OpenRouterConfigSchema>

export class OpenRouterConfigurationError extends Error {
  readonly name = "OpenRouterConfigurationError"

  constructor(options?: ErrorOptions) {
    super("OPENROUTER_API_KEY is required", options)
  }
}

export class OpenRouterResponseError extends Error {
  readonly name = "OpenRouterResponseError"

  constructor(options?: ErrorOptions) {
    super("OpenRouter returned an invalid normalization response", options)
  }
}

export class OpenRouterGeminiFlashClient implements ProductNormalizerClient {
  readonly modelName: string
  private readonly apiKey: string
  private readonly endpoint: string

  constructor(config: OpenRouterGeminiFlashConfig) {
    const parsed = OpenRouterConfigSchema.parse(config)
    this.apiKey = parsed.apiKey
    this.modelName = parsed.model
    this.endpoint = parsed.endpoint
  }

  static fromEnvironment(environment: NodeJS.ProcessEnv): OpenRouterGeminiFlashClient {
    const apiKey = environment["OPENROUTER_API_KEY"]
    if (apiKey === undefined || apiKey.trim().length === 0) {
      throw new OpenRouterConfigurationError()
    }
    return new OpenRouterGeminiFlashClient({
      apiKey,
      model: environment["OPENROUTER_MODEL"] ?? "google/gemini-3.5-flash",
    })
  }

  async normalize(input: ProductNormalizationInput): Promise<NormalizedProduct> {
    const response = await ky
      .post(this.endpoint, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "HTTP-Referer": "https://hub.avocadoss.co.kr",
          "X-OpenRouter-Title": "WholesaleHub",
        },
        retry: { limit: 2 },
        timeout: 30_000,
        json: {
          model: this.modelName,
          messages: [
            {
              role: "system",
              content: [
                "너는 한국 도매 식품/농산물 상품명을 구조화하는 파서다.",
                "반드시 JSON만 출력한다.",
                "상품 상세 설명을 생성하지 않는다.",
                "없는 정보는 null로 둔다.",
                "추측이 강하면 confidence를 낮게 준다.",
              ].join("\n"),
            },
            {
              role: "user",
              content: [
                "다음 상품명을 표준화해줘.",
                `원상품명: ${input.originalProductName}`,
                `옵션명: ${input.originalOptionName ?? ""}`,
                `공급처: ${input.supplierName}`,
              ].join("\n"),
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "wholesale_product_normalization",
              strict: true,
              schema: NORMALIZED_PRODUCT_JSON_SCHEMA,
            },
          },
          provider: {
            require_parameters: true,
          },
        },
      })
      .json()
    return parseOpenRouterResponse(response)
  }
}

export function parseOpenRouterResponse(response: unknown): NormalizedProduct {
  try {
    const envelope = OpenRouterResponseSchema.parse(response)
    const content = envelope.choices[0]?.message.content
    if (content === undefined) {
      throw new OpenRouterResponseError()
    }
    const value = OpenRouterNormalizedProductSchema.parse(JSON.parse(content))
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
      isFrozen: value.is_frozen,
      confidence: value.confidence,
      reason: value.reason,
    }
  } catch (error) {
    if (error instanceof OpenRouterResponseError) {
      throw error
    }
    throw new OpenRouterResponseError({ cause: error })
  }
}
