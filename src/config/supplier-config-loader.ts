import { readFile } from "node:fs/promises"
import { parse } from "yaml"
import { z } from "zod"
import type { SupplierConfig } from "../domain/product.js"

const SupplierConfigFileSchema = z.object({
  supplier_id: z.string().min(1),
  supplier_name: z.string().min(1),
  source_type: z.literal("google_sheet"),
  enabled: z.boolean(),
  google_sheet: z.object({
    spreadsheet_id: z.string().min(1),
    gid: z.string().min(1),
    sheet_url: z.url(),
    csv_export_url: z.url(),
    access_mode: z.literal("csv_export_or_google_oauth"),
  }),
  schedule: z.object({
    timezone: z.string().min(1),
    cron: z.string().min(1),
  }),
  column_mapping: z.object({
    product_name_column: z.string().min(1),
    option_column: z.string().min(1),
    price_column: z.string().min(1),
    stock_column: z.string().min(1),
    memo_column: z.string().min(1),
  }),
  collection: z.object({
    playwright_enabled: z.literal(false),
    auto_order_enabled: z.literal(false),
    data_retention: z.literal("latest_only"),
  }),
})

export class SupplierConfigError extends Error {
  readonly name = "SupplierConfigError"

  constructor(
    readonly configPath: string,
    options?: ErrorOptions,
  ) {
    super(`Invalid supplier config: ${configPath}`, options)
  }
}

export async function loadSupplierConfig(configPath: string): Promise<SupplierConfig> {
  try {
    const yaml = await readFile(configPath, "utf8")
    const value = SupplierConfigFileSchema.parse(parse(yaml))
    return {
      supplierId: value.supplier_id,
      supplierName: value.supplier_name,
      sourceType: value.source_type,
      enabled: value.enabled,
      googleSheet: {
        spreadsheetId: value.google_sheet.spreadsheet_id,
        gid: value.google_sheet.gid,
        sheetUrl: value.google_sheet.sheet_url,
        csvExportUrl: value.google_sheet.csv_export_url,
        accessMode: value.google_sheet.access_mode,
      },
      schedule: value.schedule,
      columnMapping: {
        productNameColumn: value.column_mapping.product_name_column,
        optionColumn: value.column_mapping.option_column,
        priceColumn: value.column_mapping.price_column,
        stockColumn: value.column_mapping.stock_column,
        memoColumn: value.column_mapping.memo_column,
      },
      collection: {
        playwrightEnabled: value.collection.playwright_enabled,
        autoOrderEnabled: value.collection.auto_order_enabled,
        dataRetention: value.collection.data_retention,
      },
    }
  } catch (error) {
    throw new SupplierConfigError(configPath, { cause: error })
  }
}
