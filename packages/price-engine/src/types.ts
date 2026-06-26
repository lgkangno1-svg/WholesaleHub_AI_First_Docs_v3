export type PriceComparisonCandidate = {
  readonly rawProductId: number
  readonly supplierId: string
  readonly normalizedName: string
  readonly optionKey: string
  readonly price: number
  readonly unitPrice: number | null
  readonly stockStatus: string | null
  readonly mappingStatus: string
  readonly supplierEnabled: boolean
  readonly productUrl: string | null
}

export type CompareProductResult = {
  readonly compareKey: string
  readonly rawProductId: number
  readonly supplierId: string
  readonly normalizedName: string
  readonly optionKey: string
  readonly price: number
  readonly unitPrice: number
  readonly stockStatus: string | null
  readonly productUrl: string | null
}

export interface PriceComparisonStore {
  loadCandidates(): readonly PriceComparisonCandidate[]
  replaceResults(results: readonly CompareProductResult[]): void
}
