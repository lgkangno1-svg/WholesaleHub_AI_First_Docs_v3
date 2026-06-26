import { z } from "zod"
import type { WooCommerceUpdatePayload } from "./types.js"

const FORBIDDEN_FIELDS: ReadonlySet<string> = new Set([
  "supplier_id",
  "supplier_name",
  "source_url",
  "raw_cost",
  "compare_key",
  "normalized_name",
  "option_key",
] as const)

const WooCommerceUpdatePayloadSchema = z
  .object({
    regular_price: z.string().regex(/^\d+$/),
    sale_price: z.literal(""),
    stock_status: z.enum(["instock", "outofstock"]),
    manage_stock: z.literal(false),
  })
  .strict()

export class SupplierDataExposureError extends Error {
  readonly name = "SupplierDataExposureError"

  constructor(readonly forbiddenField: string) {
    super(`WooCommerce payload contains forbidden supplier field: ${forbiddenField}`)
  }
}

export function assertSupplierSafeWooCommercePayload(
  payload: unknown,
): asserts payload is WooCommerceUpdatePayload {
  const forbiddenField = findForbiddenField(payload)
  if (forbiddenField !== null) {
    throw new SupplierDataExposureError(forbiddenField)
  }
  WooCommerceUpdatePayloadSchema.parse(payload)
}

function findForbiddenField(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const forbiddenField = findForbiddenField(item)
      if (forbiddenField !== null) {
        return forbiddenField
      }
    }
    return null
  }
  if (value === null || typeof value !== "object") {
    return null
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.has(key)) {
      return key
    }
    if (key === "key" && typeof child === "string" && FORBIDDEN_FIELDS.has(child)) {
      return child
    }
    const forbiddenField = findForbiddenField(child)
    if (forbiddenField !== null) {
      return forbiddenField
    }
  }
  return null
}
