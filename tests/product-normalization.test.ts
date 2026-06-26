import { createServer } from "node:http"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { applySchema, DatabaseProductMappingCache } from "../packages/database/src/index.js"
import {
  type NormalizedProduct,
  OpenRouterGeminiFlashClient,
  OpenRouterResponseError,
  ProductNormalizationService,
  type ProductNormalizerClient,
  parseOpenRouterResponse,
} from "../packages/normalizer/src/index.js"

const input = {
  originalProductName: "미백 찰옥수수 특품 30개",
  originalOptionName: "국내산 30입",
  supplierName: "데일리푸드",
} as const

const approvedOutput = {
  normalizedName: "미백 찰옥수수",
  category: "농산물",
  grade: "특품",
  origin: "국내산",
  quantity: 30,
  unit: "개",
  weightValue: null,
  weightUnit: null,
  optionKey: "국내산|특품|30개",
  isFrozen: null,
  confidence: 0.93,
  reason: "상품명과 옵션에서 원산지, 등급, 수량을 확인함",
} as const

class CountingNormalizerClient implements ProductNormalizerClient {
  readonly modelName = "fake-gemini-flash"
  calls = 0

  constructor(private readonly output: NormalizedProduct = approvedOutput) {}

  async normalize(): Promise<NormalizedProduct> {
    this.calls += 1
    return this.output
  }
}

describe("ProductNormalizationService", () => {
  it("calls Gemini once, saves an approved mapping, then reuses the cache", async () => {
    // Given
    const database = new DatabaseSync(":memory:")
    await applySchema(database)
    const cache = new DatabaseProductMappingCache(database)
    const client = new CountingNormalizerClient()
    const service = new ProductNormalizationService(cache, client)

    // When
    const first = await service.normalize(input)
    const second = await service.normalize(input)

    // Then
    const row = database
      .prepare(
        "SELECT status, normalized_name, option_key, confidence FROM product_mapping LIMIT 1",
      )
      .get()
    database.close()
    expect(client.calls).toBe(1)
    expect(first.cacheHit).toBe(false)
    expect(second.cacheHit).toBe(true)
    expect(row).toEqual({
      status: "approved",
      normalized_name: "미백 찰옥수수",
      option_key: "국내산|특품|30개",
      confidence: 0.93,
    })
  })

  it("stores low-confidence Gemini results as pending", async () => {
    // Given
    const database = new DatabaseSync(":memory:")
    await applySchema(database)
    const cache = new DatabaseProductMappingCache(database)
    const client = new CountingNormalizerClient({
      ...approvedOutput,
      confidence: 0.45,
      reason: "규격 정보가 불명확함",
    })
    const service = new ProductNormalizationService(cache, client)

    // When
    const result = await service.normalize(input)

    // Then
    const row = database.prepare("SELECT status FROM product_mapping LIMIT 1").get()
    database.close()
    expect(result.status).toBe("pending")
    expect(row).toEqual({ status: "pending" })
  })
})

describe("OpenRouterGeminiFlashClient", () => {
  it("validates structured JSON returned by OpenRouter", async () => {
    // Given
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  normalized_name: "미백 찰옥수수",
                  category: "농산물",
                  grade: "특품",
                  origin: "국내산",
                  quantity: 30,
                  unit: "개",
                  weight_value: null,
                  weight_unit: null,
                  option_key: "국내산|특품|30개",
                  is_frozen: null,
                  confidence: 0.93,
                  reason: "필드 확인",
                }),
              },
            },
          ],
        }),
      )
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (address === null || typeof address === "string") {
      server.close()
      throw new TypeError("HTTP test server did not expose a TCP address")
    }
    const client = new OpenRouterGeminiFlashClient({
      apiKey: "test-key",
      endpoint: `http://127.0.0.1:${address.port}/chat/completions`,
      model: "google/gemini-3.5-flash",
    })

    // When
    const result = await client.normalize(input).finally(() => server.close())

    // Then
    expect(result).toEqual({
      ...approvedOutput,
      reason: "필드 확인",
    })
  })

  it("rejects content that does not match the normalization JSON schema", () => {
    // Given
    const response = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              normalized_name: "미백 찰옥수수",
              confidence: 2,
            }),
          },
        },
      ],
    }

    // When
    const parse = (): NormalizedProduct => parseOpenRouterResponse(response)

    // Then
    expect(parse).toThrow(OpenRouterResponseError)
  })
})
