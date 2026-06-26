import { parse } from "csv-parse/sync"
import { z } from "zod"
import type { DailyFoodSupplierConfig, RawProduct, StockStatus } from "./types.js"

const CsvRowsSchema = z.array(z.array(z.string()))
const OPTION_ALIASES = ["규격", "중량", "옵션"] as const
const PRICE_ALIASES = ["판매가", "단가", "가격"] as const
const STOCK_ALIASES = ["재고", "재고상태"] as const
const MEMO_ALIASES = ["비고", "md 코멘트", "메모"] as const

export class DailyFoodCsvError extends Error {
  readonly name = "DailyFoodCsvError"

  constructor(readonly reason: string) {
    super(`DailyFood CSV parsing failed: ${reason}`)
  }
}

export function parseDailyFoodCsv(
  csv: string,
  config: DailyFoodSupplierConfig,
): readonly RawProduct[] {
  const rows = CsvRowsSchema.parse(
    parse(csv, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: true,
    }),
  )
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => headerEquals(cell, config.columnMapping.productNameColumn)),
  )
  const header = headerIndex < 0 ? undefined : rows[headerIndex]
  if (header === undefined) {
    throw new DailyFoodCsvError("configured product name column was not found")
  }
  const columns = {
    productName: requireColumn(header, [config.columnMapping.productNameColumn]),
    option: requireColumn(header, [config.columnMapping.optionColumn, ...OPTION_ALIASES]),
    price: requireColumn(header, [config.columnMapping.priceColumn, ...PRICE_ALIASES]),
    stock: optionalColumn(header, [config.columnMapping.stockColumn, ...STOCK_ALIASES]),
    memo: optionalColumn(header, [config.columnMapping.memoColumn, ...MEMO_ALIASES]),
  }
  const products: RawProduct[] = []
  for (const row of rows.slice(headerIndex + 1)) {
    const productName = cleanCell(row[columns.productName])
    const price = cleanPrice(row[columns.price])
    if (productName.length === 0 || price === null) {
      continue
    }
    const optionName = cleanCell(row[columns.option])
    const stockText = `${readOptional(row, columns.stock)} ${readOptional(row, columns.memo)}`
    products.push({
      supplierId: config.supplierId,
      sourceType: config.sourceType,
      originalProductName: productName,
      originalOptionName: optionName.length > 0 ? optionName : null,
      price,
      shippingFee: 0,
      stockStatus: parseStockStatus(stockText),
      productUrl: null,
      rawJson: JSON.stringify(row),
    })
  }
  return products
}

export function cleanPrice(value: string | undefined): number | null {
  const digits = cleanCell(value).replace(/[^\d]/g, "")
  if (digits.length === 0) {
    return null
  }
  const price = Number.parseInt(digits, 10)
  return Number.isSafeInteger(price) && price > 0 ? price : null
}

function normalizeHeader(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("ko-KR")
}

function headerEquals(value: string, candidate: string): boolean {
  return normalizeHeader(value) === normalizeHeader(candidate)
}

function optionalColumn(header: readonly string[], candidates: readonly string[]): number | null {
  const index = header.findIndex((cell) =>
    candidates.some((candidate) => headerEquals(cell, candidate)),
  )
  return index >= 0 ? index : null
}

function requireColumn(header: readonly string[], candidates: readonly string[]): number {
  const index = optionalColumn(header, candidates)
  if (index === null) {
    throw new DailyFoodCsvError(`required column was not found: ${candidates.join(", ")}`)
  }
  return index
}

function cleanCell(value: string | undefined): string {
  return value?.replace(/\r/g, "").trim() ?? ""
}

function readOptional(row: readonly string[], index: number | null): string {
  return index === null ? "" : cleanCell(row[index])
}

function parseStockStatus(value: string): StockStatus {
  if (/품절|sold\s*out|재고\s*없음/i.test(value)) {
    return "out_of_stock"
  }
  if (/판매중|재고\s*있음|in\s*stock/i.test(value)) {
    return "in_stock"
  }
  return "unknown"
}
