export type StockStatus = "in_stock" | "out_of_stock" | "unknown"

export type RawProduct = {
  readonly supplierId: string
  readonly sourceType: "google_sheet" | "google_sheet_htmlview" | "google_sheet_htmlview"
  readonly originalProductName: string
  readonly originalOptionName: string | null
  readonly price: number
  readonly shippingFee: number
  readonly stockStatus: StockStatus
  readonly productUrl: string | null
  readonly rawJson: string
}

export type DailyFoodSupplierConfig = {
  readonly supplierId: "dailyfood"
  readonly supplierName: string
  readonly sourceType: "google_sheet" | "google_sheet_htmlview" | "google_sheet_htmlview"
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

export const ADMINPLUS_COLLECT_ONLY_FIELDS = [
  "product_name",
  "option_text",
  "price",
  "stock_status",
  "product_url",
] as const

export type AdminPlusCollectOnlyField = (typeof ADMINPLUS_COLLECT_ONLY_FIELDS)[number]

export type AdminPlusCollectedProduct = {
  readonly productName: string
  readonly optionText: string | null
  readonly price: number
  readonly stockStatus: StockStatus
  readonly productUrl: string | null
}

export type AdminPlusSiteConfig = {
  readonly supplierId: string
  readonly supplierName: string
  readonly enabled: boolean
  readonly listUrls: readonly string[]
  readonly allowedHosts: readonly string[]
  readonly allowedPathPrefixes: readonly string[]
  readonly forbiddenPathPatterns: readonly string[]
  readonly collectOnly: readonly AdminPlusCollectOnlyField[]
  readonly selectors: {
    readonly row: string
    readonly productName: string
    readonly optionText: string
    readonly price: string
    readonly stockStatus: string
    readonly productUrl: string
    readonly securityWarning?: string
  }
  readonly outOfStockTexts?: readonly string[]
  readonly storageStatePath?: string
  readonly maxPages: number
}

export type AdminPlusSitesConfig = {
  readonly schedule: {
    readonly timezone: "Asia/Seoul"
    readonly cron: "0 11 * * *"
    readonly maxRunsPerDay: 1
  }
  readonly sites: readonly AdminPlusSiteConfig[]
}

export interface AdminPlusPageCollector {
  collect(
    site: AdminPlusSiteConfig,
    signal?: AbortSignal,
  ): Promise<readonly AdminPlusCollectedProduct[]>
}

export interface AdminPlusRunGate {
  runOnce<T>(supplierId: string, date: string, task: () => Promise<T>): Promise<T>
}
