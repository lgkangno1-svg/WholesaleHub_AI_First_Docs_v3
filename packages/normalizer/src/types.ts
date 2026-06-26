export type MappingStatus = "pending" | "approved"

export type ProductNormalizationInput = {
  readonly originalProductName: string
  readonly originalOptionName: string | null
  readonly supplierName: string
}

export type NormalizedProduct = {
  readonly normalizedName: string
  readonly category: string | null
  readonly grade: string | null
  readonly origin: string | null
  readonly quantity: number | null
  readonly unit: "개" | "입" | "팩" | "박스" | "망" | "kg" | "g" | null
  readonly weightValue: number | null
  readonly weightUnit: "kg" | "g" | null
  readonly optionKey: string
  readonly isFrozen: boolean | null
  readonly confidence: number
  readonly reason: string
}

export type ProductMappingRecord = NormalizedProduct & {
  readonly id: number
  readonly mappingKey: string
  readonly originalProductName: string
  readonly originalOptionName: string | null
  readonly status: MappingStatus
  readonly parserModel: string
}

export type ProductMappingSaveInput = Omit<ProductMappingRecord, "id">

export interface ProductMappingCache {
  find(mappingKey: string): ProductMappingRecord | null
  save(input: ProductMappingSaveInput): ProductMappingRecord
}

export interface ProductNormalizerClient {
  readonly modelName: string
  normalize(input: ProductNormalizationInput): Promise<NormalizedProduct>
}

export type ProductNormalizationResult = ProductMappingRecord & {
  readonly cacheHit: boolean
}
