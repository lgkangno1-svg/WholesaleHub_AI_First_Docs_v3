import ky from "ky"
import { parseDailyFoodHtmlSheetToCsvRows, toDailyFoodCsv } from "./dailyfood-html-table.js"

export type DailyFoodHtmlViewCsvResult = {
  readonly csv: string
  readonly sheetCount: number
  readonly rowCount: number
}

const OUTPUT_HEADER = ["상품명", "중량", "단가", "md 코멘트", "발주&단가 상담 링크"] as const

export async function fetchDailyFoodHtmlViewAsCsv(
  rootUrl: string,
): Promise<DailyFoodHtmlViewCsvResult> {
  const rootHtml = await ky.get(rootUrl, { retry: { limit: 2 }, timeout: 30_000 }).text()
  const sheetUrls = extractSheetUrls(rootUrl, rootHtml)
  const bodyRows: (readonly string[])[] = []
  for (const url of sheetUrls) {
    const html = await ky.get(url, { retry: { limit: 2 }, timeout: 30_000 }).text()
    bodyRows.push(...parseDailyFoodHtmlSheetToCsvRows(html))
  }
  return {
    csv: toDailyFoodCsv([OUTPUT_HEADER, ...bodyRows]),
    sheetCount: sheetUrls.length,
    rowCount: bodyRows.length,
  }
}

function extractSheetUrls(rootUrl: string, html: string): readonly string[] {
  const spreadsheetId = /\/d\/([^/]+)\//u.exec(rootUrl)?.[1]
  if (spreadsheetId === undefined) {
    return [rootUrl]
  }
  const gids = [...new Set([...html.matchAll(/gid: "(\d+)"/gu)].map((match) => match[1]))].filter(
    (gid): gid is string => gid !== undefined,
  )
  if (gids.length === 0) {
    const gid = /[#?&]gid=(\d+)/u.exec(rootUrl)?.[1]
    return gid === undefined ? [rootUrl] : [sheetUrl(spreadsheetId, gid)]
  }
  return gids.map((gid) => sheetUrl(spreadsheetId, gid))
}

function sheetUrl(spreadsheetId: string, gid: string): string {
  return `https://docs.google.com/spreadsheets/u/0/d/${spreadsheetId}/htmlview/sheet?headers=true&gid=${gid}`
}
