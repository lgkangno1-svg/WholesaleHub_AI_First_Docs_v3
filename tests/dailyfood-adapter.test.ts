import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { parseDailyFoodCsv } from "../src/adapters/dailyfood/dailyfood-adapter.js"
import { loadSupplierConfig } from "../src/config/supplier-config-loader.js"

describe("parseDailyFoodCsv", () => {
  it("forward-fills DailyFood option rows when product name cells are blank", async () => {
    // Given
    const config = await loadSupplierConfig("config/suppliers/dailyfood.google_sheet.yml")
    const csv = await readFile("tests/fixtures/dailyfood.csv", "utf8")

    // When
    const result = parseDailyFoodCsv(csv, config)

    // Then
    expect(result.products).toHaveLength(4)
    expect(result.skippedRows).toBe(2)
    expect(result.skippedRowsByReason).toEqual({
      empty_product_name_without_context: 0,
      missing_price: 0,
      invalid_price: 1,
      empty_row: 1,
      etc: 0,
    })
    expect(result.products[0]).toMatchObject({
      originalProductName: "🔥7월 추천템\n2026 햇 미백찰옥수수",
      originalOptionName: "미백 찰옥수수 특품 5개입 (16-22센치 내외)",
      price: 6000,
    })
    expect(result.products[1]).toMatchObject({
      originalProductName: "🔥7월 추천템\n2026 햇 미백찰옥수수",
      originalOptionName: "미백 찰옥수수 특품 10개입 (16-22센치 내외)",
      price: 7800,
    })
    expect(JSON.parse(result.products[0]?.rawJson ?? "{}")).toMatchObject({
      forwardFilled: false,
    })
    expect(JSON.parse(result.products[1]?.rawJson ?? "{}")).toMatchObject({
      forwardFilled: true,
    })
  })
})
