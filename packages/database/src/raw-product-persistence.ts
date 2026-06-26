import type { DatabaseSync } from "node:sqlite"
import { z } from "zod"

const RawProductSchema = z.object({
  supplierId: z.string().min(1),
  sourceType: z.string().min(1),
  originalProductName: z.string().min(1),
  originalOptionName: z.string().nullable(),
  price: z.number().int().positive(),
  shippingFee: z.number().int().nonnegative(),
  stockStatus: z.enum(["in_stock", "out_of_stock", "unknown"]),
  productUrl: z.string().nullable(),
  rawJson: z.string(),
})

const RawProductCollectionSchema = z
  .object({
    supplierId: z.string().min(1),
    sourceType: z.string().min(1),
    sourceUrl: z.string().min(1),
    fileName: z.string().min(1),
    products: z.array(RawProductSchema),
  })
  .superRefine((value, context) => {
    for (const [index, product] of value.products.entries()) {
      if (product.supplierId !== value.supplierId) {
        context.addIssue({
          code: "custom",
          message: "product supplierId must match collection supplierId",
          path: ["products", index, "supplierId"],
        })
      }
      if (product.sourceType !== value.sourceType) {
        context.addIssue({
          code: "custom",
          message: "product sourceType must match collection sourceType",
          path: ["products", index, "sourceType"],
        })
      }
    }
  })

export type RawProductInput = {
  readonly supplierId: string
  readonly sourceType: string
  readonly originalProductName: string
  readonly originalOptionName: string | null
  readonly price: number
  readonly shippingFee: number
  readonly stockStatus: "in_stock" | "out_of_stock" | "unknown"
  readonly productUrl: string | null
  readonly rawJson: string
}

export type RawProductCollectionInput = {
  readonly supplierId: string
  readonly sourceType: string
  readonly sourceUrl: string
  readonly fileName: string
  readonly products: readonly RawProductInput[]
}

export type RawProductCollectionResult = {
  readonly sourceFileId: number
  readonly rowCount: number
}

export class RawProductPersistenceError extends Error {
  readonly name = "RawProductPersistenceError"

  constructor(
    readonly sourceFileId: number,
    options?: ErrorOptions,
  ) {
    super(`Failed to replace raw products for collection ${sourceFileId}`, options)
  }
}

export function replaceSupplierRawProducts(
  database: DatabaseSync,
  input: RawProductCollectionInput,
): RawProductCollectionResult {
  const collection = RawProductCollectionSchema.parse(input)
  const sourceFileId = createCollectionRecord(database, collection)
  database.exec("BEGIN IMMEDIATE")
  try {
    database.prepare("DELETE FROM raw_products WHERE supplier_id = ?").run(collection.supplierId)
    insertRawProducts(database, sourceFileId, collection.products)
    database
      .prepare(`
        UPDATE supplier_price_files
        SET status = 'processed',
          processed_at = CURRENT_TIMESTAMP,
          row_count = ?,
          error_message = NULL
        WHERE id = ?
      `)
      .run(collection.products.length, sourceFileId)
    database.exec("COMMIT")
    return { sourceFileId, rowCount: collection.products.length }
  } catch (error) {
    database.exec("ROLLBACK")
    database
      .prepare(`
        UPDATE supplier_price_files
        SET status = 'failed',
          processed_at = CURRENT_TIMESTAMP,
          row_count = 0,
          error_message = ?
        WHERE id = ?
      `)
      .run(toErrorMessage(error), sourceFileId)
    throw new RawProductPersistenceError(sourceFileId, { cause: error })
  }
}

function createCollectionRecord(
  database: DatabaseSync,
  collection: z.infer<typeof RawProductCollectionSchema>,
): number {
  const result = database
    .prepare(`
      INSERT INTO supplier_price_files (
        supplier_id, source_type, file_name, source_url, status, row_count
      ) VALUES (?, ?, ?, ?, 'pending', 0)
    `)
    .run(collection.supplierId, collection.sourceType, collection.fileName, collection.sourceUrl)
  return Number(result.lastInsertRowid)
}

function insertRawProducts(
  database: DatabaseSync,
  sourceFileId: number,
  products: readonly RawProductInput[],
): void {
  const insert = database.prepare(`
    INSERT INTO raw_products (
      supplier_id, source_file_id, source_type, original_product_name,
      original_option_name, price, shipping_fee, stock_status, product_url, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const product of products) {
    insert.run(
      product.supplierId,
      sourceFileId,
      product.sourceType,
      product.originalProductName,
      product.originalOptionName,
      product.price,
      product.shippingFee,
      product.stockStatus,
      product.productUrl,
      product.rawJson,
    )
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
