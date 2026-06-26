import { describe, expect, it } from "vitest"
import { loadSupplierConfig } from "../src/config/supplier-config-loader.js"

describe("loadSupplierConfig", () => {
  it("parses the DailyFood YAML when the config is valid", async () => {
    // Given
    const path = "config/suppliers/dailyfood.google_sheet.yml"

    // When
    const config = await loadSupplierConfig(path)

    // Then
    expect(config.supplierId).toBe("dailyfood")
    expect(config.googleSheet.gid).toBe("860422621")
    expect(config.columnMapping).toMatchObject({
      productNameColumn: "상품명",
      optionColumn: "중량",
      priceColumn: "단가",
      stockColumn: null,
      memoColumn: "md 코멘트",
    })
    expect(config.collection.playwrightEnabled).toBe(false)
    expect(config.collection.autoOrderEnabled).toBe(false)
  })
})
