import { createHash } from "node:crypto"
import type { CompareProduct, PriceCandidate } from "../domain/product.js"

export function calculateLowestPrices(
  candidates: readonly PriceCandidate[],
): readonly CompareProduct[] {
  const cheapestByGroup = new Map<string, PriceCandidate>()
  for (const candidate of candidates) {
    const groupKey = `${candidate.normalizedName}|${candidate.optionKey}`
    const current = cheapestByGroup.get(groupKey)
    if (
      current === undefined ||
      candidate.unitPrice < current.unitPrice ||
      (candidate.unitPrice === current.unitPrice && candidate.price < current.price)
    ) {
      cheapestByGroup.set(groupKey, candidate)
    }
  }
  return [...cheapestByGroup.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "ko-KR"))
    .map(([groupKey, candidate]) => ({
      ...candidate,
      compareKey: createHash("sha256").update(groupKey).digest("hex"),
    }))
}
