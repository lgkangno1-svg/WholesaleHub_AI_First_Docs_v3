import { z } from "zod"
import { assertSupplierSafeWooCommercePayload } from "./payload-safety.js"
import type {
  WooCommerceDryRunOperation,
  WooCommerceSyncCandidate,
  WooCommerceUpdatePayload,
} from "./types.js"

const MarginAmountSchema = z.number().int().nonnegative()

export function buildWooCommerceDryRunOperations(
  candidates: readonly WooCommerceSyncCandidate[],
  marginAmount: number,
): readonly WooCommerceDryRunOperation[] {
  const margin = MarginAmountSchema.parse(marginAmount)
  return candidates.map((candidate) => {
    const payload: WooCommerceUpdatePayload = {
      regular_price: String(candidate.price + margin),
      sale_price: "",
      stock_status: candidate.stockStatus === "out_of_stock" ? "outofstock" : "instock",
      manage_stock: false,
    }
    assertSupplierSafeWooCommercePayload(payload)
    return {
      mode: "dry-run",
      productId: null,
      payload,
    }
  })
}
