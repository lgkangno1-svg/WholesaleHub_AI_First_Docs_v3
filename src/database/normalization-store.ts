import type { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import type {
  CompareProduct,
  ParsedProduct,
  PriceCandidate,
  ProductMappingRecord,
  RawProductRecord,
} from "../domain/product.js"
import { CandidateRowSchema, MappingRowSchema, toCandidate, toMapping } from "./database-rows.js"

export class NormalizationStore {
  constructor(private readonly database: DatabaseSync) {}

  findMapping(mappingKey: string): ProductMappingRecord | null {
    const row = this.database
      .prepare(`
        SELECT id, mapping_key, normalized_name, category, grade, origin, quantity, unit,
          weight_value, weight_unit, option_key, confidence, status, parser_model, parser_reason
        FROM product_mapping
        WHERE mapping_key = ?
      `)
      .get(mappingKey)
    return row === undefined ? null : toMapping(MappingRowSchema.parse(row))
  }

  saveMapping(
    mappingKey: string,
    raw: RawProductRecord,
    parsed: ParsedProduct,
  ): ProductMappingRecord {
    const status = parsed.confidence >= 0.8 ? "approved" : "pending"
    this.database
      .prepare(`
        INSERT INTO product_mapping (
          mapping_key, original_product_name, original_option_name, normalized_name,
          category, grade, origin, quantity, unit, weight_value, weight_unit, option_key,
          confidence, status, parser_model, parser_reason, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `)
      .run(
        mappingKey,
        raw.originalProductName,
        raw.originalOptionName,
        parsed.normalizedName,
        parsed.category,
        parsed.grade,
        parsed.origin,
        parsed.quantity,
        parsed.unit,
        parsed.weightValue,
        parsed.weightUnit,
        parsed.optionKey,
        parsed.confidence,
        status,
        parsed.parserModel,
        parsed.parserReason,
      )
    const saved = this.findMapping(mappingKey)
    if (saved === null) {
      throw new MappingPersistenceError(mappingKey)
    }
    return saved
  }

  insertNormalized(raw: RawProductRecord, mapping: ProductMappingRecord): void {
    const divisor = mapping.quantity ?? mapping.weightValue ?? 1
    this.database
      .prepare(`
        INSERT INTO normalized_products (
          raw_product_id, supplier_id, normalized_name, category, grade, origin,
          quantity, unit, weight_value, weight_unit, option_key, price, unit_price,
          stock_status, product_url, mapping_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        raw.id,
        raw.supplierId,
        mapping.normalizedName,
        mapping.category,
        mapping.grade,
        mapping.origin,
        mapping.quantity,
        mapping.unit,
        mapping.weightValue,
        mapping.weightUnit,
        mapping.optionKey,
        raw.price,
        raw.price / divisor,
        raw.stockStatus,
        raw.productUrl,
        mapping.id,
      )
  }

  getPriceCandidates(): readonly PriceCandidate[] {
    const rows = this.database
      .prepare(`
        SELECT n.raw_product_id, n.supplier_id, n.normalized_name, n.option_key, n.price,
          n.unit_price, n.stock_status, n.product_url
        FROM normalized_products n
        JOIN product_mapping m ON m.id = n.mapping_id
        JOIN suppliers s ON s.supplier_id = n.supplier_id
        WHERE m.status = 'approved'
          AND s.enabled = 1
          AND n.price > 0
          AND n.stock_status != 'out_of_stock'
      `)
      .all()
    return z.array(CandidateRowSchema).parse(rows).map(toCandidate)
  }

  replaceCompareProducts(products: readonly CompareProduct[]): void {
    this.database.exec("DELETE FROM compare_products")
    const insert = this.database.prepare(`
      INSERT INTO compare_products (
        compare_key, normalized_name, option_key, cheapest_supplier_id,
        cheapest_raw_product_id, cheapest_price, cheapest_unit_price,
        stock_status, product_url, calculated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    for (const product of products) {
      insert.run(
        product.compareKey,
        product.normalizedName,
        product.optionKey,
        product.supplierId,
        product.rawProductId,
        product.price,
        product.unitPrice,
        product.stockStatus,
        product.productUrl,
      )
    }
  }
}

export class MappingPersistenceError extends Error {
  readonly name = "MappingPersistenceError"

  constructor(readonly mappingKey: string) {
    super(`Mapping was not persisted: ${mappingKey}`)
  }
}
