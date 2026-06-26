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
    optionColumn: "규격",
    priceColumn: "판매가",
    stockColumn: "재고",
    memoColumn: "비고",
  },
  collection: {
    playwrightEnabled: false,
    autoOrderEnabled: false,
    dataRetention: "latest_only",
  },
}

describe("parseDailyFoodCsv", () => {
  it("applies configured columns and cleans numeric prices", () => {
    // Given
    const csv = [
      "안내 문구,,,,",
      "상품명,규격,판매가,재고,비고",
      '미백 찰옥수수,"특품 5개입","₩ 6,000원",판매중,추천',
      '홍매실,2kg,"9,500",품절,',
      "가격 오류,1kg,문의,판매중,",
      ",,,,",
    ].join("\n")

    // When
    const products = parseDailyFoodCsv(csv, config)

    // Then
    expect(products).toEqual([
      {
        supplierId: "dailyfood",
        sourceType: "google_sheet",
        originalProductName: "미백 찰옥수수",
        originalOptionName: "특품 5개입",
        price: 6000,
        shippingFee: 0,
        stockStatus: "in_stock",
        productUrl: null,
        rawJson: expect.any(String),
      },
      {
        supplierId: "dailyfood",
        sourceType: "google_sheet",
        originalProductName: "홍매실",
        originalOptionName: "2kg",
        price: 9500,
        shippingFee: 0,
        stockStatus: "out_of_stock",
        productUrl: null,
        rawJson: expect.any(String),
      },
    ])
  })
})

describe("DailyFoodGoogleSheetAdapter", () => {
  it("fetches the configured CSV export URL and returns RawProduct entries", async () => {
    // Given
    const csv = ["상품명,규격,판매가,재고,비고", '세척사과,1kg,"7,500",판매중,베스트'].join("\n")
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
      originalProductName: "세척사과",
      originalOptionName: "1kg",
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
    expect(loaded.collection.playwrightEnabled).toBe(false)
  })
})
