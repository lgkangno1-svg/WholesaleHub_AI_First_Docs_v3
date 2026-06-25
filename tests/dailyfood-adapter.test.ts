import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { parseDailyFoodCsv } from "../src/adapters/dailyfood/dailyfood-adapter.js"
import { loadSupplierConfig } from "../src/config/supplier-config-loader.js"

describe("parseDailyFoodCsv", () => {
  it("detects the header row and maps valid product rows", async () => {
    // Given
    const config = await loadSupplierConfig("config/suppliers/dailyfood.google_sheet.yml")
    const csv = await readFile("tests/fixtures/dailyfood.csv", "utf8")

    // When
    const result = parseDailyFoodCsv(csv, config)

    // Then
    expect(result.products).toHaveLength(3)
    expect(result.products[0]).toMatchObject({
      originalProductName: "2026 햇 미백찰옥수수",
      originalOptionName: "미백 찰옥수수 특품 5개입 (16-22센치 내외)",
      price: 6000,
    })
  })
})
