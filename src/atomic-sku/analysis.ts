import type { AtomicComparisonReport, CanonicalVariantResult, NormalizedOffer } from "./types.js"

const CONFLICT_FIELDS = [
  "productFamily",
  "variety",
  "processing",
  "qualityGrade",
  "usageGrade",
  "sizeLabel",
  "sizeMin",
  "sizeMax",
  "sizeUnit",
  "weight",
  "weightBasis",
  "count",
  "optionUnit",
  "origin",
  "packaging",
  "packageType",
] as const

export function buildComparisonCoverage(
  offers: readonly NormalizedOffer[],
  report: AtomicComparisonReport,
) {
  const productFamilies = [...new Set(offers.map((offer) => offer.productFamily))].sort()
  const rows = productFamilies.map((productFamily) => {
    const familyOffers = offers.filter((offer) => offer.productFamily === productFamily)
    const familyVariants = variantsForOffers(report.variants, familyOffers)
    return {
      productFamily,
      atomicSkuCount: familyOffers.length,
      canonicalProductCount: new Set(familyOffers.map((offer) => offer.canonicalProductKey)).size,
      canonicalVariantCount: familyVariants.length,
      multiSupplierVariantCount: familyVariants.filter(
        (variant) => variant.activeSupplierCount >= 2,
      ).length,
      singleSourceVariantCount: familyVariants.filter(
        (variant) => variant.comparisonStatus === "single_source",
      ).length,
      comparisonWinnerCount: familyVariants.filter(
        (variant) => variant.selectionType === "comparison_winner",
      ).length,
      backupCount: familyVariants.reduce((sum, variant) => sum + variant.backupCount, 0),
      reviewNeededCount: report.reviewQueue.filter(
        (review) => review.productFamily === productFamily,
      ).length,
      promotionCount: familyOffers.filter((offer) => offer.status === "promotion").length,
      missingSpecCount: familyOffers.filter((offer) => offer.canonicalVariantKey === null).length,
      atomicSkuCountBySupplier: countBy(familyOffers.map((offer) => offer.supplierId)),
    }
  })
  const activeVariants = report.variants.filter((variant) => variant.activeOfferCount > 0)
  const multiSupplierVariants = activeVariants.filter((variant) => variant.activeSupplierCount >= 2)
  const actuallyComparedVariants = activeVariants.filter((variant) => variant.isActuallyCompared)
  return {
    generatedAt: report.generatedAt,
    definition:
      "active 공급처가 2개 이상 연결된 canonical_variant 수 / 전체 active canonical_variant 수",
    overall: {
      activeCanonicalVariantCount: activeVariants.length,
      multiSupplierLinkedVariantCount: multiSupplierVariants.length,
      actuallyComparedVariantCount: actuallyComparedVariants.length,
      comparisonCoverageRatio:
        activeVariants.length === 0 ? 0 : multiSupplierVariants.length / activeVariants.length,
      actuallyComparedRatio:
        activeVariants.length === 0 ? 0 : actuallyComparedVariants.length / activeVariants.length,
    },
    rows,
  }
}

export function buildReviewDetails(
  report: AtomicComparisonReport,
): readonly Readonly<Record<string, unknown>>[] {
  const variants = new Map(report.variants.map((variant) => [variant.canonicalVariantKey, variant]))
  return report.reviewQueue.map((review) => {
    const conflictFields = differingFields(review.extractedOffers)
    const active = review.extractedOffers
      .filter((offer) => offer.status === "active")
      .sort(
        (left, right) =>
          left.finalCost - right.finalCost || left.atomicSkuId.localeCompare(right.atomicSkuId),
      )
    const activeSupplierCount = new Set(active.map((offer) => offer.supplierId)).size
    const mergedSelection =
      active.length === 0
        ? null
        : {
            selectionType: activeSupplierCount >= 2 ? "comparison_winner" : "single_source_offer",
            selectedAtomicSkuId: active[0]?.atomicSkuId ?? null,
            selectedFinalCost: active[0]?.finalCost ?? null,
            rankedActiveOffers: active.map((offer) => ({
              atomicSkuId: offer.atomicSkuId,
              supplierId: offer.supplierId,
              finalCost: offer.finalCost,
            })),
          }
    return {
      reviewKey: review.reviewKey,
      productFamily: review.productFamily,
      suppliers: review.supplierIds,
      offers: review.extractedOffers.map(reviewOffer),
      conflictFields,
      autoMergeBlockedReason: review.conflictReason,
      aiRecommendedDecision: review.aiSuggestion,
      allowedAdminDecisions: review.allowedDecisions,
      sameVariantApprovalResult: {
        mergedCanonicalVariantCandidates: [
          ...new Set(
            review.extractedOffers.flatMap((offer) =>
              offer.canonicalVariantKey === null ? [] : [offer.canonicalVariantKey],
            ),
          ),
        ],
        priceComparison: mergedSelection,
      },
      separateVariantResult: review.extractedOffers.map((offer) => ({
        atomicSkuId: offer.atomicSkuId,
        canonicalProductKey: offer.canonicalProductKey,
        canonicalVariantKey: offer.canonicalVariantKey,
        currentComparisonStatus:
          offer.canonicalVariantKey === null
            ? "missing_spec"
            : (variants.get(offer.canonicalVariantKey)?.comparisonStatus ?? "unlinked"),
        currentSelectionType:
          offer.canonicalVariantKey === null
            ? null
            : (variants.get(offer.canonicalVariantKey)?.selectionType ?? null),
      })),
    }
  })
}

export function buildCanonicalHierarchy(
  offers: readonly NormalizedOffer[],
  report: AtomicComparisonReport,
) {
  const products = new Map<string, NormalizedOffer[]>()
  for (const offer of offers) {
    const productOffers = products.get(offer.canonicalProductKey) ?? []
    productOffers.push(offer)
    products.set(offer.canonicalProductKey, productOffers)
  }
  return [...products.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([canonicalProductKey, productOffers]) => {
      const first = productOffers[0]
      const variants = variantsForOffers(report.variants, productOffers)
      return {
        canonicalProductKey,
        productFamily: first?.productFamily ?? "unknown",
        gradeGroup: first?.qualityGrade ?? "quality_standard",
        usageGroup: first?.usageGrade ?? "usage_standard",
        separationLevel:
          first?.qualityGrade !== null || first?.usageGrade !== null
            ? "grade_or_usage_group_within_canonical_product"
            : "canonical_product_without_explicit_grade",
        separationExplanation:
          first?.qualityGrade !== null || first?.usageGrade !== null
            ? "quality_grade와 usage_grade는 canonical_product key에서 제외되고 variant의 grade/usage group으로 유지됨"
            : "명시적 grade/usage 표현이 없어 standard group으로 유지됨",
        variants: variants.map((variant) => ({
          ...variant,
          supplierOffers: productOffers
            .filter((offer) => offer.canonicalVariantKey === variant.canonicalVariantKey)
            .map((offer) => ({
              atomicSkuId: offer.atomicSkuId,
              supplierId: offer.supplierId,
              originalProductTitle: offer.originalProductTitle,
              originalOptionName: offer.originalOptionName,
              finalCost: offer.finalCost,
              status: offer.status,
            })),
        })),
      }
    })
}

export function buildUnmatchedReasons(
  offers: readonly NormalizedOffer[],
  report: AtomicComparisonReport,
) {
  const reviewOfferIds = new Set(
    report.reviewQueue.flatMap((review) =>
      review.extractedOffers.map((offer) => offer.atomicSkuId),
    ),
  )
  return report.variants
    .filter((variant) => variant.comparisonStatus === "single_source")
    .map((variant) => {
      const variantOffers = offers.filter(
        (offer) => offer.canonicalVariantKey === variant.canonicalVariantKey,
      )
      const first = variantOffers[0]
      const otherSupplierOffers = offers.filter(
        (offer) =>
          offer.status === "active" &&
          offer.productFamily === first?.productFamily &&
          variantOffers.every((current) => current.supplierId !== offer.supplierId),
      )
      const reason = classifyUnmatched(
        first,
        otherSupplierOffers,
        variantOffers.some((offer) => reviewOfferIds.has(offer.atomicSkuId)),
      )
      return {
        canonicalProductKey: variant.canonicalProductKey,
        canonicalVariantKey: variant.canonicalVariantKey,
        productFamily: first?.productFamily ?? "unknown",
        sourceSuppliers: [...new Set(variantOffers.map((offer) => offer.supplierId))],
        activeOfferCount: variant.activeOfferCount,
        unmatchedReason: reason,
        nearestOtherSupplierCandidates: otherSupplierOffers.slice(0, 5).map((offer) => ({
          supplierId: offer.supplierId,
          canonicalVariantKey: offer.canonicalVariantKey,
          originalProductTitle: offer.originalProductTitle,
          originalOptionName: offer.originalOptionName,
        })),
      }
    })
    .sort(
      (left, right) =>
        right.activeOfferCount - left.activeOfferCount ||
        left.canonicalVariantKey.localeCompare(right.canonicalVariantKey),
    )
    .slice(0, 30)
}

function reviewOffer(offer: NormalizedOffer): Readonly<Record<string, unknown>> {
  return {
    supplierId: offer.supplierId,
    originalProductTitle: offer.originalProductTitle,
    originalOptionName: offer.originalOptionName,
    detailUrl: offer.productUrl,
    imageUrl: offer.imageUrl,
    finalCost: offer.finalCost,
    status: offer.status,
    canonicalProductKey: offer.canonicalProductKey,
    canonicalVariantKey: offer.canonicalVariantKey,
    extractedAttributes: Object.fromEntries(CONFLICT_FIELDS.map((field) => [field, offer[field]])),
    provenance: offer.provenance,
  }
}

function differingFields(offers: readonly NormalizedOffer[]): readonly string[] {
  return CONFLICT_FIELDS.filter(
    (field) => new Set(offers.map((offer) => String(offer[field] ?? ""))).size > 1,
  )
}

function variantsForOffers(
  variants: readonly CanonicalVariantResult[],
  offers: readonly NormalizedOffer[],
): readonly CanonicalVariantResult[] {
  const keys = new Set(
    offers.flatMap((offer) =>
      offer.canonicalVariantKey === null ? [] : [offer.canonicalVariantKey],
    ),
  )
  return variants.filter((variant) => keys.has(variant.canonicalVariantKey))
}

function countBy(values: readonly string[]): Readonly<Record<string, number>> {
  const result: Record<string, number> = {}
  for (const value of values) result[value] = (result[value] ?? 0) + 1
  return result
}

function classifyUnmatched(
  offer: NormalizedOffer | undefined,
  candidates: readonly NormalizedOffer[],
  reviewPending: boolean,
): string {
  if (offer === undefined || offer.canonicalVariantKey === null) return "규격 정보 누락"
  if (reviewPending) return "review 대기"
  if (candidates.length === 0) return "다른 공급처에 해당 품목 없음"
  if (
    candidates.every(
      (candidate) =>
        candidate.processing !== offer.processing || candidate.packaging !== offer.packaging,
    )
  ) {
    return "가공/포장 상태 차이"
  }
  if (
    candidates.every(
      (candidate) =>
        candidate.qualityGrade !== offer.qualityGrade || candidate.usageGrade !== offer.usageGrade,
    )
  ) {
    return "등급 불일치"
  }
  if (
    candidates.every(
      (candidate) => candidate.weight !== offer.weight || candidate.count !== offer.count,
    )
  ) {
    return "중량/수량 불일치"
  }
  if (
    candidates.every(
      (candidate) =>
        candidate.sizeMin !== offer.sizeMin ||
        candidate.sizeMax !== offer.sizeMax ||
        candidate.sizeLabel !== offer.sizeLabel,
    )
  ) {
    return "크기 수치 불일치"
  }
  return "문자열 alias 미등록"
}
