import { createHash } from "node:crypto"
import type {
  MappingStatus,
  ProductMappingCache,
  ProductNormalizationInput,
  ProductNormalizationResult,
  ProductNormalizerClient,
} from "./types.js"

export class ProductNormalizationService {
  constructor(
    private readonly cache: ProductMappingCache,
    private readonly client: ProductNormalizerClient,
    private readonly approvalThreshold = 0.8,
  ) {}

  async normalize(input: ProductNormalizationInput): Promise<ProductNormalizationResult> {
    const mappingKey = createProductMappingKey(input)
    const cached = this.cache.find(mappingKey)
    if (cached !== null) {
      return { ...cached, cacheHit: true }
    }
    const normalized = await this.client.normalize(input)
    const status: MappingStatus =
      normalized.confidence >= this.approvalThreshold ? "approved" : "pending"
    const saved = this.cache.save({
      ...normalized,
      mappingKey,
      originalProductName: input.originalProductName,
      originalOptionName: input.originalOptionName,
      status,
      parserModel: this.client.modelName,
    })
    return { ...saved, cacheHit: false }
  }
}

export function createProductMappingKey(input: ProductNormalizationInput): string {
  return createHash("sha256")
    .update(`${input.originalProductName.trim()}|${input.originalOptionName?.trim() ?? ""}`)
    .digest("hex")
}
