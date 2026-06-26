import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  applySchema,
  applySupplierSeed,
  DatabasePriceComparisonStore,
} from "../packages/database/src/index.js"
import {
  calculateLowestUnitPrices,
  type PriceComparisonCandidate,
  PriceEngine,
} from "../packages/price-engine/src/index.js"

const candidates: readonly PriceComparisonCandidate[] = [
  {
    rawProductId: 1,
    supplierId: "supplier-a",
    normalizedName: "미백 찰옥수수",
    optionKey: "국내산|특품|10개",
    price: 10_000,
    unitPrice: 1000,
    stockStatus: "in_stock",
    mappingStatus: "approved",
    supplierEnabled: true,
    productUrl: null,
  },
  {
    rawProductId: 2,
    supplierId: "supplier-b",
    normalizedName: "미백 찰옥수수",
    optionKey: "국내산|특품|10개",
    price: 12_000,
    unitPrice: 800,
    stockStatus: "in_stock",
    mappingStatus: "approved",
    supplierEnabled: true,
    productUrl: null,
  },
  {
    rawProductId: 3,
    supplierId: "supplier-c",
    normalizedName: "미백 찰옥수수",
    optionKey: "국내산|특품|10개",
    price: 5000,
    unitPrice: 500,
    stockStatus: "out_of_stock",
    mappingStatus: "approved",
    supplierEnabled: true,
    productUrl: null,
  },
  {
    rawProductId: 4,
    supplierId: "supplier-d",
    normalizedName: "미백 찰옥수수",
    optionKey: "국내산|특품|10개",
    price: 0,
    unitPrice: 0,
    stockStatus: "in_stock",
    mappingStatus: "approved",
    supplierEnabled: true,
    productUrl: null,
  },
  {
    rawProductId: 5,
    supplierId: "supplier-e",
    normalizedName: "미백 찰옥수수",
    optionKey: "국내산|특품|10개",
    price: 4000,
    unitPrice: 400,
    stockStatus: "in_stock",
    mappingStatus: "pending",
    supplierEnabled: true,
    productUrl: null,
  },
]

describe("calculateLowestUnitPrices", () => {
  it("groups by normalized name and option key and selects the lowest eligible unit price", () => {
    // Given
    const input = candidates

    // When
    const result = calculateLowestUnitPrices(input)

    // Then
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      supplierId: "supplier-b",
      rawProductId: 2,
      price: 12_000,
      unitPrice: 800,
    })
  })
})

describe("PriceEngine", () => {
  it("replaces compare_products with the latest eligible results", async () => {
    // Given
    const database = new DatabaseSync(":memory:")
    await applySchema(database)
    await applySupplierSeed(database)
    database.exec(`
      INSERT INTO suppliers (
        supplier_id, supplier_name, source_type, enabled
      ) VALUES
        ('supplier-b', '공급처 B', 'google_sheet', 1),
        ('supplier-disabled', '비활성 공급처', 'google_sheet', 0);

      INSERT INTO raw_products (
        id, supplier_id, source_type, original_product_name, price, stock_status
      ) VALUES
        (101, 'dailyfood', 'google_sheet', '옥수수 A', 10000, 'in_stock'),
        (102, 'supplier-b', 'google_sheet', '옥수수 B', 12000, 'in_stock'),
        (103, 'supplier-b', 'google_sheet', '품절 옥수수', 5000, 'out_of_stock'),
        (104, 'supplier-b', 'google_sheet', '가격 없음', 0, 'in_stock'),
        (105, 'supplier-b', 'google_sheet', '승인 대기', 4000, 'in_stock'),
        (106, 'supplier-disabled', 'google_sheet', '비활성 상품', 3000, 'in_stock'),
        (107, 'dailyfood', 'google_sheet', '사과', 9000, 'in_stock');

      INSERT INTO product_mapping (
        id, mapping_key, original_product_name, normalized_name, option_key, status
      ) VALUES
        (201, 'm1', '옥수수 A', '미백 찰옥수수', '국내산|특품|10개', 'approved'),
        (202, 'm2', '옥수수 B', '미백 찰옥수수', '국내산|특품|10개', 'approved'),
        (203, 'm3', '품절 옥수수', '미백 찰옥수수', '국내산|특품|10개', 'approved'),
        (204, 'm4', '가격 없음', '미백 찰옥수수', '국내산|특품|10개', 'approved'),
        (205, 'm5', '승인 대기', '미백 찰옥수수', '국내산|특품|10개', 'pending'),
        (206, 'm6', '비활성 상품', '미백 찰옥수수', '국내산|특품|10개', 'approved'),
        (207, 'm7', '사과', '부사 사과', '국내산|상품|1kg', 'approved');

      INSERT INTO normalized_products (
        raw_product_id, supplier_id, normalized_name, option_key, price,
        unit_price, stock_status, mapping_id
      ) VALUES
        (101, 'dailyfood', '미백 찰옥수수', '국내산|특품|10개', 10000, 1000, 'in_stock', 201),
        (102, 'supplier-b', '미백 찰옥수수', '국내산|특품|10개', 12000, 800, 'in_stock', 202),
        (103, 'supplier-b', '미백 찰옥수수', '국내산|특품|10개', 5000, 500, 'out_of_stock', 203),
        (104, 'supplier-b', '미백 찰옥수수', '국내산|특품|10개', 0, 0, 'in_stock', 204),
        (105, 'supplier-b', '미백 찰옥수수', '국내산|특품|10개', 4000, 400, 'in_stock', 205),
        (106, 'supplier-disabled', '미백 찰옥수수', '국내산|특품|10개', 3000, 300, 'in_stock', 206),
        (107, 'dailyfood', '부사 사과', '국내산|상품|1kg', 9000, 9000, 'in_stock', 207);

      INSERT INTO compare_products (
        compare_key, normalized_name, option_key, cheapest_supplier_id,
        cheapest_raw_product_id, cheapest_price
      ) VALUES ('stale', '오래된 상품', '오래된 옵션', 'dailyfood', 101, 1);
    `)
    const engine = new PriceEngine(new DatabasePriceComparisonStore(database))

    // When
    const result = engine.refresh()

    // Then
    const rows = z
      .array(
        z.object({
          normalized_name: z.string(),
          cheapest_supplier_id: z.string(),
          cheapest_price: z.number().int(),
          cheapest_unit_price: z.number(),
        }),
      )
      .parse(
        database
          .prepare(`
            SELECT normalized_name, cheapest_supplier_id,
              cheapest_price, cheapest_unit_price
            FROM compare_products
            ORDER BY normalized_name
          `)
          .all(),
      )
    database.close()
    expect(result.count).toBe(2)
    expect(rows).toEqual([
      {
        normalized_name: "미백 찰옥수수",
        cheapest_supplier_id: "supplier-b",
        cheapest_price: 12_000,
        cheapest_unit_price: 800,
      },
      {
        normalized_name: "부사 사과",
        cheapest_supplier_id: "dailyfood",
        cheapest_price: 9000,
        cheapest_unit_price: 9000,
      },
    ])
  })
})
