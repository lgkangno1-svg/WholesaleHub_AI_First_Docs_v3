export type SupplierConfig = {
  readonly supplierId: string
  readonly supplierName: string
  readonly sourceType: "google_sheet" | "google_sheet_htmlview" | "website" | "excel_download"
  readonly enabled: boolean
  readonly googleSheet: {
    readonly spreadsheetId: string
    readonly gid: string
    readonly sheetUrl: string
    readonly csvExportUrl: string
    readonly accessMode: "csv_export_or_google_oauth"
  }
  readonly schedule: {
    readonly timezone: string
    readonly cron: string
  }
  readonly columnMapping: {
    readonly productNameColumn: string
    readonly optionColumn: string
    readonly priceColumn: string
    readonly stockColumn: string | null
    readonly memoColumn: string
  }
  readonly collection: {
    readonly playwrightEnabled: false
    readonly autoOrderEnabled: false
    readonly dataRetention: "latest_only"
  }
}

export type CollectedProduct = {
  readonly supplierId: string
  readonly sourceType:
    | "google_sheet"
    | "google_sheet_htmlview"
    | "website"
    | "excel_download"
    | "website"
  readonly originalProductName: string
  readonly originalOptionName: string | null
  readonly price: number
  readonly shippingFee: number
  readonly stockStatus: "in_stock" | "out_of_stock" | "unknown"
  readonly productUrl: string | null
  readonly rawJson: string
}

export type DailyFoodSkipReason =
  | "empty_product_name_without_context"
  | "missing_price"
  | "invalid_price"
  | "empty_row"
  | "etc"

export type DailyFoodSkippedRowsByReason = Record<DailyFoodSkipReason, number>

export type ParsedProduct = {
  readonly normalizedName: string
  readonly category: string | null
  readonly grade: string | null
  readonly origin: string | null
  readonly quantity: number | null
  readonly unit: string | null
  readonly weightValue: number | null
  readonly weightUnit: string | null
  readonly optionKey: string
  readonly confidence: number
  readonly parserModel: string
  readonly parserReason: string
}

export type RawProductRecord = CollectedProduct & {
  readonly id: number
}

export type ProductMappingRecord = ParsedProduct & {
  readonly id: number
  readonly mappingKey: string
  readonly status: "pending" | "approved"
}

export type PriceCandidate = {
  readonly rawProductId: number
  readonly supplierId: string
  readonly normalizedName: string
  readonly optionKey: string
  readonly price: number
  readonly unitPrice: number
  readonly stockStatus: "in_stock" | "out_of_stock" | "unknown"
  readonly productUrl: string | null
}

export type CompareProduct = PriceCandidate & {
  readonly compareKey: string
}

export interface ProductParser {
  readonly modelName: string
  parse(productName: string, optionName: string | null): Promise<ParsedProduct>
}

export type WooCommerceDryRunPayload = {
  readonly product_id?: number
  readonly variation_id?: number
  readonly regular_price: string
  readonly stock_status: "instock" | "outofstock"
  readonly manage_stock: false
}
