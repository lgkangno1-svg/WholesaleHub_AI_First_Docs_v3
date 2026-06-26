import type { DatabaseSync } from "node:sqlite"
import { z } from "zod"

const CandidateRowSchema = z.object({
  raw_product_id: z.number().int(),
  supplier_id: z.string(),
  normalized_name: z.string(),
  option_key: z.string(),
  price: z.number(),
  unit_price: z.number().nullable(),
  stock_status: z.string().nullable(),
  mapping_status: z.string(),
  supplier_enabled: z.number().int(),
  product_url: z.string().nullable(),
})

export type DatabasePriceComparisonCandidate = {
  readonly rawProductId: number
  readonly supplierId: string
  readonly normalizedName: string
  readonly optionKey: string
  readonly price: number
  readonly unitPrice: number | null
  readonly stockStatus: string | null
  readonly mappingStatus: string
  readonly supplierEnabled: boolean
  readonly productUrl: string | null
}

export type DatabaseCompareProductResult = {
  readonly compareKey: string
  readonly rawProductId: number
  readonly supplierId: string
  readonly normalizedName: string
  readonly optionKey: string
  readonly price: number
  readonly unitPrice: number
  readonly stockStatus: string | null
  readonly productUrl: string | null
}

export class DatabasePriceComparisonStore {
  constructor(private readonly database: DatabaseSync) {}

  loadCandidates(): readonly DatabasePriceComparisonCandidate[] {
    const rows = z.array(CandidateRowSchema).parse(
      this.database
        .prepare(`
          SELECT n.raw_product_id, n.supplier_id, n.normalized_name, n.option_key,
            n.price, n.unit_price, n.stock_status, n.product_url,
            m.status AS mapping_status, s.enabled AS supplier_enabled
          FROM normalized_products n
          JOIN product_mapping m ON m.id = n.mapping_id
          JOIN suppliers s ON s.supplier_id = n.supplier_id
        `)
        .all(),
    )
    return rows.map((row) => ({
      rawProductId: row.raw_product_id,
      supplierId: row.supplier_id,
      normalizedName: row.normalized_name,
      optionKey: row.option_key,
      price: row.price,
      unitPrice: row.unit_price,
      stockStatus: row.stock_status,
      mappingStatus: row.mapping_status,
      supplierEnabled: row.supplier_enabled === 1,
      productUrl: row.product_url,
    }))
  }

  replaceResults(results: readonly DatabaseCompareProductResult[]): void {
    this.database.exec("BEGIN IMMEDIATE")
    try {
      this.database.exec("DELETE FROM compare_products")
      const insert = this.database.prepare(`
        INSERT INTO compare_products (
          compare_key, normalized_name, option_key, cheapest_supplier_id,
          cheapest_raw_product_id, cheapest_price, cheapest_unit_price,
          stock_status, product_url, calculated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `)
      for (const result of results) {
        insert.run(
          result.compareKey,
          result.normalizedName,
          result.optionKey,
          result.supplierId,
          result.rawProductId,
          result.price,
          result.unitPrice,
          result.stockStatus,
          result.productUrl,
        )
      }
      this.database.exec("COMMIT")
    } catch (error) {
      this.database.exec("ROLLBACK")
      throw error
    }
  }
}
