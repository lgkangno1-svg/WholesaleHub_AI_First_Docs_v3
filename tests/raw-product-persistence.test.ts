import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  applySchema,
  applySupplierSeed,
  RawProductPersistenceError,
  replaceSupplierRawProducts,
} from "../packages/database/src/index.js"

const CountRowSchema = z.object({ count: z.number().int() })
const RawProductRowSchema = z.object({
  original_product_name: z.string(),
  price: z.number().int(),
  source_file_id: z.number().int(),
})
const CollectionRowSchema = z.object({
  status: z.enum(["pending", "processed", "failed"]),
  row_count: z.number().int(),
  error_message: z.string().nullable(),
})

const firstCollection = [
  {
    supplierId: "dailyfood",
    sourceType: "google_sheet",
    originalProductName: "기존 사과",
    originalOptionName: "1kg",
    price: 7000,
    shippingFee: 0,
    stockStatus: "in_stock",
    productUrl: null,
    rawJson: "{}",
  },
] as const

describe("replaceSupplierRawProducts", () => {
  it("deletes the supplier rows, inserts new products, and records the collection", async () => {
    // Given
    const database = new DatabaseSync(":memory:")
    await applySchema(database)
    await applySupplierSeed(database)
    replaceSupplierRawProducts(database, {
      supplierId: "dailyfood",
      sourceType: "google_sheet",
      sourceUrl: "https://example.com/first.csv",
      fileName: "first.csv",
      products: firstCollection,
    })

    // When
    const result = replaceSupplierRawProducts(database, {
      supplierId: "dailyfood",
      sourceType: "google_sheet",
      sourceUrl: "https://example.com/second.csv",
      fileName: "second.csv",
      products: [
        {
          ...firstCollection[0],
          originalProductName: "새 사과",
          price: 6500,
        },
        {
          ...firstCollection[0],
          originalProductName: "새 배",
          price: 8000,
        },
      ],
    })

    // Then
    const rawRows = z
      .array(RawProductRowSchema)
      .parse(
        database
          .prepare(
            "SELECT original_product_name, price, source_file_id FROM raw_products ORDER BY id",
          )
          .all(),
      )
    const collection = CollectionRowSchema.parse(
      database
        .prepare("SELECT status, row_count, error_message FROM supplier_price_files WHERE id = ?")
        .get(result.sourceFileId),
    )
    database.close()
    expect(rawRows).toEqual([
      {
        original_product_name: "새 사과",
        price: 6500,
        source_file_id: result.sourceFileId,
      },
      {
        original_product_name: "새 배",
        price: 8000,
        source_file_id: result.sourceFileId,
      },
    ])
    expect(collection).toEqual({
      status: "processed",
      row_count: 2,
      error_message: null,
    })
  })

  it("records error_message and preserves existing rows when insertion fails", async () => {
    // Given
    const database = new DatabaseSync(":memory:")
    await applySchema(database)
    await applySupplierSeed(database)
    replaceSupplierRawProducts(database, {
      supplierId: "dailyfood",
      sourceType: "google_sheet",
      sourceUrl: "https://example.com/first.csv",
      fileName: "first.csv",
      products: firstCollection,
    })
    database.exec(`
      CREATE TRIGGER fail_dailyfood_insert
      BEFORE INSERT ON raw_products
      BEGIN
        SELECT RAISE(ABORT, 'forced insert failure');
      END;
    `)

    // When
    const save = (): void => {
      replaceSupplierRawProducts(database, {
        supplierId: "dailyfood",
        sourceType: "google_sheet",
        sourceUrl: "https://example.com/failure.csv",
        fileName: "failure.csv",
        products: [
          {
            ...firstCollection[0],
            originalProductName: "실패할 상품",
          },
        ],
      })
    }

    // Then
    expect(save).toThrow(RawProductPersistenceError)
    const rawCount = CountRowSchema.parse(
      database.prepare("SELECT COUNT(*) AS count FROM raw_products").get(),
    )
    const existing = RawProductRowSchema.parse(
      database
        .prepare("SELECT original_product_name, price, source_file_id FROM raw_products LIMIT 1")
        .get(),
    )
    const failedCollection = CollectionRowSchema.parse(
      database
        .prepare(`
          SELECT status, row_count, error_message
          FROM supplier_price_files
          ORDER BY id DESC
          LIMIT 1
        `)
        .get(),
    )
    database.close()
    expect(rawCount.count).toBe(1)
    expect(existing.original_product_name).toBe("기존 사과")
    expect(failedCollection.status).toBe("failed")
    expect(failedCollection.row_count).toBe(0)
    expect(failedCollection.error_message).toContain("forced insert failure")
  })
})
