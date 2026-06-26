import { createServer } from "node:http"
import { describe, expect, it } from "vitest"
import {
  DailyFoodGoogleSheetAdapter,
  type DailyFoodSupplierConfig,
  loadDailyFoodSupplierConfig,
  parseDailyFoodCsv,
} from "../packages/supplier-adapters/src/index.js"

const config: DailyFoodSupplierConfig = {
  supplierId: "dailyfood",
  supplierName: "데일리푸드",
  sourceType: "google_sheet",
  enabled: true,
  googleSheet: {
    spreadsheetId: "sheet-id",
    gid: "123",
    sheetUrl: "https://docs.google.com/spreadsheets/d/sheet-id/edit",
    csvExportUrl: "https://example.com/dailyfood.csv",
    accessMode: "csv_export_or_google_oauth",
  },
  schedule: {
    timezone: "Asia/Seoul",
    cron: "0 9,12,15,18 * * *",
  },
  columnMapping: {
    productNameColumn: "상품명",
    optionColumn: "중량",
    priceColumn: "단가",
    stockColumn: null,
    memoColumn: "md 코멘트",
  },
  collection: {
    playwrightEnabled: false,
    autoOrderEnabled: false,
    dataRetention: "latest_only",
  },
}

describe("parseDailyFoodCsv", () => {
  it("applies DailyFood columns, nullable stock, and forward-filled product names", () => {
    // Given
    const csv = [
      ",안내 문구,,,,,,",
      ",품목 사진,상품명,중량,단가,md 코멘트,,발주&단가 상담 링크",
      ',이미지,"🔥7월 추천템\\n2026 햇 미백찰옥수수",미백 찰옥수수 특품 5개입,"6,000",판매중,,',
      ',,,미백 찰옥수수 특품 10개입,"7,800",,,',
      ",,,가격문의,문의,,,",
    ].join("\n")

    // When
    const products = parseDailyFoodCsv(csv, config)

    // Then
    expect(products).toHaveLength(2)
    expect(products).toEqual([
      {
        supplierId: "dailyfood",
        sourceType: "google_sheet",
        originalProductName: "🔥7월 추천템\\n2026 햇 미백찰옥수수",
        originalOptionName: "미백 찰옥수수 특품 5개입",
        price: 6000,
        shippingFee: 0,
        stockStatus: "in_stock",
        productUrl: null,
        rawJson: expect.any(String),
      },
      {
        supplierId: "dailyfood",
        sourceType: "google_sheet",
        originalProductName: "🔥7월 추천템\\n2026 햇 미백찰옥수수",
        originalOptionName: "미백 찰옥수수 특품 10개입",
        price: 7800,
        shippingFee: 0,
        stockStatus: "unknown",
        productUrl: null,
        rawJson: expect.any(String),
      },
    ])
    expect(JSON.parse(products[1]?.rawJson ?? "{}")).toMatchObject({ forwardFilled: true })
  })
})

describe("DailyFoodGoogleSheetAdapter", () => {
  it("fetches the configured CSV export URL and returns RawProduct entries", async () => {
    // Given
    const csv = [
      ",품목 사진,상품명,중량,단가,md 코멘트,,발주&단가 상담 링크",
      ',이미지,홍매실,홍매실 2kg,"7,500",판매중,,',
    ].join("\n")
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/csv; charset=utf-8" })
      response.end(csv)
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (address === null || typeof address === "string") {
      server.close()
      throw new TypeError("HTTP test server did not expose a TCP address")
    }
    const adapter = new DailyFoodGoogleSheetAdapter({
      ...config,
      googleSheet: {
        ...config.googleSheet,
        csvExportUrl: `http://127.0.0.1:${address.port}/dailyfood.csv`,
      },
    })

    // When
    const products = await adapter.collect().finally(() => server.close())

    // Then
    expect(products).toHaveLength(1)
    expect(products[0]).toMatchObject({
      originalProductName: "홍매실",
      originalOptionName: "홍매실 2kg",
      price: 7500,
    })
  })
})

describe("loadDailyFoodSupplierConfig", () => {
  it("loads the repository YAML with Playwright disabled", async () => {
    // Given
    const configPath = "config/suppliers/dailyfood.google_sheet.yml"

    // When
    const loaded = await loadDailyFoodSupplierConfig(configPath)

    // Then
    expect(loaded.supplierId).toBe("dailyfood")
    expect(loaded.googleSheet.csvExportUrl).toContain("export?format=csv")
    expect(loaded.columnMapping.stockColumn).toBeNull()
    expect(loaded.collection.playwrightEnabled).toBe(false)
  })
})
