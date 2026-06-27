import ky from "ky"
import { z } from "zod"
import type { CollectedProduct } from "../../domain/product.js"
import type { Walldob2bLogin } from "./walldob2b-adapter.js"

const SUPPLIER_ID = "walldob2b"
const BASE_URL = "https://walldob2b.com"
const DOWNLOAD_URL = `${BASE_URL}/theme/jelly/shop/product_excel_download.php`

const RequiredHeaderSchema = z.object({
  productId: z.number().int().nonnegative(),
  optionId: z.number().int().nonnegative(),
  productName: z.number().int().nonnegative(),
  optionName: z.number().int().nonnegative(),
  price: z.number().int().nonnegative(),
})

type RequiredHeaderIndexes = z.infer<typeof RequiredHeaderSchema>

type ExcelRow = {
  readonly productId: string
  readonly optionId: string
  readonly productName: string
  readonly optionName: string
  readonly price: number
}

export type Walldob2bExcelParseResult = {
  readonly totalRows: number
  readonly products: readonly CollectedProduct[]
  readonly skippedRows: readonly Walldob2bExcelSkippedRow[]
}

export type Walldob2bExcelSkippedRow = {
  readonly rowNumber: number
  readonly reason:
    | "empty_row"
    | "missing_product_name"
    | "missing_option_name"
    | "missing_price"
    | "invalid_price"
}

export async function fetchWalldob2bProductExcel(login: Walldob2bLogin): Promise<string> {
  const cookie = await loginForDownload(login)
  const buffer = await ky
    .get(DOWNLOAD_URL, {
      headers: { cookie, "user-agent": "Mozilla/5.0" },
      timeout: 30_000,
      retry: { limit: 1 },
    })
    .arrayBuffer()
  return decodeExcelHtml(buffer)
}

export function parseWalldob2bProductExcelHtml(
  html: string,
  limit: number,
): Walldob2bExcelParseResult {
  const tableRows = parseHtmlTableRows(html)
  if (tableRows.length === 0) {
    return { totalRows: 0, products: [], skippedRows: [] }
  }
  const headerIndexes = findHeaderIndexes(tableRows[0] ?? [])
  const products: CollectedProduct[] = []
  const skippedRows: Walldob2bExcelSkippedRow[] = []
  for (const [index, cells] of tableRows.slice(1).entries()) {
    const rowNumber = index + 2
    const parsed = parseExcelRow(cells, headerIndexes)
    if (parsed.kind === "skip") {
      skippedRows.push({ rowNumber, reason: parsed.reason })
      continue
    }
    products.push(toCollectedProduct(parsed.row))
    if (products.length >= limit) {
      break
    }
  }
  return { totalRows: tableRows.length - 1, products, skippedRows }
}

function parseExcelRow(
  cells: readonly string[],
  headerIndexes: RequiredHeaderIndexes,
):
  | { readonly kind: "ok"; readonly row: ExcelRow }
  | { readonly kind: "skip"; readonly reason: Walldob2bExcelSkippedRow["reason"] } {
  if (cells.every((cell) => cell.length === 0)) {
    return { kind: "skip", reason: "empty_row" }
  }
  const productId = cells[headerIndexes.productId] ?? ""
  const optionId = cells[headerIndexes.optionId] ?? ""
  const productName = cells[headerIndexes.productName] ?? ""
  const optionName = cells[headerIndexes.optionName] ?? ""
  const priceText = cells[headerIndexes.price] ?? ""
  if (productName.length === 0) {
    return { kind: "skip", reason: "missing_product_name" }
  }
  if (optionName.length === 0) {
    return { kind: "skip", reason: "missing_option_name" }
  }
  if (priceText.length === 0) {
    return { kind: "skip", reason: "missing_price" }
  }
  const price = parseMoney(priceText)
  if (price === null) {
    return { kind: "skip", reason: "invalid_price" }
  }
  return { kind: "ok", row: { productId, optionId, productName, optionName, price } }
}

function toCollectedProduct(row: ExcelRow): CollectedProduct {
  return {
    supplierId: SUPPLIER_ID,
    sourceType: "excel_download",
    originalProductName: row.productName,
    originalOptionName: row.optionName,
    price: row.price,
    shippingFee: 0,
    stockStatus: "in_stock",
    productUrl: `${BASE_URL}/shop/item.php?it_id=${encodeURIComponent(row.productId)}`,
    rawJson: JSON.stringify({
      sourceProductId: row.productId,
      sourceOptionId: row.optionId,
      source: "product_excel_download",
    }),
  }
}

function findHeaderIndexes(headers: readonly string[]): RequiredHeaderIndexes {
  return RequiredHeaderSchema.parse({
    productId: findHeader(headers, "관리코드"),
    optionId: findHeader(headers, "옵션번호"),
    productName: findHeader(headers, "상품명"),
    optionName: findHeader(headers, "옵션명"),
    price: findHeader(headers, "판매가"),
  })
}

function findHeader(headers: readonly string[], name: string): number {
  const index = headers.indexOf(name)
  if (index < 0) {
    throw new Walldob2bExcelHeaderError(name)
  }
  return index
}

function parseHtmlTableRows(html: string): readonly (readonly string[])[] {
  const normalizedHtml = html.replace(
    /<td[^>]*>\s*<table[\s\S]*?<\/table>\s*<\/td>/giu,
    "<td></td>",
  )
  return [...normalizedHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/giu)].map((rowMatch) =>
    [...(rowMatch[1] ?? "").matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/giu)].map((cellMatch) =>
      normalizeCell(cellMatch[1] ?? ""),
    ),
  )
}

function normalizeCell(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim()
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&#([0-9]+);/gu, (_match, code: string) => String.fromCodePoint(Number(code)))
}

function parseMoney(value: string): number | null {
  const digits = value.replace(/[^\d]/gu, "")
  if (digits.length === 0) {
    return null
  }
  return Number.parseInt(digits, 10)
}

async function loginForDownload(login: Walldob2bLogin): Promise<string> {
  const response = await ky.post(`${BASE_URL}/bbs/login_check.php`, {
    body: new URLSearchParams({
      mb_id: login.username,
      mb_password: login.password,
      url: "%2Fshop%2Flist.php%3Fca_id%3D80",
    }),
    redirect: "manual",
    throwHttpErrors: false,
    timeout: 30_000,
    retry: { limit: 1 },
  })
  return storeCookies(response)
}

function storeCookies(response: Response): string {
  const cookieJar = new Map<string, string>()
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";")[0]
    const [name, value = ""] = pair?.split("=") ?? []
    if (name !== undefined && name.length > 0 && value.length > 0 && pair !== undefined) {
      cookieJar.set(name, pair)
    }
  }
  return [...cookieJar.values()].join("; ")
}

function decodeExcelHtml(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes)
  return utf8.includes("관리코드") ? utf8 : new TextDecoder("euc-kr").decode(bytes)
}

export class Walldob2bExcelHeaderError extends Error {
  readonly name = "Walldob2bExcelHeaderError"

  constructor(readonly headerName: string) {
    super(`Missing walldob2b excel header: ${headerName}`)
  }
}
