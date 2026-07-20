import { createHash } from "node:crypto"
import type {
  AtomicComparisonReport,
  AtomicReviewQueueItem,
  CanonicalVariantResult,
  NormalizedOffer,
  ReviewDecision,
} from "./types.js"

export type NormalizationRule = {
  readonly supplierId: string
  readonly productFamily: string
  readonly decision: ReviewDecision
  readonly matchJson: Readonly<Record<string, string>>
}

export type DryRunProductPairRule = {
  readonly ruleId: string
  readonly decision: "separate_variant" | "review_needed"
  readonly productFamily: string
  readonly conflictFields: readonly string[]
  readonly left: { readonly supplierId: string; readonly sourceProductId: string }
  readonly right: { readonly supplierId: string; readonly sourceProductId: string }
}

export type CrossSupplierCandidateDecision =
  | "same_variant"
  | "separate_variant"
  | "separate_product"
  | "review_needed"

export type CrossSupplierProductCandidate = {
  readonly productFamily: string
  readonly leftSupplierId: string
  readonly leftSourceProductId: string
  readonly leftTitle: string
  readonly leftAtomicSkuCount: number
  readonly rightSupplierId: string
  readonly rightSourceProductId: string
  readonly rightTitle: string
  readonly rightAtomicSkuCount: number
  readonly decision: CrossSupplierCandidateDecision
  readonly decisionCounts: Readonly<Record<CrossSupplierCandidateDecision, number>>
  readonly reasons: readonly string[]
  readonly offers: readonly NormalizedOffer[]
  readonly reviewOffers: readonly NormalizedOffer[]
  readonly separatedOffers: readonly NormalizedOffer[]
}

export function compareNormalizedOffers(input: {
  readonly offers: readonly NormalizedOffer[]
  readonly rules?: readonly NormalizationRule[]
  readonly productPairRules?: readonly DryRunProductPairRule[]
  readonly generatedAt?: string
}): AtomicComparisonReport {
  const matchingOffers = input.offers.filter((offer) => offer.status !== "promotion")
  const groups = groupByVariant(input.offers)
  const variants: CanonicalVariantResult[] = []
  const reviewQueue = new Map<string, AtomicReviewQueueItem>()
  const crossSupplierCandidates = buildCrossSupplierProductCandidates(
    input.offers,
    input.productPairRules ?? [],
  )
  const reviewBlockedAtomicSkuIds = new Set(
    crossSupplierCandidates.flatMap((candidate) =>
      candidate.reviewOffers.map((offer) => offer.atomicSkuId),
    ),
  )
  const separatedByRuleAtomicSkuIds = new Set(
    crossSupplierCandidates.flatMap((candidate) =>
      candidate.separatedOffers.map((offer) => offer.atomicSkuId),
    ),
  )

  for (const [variantKey, offers] of groups) {
    const evaluation = evaluateVariant(
      variantKey,
      offers,
      input.rules ?? [],
      reviewBlockedAtomicSkuIds,
      separatedByRuleAtomicSkuIds,
    )
    variants.push(evaluation.variant)
    if (evaluation.review !== null) reviewQueue.set(evaluation.review.reviewKey, evaluation.review)
  }
  for (const offer of input.offers.filter(
    (item) => item.canonicalVariantKey === null && item.status !== "promotion",
  )) {
    const item = buildReviewQueueItem([offer], "missing_variant_spec", "missing_spec")
    reviewQueue.set(item.reviewKey, item)
  }
  for (const item of buildCrossVariantAmbiguityReviews(crossSupplierCandidates)) {
    reviewQueue.set(item.reviewKey, item)
  }
  const comparisonWinners = new Set(
    variants.flatMap((variant) =>
      variant.comparisonWinnerAtomicSkuId === null ? [] : [variant.comparisonWinnerAtomicSkuId],
    ),
  )
  const singleSourceOffers = new Set(
    variants.flatMap((variant) =>
      variant.singleSourceOfferAtomicSkuId === null ? [] : [variant.singleSourceOfferAtomicSkuId],
    ),
  )
  const consolidatedReviewQueue = consolidateReviewItems([...reviewQueue.values()])

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    mode: "dry_run",
    safety: {
      woocommerceWrites: 0,
      publicProductsCreated: 0,
      orderPaymentAutoOrderChanges: 0,
    },
    summary: {
      atomicSkuCount: input.offers.length,
      normalizedOfferCount: input.offers.length,
      canonicalProductCount: new Set(matchingOffers.map((offer) => offer.canonicalProductKey)).size,
      canonicalVariantCount: variants.length,
      comparisonWinnerCount: comparisonWinners.size,
      singleSourceOfferCount: singleSourceOffers.size,
      backupOfferCount: variants.reduce(
        (sum, variant) => sum + variant.backupAtomicSkuIds.length,
        0,
      ),
      crossSupplierBackupCount: variants.reduce(
        (sum, variant) => sum + variant.crossSupplierBackupCount,
        0,
      ),
      supplierAlternateOfferCount: variants.reduce(
        (sum, variant) => sum + variant.supplierAlternateOfferCount,
        0,
      ),
      reviewNeededCount: consolidatedReviewQueue.length,
      promotionCount: input.offers.filter((offer) => offer.status === "promotion").length,
      zeroPriceInvalidCount: input.offers.filter((offer) => offer.status === "zero_price_invalid")
        .length,
      soldOutCount: input.offers.filter((offer) => offer.status === "sold_out").length,
    },
    variants: variants.sort((left, right) =>
      left.canonicalVariantKey.localeCompare(right.canonicalVariantKey),
    ),
    reviewQueue: consolidatedReviewQueue,
    beforeAfter: input.offers.map((offer) => ({
      atomicSkuId: offer.atomicSkuId,
      supplierId: offer.supplierId,
      beforeProductTitle: offer.originalProductTitle,
      beforeOptionName: offer.originalOptionName,
      beforePrice: offer.supplierPrice,
      canonicalProductKey: offer.canonicalProductKey,
      canonicalVariantKey: offer.canonicalVariantKey,
      finalCost: offer.finalCost,
      listingStartPrice: offer.listingStartPrice,
      listingDetailPriceDifference:
        offer.listingStartPrice === null ? null : offer.supplierPrice - offer.listingStartPrice,
      status: offer.status,
      winner: comparisonWinners.has(offer.atomicSkuId),
    })),
  }
}

function consolidateReviewItems(
  items: readonly AtomicReviewQueueItem[],
): readonly AtomicReviewQueueItem[] {
  const groups = new Map<
    string,
    { readonly reason: string; readonly suggestion: ReviewDecision; offers: NormalizedOffer[] }
  >()
  for (const item of items) {
    const productPair = [
      ...new Set(
        item.extractedOffers.map((offer) => `${offer.supplierId}:${offer.sourceProductId}`),
      ),
    ].sort()
    const key = `${item.productFamily}|${productPair.join("|")}|${item.conflictReason}|${item.aiSuggestion}`
    const group = groups.get(key) ?? {
      reason: item.conflictReason,
      suggestion: item.aiSuggestion,
      offers: [],
    }
    const ids = new Set(group.offers.map((offer) => offer.atomicSkuId))
    for (const offer of item.extractedOffers) {
      if (!ids.has(offer.atomicSkuId)) group.offers.push(offer)
    }
    groups.set(key, group)
  }
  return [...groups.values()].map((group) =>
    buildReviewQueueItem(group.offers, group.reason, group.suggestion),
  )
}

export function buildCrossSupplierProductCandidates(
  offers: readonly NormalizedOffer[],
  productPairRules: readonly DryRunProductPairRule[],
): readonly CrossSupplierProductCandidate[] {
  const products = new Map<string, NormalizedOffer[]>()
  const eligible = offers.filter((offer) => offer.status === "active")
  for (const offer of eligible) {
    if (offer.productFamily === "unknown") continue
    const key = `${offer.productFamily}|${offer.supplierId}|${offer.sourceProductId}`
    const productOffers = products.get(key) ?? []
    productOffers.push(offer)
    products.set(key, productOffers)
  }
  const productGroups = [...products.values()]
  const result: CrossSupplierProductCandidate[] = []
  for (let leftIndex = 0; leftIndex < productGroups.length; leftIndex += 1) {
    const leftOffers = productGroups[leftIndex] ?? []
    const left = leftOffers?.[0]
    if (left === undefined) continue
    for (let rightIndex = leftIndex + 1; rightIndex < productGroups.length; rightIndex += 1) {
      const rightOffers = productGroups[rightIndex] ?? []
      const right = rightOffers?.[0]
      if (
        right === undefined ||
        left.supplierId === right.supplierId ||
        left.productFamily !== right.productFamily
      ) {
        continue
      }
      const evaluations = leftOffers.flatMap((leftOffer) =>
        rightOffers.map((rightOffer) => ({
          ...classifyCrossSupplierOfferCandidate(leftOffer, rightOffer, productPairRules),
          leftOffer,
          rightOffer,
        })),
      )
      const decisionCounts = {
        same_variant: evaluations.filter((item) => item.decision === "same_variant").length,
        separate_variant: evaluations.filter((item) => item.decision === "separate_variant").length,
        separate_product: evaluations.filter((item) => item.decision === "separate_product").length,
        review_needed: evaluations.filter((item) => item.decision === "review_needed").length,
      }
      const decision =
        decisionCounts.review_needed > 0
          ? "review_needed"
          : decisionCounts.same_variant > 0
            ? "same_variant"
            : decisionCounts.separate_product > 0
              ? "separate_product"
              : "separate_variant"
      result.push({
        productFamily: left.productFamily,
        leftSupplierId: left.supplierId,
        leftSourceProductId: left.sourceProductId,
        leftTitle: left.originalProductTitle,
        leftAtomicSkuCount: leftOffers.length,
        rightSupplierId: right.supplierId,
        rightSourceProductId: right.sourceProductId,
        rightTitle: right.originalProductTitle,
        rightAtomicSkuCount: rightOffers.length,
        decision,
        decisionCounts,
        reasons: [...new Set(evaluations.map((item) => item.reason))],
        offers: [...leftOffers, ...rightOffers],
        reviewOffers: uniqueOffers(
          evaluations
            .filter((item) => item.decision === "review_needed")
            .flatMap((item) => [item.leftOffer, item.rightOffer]),
        ),
        separatedOffers: uniqueOffers(
          evaluations
            .filter(
              (item) =>
                item.decision === "separate_variant" || item.decision === "separate_product",
            )
            .flatMap((item) => [item.leftOffer, item.rightOffer]),
        ),
      })
    }
  }
  return result
}

function buildCrossVariantAmbiguityReviews(
  candidates: readonly CrossSupplierProductCandidate[],
): readonly AtomicReviewQueueItem[] {
  return candidates
    .filter((candidate) => candidate.decision === "review_needed")
    .map((candidate) =>
      buildReviewQueueItem(candidate.reviewOffers, candidate.reasons.join(","), "missing_spec"),
    )
}

function classifyCrossSupplierOfferCandidate(
  left: NormalizedOffer,
  right: NormalizedOffer,
  productPairRules: readonly DryRunProductPairRule[],
): { readonly decision: CrossSupplierCandidateDecision; readonly reason: string } {
  const productPairRule = matchingProductPairRule(left, right, productPairRules)
  if (productPairRule?.decision === "separate_variant") {
    return { decision: "separate_variant", reason: "fixture_product_pair_rule" }
  }
  const hardSeparateProductReason = automaticSeparateProductReason(left, right)
  if (hardSeparateProductReason !== null) {
    return { decision: "separate_product", reason: hardSeparateProductReason }
  }
  const hardSeparateReason = automaticSeparateVariantReason(left, right)
  if (hardSeparateReason !== null) {
    return { decision: "separate_variant", reason: hardSeparateReason }
  }
  if (productPairRule?.decision === "review_needed") {
    return {
      decision: "review_needed",
      reason: `fixture_product_pair_review_rule:${productPairRule.conflictFields.join("+")}`,
    }
  }
  if (left.canonicalVariantKey !== null && left.canonicalVariantKey === right.canonicalVariantKey) {
    return { decision: "same_variant", reason: "canonical_variant_key_match" }
  }
  return {
    decision: "review_needed",
    reason: ambiguousLabelPair(left, right)
      ? "cross_supplier_ambiguous_label_pair_without_admin_rule"
      : "cross_supplier_candidate_missing_or_ambiguous_spec",
  }
}

function automaticSeparateProductReason(
  left: NormalizedOffer,
  right: NormalizedOffer,
): string | null {
  if (
    left.productFamily === "복숭아" &&
    left.peachSkinType !== "unknown" &&
    right.peachSkinType !== "unknown" &&
    left.peachSkinType !== right.peachSkinType
  ) {
    return "peach_skin_type_mismatch"
  }
  if (
    left.productFamily === "자두" &&
    right.productFamily === "자두" &&
    left.variety !== right.variety &&
    (left.variety !== null || right.variety !== null)
  ) {
    return "explicit_plum_variety_vs_unspecified"
  }
  if (left.variety !== null && right.variety !== null && left.variety !== right.variety) {
    return "explicit_product_type_or_variety_mismatch"
  }
  return null
}

function automaticSeparateVariantReason(
  left: NormalizedOffer,
  right: NormalizedOffer,
): string | null {
  if (left.processing !== right.processing) return "processing_mismatch"
  if (left.qualityGrade !== right.qualityGrade) return "quality_grade_mismatch"
  if (left.usageGrade !== right.usageGrade) return "usage_grade_mismatch"
  if (left.weightBasis !== right.weightBasis) return "weight_basis_mismatch"
  if (
    left.sizeLabel !== null &&
    right.sizeLabel !== null &&
    left.sizeLabel !== right.sizeLabel &&
    !ambiguousLabelPair(left, right)
  ) {
    return "size_label_mismatch"
  }
  if (
    left.sizeMin !== null &&
    right.sizeMin !== null &&
    (left.sizeMin !== right.sizeMin || left.sizeMax !== right.sizeMax)
  ) {
    return "numeric_size_mismatch"
  }
  if (left.weight !== null && right.weight !== null && left.weight !== right.weight) {
    return "weight_mismatch"
  }
  if (left.count !== null && right.count !== null && left.count !== right.count) {
    return "count_mismatch"
  }
  return null
}

function matchingProductPairRule(
  left: NormalizedOffer,
  right: NormalizedOffer,
  rules: readonly DryRunProductPairRule[],
): DryRunProductPairRule | undefined {
  return rules.find(
    (rule) =>
      rule.productFamily === left.productFamily &&
      ((matchesRuleSide(left, rule.left) && matchesRuleSide(right, rule.right)) ||
        (matchesRuleSide(left, rule.right) && matchesRuleSide(right, rule.left))),
  )
}

function matchesRuleSide(offer: NormalizedOffer, side: DryRunProductPairRule["left"]): boolean {
  return offer.supplierId === side.supplierId && offer.sourceProductId === side.sourceProductId
}

function ambiguousLabelPair(left: NormalizedOffer, right: NormalizedOffer): boolean {
  return isPair(left.sizeLabel, right.sizeLabel, [
    ["중", "중과"],
    ["대", "대과"],
  ])
}

function isPair(
  left: string | null,
  right: string | null,
  pairs: readonly (readonly [string, string])[],
): boolean {
  return pairs.some(([a, b]) => (left === a && right === b) || (left === b && right === a))
}

function groupByVariant(
  offers: readonly NormalizedOffer[],
): ReadonlyMap<string, readonly NormalizedOffer[]> {
  const groups = new Map<string, NormalizedOffer[]>()
  for (const offer of offers) {
    if (offer.canonicalVariantKey === null || offer.status === "promotion") continue
    const group = groups.get(offer.canonicalVariantKey) ?? []
    group.push(offer)
    groups.set(offer.canonicalVariantKey, group)
  }
  return groups
}

function evaluateVariant(
  variantKey: string,
  offers: readonly NormalizedOffer[],
  rules: readonly NormalizationRule[],
  reviewBlockedAtomicSkuIds: ReadonlySet<string>,
  separatedByRuleAtomicSkuIds: ReadonlySet<string>,
): { readonly variant: CanonicalVariantResult; readonly review: AtomicReviewQueueItem | null } {
  const active = offers.filter((offer) => offer.status === "active")
  const promotion = offers.filter((offer) => offer.status === "promotion")
  const duplicatePromotionIds =
    active.length === 0 ? new Set<string>() : new Set(promotion.map((offer) => offer.atomicSkuId))
  const eligible = active
  const retainedUnavailable = offers.filter(
    (offer) => offer.status === "sold_out" || offer.status === "preorder",
  )
  const excluded = offers.filter(
    (offer) =>
      duplicatePromotionIds.has(offer.atomicSkuId) ||
      offer.status === "zero_price_invalid" ||
      offer.status === "expired" ||
      offer.status === "blocked" ||
      offer.status === "review_needed" ||
      offer.status === "promotion",
  )
  const supplierCount = new Set(active.map((offer) => offer.supplierId)).size
  const ambiguousAcrossSuppliers =
    supplierCount > 1 &&
    eligible.some((offer) => hasAmbiguousNonNumericSpec(offer)) &&
    eligible.some((offer) => !hasApprovedSameVariantRule(offer, rules))
  const reasons = [
    ...(active.some((offer) => reviewBlockedAtomicSkuIds.has(offer.atomicSkuId))
      ? ["cross_supplier_product_family_candidate_requires_review"]
      : []),
    ...(ambiguousAcrossSuppliers ? ["cross_supplier_label_without_numeric_spec"] : []),
  ]
  if (reasons.length > 0) {
    return {
      variant: {
        canonicalProductKey: offers[0]?.canonicalProductKey ?? "unknown",
        canonicalVariantKey: variantKey,
        status: "review_needed",
        selectionType: null,
        selectedOfferAtomicSkuId: null,
        comparisonWinnerAtomicSkuId: null,
        singleSourceOfferAtomicSkuId: null,
        rankedOfferAtomicSkuIds: [],
        backupAtomicSkuIds: retainedUnavailable.map((offer) => offer.atomicSkuId),
        crossSupplierBackupAtomicSkuIds: [],
        supplierAlternateOfferAtomicSkuIds: [],
        excludedAtomicSkuIds: [...eligible, ...excluded].map((offer) => offer.atomicSkuId),
        activeSupplierCount: supplierCount,
        activeOfferCount: active.length,
        backupCount: retainedUnavailable.length,
        crossSupplierBackupCount: 0,
        supplierAlternateOfferCount: 0,
        isActuallyCompared: false,
        winnerReason: "review_required_before_price_comparison",
        comparisonStatus: "review_blocked",
        reasons,
      },
      review: ambiguousAcrossSuppliers
        ? buildReviewQueueItem(offers, reasons.join(","), "missing_spec")
        : null,
    }
  }
  const ranked = [...eligible].sort(
    (left, right) =>
      left.finalCost - right.finalCost || left.atomicSkuId.localeCompare(right.atomicSkuId),
  )
  const selected = ranked[0] ?? null
  const isActuallyCompared = supplierCount >= 2
  const isSeparatedByRule =
    supplierCount === 1 &&
    active.some((offer) => separatedByRuleAtomicSkuIds.has(offer.atomicSkuId))
  const selectionType =
    selected === null
      ? null
      : isActuallyCompared
        ? ("comparison_winner" as const)
        : isSeparatedByRule
          ? ("separated_by_rule" as const)
          : ("single_source_offer" as const)
  const blockedReason =
    selected === null && promotion.length > 0
      ? "promotion_without_duplicate_or_admin_approval"
      : "no_active_eligible_offer"
  const backupAtomicSkuIds = [
    ...ranked.slice(1).map((offer) => offer.atomicSkuId),
    ...retainedUnavailable.map((offer) => offer.atomicSkuId),
  ]
  const bestOfferBySupplier = new Map<string, NormalizedOffer>()
  for (const offer of ranked) {
    if (!bestOfferBySupplier.has(offer.supplierId)) {
      bestOfferBySupplier.set(offer.supplierId, offer)
    }
  }
  const crossSupplierBackupAtomicSkuIds =
    selected === null
      ? []
      : [...bestOfferBySupplier.values()]
          .filter((offer) => offer.supplierId !== selected.supplierId)
          .map((offer) => offer.atomicSkuId)
  const primaryOfferIds = new Set([
    ...(selected === null ? [] : [selected.atomicSkuId]),
    ...crossSupplierBackupAtomicSkuIds,
  ])
  const supplierAlternateOfferAtomicSkuIds = ranked
    .filter((offer) => !primaryOfferIds.has(offer.atomicSkuId))
    .map((offer) => offer.atomicSkuId)
  return {
    variant: {
      canonicalProductKey: offers[0]?.canonicalProductKey ?? "unknown",
      canonicalVariantKey: variantKey,
      status:
        selected === null
          ? "blocked"
          : isActuallyCompared
            ? "comparison_winner_selected"
            : isSeparatedByRule
              ? "separated_by_rule"
              : "single_source_offer",
      selectionType,
      selectedOfferAtomicSkuId: selected?.atomicSkuId ?? null,
      comparisonWinnerAtomicSkuId:
        selectionType === "comparison_winner" ? (selected?.atomicSkuId ?? null) : null,
      singleSourceOfferAtomicSkuId:
        selectionType === "single_source_offer" ? (selected?.atomicSkuId ?? null) : null,
      rankedOfferAtomicSkuIds: ranked.map((offer) => offer.atomicSkuId),
      backupAtomicSkuIds,
      crossSupplierBackupAtomicSkuIds,
      supplierAlternateOfferAtomicSkuIds,
      excludedAtomicSkuIds: excluded.map((offer) => offer.atomicSkuId),
      activeSupplierCount: supplierCount,
      activeOfferCount: active.length,
      backupCount: backupAtomicSkuIds.length,
      crossSupplierBackupCount: crossSupplierBackupAtomicSkuIds.length,
      supplierAlternateOfferCount: supplierAlternateOfferAtomicSkuIds.length,
      isActuallyCompared,
      winnerReason:
        selected === null
          ? blockedReason
          : isActuallyCompared
            ? `lowest_final_cost_among_${supplierCount}_active_suppliers`
            : isSeparatedByRule
              ? "cross_supplier_candidates_separated_by_hard_rule"
              : "only_active_supplier_not_a_price_comparison",
      comparisonStatus:
        selected === null
          ? "no_active_offer"
          : isActuallyCompared
            ? "multi_supplier_compared"
            : isSeparatedByRule
              ? "separated_by_rule"
              : "single_source",
      reasons: selected === null ? [blockedReason] : [],
    },
    review: null,
  }
}

function uniqueOffers(offers: readonly NormalizedOffer[]): readonly NormalizedOffer[] {
  return [...new Map(offers.map((offer) => [offer.atomicSkuId, offer])).values()]
}

function hasAmbiguousNonNumericSpec(offer: NormalizedOffer): boolean {
  const ambiguousSize = new Set(["중", "중과", "대", "대과"])
  const ambiguousQuality = new Set(["특품", "특A", "A급", "가정용", "실속형"])
  const ambiguousUsage = new Set(["혼합과", "랜덤과"])
  return (
    (offer.sizeLabel !== null && offer.sizeMin === null && ambiguousSize.has(offer.sizeLabel)) ||
    (offer.qualityGrade !== null && ambiguousQuality.has(offer.qualityGrade)) ||
    (offer.usageGrade !== null && ambiguousUsage.has(offer.usageGrade))
  )
}

function hasApprovedSameVariantRule(
  offer: NormalizedOffer,
  rules: readonly NormalizationRule[],
): boolean {
  return rules.some(
    (rule) =>
      rule.supplierId === offer.supplierId &&
      rule.productFamily === offer.productFamily &&
      rule.decision === "same_variant" &&
      ruleMatches(offer, rule.matchJson),
  )
}

function ruleMatches(offer: NormalizedOffer, matchJson: Readonly<Record<string, string>>): boolean {
  return Object.entries(matchJson).every(
    ([key, value]) =>
      key === "status" || String(offer[key as keyof NormalizedOffer] ?? "") === value,
  )
}

function buildReviewQueueItem(
  offers: readonly NormalizedOffer[],
  reason: string,
  suggestion: ReviewDecision,
): AtomicReviewQueueItem {
  const first = offers[0]
  const productFamily = first?.productFamily ?? "unknown"
  const canonicalVariantKey = first?.canonicalVariantKey ?? null
  return {
    reviewKey: hash(
      `${productFamily}|${canonicalVariantKey ?? "missing"}|${offers
        .map((offer) => offer.atomicSkuId)
        .sort()
        .join("|")}|${reason}`,
    ),
    productFamily,
    canonicalVariantKey,
    supplierIds: [...new Set(offers.map((offer) => offer.supplierId))],
    originalTitles: offers.map((offer) => offer.originalProductTitle),
    originalOptionNames: offers.map((offer) => offer.originalOptionName),
    detailDescriptions: offers.map((offer) => offer.detailDescription),
    imageUrls: offers.map((offer) => offer.imageUrl),
    extractedOffers: offers,
    conflictReason: reason,
    aiSuggestion: suggestion,
    allowedDecisions: [
      "same_variant",
      "separate_variant",
      "separate_product",
      "exclude",
      "missing_spec",
    ],
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
