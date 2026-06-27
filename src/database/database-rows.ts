import { z } from "zod"
import type { PriceCandidate, ProductMappingRecord, RawProductRecord } from "../domain/product.js"

export const RawProductRowSchema = z.object({
  id: z.number().int(),
  supplier_id: z.string(),
  source_type: z.enum(["google_sheet", "website", "excel_download"]),
  original_product_name: z.string(),
  original_option_name: z.string().nullable(),
  price: z.number().int(),
  shipping_fee: z.number().int(),
  stock_status: z.enum(["in_stock", "out_of_stock", "unknown"]),
  product_url: z.string().nullable(),
  raw_json: z.string(),
})

export const MappingRowSchema = z.object({
  id: z.number().int(),
  mapping_key: z.string(),
  normalized_name: z.string(),
  category: z.string().nullable(),
  grade: z.string().nullable(),
  origin: z.string().nullable(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  weight_value: z.number().nullable(),
  weight_unit: z.string().nullable(),
  option_key: z.string(),
  confidence: z.number(),
  status: z.enum(["pending", "approved"]),
  parser_model: z.string(),
  parser_reason: z.string(),
})

export const CandidateRowSchema = z.object({
  raw_product_id: z.number().int(),
  supplier_id: z.string(),
  normalized_name: z.string(),
  option_key: z.string(),
  price: z.number().int(),
  unit_price: z.number(),
  stock_status: z.enum(["in_stock", "out_of_stock", "unknown"]),
  product_url: z.string().nullable(),
})

export function toRawProduct(row: z.infer<typeof RawProductRowSchema>): RawProductRecord {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    sourceType: row.source_type,
    originalProductName: row.original_product_name,
    originalOptionName: row.original_option_name,
    price: row.price,
    shippingFee: row.shipping_fee,
    stockStatus: row.stock_status,
    productUrl: row.product_url,
    rawJson: row.raw_json,
  }
}

export function toMapping(row: z.infer<typeof MappingRowSchema>): ProductMappingRecord {
  return {
    id: row.id,
    mappingKey: row.mapping_key,
    normalizedName: row.normalized_name,
    category: row.category,
    grade: row.grade,
    origin: row.origin,
    quantity: row.quantity,
    unit: row.unit,
    weightValue: row.weight_value,
    weightUnit: row.weight_unit,
    optionKey: row.option_key,
    confidence: row.confidence,
    status: row.status,
    parserModel: row.parser_model,
    parserReason: row.parser_reason,
  }
}

export function toCandidate(row: z.infer<typeof CandidateRowSchema>): PriceCandidate {
  return {
    rawProductId: row.raw_product_id,
    supplierId: row.supplier_id,
    normalizedName: row.normalized_name,
    optionKey: row.option_key,
    price: row.price,
    unitPrice: row.unit_price,
    stockStatus: row.stock_status,
    productUrl: row.product_url,
  }
}
