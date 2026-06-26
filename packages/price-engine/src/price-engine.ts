import { calculateLowestUnitPrices } from "./calculate-lowest-unit-prices.js"
import type { PriceComparisonStore } from "./types.js"

export type PriceEngineResult = {
  readonly count: number
}

export class PriceEngine {
  constructor(private readonly store: PriceComparisonStore) {}

  refresh(): PriceEngineResult {
    const results = calculateLowestUnitPrices(this.store.loadCandidates())
    this.store.replaceResults(results)
    return { count: results.length }
  }
}
