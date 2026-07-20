import type {
  AtomicOfferStatus,
  AtomicSupplierSku,
  AttributeProvenance,
  CategoryProfile,
  NormalizedOffer,
  ProvenanceSourceField,
} from "./types.js"

const MARKETING_TERMS = [
  "새콤달콤",
  "고당도",
  "초특가",
  "특가",
  "국내최저가",
  "국내 최저가",
  "시즌오픈",
  "시즌시작",
  "첫출고",
  "첫 출고",
  "프리미엄",
  "노마진",
] as const

type Extracted<T extends string | number | boolean | null> = {
  readonly value: T
  readonly provenance: AttributeProvenance
}

type AttributeSource = {
  readonly sourceField: ProvenanceSourceField
  readonly rawValue: string
}

type PrioritizedExtracted<T extends string | number | null> = Extracted<T> & {
  readonly candidates: readonly AttributeProvenance[]
  readonly conflicts: readonly string[]
}

export function normalizeAtomicSku(sku: AtomicSupplierSku): NormalizedOffer {
  const combined = `${sku.originalProductTitle} ${sku.originalOptionName}`
  const cleaned = removeMarketing(combined)
  const sources = attributeSources(sku)
  const family = prioritizedText(
    sources,
    (value) => extractProductFamily(removeMarketing(value).value),
    "family_dictionary",
    (value) => value === "unknown",
  )
  const variety = prioritizedText(
    sources,
    (value) =>
      extractVariety(
        normalizeClassificationText(removeMarketing(value).value, family.value),
      ),
    "variety_dictionary",
  )
  const productType = prioritizedText(
    sources,
    (value) =>
      family.value === "복숭아"
        ? extractVariety(normalizeClassificationText(value, family.value))
        : null,
    "peach_product_type_dictionary",
  )
  const peachSkinType = prioritizedText(
    sources,
    (value) =>
      extractPeachSkinType(
        family.value,
        normalizeClassificationText(value, family.value),
      ),
    "peach_skin_type_dictionary",
    (value) => value === "unknown",
  )
  const cultivationMethod = prioritizedText(
    sources,
    extractCultivationMethod,
    "cultivation_method_dictionary",
  )
  const processing = prioritizedText(sources, extractProcessing, "processing_dictionary")
  const quality = prioritizedText(sources, extractQualityGrade, "quality_grade_dictionary")
  const usage = prioritizedText(sources, extractUsageGrade, "usage_grade_dictionary")
  const size = prioritizedSize(sources)
  const weight = prioritizedNumber(sources, extractWeight, "weight_regex_kg")
  const countValue = prioritizedCount(sources)
  const count = countValue.count
  const optionUnit = countValue.unit
  const origin = prioritizedText(sources, extractOrigin, "origin_dictionary")
  const packageType = prioritizedText(
    sources,
    (value) => extractPackageType(value, extractCount(value).unit),
    "package_type_dictionary",
  )
  const weightBasis = prioritizedText(
    sources,
    extractWeightBasis,
    "weight_basis_dictionary",
    (value) => value === "unknown",
  )
  const promotionEvidence = extractPromotionEvidence(sku)
  const promotion = booleanExtract(
    promotionEvidence.matched,
    promotionEvidence.sourceField,
    promotionEvidence.rawValue,
    "promotion_evidence",
  )
  const preorder = booleanExtract(
    /예약|출고\s*예정|[0-9]{1,2}\s*월\s*[0-9]{1,2}\s*일\s*출고/u.test(combined),
    "title",
    combined,
    "preorder_evidence",
  )
  const soldOut = booleanExtract(
    sku.stockStatus === "out_of_stock",
    "structured_html",
    sku.stockStatus,
    "supplier_stock_state",
  )
  const shipping = numberExtract(
    sku.shippingFee,
    "structured_html",
    String(sku.shippingFee),
    "supplier_shipping_fee",
  )
  const finalCost = sku.supplierPrice + sku.shippingFee
  const finalCostProvenance = provenance(
    "derived",
    `${sku.supplierPrice}+${sku.shippingFee}`,
    finalCost,
    "supplier_price_plus_shipping",
    1,
    "상세 옵션가격과 배송비의 합계",
  )
  const priceAnomaly = booleanExtract(
    sku.priceAnomaly ?? false,
    "derived",
    String(sku.priceAnomaly ?? false),
    "higher_count_lower_price_check",
  )
  const specConflicts = [
    ...family.conflicts.map((reason) => `productFamily:${reason}`),
    ...variety.conflicts.map((reason) => `variety:${reason}`),
    ...processing.conflicts.map((reason) => `processing:${reason}`),
    ...quality.conflicts.map((reason) => `qualityGrade:${reason}`),
    ...usage.conflicts.map((reason) => `usageGrade:${reason}`),
    ...size.conflicts.map((reason) => `size:${reason}`),
    ...weight.conflicts.map((reason) => `weight:${reason}`),
    ...countValue.conflicts.map((reason) => `count:${reason}`),
  ]
  const hasVariantSpec =
    size.label.value !== null ||
    size.min.value !== null ||
    weight.value !== null ||
    count.value !== null
  const status = statusOf({
    supplierPrice: sku.supplierPrice,
    soldOutFlag: soldOut.value,
    promotionFlag: promotion.value,
    preorderFlag: preorder.value,
    productFamily: family.value,
    hasVariantSpec,
  })
  const canonicalProductKey = [
    family.value,
    variety.value ?? "variety_unspecified",
    processing.value ?? "fresh",
  ].join("|")
  const variantParts = [
    `quality:${quality.value ?? "quality_standard"}`,
    `usage:${usage.value ?? "usage_standard"}`,
    size.label.value,
    size.min.value === null
      ? null
      : `${numberText(size.min.value)}-${numberText(size.max.value ?? size.min.value)}${size.unit.value ?? ""}`,
    weight.value === null ? null : `${numberText(weight.value)}kg:${weightBasis.value}`,
    count.value === null ? null : `${numberText(count.value)}${optionUnit.value ?? "개"}`,
  ].filter((value): value is string => value !== null && value.length > 0)
  const canonicalVariantKey =
    !hasVariantSpec || variantParts.length === 0
      ? null
      : `${canonicalProductKey}|${variantParts.join("|")}`
  const confidence = confidenceOf({
    productFamily: family.value,
    canonicalVariantKey,
    qualityGrade: quality.value,
    usageGrade: usage.value,
    sizeLabel: size.label.value,
    sizeMin: size.min.value,
  })
  const confidenceReason = [
    family.value === "unknown" ? "품목 미식별" : "품목 식별",
    canonicalVariantKey === null ? "핵심 규격 누락" : "variant 규격 존재",
    size.label.value !== null && size.min.value === null ? "비수치 크기명" : "크기 모호성 없음",
  ].join("; ")
  const categoryProfile = buildCategoryProfile(family.value, cleaned.value, {
    count: count.value,
    peachSkinType: peachSkinType.value,
    productType: productType.value,
    sizeLabel: size.label.value,
    usageGrade: usage.value,
    variety: variety.value,
  })

  return {
    ...sku,
    productFamily: family.value,
    variety: variety.value,
    productType: productType.value,
    peachSkinType: peachSkinType.value,
    cultivationMethod: cultivationMethod.value,
    processing: processing.value,
    qualityGrade: quality.value,
    usageGrade: usage.value,
    sizeLabel: size.label.value,
    sizeMin: size.min.value,
    sizeMax: size.max.value,
    sizeUnit: size.unit.value,
    weight: weight.value,
    count: count.value,
    optionUnit: optionUnit.value,
    origin: origin.value,
    packaging: packageType.value,
    weightBasis: weightBasis.value,
    packageType: packageType.value,
    promotionFlag: promotion.value,
    preorderFlag: preorder.value,
    soldOutFlag: soldOut.value,
    finalCost,
    priceAnomaly: priceAnomaly.value,
    confidence,
    confidenceReason,
    provenance: {
      productFamily: family.provenance,
      variety: variety.provenance,
      productType: productType.provenance,
      peachSkinType: peachSkinType.provenance,
      cultivationMethod: cultivationMethod.provenance,
      processing: processing.provenance,
      qualityGrade: quality.provenance,
      usageGrade: usage.provenance,
      sizeLabel: size.label.provenance,
      sizeMin: size.min.provenance,
      sizeMax: size.max.provenance,
      sizeUnit: size.unit.provenance,
      weight: weight.provenance,
      count: count.provenance,
      optionUnit: optionUnit.provenance,
      origin: origin.provenance,
      packaging: packageType.provenance,
      weightBasis: weightBasis.provenance,
      packageType: packageType.provenance,
      promotionFlag: promotion.provenance,
      preorderFlag: preorder.provenance,
      soldOutFlag: soldOut.provenance,
      shippingFee: shipping.provenance,
      finalCost: finalCostProvenance,
      priceAnomaly: priceAnomaly.provenance,
    },
    provenanceCandidates: {
      productFamily: family.candidates,
      variety: variety.candidates,
      productType: productType.candidates,
      peachSkinType: peachSkinType.candidates,
      cultivationMethod: cultivationMethod.candidates,
      processing: processing.candidates,
      qualityGrade: quality.candidates,
      usageGrade: usage.candidates,
      sizeLabel: size.labelCandidates,
      sizeMin: size.minCandidates,
      sizeMax: size.maxCandidates,
      sizeUnit: size.unitCandidates,
      weight: weight.candidates,
      count: countValue.count.candidates,
      optionUnit: countValue.unit.candidates,
      origin: origin.candidates,
      packaging: packageType.candidates,
      weightBasis: weightBasis.candidates,
      packageType: packageType.candidates,
      priceAnomaly: [priceAnomaly.provenance],
    },
    specConflicts,
    categoryProfile,
    removedMarketingTerms: cleaned.removed,
    status,
    statusReasons: reasonsOf(status),
    canonicalProductKey,
    canonicalVariantKey,
  }
}

function attributeSources(sku: AtomicSupplierSku): readonly AttributeSource[] {
  const sources: readonly AttributeSource[] = [
    { sourceField: "option", rawValue: sku.originalOptionName },
    { sourceField: "structured_html", rawValue: sku.optionGroupTitle ?? "" },
    { sourceField: "description", rawValue: sku.detailDescription ?? "" },
    { sourceField: "title", rawValue: sku.originalProductTitle },
  ]
  return sources.filter((source) => source.rawValue.trim().length > 0)
}

function prioritizedText<T extends string | null>(
  sources: readonly AttributeSource[],
  extractor: (value: string) => T,
  method: string,
  isMissing: (value: T) => boolean = (value) => value === null,
): PrioritizedExtracted<T> {
  const extracted = sources.map((source) => {
    const value = extractor(source.rawValue)
    return {
      value,
      provenance: provenance(
        source.sourceField,
        source.rawValue,
        value,
        method,
        isMissing(value) ? 0.35 : 0.9,
        isMissing(value) ? `${method} 값 없음` : `${method}로 추출`,
      ),
    }
  })
  const selected = extracted.find((item) => !isMissing(item.value)) ?? extracted.at(-1)
  if (selected === undefined) {
    throw new Error(`attribute source missing for ${method}`)
  }
  const values = [
    ...new Set(
      extracted.filter((item) => !isMissing(item.value)).map((item) => String(item.value)),
    ),
  ]
  return {
    ...selected,
    candidates: extracted.map((item) => item.provenance),
    conflicts: values.length > 1 ? [`source_values=${values.join("|")}`] : [],
  }
}

function prioritizedNumber(
  sources: readonly AttributeSource[],
  extractor: (value: string) => number | null,
  method: string,
): PrioritizedExtracted<number | null> {
  const extracted = sources.map((source) => {
    const value = extractor(source.rawValue)
    return {
      value,
      provenance: provenance(
        source.sourceField,
        source.rawValue,
        value,
        method,
        value === null ? 0.35 : 0.95,
        value === null ? `${method} 값 없음` : `${method}로 추출`,
      ),
    }
  })
  const selected = extracted.find((item) => item.value !== null) ?? extracted.at(-1)
  if (selected === undefined) throw new Error(`attribute source missing for ${method}`)
  const values = [
    ...new Set(extracted.flatMap((item) => (item.value === null ? [] : [item.value]))),
  ]
  return {
    ...selected,
    candidates: extracted.map((item) => item.provenance),
    conflicts: values.length > 1 ? [`source_values=${values.join("|")}`] : [],
  }
}

function prioritizedCount(sources: readonly AttributeSource[]): {
  readonly count: PrioritizedExtracted<number | null>
  readonly unit: PrioritizedExtracted<string | null>
  readonly conflicts: readonly string[]
} {
  const count = prioritizedNumber(sources, (value) => extractCount(value).value, "count_regex")
  const unit = prioritizedText(sources, (value) => extractCount(value).unit, "count_unit_regex")
  return {
    count,
    unit,
    conflicts: [...count.conflicts, ...unit.conflicts],
  }
}

function prioritizedSize(sources: readonly AttributeSource[]): {
  readonly label: Extracted<string | null>
  readonly min: Extracted<number | null>
  readonly max: Extracted<number | null>
  readonly unit: Extracted<string | null>
  readonly labelCandidates: readonly AttributeProvenance[]
  readonly minCandidates: readonly AttributeProvenance[]
  readonly maxCandidates: readonly AttributeProvenance[]
  readonly unitCandidates: readonly AttributeProvenance[]
  readonly conflicts: readonly string[]
} {
  const extracted = sources.map((source) => extractSize(source.rawValue, source.sourceField))
  const choose = <T extends string | number>(
    values: readonly Extracted<T | null>[],
  ): Extracted<T | null> => {
    const selected = values.find((item) => item.value !== null) ?? values.at(-1)
    if (selected === undefined) throw new Error("size attribute source missing")
    return selected
  }
  const numeric = extracted.find((item) => item.min.value !== null) ?? extracted.at(-1)
  if (numeric === undefined) throw new Error("numeric size attribute source missing")
  const conflicts = (
    field: string,
    values: readonly Extracted<string | number | null>[],
  ): readonly string[] => {
    const distinct = [
      ...new Set(values.flatMap((item) => (item.value === null ? [] : [String(item.value)]))),
    ]
    return distinct.length > 1 ? [`${field}_source_values=${distinct.join("|")}`] : []
  }
  return {
    label: choose(extracted.map((item) => item.label)),
    min: numeric.min,
    max: numeric.max,
    unit: numeric.unit,
    labelCandidates: extracted.map((item) => item.label.provenance),
    minCandidates: extracted.map((item) => item.min.provenance),
    maxCandidates: extracted.map((item) => item.max.provenance),
    unitCandidates: extracted.map((item) => item.unit.provenance),
    conflicts: [
      ...conflicts(
        "label",
        extracted.map((item) => item.label),
      ),
      ...conflicts(
        "min",
        extracted.map((item) => item.min),
      ),
      ...conflicts(
        "max",
        extracted.map((item) => item.max),
      ),
      ...conflicts(
        "unit",
        extracted.map((item) => item.unit),
      ),
    ],
  }
}

function removeMarketing(value: string): {
  readonly value: string
  readonly removed: readonly string[]
} {
  let cleaned = value.replace(/[\p{Extended_Pictographic}✨⭐♥♡◆■●▶✓✔🔥]+/gu, " ")
  const removed: string[] = []
  for (const term of MARKETING_TERMS) {
    if (!cleaned.includes(term)) continue
    removed.push(term)
    cleaned = cleaned.split(term).join(" ")
  }
  return { value: whitespace(cleaned), removed }
}

function normalizeClassificationText(value: string, productFamily: string): string {
  return whitespace(
    value.replace(/\(([^()]*)\)/gu, (parenthetical, content: string, offset: number) => {
      const base = value.slice(0, offset)
      return isExplanatoryClassification(base, content, productFamily)
        ? " "
        : parenthetical
    }),
  )
}

function isExplanatoryClassification(
  base: string,
  content: string,
  productFamily: string,
): boolean {
  if (!/(?:품종|계열|종류|타입)\s*$/u.test(content)) return false
  if (extractVariety(base) === null) return false
  if (hasProtectedParentheticalAttribute(content)) return false
  const innerFamily = extractProductFamily(content)
  if (innerFamily !== "unknown" && innerFamily !== productFamily) return false
  return isCategoryProfileClassifier(productFamily, content)
}

function hasProtectedParentheticalAttribute(value: string): boolean {
  const size = extractSize(value)
  return (
    extractVariety(value) !== null ||
    extractQualityGrade(value) !== null ||
    extractUsageGrade(value) !== null ||
    extractProcessing(value) !== null ||
    extractOrigin(value) !== null ||
    extractWeight(value) !== null ||
    extractCount(value).value !== null ||
    size.label.value !== null ||
    size.min.value !== null
  )
}

function isCategoryProfileClassifier(productFamily: string, value: string): boolean {
  if (productFamily === "복숭아") {
    return /(?:천도|털)\s*복숭아\s*(?:품종|계열|종류|타입)\s*$/u.test(value)
  }
  return false
}

function extractProductFamily(value: string): string {
  const compact = value.replace(/\s/gu, "")
  if (/레드루비|자몽/u.test(compact)) return "자몽"
  if (/옥수수/u.test(compact)) return "옥수수"
  if (/참외/u.test(compact)) return "참외"
  if (/사과/u.test(compact)) return "사과"
  if (/감자/u.test(compact)) return "감자"
  if (/당근/u.test(compact)) return "당근"
  if (/애플수박|흑수박|씨들리스수박|참박수박|수박/u.test(compact)) return "수박"
  if (
    /천도복숭아|망고복숭아|신비복숭아|대극천복숭아|복숭아|백도|황도|천반도|거반도/u.test(compact)
  ) {
    return "복숭아"
  }
  if (/피자두|대석자두|자두/u.test(compact)) return "자두"
  if (/감귤|하우스귤|귤/u.test(compact)) return "감귤"
  if (/방울토마토/u.test(compact)) return "방울토마토"
  if (/토마토/u.test(compact)) return "토마토"
  if (/샤인머스켓|거봉|캠벨포도|포도/u.test(compact)) return "포도"
  if (/머스크메론|세지메론|백자멜론|파파야메론|멜론|메론/u.test(compact)) return "멜론"
  if (/키위/u.test(compact)) return "키위"
  if (/아보카도/u.test(compact)) return "아보카도"
  if (/망고스틴/u.test(compact)) return "망고스틴"
  if (/망고/u.test(compact)) return "망고"
  if (/용과/u.test(compact)) return "용과"
  if (/체리/u.test(compact)) return "체리"
  if (/살구/u.test(compact)) return "살구"
  if (/호박/u.test(compact)) return "호박"
  if (/고구마/u.test(compact)) return "고구마"
  if (/양파/u.test(compact)) return "양파"
  if (/오이/u.test(compact)) return "오이"
  if (/마늘/u.test(compact)) return "마늘"
  if (/양배추/u.test(compact)) return "양배추"
  if (/배추/u.test(compact)) return "배추"
  if (/깻잎/u.test(compact)) return "깻잎"
  if (/강낭콩|호랑이콩|콩물|콩/u.test(compact)) return "콩"
  if (/마카다미아/u.test(compact)) return "마카다미아"
  if (/석가/u.test(compact)) return "석가"
  return "unknown"
}

function extractVariety(value: string): string | null {
  const aliases = [
    [/(미백\s*찰)/u, "미백찰"],
    [/(레드\s*루비)/u, "레드루비"],
    [
      /(애플수박|흑수박|씨들리스수박|참박수박|딱딱이\s*복숭아|망고복숭아|신비복숭아|대극천복숭아|백도|황도|천반도|거반도|피자두|대석자두|샤인머스켓|거봉|캠벨포도|머스크메론|세지메론|백자멜론|파파야메론)/u,
      null,
    ],
    [/(흑찰|성주|부사|수미|두백|초당|찰옥수수|홍로|아오리)/u, null],
  ] as const
  for (const [pattern, normalized] of aliases) {
    const match = pattern.exec(value)?.[1]
    if (match !== undefined) {
      const compact = match.replace(/\s/gu, "")
      return normalized ?? (compact === "딱딱이복숭아" ? "딱딱이복숭아" : compact)
    }
  }
  return null
}

function extractPeachSkinType(
  productFamily: string,
  value: string,
): "nectarine" | "fuzzy" | "unknown" {
  if (productFamily !== "복숭아") return "unknown"
  if (/천도|천반도|망고복숭아|신비복숭아/u.test(value)) return "nectarine"
  if (/털복숭아|거반도|딱딱이\s*복숭아|대극천복숭아|백도|황도/u.test(value)) {
    return "fuzzy"
  }
  return "unknown"
}

function extractProcessing(value: string): string | null {
  if (/착즙|주스(?!용)|쥬스(?!용)/u.test(value)) return "착즙"
  if (/콩물|우묵가사리|김치|겉절이|절임/u.test(value)) return "가공"
  return /(세척|비세척|냉동|건조|반건조|생물)/u.exec(value)?.[1] ?? null
}

function extractCultivationMethod(value: string): "노지" | null {
  return /노지/u.test(value) ? "노지" : null
}

function extractQualityGrade(value: string): string | null {
  return /(특품|특A|A급|가정용|실속형|못난이|정품|상품|중품|상급)/u.exec(value)?.[1] ?? null
}

function extractUsageGrade(value: string): string | null {
  return /(주스용|쥬스용|조림용|혼합과|랜덤과)/u.exec(value)?.[1] ?? null
}

function extractSize(
  value: string,
  sourceField: ProvenanceSourceField = "option",
): {
  readonly label: Extracted<string | null>
  readonly min: Extracted<number | null>
  readonly max: Extracted<number | null>
  readonly unit: Extracted<string | null>
} {
  const range = /(\d+(?:\.\d+)?)\s*(?:~|-)\s*(\d+(?:\.\d+)?)\s*(R|cm|센티|센치|mm|g)/iu.exec(value)
  const minimum = /(\d+(?:\.\d+)?)\s*(R|cm|센티|센치|mm|g)\s*(?:이상|\+)/iu.exec(value)
  const label =
    /(?:^|[\s(/])((?:초소과|소과|중소과|중과|중대과|대과|특대과|로얄과|특대|소|중|대))(?=$|[\s\d()/])/u.exec(
      value,
    )?.[1] ?? null
  const min =
    range?.[1] !== undefined
      ? Number(range[1])
      : minimum?.[1] === undefined
        ? null
        : Number(minimum[1])
  const max = range?.[2] === undefined ? null : Number(range[2])
  const unit = normalizeSizeUnit(range?.[3] ?? minimum?.[2] ?? null)
  const method = range === null ? "size_minimum_regex" : "size_range_regex"
  return {
    label: textExtract(label, sourceField, value, "size_label_dictionary"),
    min: numberExtract(min, sourceField, value, method),
    max: numberExtract(max, sourceField, value, method),
    unit: textExtract(unit, sourceField, value, "size_unit_regex"),
  }
}

function extractWeight(value: string): number | null {
  const withoutRanges = value.replace(/\d+(?:\.\d+)?\s*(?:~|-)\s*\d+(?:\.\d+)?\s*(?:kg|g)/giu, " ")
  const match = /(\d+(?:\.\d+)?)\s*(kg|g)/iu.exec(withoutRanges)
  if (match?.[1] === undefined) return null
  const amount = Number(match[1])
  return /kg/iu.test(match[2] ?? "") ? amount : amount / 1000
}

function extractCount(value: string): {
  readonly value: number | null
  readonly unit: string | null
} {
  const withoutRanges = value.replace(/\d+\s*(?:~|-)\s*\d+\s*(?:개|과|입|망|봉)/gu, " ")
  const matches = [...withoutRanges.matchAll(/(\d+(?:\.\d+)?)\s*(개입|개|과|입|망|봉|세트|팩)/gu)]
  const match = matches.at(-1)
  if (match?.[1] === undefined) return { value: null, unit: null }
  return { value: Number(match[1]), unit: match[2] === "개입" ? "개" : (match[2] ?? null) }
}

function extractOrigin(value: string): string | null {
  const match = /(국내산|국산|미국산|중국산|수입산|제주산|성주산)/u.exec(value)
  if (match?.[1] === "국산") return "국내산"
  return match?.[1] ?? null
}

function extractPackageType(value: string, optionUnit: string | null): string | null {
  if (/박스\s*무게\s*포함|박스\s*포함|박스포함|박스/u.test(value)) return "박스"
  if (/벌크/u.test(value)) return "벌크"
  if (optionUnit === "망") return "망"
  if (optionUnit === "봉") return "봉"
  if (optionUnit === "팩") return "팩"
  return null
}

function extractWeightBasis(value: string): "net" | "gross" | "unknown" {
  if (/실\s*중량/u.test(value)) return "net"
  if (/박스\s*무게\s*포함|박스\s*포함|박스포함/u.test(value)) return "gross"
  return "unknown"
}

function extractPromotionEvidence(sku: AtomicSupplierSku): {
  readonly matched: boolean
  readonly sourceField: "title" | "option" | "description"
  readonly rawValue: string
} {
  const pattern =
    /반짝\s*행사|\[\s*행사\s*\]|기간\s*한정|오늘만|\d+\s*일까지|\d+\s*개\s*한정|예약\s*발송/u
  const sources = [
    { sourceField: "option" as const, rawValue: sku.originalOptionName },
    { sourceField: "title" as const, rawValue: sku.originalProductTitle },
    { sourceField: "description" as const, rawValue: sku.detailDescription ?? "" },
  ]
  const matched = sources.find((source) => pattern.test(source.rawValue))
  return matched === undefined
    ? { matched: false, sourceField: "title", rawValue: sku.originalProductTitle }
    : { matched: true, ...matched }
}

function statusOf(input: {
  readonly supplierPrice: number
  readonly soldOutFlag: boolean
  readonly promotionFlag: boolean
  readonly preorderFlag: boolean
  readonly productFamily: string
  readonly hasVariantSpec: boolean
}): AtomicOfferStatus {
  if (!Number.isFinite(input.supplierPrice) || input.supplierPrice <= 0) return "zero_price_invalid"
  if (input.soldOutFlag) return "sold_out"
  if (input.promotionFlag) return "promotion"
  if (input.preorderFlag) return "preorder"
  if (input.productFamily === "unknown" || !input.hasVariantSpec) return "review_needed"
  return "active"
}

function reasonsOf(status: AtomicOfferStatus): readonly string[] {
  if (status === "zero_price_invalid") return ["zero_or_unverified_option_price"]
  if (status === "sold_out") return ["sold_out_excluded_from_current_winner"]
  if (status === "promotion") return ["evidence_backed_temporary_promotion"]
  if (status === "preorder") return ["preorder_not_currently_active"]
  if (status === "review_needed") return ["missing_product_family_or_variant_spec"]
  return []
}

function confidenceOf(input: {
  readonly productFamily: string
  readonly canonicalVariantKey: string | null
  readonly qualityGrade: string | null
  readonly usageGrade: string | null
  readonly sizeLabel: string | null
  readonly sizeMin: number | null
}): number {
  let score = 0.45
  if (input.productFamily !== "unknown") score += 0.2
  if (input.canonicalVariantKey !== null) score += 0.2
  if (input.qualityGrade !== null || input.usageGrade !== null) score += 0.05
  if (input.sizeLabel === null || input.sizeMin !== null) score += 0.1
  return Math.min(1, score)
}

function buildCategoryProfile(
  productFamily: string,
  value: string,
  extracted: {
    readonly variety: string | null
    readonly productType: string | null
    readonly peachSkinType: "nectarine" | "fuzzy" | "unknown"
    readonly usageGrade: string | null
    readonly sizeLabel: string | null
    readonly count: number | null
  },
): CategoryProfile {
  if (productFamily === "감자") {
    return {
      washed: /세척/u.test(value) ? true : /비세척/u.test(value) ? false : null,
      cookingUse: /조림용/u.test(value) ? "조림용" : null,
      variety: extracted.variety,
      tuberSize: extracted.sizeLabel,
    }
  }
  if (productFamily === "당근") {
    return {
      washed: /세척/u.test(value) ? true : /비세척/u.test(value) ? false : null,
      juiceUse: /주스용|쥬스용/u.test(value),
    }
  }
  if (productFamily === "옥수수") {
    return {
      length: null,
      variety: extracted.variety,
      cornType: /초당/u.test(value) ? "초당" : /찰/u.test(value) ? "찰" : null,
      count: extracted.count,
    }
  }
  if (productFamily === "사과") {
    return {
      variety: extracted.variety,
      expectedUse: extracted.usageGrade ?? extractQualityGrade(value),
      fruitCount: extracted.count,
    }
  }
  if (productFamily === "참외") {
    return {
      expectedUse: extracted.usageGrade ?? extractQualityGrade(value),
      fruitCount: extracted.count,
      size: extracted.sizeLabel,
    }
  }
  if (productFamily === "복숭아") {
    return {
      peachSkinType: extracted.peachSkinType,
      productType: extracted.productType,
      variety: extracted.variety,
      size: extracted.sizeLabel,
    }
  }
  return {}
}

function textExtract<T extends string | null>(
  value: T,
  sourceField: ProvenanceSourceField,
  rawValue: string,
  method: string,
): Extracted<T> {
  const found = value !== null
  return {
    value,
    provenance: provenance(
      sourceField,
      rawValue,
      value,
      method,
      found ? 0.9 : 0.35,
      found ? `${method} 규칙과 일치` : `${method} 규칙에서 값을 찾지 못함`,
    ),
  }
}

function numberExtract(
  value: number | null,
  sourceField: ProvenanceSourceField,
  rawValue: string,
  method: string,
): Extracted<number | null> {
  return {
    value,
    provenance: provenance(
      sourceField,
      rawValue,
      value,
      method,
      value === null ? 0.35 : 0.95,
      value === null ? `${method} 규격 없음` : `${method}로 수치 규격 추출`,
    ),
  }
}

function booleanExtract(
  value: boolean,
  sourceField: ProvenanceSourceField,
  rawValue: string,
  method: string,
): Extracted<boolean> {
  return {
    value,
    provenance: provenance(
      sourceField,
      rawValue,
      value,
      method,
      0.95,
      value ? `${method} 증거 확인` : `${method} 증거 없음`,
    ),
  }
}

function provenance(
  sourceField: ProvenanceSourceField,
  rawValue: string,
  normalizedValue: string | number | boolean | null,
  extractionMethod: string,
  confidence: number,
  reason: string,
): AttributeProvenance {
  return { sourceField, rawValue, normalizedValue, extractionMethod, confidence, reason }
}

function normalizeSizeUnit(value: string | null): string | null {
  if (value === null) return null
  if (/cm|센티|센치/iu.test(value)) return "cm"
  return value.toLowerCase()
}

function whitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim()
}

function numberText(value: number): string {
  return String(value)
}
