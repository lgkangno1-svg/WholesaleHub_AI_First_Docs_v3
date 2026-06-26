import { describe, expect, it } from "vitest"
import {
  assertSupplierSafeWooCommercePayload,
  buildWooCommerceDryRunOperations,
  SupplierDataExposureError,
} from "../packages/woocommerce-sync/src/index.js"

const candidate = {
  compareKey: "corn-domestic-30",
  normalizedName: "corn",
  optionKey: "30ea",
  price: 10_000,
  stockStatus: "in_stock",
  supplierId: "dailyfood",
  supplierName: "DailyFood",
  sourceUrl: "https://supplier.example/products/1",
  rawCost: 10_000,
} as const

describe("buildWooCommerceDryRunOperations", () => {
  it("creates a supplier-safe update payload without calling WooCommerce", () => {
    // Given
    const marginAmount = 1500

    // When
    const operations = buildWooCommerceDryRunOperations([candidate], marginAmount)

    // Then
    expect(operations).toEqual([
      {
        mode: "dry-run",
        productId: null,
        payload: {
          regular_price: "11500",
          sale_price: "",
          stock_status: "instock",
          manage_stock: false,
        },
      },
    ])
    expect(JSON.stringify(operations)).not.toMatch(
      /supplier_id|supplier_name|source_url|raw_cost|compare_key|normalized_name|option_key/,
    )
  })
})

describe("assertSupplierSafeWooCommercePayload", () => {
  it.each([
    "supplier_id",
    "supplier_name",
    "source_url",
    "raw_cost",
    "compare_key",
    "normalized_name",
    "option_key",
  ])("rejects the forbidden field %s", (forbiddenField) => {
    // Given
    const unsafePayload = {
      regular_price: "11500",
      sale_price: "",
      stock_status: "instock",
      manage_stock: false,
      [forbiddenField]: "secret",
    }

    // When
    const validate = (): void => assertSupplierSafeWooCommercePayload(unsafePayload)

    // Then
    expect(validate).toThrow(SupplierDataExposureError)
  })

  it("rejects supplier data hidden inside WooCommerce metadata", () => {
    // Given
    const unsafePayload = {
      regular_price: "11500",
      sale_price: "",
      stock_status: "instock",
      manage_stock: false,
      meta_data: [{ key: "supplier_id", value: "dailyfood" }],
    }

    // When
    const validate = (): void => assertSupplierSafeWooCommercePayload(unsafePayload)

    // Then
    expect(validate).toThrow(SupplierDataExposureError)
  })
})
