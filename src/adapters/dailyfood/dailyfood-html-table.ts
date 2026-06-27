type HtmlColumnIndexes = {
  readonly photo: number | null
  readonly product: number | null
  readonly option: number | null
  readonly price: number
  readonly memo: number | null
  readonly url: number | null
}

type PriceResult =
  | { readonly kind: "valid"; readonly value: string }
  | { readonly kind: "missing" }
  | { readonly kind: "invalid" }

export function parseDailyFoodHtmlSheetToCsvRows(html: string): readonly (readonly string[])[] {
  const rows = parseHtmlGrid(html)
  const headerIndex = rows.findIndex(isHeaderRow)
  const header = rows[headerIndex]
  if (header === undefined) {
    return []
  }
  const indexes = columnIndexes(header)
  const output: string[][] = []
  let currentProductName: string | null = null
  let currentPhotoContext: string | null = null
  for (const row of rows.slice(headerIndex + 1)) {
    currentPhotoContext = nextPhotoContext(row, indexes.photo, currentPhotoContext)
    const parsed = parseDataRow(row, indexes, currentProductName, currentPhotoContext)
    if (parsed === null) {
      continue
    }
    if (parsed.productName.length > 0) {
      currentProductName = parsed.productName
    }
    output.push([parsed.productName, parsed.optionName, parsed.price, parsed.memo, parsed.url])
  }
  return output
}

function parseDataRow(
  row: readonly string[],
  indexes: HtmlColumnIndexes,
  currentProductName: string | null,
  currentPhotoContext: string | null,
): {
  readonly productName: string
  readonly optionName: string
  readonly price: string
  readonly memo: string
  readonly url: string
} | null {
  const productCell = indexes.product === null ? "" : cleanCell(row[indexes.product])
  const optionCell = indexes.option === null ? "" : cleanCell(row[indexes.option])
  const normalPrice = parsePrice(row[indexes.price])
  if (normalPrice.kind === "valid") {
    const productName = productCell.length > 0 ? productCell : (currentPhotoContext ?? "")
    return productName.length === 0
      ? null
      : outputRow(productName, optionCell, normalPrice.value, row, indexes)
  }
  const shiftedPrice: PriceResult =
    indexes.option === null ? { kind: "missing" } : parsePrice(row[indexes.option])
  if (shiftedPrice.kind !== "valid" || productCell.length === 0) {
    return null
  }
  const productName = currentProductName ?? currentPhotoContext ?? ""
  return productName.length === 0
    ? null
    : outputRow(productName, productCell, shiftedPrice.value, row, indexes)
}

function outputRow(
  productName: string,
  optionName: string,
  price: string,
  row: readonly string[],
  indexes: HtmlColumnIndexes,
): {
  readonly productName: string
  readonly optionName: string
  readonly price: string
  readonly memo: string
  readonly url: string
} {
  return {
    productName,
    optionName,
    price,
    memo: indexes.memo === null ? "" : cleanCell(row[indexes.memo]),
    url: indexes.url === null ? "" : cleanCell(row[indexes.url]),
  }
}

function parseHtmlGrid(html: string): readonly (readonly string[])[] {
  const active = new Map<number, { readonly text: string; readonly remaining: number }>()
  return [...html.matchAll(/<tr\b[\s\S]*?<\/tr>/giu)].map((rowMatch) => {
    const row: string[] = []
    let column = 0
    for (const cellMatch of rowMatch[0].matchAll(/<td\b([^>]*)[\s\S]*?<\/td>/giu)) {
      column = fillActive(row, active, column)
      const attrs = cellMatch[1] ?? ""
      const text = cellText(cellMatch[0])
      const colspan = spanValue(attrs, "colspan")
      const rowspan = spanValue(attrs, "rowspan")
      for (let offset = 0; offset < colspan; offset += 1) {
        row[column + offset] = text
        if (rowspan > 1) {
          active.set(column + offset, { text, remaining: rowspan - 1 })
        }
      }
      column += colspan
    }
    fillActive(row, active, column)
    return row
  })
}

function fillActive(
  row: string[],
  active: Map<number, { readonly text: string; readonly remaining: number }>,
  start: number,
): number {
  let column = start
  while (active.has(column)) {
    const value = active.get(column)
    row[column] = value?.text ?? ""
    if (value === undefined || value.remaining <= 1) {
      active.delete(column)
    } else {
      active.set(column, { text: value.text, remaining: value.remaining - 1 })
    }
    column += 1
  }
  return column
}

function spanValue(attrs: string, name: string): number {
  const value = new RegExp(`${name}="(\\d+)"`, "iu").exec(attrs)?.[1]
  return value === undefined ? 1 : Number.parseInt(value, 10)
}

function isHeaderRow(row: readonly string[]): boolean {
  return (
    row.some((cell) => matches(cell, ["상품명", "중량"])) &&
    row.some((cell) => matches(cell, ["단가", "공급가", "판매가"]))
  )
}

function columnIndexes(header: readonly string[]): HtmlColumnIndexes {
  const product = findOptionalColumn(header, ["상품명"])
  const option = findOptionalColumn(header, ["중량", "옵션"])
  return {
    photo: findOptionalColumn(header, ["품목 사진\n*클릭 시 사진 이동*", "품목 사진"]),
    product,
    option: product === null ? (option ?? findOptionalColumn(header, ["상품명"])) : option,
    price: findRequiredColumn(header, ["단가", "공급가", "판매가"]),
    memo: findOptionalColumn(header, ["md 코멘트", "비고", "상세 설명"]),
    url: findOptionalColumn(header, ["발주&단가 상담 링크"]),
  }
}

function nextPhotoContext(
  row: readonly string[],
  index: number | null,
  current: string | null,
): string | null {
  if (index === null) {
    return current
  }
  const value = cleanCell(row[index])
  if (value.length === 0 || /이미지|품목 사진|바로가기|무료배송/u.test(value)) {
    return current
  }
  return value
}

function parsePrice(value: string | undefined): PriceResult {
  const text = cleanCell(value)
  if (text.length === 0) {
    return { kind: "missing" }
  }
  const digits = text.replace(/[^\d]/gu, "")
  if (digits.length === 0) {
    return { kind: "invalid" }
  }
  return { kind: "valid", value: digits }
}

function findRequiredColumn(header: readonly string[], candidates: readonly string[]): number {
  const index = findOptionalColumn(header, candidates)
  if (index === null) {
    throw new Error(`DailyFood htmlview required column not found: ${candidates.join(", ")}`)
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

function matches(value: string, candidates: readonly string[]): boolean {
  const normalized = normalize(value)
  return candidates.some((candidate) => normalized === normalize(candidate))
}

function normalize(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase("ko-KR")
}

function cleanCell(value: string | undefined): string {
  return value?.replace(/\s+\n/gu, "\n").replace(/\n\s+/gu, "\n").trim() ?? ""
}

function cellText(cell: string): string {
  return decodeEntities(
    cell
      .replace(/<br\s*\/?>/giu, "\n")
      .replace(/<[^>]*>/gu, "")
      .trim(),
  )
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gu, "&")
    .replace(/&nbsp;/gu, " ")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&#39;/gu, "'")
    .replace(/&quot;/gu, '"')
}

export function toDailyFoodCsv(rows: readonly (readonly string[])[]): string {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`
}

function csvCell(value: string): string {
  return `"${value.replace(/"/gu, '""')}"`
}
