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
      name: `${candidate.normalizedName.trim()} ${candidate.optionKey.trim()}`,
      regular_price: String(candidate.price + margin),
      sale_price: "",
      stock_status: candidate.stockStatus === "out_of_stock" ? "outofstock" : "instock",
      manage_stock: false,
      meta_data: [
        {
          key: "_wholesalehub_compare_key",
          value: candidate.compareKey,
        },
      ],
    }
    assertSupplierSafeWooCommercePayload(payload)
    return {
      mode: "dry-run",
      lookupKey: candidate.compareKey,
      payload,
    }
  })
}
