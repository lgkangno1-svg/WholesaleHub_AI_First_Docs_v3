import type { DatabaseSync } from "node:sqlite"
import { z } from "zod"

const MappingRowSchema = z.object({
  id: z.number().int(),
  mapping_key: z.string(),
  original_product_name: z.string(),
  original_option_name: z.string().nullable(),
  normalized_name: z.string(),
  category: z.string().nullable(),
  grade: z.string().nullable(),
  origin: z.string().nullable(),
  quantity: z.number().nullable(),
  unit: z.enum(["개", "입", "팩", "박스", "망", "kg", "g"]).nullable(),
  weight_value: z.number().nullable(),
  weight_unit: z.enum(["kg", "g"]).nullable(),
  option_key: z.string(),
  is_frozen: z.number().int().nullable(),
  confidence: z.number(),
  status: z.enum(["pending", "approved"]),
  parser_model: z.string(),
  parser_reason: z.string(),
})

export type DatabaseProductMappingRecord = {
  readonly id: number
  readonly mappingKey: string
  readonly originalProductName: string
  readonly originalOptionName: string | null
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
  readonly status: "pending" | "approved"
  readonly parserModel: string
}

export type DatabaseProductMappingSaveInput = Omit<DatabaseProductMappingRecord, "id">

export class DatabaseProductMappingCache {
  constructor(private readonly database: DatabaseSync) {}

  find(mappingKey: string): DatabaseProductMappingRecord | null {
    const row = this.database
      .prepare(`
        SELECT id, mapping_key, original_product_name, original_option_name,
          normalized_name, category, grade, origin, quantity, unit,
          weight_value, weight_unit, option_key, is_frozen, confidence,
          status, parser_model, parser_reason
        FROM product_mapping
        WHERE mapping_key = ?
      `)
      .get(mappingKey)
    return row === undefined ? null : mapRow(MappingRowSchema.parse(row))
  }

  save(input: DatabaseProductMappingSaveInput): DatabaseProductMappingRecord {
    this.database
      .prepare(`
        INSERT INTO product_mapping (
          mapping_key, original_product_name, original_option_name,
          normalized_name, category, grade, origin, quantity, unit,
          weight_value, weight_unit, option_key, is_frozen, confidence,
          status, parser_model, parser_reason, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(mapping_key) DO UPDATE SET
          normalized_name = excluded.normalized_name,
          category = excluded.category,
          grade = excluded.grade,
          origin = excluded.origin,
          quantity = excluded.quantity,
          unit = excluded.unit,
          weight_value = excluded.weight_value,
          weight_unit = excluded.weight_unit,
          option_key = excluded.option_key,
          is_frozen = excluded.is_frozen,
          confidence = excluded.confidence,
          status = excluded.status,
          parser_model = excluded.parser_model,
          parser_reason = excluded.parser_reason,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(
        input.mappingKey,
        input.originalProductName,
        input.originalOptionName,
        input.normalizedName,
        input.category,
        input.grade,
        input.origin,
        input.quantity,
        input.unit,
        input.weightValue,
        input.weightUnit,
        input.optionKey,
        input.isFrozen === null ? null : Number(input.isFrozen),
        input.confidence,
        input.status,
        input.parserModel,
        input.reason,
      )
    const saved = this.find(input.mappingKey)
    if (saved === null) {
      throw new ProductMappingPersistenceError(input.mappingKey)
    }
    return saved
  }
}

export class ProductMappingPersistenceError extends Error {
  readonly name = "ProductMappingPersistenceError"

  constructor(readonly mappingKey: string) {
    super(`Product mapping was not persisted: ${mappingKey}`)
  }
}

function mapRow(row: z.infer<typeof MappingRowSchema>): DatabaseProductMappingRecord {
  return {
    id: row.id,
    mappingKey: row.mapping_key,
    originalProductName: row.original_product_name,
    originalOptionName: row.original_option_name,
    normalizedName: row.normalized_name,
    category: row.category,
    grade: row.grade,
    origin: row.origin,
    quantity: row.quantity,
    unit: row.unit,
    weightValue: row.weight_value,
    weightUnit: row.weight_unit,
    optionKey: row.option_key,
    isFrozen: row.is_frozen === null ? null : row.is_frozen === 1,
    confidence: row.confidence,
    reason: row.parser_reason,
    status: row.status,
    parserModel: row.parser_model,
  }
}
