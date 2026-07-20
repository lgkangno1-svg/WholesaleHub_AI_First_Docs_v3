import type { CollectedProduct } from "../domain/product.js"

export type AtomicOfferStatus =
  | "active"
  | "promotion"
  | "preorder"
  | "sold_out"
  | "expired"
  | "zero_price_invalid"
  | "review_needed"
  | "blocked"

export type ProvenanceSourceField =
  | "title"
  | "option"
  | "description"
  | "structured_html"
  | "admin_rule"
  | "ai"
  | "derived"

export type AttributeProvenance = {
  readonly sourceField: ProvenanceSourceField
  readonly rawValue: string
  readonly normalizedValue: string | number | boolean | null
  readonly extractionMethod: string
  readonly confidence: number
  readonly reason: string
}

export type CategoryProfile = Readonly<Record<string, string | number | boolean | null>>

export type ReviewDecision =
  | "same_variant"
  | "separate_variant"
  | "separate_product"
  | "exclude"
  | "missing_spec"

export type AtomicSupplierSku = {
  readonly atomicSkuId: string
  readonly supplierId: string
  readonly sourceProductId: string
  readonly sourceOptionId: string
  readonly originalProductTitle: string
  readonly originalOptionName: string
  readonly optionGroupTitle?: string | null
  readonly structuredAttributes?: Readonly<Record<string, string>>
  readonly productUrl: string | null
  readonly detailDescription: string | null
  readonly imageUrl: string | null
  readonly listingStartPrice: number | null
  readonly supplierPrice: number
  readonly priceAnomaly?: boolean
  readonly shippingFee: number
  readonly stockStatus: CollectedProduct["stockStatus"]
  readonly collectedAt: string
  readonly detailVerifiedAt: string
}

export type NormalizedOffer = AtomicSupplierSku & {
  readonly productFamily: string
  readonly variety: string | null
  readonly productType: string | null
  readonly peachSkinType: "nectarine" | "fuzzy" | "unknown"
  readonly cultivationMethod: "노지" | null
  readonly processing: string | null
  readonly qualityGrade: string | null
  readonly usageGrade: string | null
  readonly sizeLabel: string | null
  readonly sizeMin: number | null
  readonly sizeMax: number | null
  readonly sizeUnit: string | null
  readonly weight: number | null
  readonly count: number | null
  readonly optionUnit: string | null
  readonly origin: string | null
  readonly packaging: string | null
  readonly weightBasis: "net" | "gross" | "unknown"
  readonly packageType: string | null
  readonly promotionFlag: boolean
  readonly preorderFlag: boolean
  readonly soldOutFlag: boolean
  readonly finalCost: number
  readonly priceAnomaly: boolean
  readonly confidence: number
  readonly confidenceReason: string
  readonly provenance: Readonly<Record<string, AttributeProvenance>>
  readonly provenanceCandidates: Readonly<Record<string, readonly AttributeProvenance[]>>
  readonly specConflicts: readonly string[]
  readonly categoryProfile: CategoryProfile
  readonly removedMarketingTerms: readonly string[]
  readonly status: AtomicOfferStatus
  readonly statusReasons: readonly string[]
  readonly canonicalProductKey: string
  readonly canonicalVariantKey: string | null
}

export type CanonicalVariantResult = {
  readonly canonicalProductKey: string
  readonly canonicalVariantKey: string
  readonly status:
    | "comparison_winner_selected"
    | "single_source_offer"
    | "separated_by_rule"
    | "review_needed"
    | "blocked"
  readonly selectionType: "comparison_winner" | "single_source_offer" | "separated_by_rule" | null
  readonly selectedOfferAtomicSkuId: string | null
  readonly comparisonWinnerAtomicSkuId: string | null
  readonly singleSourceOfferAtomicSkuId: string | null
  readonly rankedOfferAtomicSkuIds: readonly string[]
  readonly backupAtomicSkuIds: readonly string[]
  readonly crossSupplierBackupAtomicSkuIds: readonly string[]
  readonly supplierAlternateOfferAtomicSkuIds: readonly string[]
  readonly excludedAtomicSkuIds: readonly string[]
  readonly activeSupplierCount: number
  readonly activeOfferCount: number
  readonly backupCount: number
  readonly crossSupplierBackupCount: number
  readonly supplierAlternateOfferCount: number
  readonly isActuallyCompared: boolean
  readonly winnerReason: string
  readonly comparisonStatus:
    | "multi_supplier_compared"
    | "single_source"
    | "separated_by_rule"
    | "review_blocked"
    | "no_active_offer"
  readonly reasons: readonly string[]
}

export type AtomicReviewQueueItem = {
  readonly reviewKey: string
  readonly productFamily: string
  readonly canonicalVariantKey: string | null
  readonly supplierIds: readonly string[]
  readonly originalTitles: readonly string[]
  readonly originalOptionNames: readonly string[]
  readonly detailDescriptions: readonly (string | null)[]
  readonly imageUrls: readonly (string | null)[]
  readonly extractedOffers: readonly NormalizedOffer[]
  readonly conflictReason: string
  readonly aiSuggestion: ReviewDecision
  readonly allowedDecisions: readonly ReviewDecision[]
}

export type AtomicComparisonReport = {
  readonly generatedAt: string
  readonly mode: "dry_run"
  readonly safety: {
    readonly woocommerceWrites: 0
    readonly publicProductsCreated: 0
    readonly orderPaymentAutoOrderChanges: 0
  }
  readonly summary: {
    readonly atomicSkuCount: number
    readonly normalizedOfferCount: number
    readonly canonicalProductCount: number
    readonly canonicalVariantCount: number
    readonly comparisonWinnerCount: number
    readonly singleSourceOfferCount: number
    readonly backupOfferCount: number
    readonly crossSupplierBackupCount: number
    readonly supplierAlternateOfferCount: number
    readonly reviewNeededCount: number
    readonly promotionCount: number
    readonly zeroPriceInvalidCount: number
    readonly soldOutCount: number
  }
  readonly variants: readonly CanonicalVariantResult[]
  readonly reviewQueue: readonly AtomicReviewQueueItem[]
  readonly beforeAfter: readonly {
    readonly atomicSkuId: string
    readonly supplierId: string
    readonly beforeProductTitle: string
    readonly beforeOptionName: string
    readonly beforePrice: number
    readonly canonicalProductKey: string
    readonly canonicalVariantKey: string | null
    readonly finalCost: number
    readonly listingStartPrice: number | null
    readonly listingDetailPriceDifference: number | null
    readonly status: AtomicOfferStatus
    readonly winner: boolean
  }[]
}
