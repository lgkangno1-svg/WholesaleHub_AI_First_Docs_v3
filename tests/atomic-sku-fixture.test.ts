import { describe, expect, it } from "vitest"
import { collectAtomicSkus } from "../src/atomic-sku/collect.js"
import {
  buildCrossSupplierProductCandidates,
  compareNormalizedOffers,
} from "../src/atomic-sku/compare.js"
import { FIVE_ITEM_DRY_RUN_PRODUCT_PAIR_RULES } from "../src/atomic-sku/fixture-rules.js"
import { normalizeAtomicSku } from "../src/atomic-sku/normalize.js"
import type {
  SupplierAtomicAdapter,
  SupplierProductDetail,
  SupplierProductReference,
} from "../src/atomic-sku/supplier-adapter.js"
import type { AtomicSupplierSku } from "../src/atomic-sku/types.js"

describe("atomic SKU comparison", () => {
  it("is idempotent for SKU and review keys", async () => {
    const adapter = fakeAdapter("supplier_c", "중 5개", 9700)
    const first = await collectAtomicSkus({ adapters: [adapter], includeProduct: () => true })
    const second = await collectAtomicSkus({ adapters: [adapter], includeProduct: () => true })
    expect(first[0]?.atomicSkuId).toBe(second[0]?.atomicSkuId)
    const a = compareNormalizedOffers({
      offers: first.map(normalizeAtomicSku),
      generatedAt: "same",
    })
    const b = compareNormalizedOffers({
      offers: second.map(normalizeAtomicSku),
      generatedAt: "same",
    })
    expect(a.reviewQueue.map((item) => item.reviewKey)).toEqual(
      b.reviewQueue.map((item) => item.reviewKey),
    )
  })

  it("stores traceable provenance for every normalized attribute", () => {
    const offer = normalizeAtomicSku(sku("a", "새콤달콤 고당도 레드루비자몽", "중 5개", 9700))
    expect(offer.productFamily).toBe("자몽")
    expect(offer.removedMarketingTerms).toEqual(["새콤달콤", "고당도"])
    expect(offer.provenance["productFamily"]).toMatchObject({
      sourceField: "title",
      normalizedValue: "자몽",
      extractionMethod: "family_dictionary",
    })
    expect(offer.provenance["productFamily"]?.reason.length).toBeGreaterThan(0)
  })

  it("detects explicit promotion evidence in option or description but not 특가 alone", () => {
    const optionPromotion = normalizeAtomicSku(
      sku(
        "dailyfood",
        "[단독특가 / 박스포함] 성주참외 혼합 랜덤과",
        "★ [박스포함] 참외 반짝행사 10kg",
        8600,
      ),
    )
    const descriptionPromotion = normalizeAtomicSku({
      ...sku("a", "성주참외 특가", "실중량 5kg", 9000),
      detailDescription: "오늘만 예약발송",
    })
    const priceWordOnly = normalizeAtomicSku(sku("b", "초특가 성주참외", "실중량 5kg", 9000))
    expect(optionPromotion.status).toBe("promotion")
    expect(optionPromotion.provenance["promotionFlag"]?.sourceField).toBe("option")
    expect(descriptionPromotion.status).toBe("promotion")
    expect(descriptionPromotion.provenance["promotionFlag"]?.sourceField).toBe("description")
    expect(priceWordOnly.status).toBe("active")
    expect(compareNormalizedOffers({ offers: [optionPromotion] }).reviewQueue).toHaveLength(0)
  })

  it("keeps grade and usage in variants under one canonical product", () => {
    const home = normalizeAtomicSku(sku("a", "부사 사과 가정용", "랜덤과 2kg", 9000))
    const premium = normalizeAtomicSku(sku("b", "부사 사과 특품", "2kg", 12000))
    const juice = normalizeAtomicSku(sku("c", "부사 사과 쥬스용", "2kg", 7000))
    expect(
      new Set([home.canonicalProductKey, premium.canonicalProductKey, juice.canonicalProductKey])
        .size,
    ).toBe(1)
    expect(
      new Set([home.canonicalVariantKey, premium.canonicalVariantKey, juice.canonicalVariantKey])
        .size,
    ).toBe(3)
  })

  it("extracts weight basis and does not let package type alone block matching", () => {
    const grossBox = normalizeAtomicSku(sku("a", "부사 사과", "박스무게포함 5kg", 9000))
    const netBox = normalizeAtomicSku(sku("b", "부사 사과", "실중량 박스 5kg", 10000))
    const unknownBulk = normalizeAtomicSku(sku("c", "부사 사과", "벌크 5kg", 8000))
    const unknownBox = normalizeAtomicSku(sku("d", "부사 사과", "박스 5kg", 8100))
    expect(grossBox.weightBasis).toBe("gross")
    expect(netBox.weightBasis).toBe("net")
    expect(unknownBulk.weightBasis).toBe("unknown")
    expect(grossBox.packageType).toBe("박스")
    expect(unknownBulk.packageType).toBe("벌크")
    expect(unknownBulk.canonicalVariantKey).toBe(unknownBox.canonicalVariantKey)
    const report = compareNormalizedOffers({ offers: [grossBox, netBox] })
    expect(report.reviewQueue).toHaveLength(0)
  })

  it("requires review for non-numeric ambiguous labels across suppliers", () => {
    const offers = [
      normalizeAtomicSku(sku("a", "성주참외", "중 10개", 10000)),
      normalizeAtomicSku(sku("b", "성주참외", "중 10개", 9000)),
    ]
    const report = compareNormalizedOffers({ offers })
    expect(report.variants[0]?.status).toBe("review_needed")
    expect(report.variants[0]?.selectedOfferAtomicSkuId).toBeNull()
    expect(report.variants[0]?.comparisonStatus).toBe("review_blocked")
  })

  it("consolidates repeated option conflicts into one product-pair review", () => {
    const offers = [
      normalizeAtomicSku(sku("a", "성주참외", "중 5개", 5000)),
      normalizeAtomicSku({
        ...sku("a", "성주참외", "중 10개", 9000),
        atomicSkuId: "a:10",
        sourceOptionId: "a:10",
      }),
      normalizeAtomicSku(sku("b", "성주참외", "중 5개", 5100)),
      normalizeAtomicSku({
        ...sku("b", "성주참외", "중 10개", 9100),
        atomicSkuId: "b:10",
        sourceOptionId: "b:10",
      }),
    ]
    expect(compareNormalizedOffers({ offers }).reviewQueue).toHaveLength(1)
  })

  it("creates broad cross-supplier candidates by product family before spec decisions", () => {
    const offers = [
      normalizeAtomicSku(sku("a", "부사 사과", "3kg", 5000)),
      normalizeAtomicSku(sku("b", "부사 사과", "10kg", 9000)),
    ]
    const candidates = buildCrossSupplierProductCandidates(offers, [])
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      productFamily: "사과",
      decision: "separate_variant",
      decisionCounts: {
        same_variant: 0,
        separate_variant: 1,
        separate_product: 0,
        review_needed: 0,
      },
      reasons: ["weight_mismatch"],
    })
  })

  it("automatically keeps conflicting grades as separate variants without review", () => {
    const offers = [
      normalizeAtomicSku(sku("a", "부사 사과 가정용", "5kg", 10000)),
      normalizeAtomicSku(sku("b", "부사 사과 실속형", "5kg", 9000)),
    ]
    const report = compareNormalizedOffers({ offers })
    expect(report.reviewQueue).toHaveLength(0)
    expect(
      report.variants.every((variant) => variant.comparisonStatus === "separated_by_rule"),
    ).toBe(true)
  })

  it("normalizes produce families, juice processing, and 미백찰 spacing aliases", () => {
    const juice = normalizeAtomicSku(
      sku("dailyfood", "수제수박쥬스(땡모반)//수박100%착즙", "1L", 5000),
    )
    const peach = normalizeAtomicSku(sku("a", "천반도", "2kg", 9000))
    const spacedCorn = normalizeAtomicSku(sku("b", "미백 찰 옥수수", "10개입", 8200))
    expect(juice).toMatchObject({ productFamily: "수박", processing: "착즙" })
    expect(peach.productFamily).toBe("복숭아")
    expect(spacedCorn.variety).toBe("미백찰")
  })

  it("keeps the 미백찰 product pair as one unresolved review after alias normalization", () => {
    const daily = normalizeAtomicSku({
      ...sku("dailyfood", "(가성비)미백찰 옥수수", "5개입", 5000),
      sourceProductId: "10002676",
    })
    const walldo = normalizeAtomicSku({
      ...sku("walldob2b", "미백 찰 옥수수", "5개입", 6000),
      sourceProductId: "JW000039",
    })
    const report = compareNormalizedOffers({
      offers: [daily, walldo],
      productPairRules: FIVE_ITEM_DRY_RUN_PRODUCT_PAIR_RULES,
    })
    expect(daily.variety).toBe(walldo.variety)
    expect(report.reviewQueue).toHaveLength(1)
    expect(report.reviewQueue[0]?.conflictReason).toContain("size_specification")
    expect(report.variants[0]?.comparisonStatus).toBe("review_blocked")
  })

  it("separates explicit peach product types while keeping 딱딱이 sizes as variants", () => {
    const flat = normalizeAtomicSku(sku("a", "천반도(납작복숭아)", "2kg", 9000))
    const mango = normalizeAtomicSku(sku("b", "망고복숭아", "2kg", 9100))
    const hard = normalizeAtomicSku(sku("c", "딱딱이 복숭아", "2kg", 9200))
    const hardSmall = normalizeAtomicSku(sku("c", "딱딱이 복숭아 소과(꼬마)", "2kg", 8200))
    expect(flat).toMatchObject({
      productType: "천반도",
      peachSkinType: "nectarine",
    })
    expect(hard).toMatchObject({
      productType: "딱딱이복숭아",
      peachSkinType: "fuzzy",
    })
    expect(flat.canonicalProductKey).not.toBe(mango.canonicalProductKey)
    expect(mango.canonicalProductKey).not.toBe(hard.canonicalProductKey)
    expect(hard.canonicalProductKey).toBe(hardSmall.canonicalProductKey)
    expect(hard.canonicalVariantKey).not.toBe(hardSmall.canonicalVariantKey)
    expect(buildCrossSupplierProductCandidates([flat, mango], [])[0]?.decision).toBe(
      "separate_product",
    )
  })

  it("keeps matching 망고복숭아 product types as same-variant candidates", () => {
    const daily = normalizeAtomicSku(sku("dailyfood", "망고복숭아", "2kg", 9000))
    const walldo = normalizeAtomicSku(sku("walldob2b", "망고복숭아 (천도복숭아 품종)", "2kg", 9500))
    const candidate = buildCrossSupplierProductCandidates([daily, walldo], [])[0]
    expect(daily.productType).toBe("망고복숭아")
    expect(walldo.productType).toBe("망고복숭아")
    expect(candidate?.decision).toBe("same_variant")
  })

  it("treats parenthetical lineage as classification and separates different peach specs", () => {
    const daily = normalizeAtomicSku(
      sku("dailyfood", "망고복숭아", "소과 1kg (10-12과)", 6500),
    )
    const walldo = normalizeAtomicSku(
      sku(
        "walldob2b",
        "망고복숭아 (천도복숭아 품종)",
        "중소과 1kg (8과수내외)",
        8000,
      ),
    )
    const anotherNectarine = normalizeAtomicSku(
      sku("supplier_c", "신비복숭아 (천도복숭아 계열)", "소과 1kg", 9000),
    )
    const report = compareNormalizedOffers({ offers: [daily, walldo] })
    expect(daily).toMatchObject({
      productFamily: "복숭아",
      productType: "망고복숭아",
      peachSkinType: "nectarine",
    })
    expect(walldo).toMatchObject({
      productFamily: "복숭아",
      productType: "망고복숭아",
      peachSkinType: "nectarine",
    })
    expect(anotherNectarine).toMatchObject({
      productType: "신비복숭아",
      peachSkinType: "nectarine",
    })
    expect(daily.canonicalProductKey).toBe(walldo.canonicalProductKey)
    expect(daily.canonicalVariantKey).not.toBe(walldo.canonicalVariantKey)
    expect(buildCrossSupplierProductCandidates([daily, walldo], [])[0]?.decision).toBe(
      "separate_variant",
    )
    expect(report.reviewQueue).toHaveLength(0)
  })

  it("does not discard meaningful attributes inside parentheses", () => {
    const offer = normalizeAtomicSku(
      sku(
        "supplier_c",
        "망고복숭아 (특품 국내산 실중량 2kg 착즙)",
        "소과 10과",
        12000,
      ),
    )
    expect(offer).toMatchObject({
      qualityGrade: "특품",
      origin: "국내산",
      processing: "착즙",
      weight: 2,
      weightBasis: "net",
      count: 10,
    })
  })

  it("inherits common specs with option, group, description, title priority", () => {
    const daily = normalizeAtomicSku({
      ...sku("dailyfood", "(가성비)미백찰 옥수수", "5개입", 5000),
      sourceProductId: "10002676",
      detailDescription: "8~14센치 사이 중품",
    })
    const walldo = normalizeAtomicSku({
      ...sku("walldob2b", "미백 찰 옥수수", "5개입", 6000),
      sourceProductId: "JW000039",
      optionGroupTitle: "찰옥수수(15cm이상)",
      detailDescription: "8~14센치",
    })
    const optionOverride = normalizeAtomicSku({
      ...sku("supplier_c", "미백찰 옥수수", "20cm이상 5개입", 7000),
      optionGroupTitle: "찰옥수수(15cm이상)",
      detailDescription: "8~14센치",
    })
    expect(daily).toMatchObject({
      sizeMin: 8,
      sizeMax: 14,
      sizeUnit: "cm",
      qualityGrade: "중품",
    })
    expect(daily.provenance["sizeMin"]?.sourceField).toBe("description")
    expect(walldo).toMatchObject({ sizeMin: 15, sizeMax: null, sizeUnit: "cm" })
    expect(walldo.provenance["sizeMin"]?.sourceField).toBe("structured_html")
    expect(optionOverride.sizeMin).toBe(20)
    expect(optionOverride.provenance["sizeMin"]?.sourceField).toBe("option")
    expect(optionOverride.provenanceCandidates["sizeMin"]).toHaveLength(4)
    const report = compareNormalizedOffers({
      offers: [daily, walldo],
      productPairRules: FIVE_ITEM_DRY_RUN_PRODUCT_PAIR_RULES,
    })
    expect(report.reviewQueue).toHaveLength(0)
    expect(
      report.variants.every((variant) => variant.comparisonStatus === "separated_by_rule"),
    ).toBe(true)
  })

  it("separates explicit 피자두 from unspecified 노지 자두 and preserves cultivation", () => {
    const pizza = normalizeAtomicSku(sku("dailyfood", "피자두", "중과 1kg", 8000))
    const field = normalizeAtomicSku(sku("walldob2b", "노지 자두", "중과 1kg", 7000))
    const fieldPizza = normalizeAtomicSku(sku("supplier_c", "노지 피자두", "중과 1kg", 7500))
    expect(pizza).toMatchObject({ productFamily: "자두", variety: "피자두" })
    expect(field).toMatchObject({
      productFamily: "자두",
      variety: null,
      cultivationMethod: "노지",
    })
    expect(fieldPizza).toMatchObject({ variety: "피자두", cultivationMethod: "노지" })
    const candidate = buildCrossSupplierProductCandidates([pizza, field], [])[0]
    expect(candidate?.decision).toBe("separate_product")
    expect(compareNormalizedOffers({ offers: [pizza, field] }).reviewQueue).toHaveLength(0)
  })

  it("marks a higher-count lower-price option as price_anomaly without deleting it", async () => {
    const adapter: SupplierAtomicAdapter = {
      supplierId: "supplier_anomaly",
      async listProducts() {
        return [
          {
            supplierId: this.supplierId,
            sourceProductId: "corn",
            originalTitle: "미백찰 옥수수",
            detailUrl: "https://example.com/corn",
            listingStartPrice: 4000,
          },
        ]
      },
      async fetchProductDetail(reference) {
        return {
          ...reference,
          detailDescription: "15cm이상",
          imageUrl: null,
          shippingFee: 0,
          options: [
            {
              sourceOptionId: "5",
              originalOptionName: "5개입",
              actualPrice: 5000,
              soldOut: false,
              structuredAttributes: {},
            },
            {
              sourceOptionId: "10",
              originalOptionName: "10개입",
              actualPrice: 4000,
              soldOut: false,
              structuredAttributes: {},
            },
          ],
          verifiedAt: "2026-07-18T00:00:00.000Z",
        }
      },
    }
    const offers = (
      await collectAtomicSkus({ adapters: [adapter], includeProduct: () => true })
    ).map(normalizeAtomicSku)
    expect(offers).toHaveLength(2)
    expect(offers.find((offer) => offer.count === 10)?.priceAnomaly).toBe(true)
  })

  it("ranks all suppliers in one canonical variant by final cost", () => {
    const offers = [
      normalizeAtomicSku(sku("supplier_c", "레드루비자몽", "100-110mm 5개", 9700)),
      normalizeAtomicSku(sku("supplier_d", "레드루비자몽", "100-110mm 5개", 9100)),
      normalizeAtomicSku(sku("supplier_e", "레드루비자몽", "100-110mm 5개", 9400)),
    ]
    const variant = compareNormalizedOffers({ offers }).variants[0]
    expect(variant?.rankedOfferAtomicSkuIds).toEqual([
      offers[1]?.atomicSkuId,
      offers[2]?.atomicSkuId,
      offers[0]?.atomicSkuId,
    ])
    expect(variant?.selectionType).toBe("comparison_winner")
    expect(variant?.activeSupplierCount).toBe(3)
    expect(variant?.activeOfferCount).toBe(3)
    expect(variant?.isActuallyCompared).toBe(true)
    expect(variant?.comparisonStatus).toBe("multi_supplier_compared")
    expect(variant?.backupAtomicSkuIds).toHaveLength(2)
  })

  it("separates cross-supplier backups from supplier alternates", () => {
    const offers = [
      normalizeAtomicSku(sku("supplier_a", "레드루비자몽", "실중량 5kg", 9000)),
      normalizeAtomicSku({
        ...sku("supplier_a", "레드루비자몽", "실중량 5kg", 9300),
        atomicSkuId: "supplier_a:alternate",
        sourceOptionId: "supplier_a:alternate",
      }),
      normalizeAtomicSku(sku("supplier_b", "레드루비자몽", "실중량 5kg", 9500)),
      normalizeAtomicSku({
        ...sku("supplier_b", "레드루비자몽", "실중량 5kg", 9700),
        atomicSkuId: "supplier_b:alternate",
        sourceOptionId: "supplier_b:alternate",
      }),
    ]
    const variant = compareNormalizedOffers({ offers }).variants[0]
    expect(variant?.crossSupplierBackupCount).toBe(1)
    expect(variant?.supplierAlternateOfferCount).toBe(2)
    expect(variant?.crossSupplierBackupAtomicSkuIds).toEqual([offers[2]?.atomicSkuId])
  })

  it("labels a single active supplier as single_source_offer, not a comparison winner", () => {
    const offer = normalizeAtomicSku(sku("only_supplier", "레드루비자몽", "5kg", 9700))
    const variant = compareNormalizedOffers({ offers: [offer] }).variants[0]
    expect(variant?.selectionType).toBe("single_source_offer")
    expect(variant?.comparisonWinnerAtomicSkuId).toBeNull()
    expect(variant?.singleSourceOfferAtomicSkuId).toBe(offer.atomicSkuId)
    expect(variant?.comparisonStatus).toBe("single_source")
    expect(variant?.winnerReason).toBe("only_active_supplier_not_a_price_comparison")
  })

  it("retains but excludes duplicate promotions, sold out, and zero prices", () => {
    const offers = [
      normalizeAtomicSku(sku("a", "특품 흑찰옥수수", "20개", 18000)),
      normalizeAtomicSku(sku("b", "[행사] 특품 흑찰옥수수", "20개", 15000)),
      normalizeAtomicSku(sku("c", "특품 흑찰옥수수", "20개", 0)),
      normalizeAtomicSku({
        ...sku("d", "특품 흑찰옥수수", "20개", 14000),
        stockStatus: "out_of_stock",
      }),
    ]
    const variant = compareNormalizedOffers({ offers }).variants[0]
    expect(offers.map((offer) => offer.status)).toEqual([
      "active",
      "promotion",
      "zero_price_invalid",
      "sold_out",
    ])
    expect(variant?.singleSourceOfferAtomicSkuId).toBe(offers[0]?.atomicSkuId)
    expect(variant?.excludedAtomicSkuIds).not.toContain(offers[1]?.atomicSkuId)
    expect(variant?.backupAtomicSkuIds).toContain(offers[3]?.atomicSkuId)
    const report = compareNormalizedOffers({ offers })
    expect(report.summary.promotionCount).toBe(1)
    expect(report.reviewQueue).toHaveLength(0)
  })

  it("sends an unknown item without a core spec to missing_spec", () => {
    const offer = normalizeAtomicSku(sku("a", "알 수 없는 신규 품목", "기본", 5000))
    const report = compareNormalizedOffers({ offers: [offer] })
    expect(offer.status).toBe("review_needed")
    expect(report.reviewQueue[0]?.aiSuggestion).toBe("missing_spec")
  })

  it("stores prior decisions and the corn review as product-pair dry-run rules", () => {
    expect(FIVE_ITEM_DRY_RUN_PRODUCT_PAIR_RULES).toHaveLength(9)
    expect(
      new Set(
        FIVE_ITEM_DRY_RUN_PRODUCT_PAIR_RULES.map(
          (rule) =>
            `${rule.left.supplierId}|${rule.left.sourceProductId}|${rule.right.supplierId}|${rule.right.sourceProductId}|${rule.productFamily}`,
        ),
      ).size,
    ).toBe(9)
    expect(
      FIVE_ITEM_DRY_RUN_PRODUCT_PAIR_RULES.filter((rule) => rule.decision === "separate_variant"),
    ).toHaveLength(8)
    expect(
      FIVE_ITEM_DRY_RUN_PRODUCT_PAIR_RULES.filter((rule) => rule.decision === "review_needed"),
    ).toHaveLength(1)
  })
})

function sku(supplierId: string, title: string, option: string, price: number): AtomicSupplierSku {
  return {
    atomicSkuId: `${supplierId}:${option}`,
    supplierId,
    sourceProductId: `${supplierId}:product`,
    sourceOptionId: `${supplierId}:option`,
    originalProductTitle: title,
    originalOptionName: option,
    productUrl: `https://example.com/${supplierId}`,
    detailDescription: "상세 설명",
    imageUrl: "https://example.com/image.jpg",
    listingStartPrice: price,
    supplierPrice: price,
    shippingFee: 0,
    stockStatus: "in_stock",
    collectedAt: "2026-07-17T00:00:00.000Z",
    detailVerifiedAt: "2026-07-17T00:00:00.000Z",
  }
}

function fakeAdapter(supplierId: string, optionName: string, price: number): SupplierAtomicAdapter {
  const reference: SupplierProductReference = {
    supplierId,
    sourceProductId: "p1",
    originalTitle: "레드루비자몽",
    detailUrl: "https://example.com/p1",
    listingStartPrice: price,
  }
  const detail: SupplierProductDetail = {
    supplierId,
    sourceProductId: "p1",
    originalTitle: reference.originalTitle,
    detailUrl: reference.detailUrl,
    listingStartPrice: reference.listingStartPrice,
    detailDescription: null,
    imageUrl: null,
    shippingFee: 0,
    options: [
      {
        sourceOptionId: "o1",
        originalOptionName: optionName,
        actualPrice: price,
        soldOut: false,
        structuredAttributes: {},
      },
    ],
    verifiedAt: "2026-07-17T00:00:00.000Z",
  }
  return {
    supplierId,
    listProducts: async (): Promise<readonly SupplierProductReference[]> => [reference],
    fetchProductDetail: async (): Promise<SupplierProductDetail> => detail,
  }
}
