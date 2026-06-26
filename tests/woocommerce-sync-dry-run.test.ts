import { describe, expect, it } from "vitest"
import {
  assertSupplierSafeWooCommercePayload,
  buildWooCommerceDryRunOperations,
  SupplierDataExposureError,
} from "../packages/woocommerce-sync/src/index.js"

const candidate = {
  compareKey: "corn-domestic-30",
  normalizedName: "미백 찰옥수수",
  optionKey: "국내산|특품|30개",
  price: 10_000,
  stockStatus: "in_stock",
  supplierId: "dailyfood",
  supplierName: "데일리푸드",
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
        lookupKey: "corn-domestic-30",
        payload: {
          name: "미백 찰옥수수 국내산|특품|30개",
          regular_price: "11500",
          sale_price: "",
          stock_status: "instock",
          manage_stock: false,
          meta_data: [{ key: "_wholesalehub_compare_key", value: "corn-domestic-30" }],
        },
      },
    ])
    expect(JSON.stringify(operations)).not.toMatch(/supplier_id|supplier_name|source_url|raw_cost/)
  })
})

describe("assertSupplierSafeWooCommercePayload", () => {
  it.each([
    "supplier_id",
    "supplier_name",
    "source_url",
    "raw_cost",
  ])("rejects the forbidden field %s", (forbiddenField) => {
    // Given
    const unsafePayload = {
      name: "미백 찰옥수수",
      regular_price: "11500",
      sale_price: "",
      stock_status: "instock",
      manage_stock: false,
      meta_data: [{ key: "_wholesalehub_compare_key", value: "corn-domestic-30" }],
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
      name: "미백 찰옥수수",
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
