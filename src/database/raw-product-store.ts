import type { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import type { CollectedProduct, RawProductRecord, SupplierConfig } from "../domain/product.js"
import { RawProductRowSchema, toRawProduct } from "./database-rows.js"

export class RawProductStore {
  constructor(private readonly database: DatabaseSync) {}

  upsertSupplier(config: SupplierConfig): void {
    this.database
      .prepare(`
        INSERT INTO suppliers (
          supplier_id, supplier_name, source_type, enabled, auto_order_enabled,
          price_crawling_enabled, schedule_cron, timezone, config_json, updated_at
        ) VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(supplier_id) DO UPDATE SET
          supplier_name = excluded.supplier_name,
          source_type = excluded.source_type,
          enabled = excluded.enabled,
          auto_order_enabled = 0,
          schedule_cron = excluded.schedule_cron,
          timezone = excluded.timezone,
          config_json = excluded.config_json,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(
        config.supplierId,
        config.supplierName,
        config.sourceType,
        config.enabled ? 1 : 0,
        config.schedule.cron,
        config.schedule.timezone,
        JSON.stringify(config),
      )
  }

  replace(
    config: SupplierConfig,
    products: readonly CollectedProduct[],
  ): readonly RawProductRecord[] {
    this.database.exec("BEGIN IMMEDIATE")
    try {
      this.clearSupplierProducts(config.supplierId)
      const sourceFileId = this.insertPriceFile(config, products.length)
      this.insertProducts(sourceFileId, products)
      this.database.exec("COMMIT")
    } catch (error) {
      this.database.exec("ROLLBACK")
      throw error
    }
    return this.getBySupplier(config.supplierId)
  }

  private clearSupplierProducts(supplierId: string): void {
    this.database
      .prepare("DELETE FROM compare_products WHERE cheapest_supplier_id = ?")
      .run(supplierId)
    this.database.prepare("DELETE FROM normalized_products WHERE supplier_id = ?").run(supplierId)
    this.database.prepare("DELETE FROM raw_products WHERE supplier_id = ?").run(supplierId)
  }

  private insertPriceFile(config: SupplierConfig, rowCount: number): number {
    const result = this.database
      .prepare(`
        INSERT INTO supplier_price_files (
          supplier_id, source_type, file_name, source_url, processed_at, status, row_count
        ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'processed', ?)
      `)
      .run(
        config.supplierId,
        config.sourceType,
        `${config.supplierId}-${config.googleSheet.gid}.csv`,
        config.googleSheet.csvExportUrl,
        rowCount,
      )
    return Number(result.lastInsertRowid)
  }

  private insertProducts(sourceFileId: number, products: readonly CollectedProduct[]): void {
    const insert = this.database.prepare(`
      INSERT INTO raw_products (
        supplier_id, source_file_id, source_type, original_product_name,
        original_option_name, price, shipping_fee, stock_status, product_url, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const product of products) {
      insert.run(
        product.supplierId,
        sourceFileId,
        product.sourceType,
        product.originalProductName,
        product.originalOptionName,
        product.price,
        product.shippingFee,
        product.stockStatus,
        product.productUrl,
        product.rawJson,
      )
    }
  }

  private getBySupplier(supplierId: string): readonly RawProductRecord[] {
    const rows = this.database
      .prepare(`
        SELECT id, supplier_id, source_type, original_product_name, original_option_name,
          price, shipping_fee, stock_status, product_url, raw_json
        FROM raw_products
        WHERE supplier_id = ?
        ORDER BY id
      `)
      .all(supplierId)
    return z.array(RawProductRowSchema).parse(rows).map(toRawProduct)
  }
}
