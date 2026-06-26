import { createHash } from "node:crypto"
import type { CompareProductResult, PriceComparisonCandidate } from "./types.js"

export function calculateLowestUnitPrices(
  candidates: readonly PriceComparisonCandidate[],
): readonly CompareProductResult[] {
  const cheapestByGroup = new Map<
    string,
    PriceComparisonCandidate & { readonly unitPrice: number }
  >()
  for (const candidate of candidates) {
    if (!isEligible(candidate)) {
      continue
    }
    const groupKey = `${candidate.normalizedName.trim()}|${candidate.optionKey.trim()}`
    const current = cheapestByGroup.get(groupKey)
    if (current === undefined || compareCandidates(candidate, current) < 0) {
      cheapestByGroup.set(groupKey, candidate)
    }
  }
  return [...cheapestByGroup.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "ko-KR"))
    .map(([groupKey, candidate]) => ({
      compareKey: createHash("sha256").update(groupKey).digest("hex"),
      rawProductId: candidate.rawProductId,
      supplierId: candidate.supplierId,
      normalizedName: candidate.normalizedName,
      optionKey: candidate.optionKey,
      price: candidate.price,
      unitPrice: candidate.unitPrice,
      stockStatus: candidate.stockStatus,
      productUrl: candidate.productUrl,
    }))
}

function isEligible(
  candidate: PriceComparisonCandidate,
): candidate is PriceComparisonCandidate & { readonly unitPrice: number } {
  return (
    candidate.price > 0 &&
    candidate.unitPrice !== null &&
    candidate.unitPrice > 0 &&
    candidate.stockStatus !== "out_of_stock" &&
    candidate.mappingStatus === "approved" &&
    candidate.supplierEnabled &&
    candidate.normalizedName.trim().length > 0 &&
    candidate.optionKey.trim().length > 0
  )
}

function compareCandidates(
  left: PriceComparisonCandidate & { readonly unitPrice: number },
  right: PriceComparisonCandidate & { readonly unitPrice: number },
): number {
  return (
    left.unitPrice - right.unitPrice ||
    left.price - right.price ||
    left.supplierId.localeCompare(right.supplierId)
  )
}
