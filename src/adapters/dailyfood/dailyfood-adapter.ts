import { parse } from "csv-parse/sync"
import ky from "ky"
import { z } from "zod"
import type { CollectedProduct, SupplierConfig } from "../../domain/product.js"

const CsvRowsSchema = z.array(z.array(z.string()))
const PRODUCT_ALIASES = ["상품명"] as const
const OPTION_ALIASES = ["규격", "중량", "옵션"] as const
const PRICE_ALIASES = ["판매가", "단가", "가격"] as const
const STOCK_ALIASES = ["재고", "재고상태"] as const
const MEMO_ALIASES = ["비고", "md 코멘트", "메모"] as const
const URL_ALIASES = ["발주&단가 상담 링크", "상품 링크", "링크"] as const

export class DailyFoodCsvError extends Error {
  readonly name = "DailyFoodCsvError"

  constructor(readonly reason: string) {
    super(`DailyFood CSV parsing failed: ${reason}`)
  }
}

export type DailyFoodParseResult = {
  readonly products: readonly CollectedProduct[]
  readonly skippedRows: number
}

export async function fetchDailyFoodCsv(
  config: SupplierConfig,
  signal?: AbortSignal,
): Promise<string> {
  const signalOption = signal === undefined ? {} : { signal }
  return ky
    .get(config.googleSheet.csvExportUrl, {
      retry: { limit: 2 },
      timeout: 30_000,
      ...signalOption,
    })
    .text()
}

export function parseDailyFoodCsv(csv: string, config: SupplierConfig): DailyFoodParseResult {
  const rows = CsvRowsSchema.parse(
    parse(csv, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: true,
    }),
  )
  const headerIndex = rows.findIndex((row) => row.some((cell) => matches(cell, PRODUCT_ALIASES)))
  if (headerIndex < 0) {
    throw new DailyFoodCsvError("상품명 header was not found")
  }

  const header = rows[headerIndex]
  if (header === undefined) {
    throw new DailyFoodCsvError("header row is missing")
  }
  const indexes = {
    product: findColumn(header, [config.columnMapping.productNameColumn, ...PRODUCT_ALIASES]),
    option: findColumn(header, [config.columnMapping.optionColumn, ...OPTION_ALIASES]),
    price: findColumn(header, [config.columnMapping.priceColumn, ...PRICE_ALIASES]),
    stock: findOptionalColumn(header, [config.columnMapping.stockColumn, ...STOCK_ALIASES]),
    memo: findOptionalColumn(header, [config.columnMapping.memoColumn, ...MEMO_ALIASES]),
    url: findOptionalColumn(header, URL_ALIASES),
  }

  const products: CollectedProduct[] = []
  let skippedRows = 0
  for (const row of rows.slice(headerIndex + 1)) {
    const productName = cleanCell(row[indexes.product])
    const price = parsePrice(row[indexes.price])
    if (productName.length === 0 || price === null) {
      skippedRows += 1
      continue
    }
    const optionName = cleanCell(row[indexes.option])
    const stockText = [readOptional(row, indexes.stock), readOptional(row, indexes.memo)].join(" ")
    const productUrl = readOptional(row, indexes.url)
    products.push({
      supplierId: config.supplierId,
      sourceType: config.sourceType,
      originalProductName: productName,
      originalOptionName: optionName.length > 0 ? optionName : null,
      price,
      shippingFee: 0,
      stockStatus: parseStockStatus(stockText),
      productUrl: productUrl.length > 0 ? productUrl : null,
      rawJson: JSON.stringify(row),
    })
  }
  return { products, skippedRows }
}

function normalizeHeader(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("ko-KR")
}

function matches(value: string, candidates: readonly string[]): boolean {
  const normalized = normalizeHeader(value)
  return candidates.some((candidate) => normalized === normalizeHeader(candidate))
}

function findColumn(header: readonly string[], candidates: readonly string[]): number {
  const index = findOptionalColumn(header, candidates)
  if (index === null) {
    throw new DailyFoodCsvError(`required column not found: ${candidates.join(", ")}`)
  }
  return index
}

function findOptionalColumn(
  header: readonly string[],
  candidates: readonly string[],
): number | null {
  const index = header.findIndex((cell) => matches(cell, candidates))
  return index >= 0 ? index : null
}

function cleanCell(value: string | undefined): string {
  return value?.replace(/\r/g, "").trim() ?? ""
}

function readOptional(row: readonly string[], index: number | null): string {
  return index === null ? "" : cleanCell(row[index])
}

function parsePrice(value: string | undefined): number | null {
  const digits = cleanCell(value).replace(/[^\d]/g, "")
  if (digits.length === 0) {
    return null
  }
  const price = Number.parseInt(digits, 10)
  return Number.isSafeInteger(price) && price > 0 ? price : null
}

function parseStockStatus(value: string): CollectedProduct["stockStatus"] {
  if (/품절|sold\s*out|재고\s*없음/i.test(value)) {
    return "out_of_stock"
  }
  if (/판매중|재고\s*있음|in\s*stock/i.test(value)) {
    return "in_stock"
  }
  return "unknown"
}
