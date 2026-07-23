import { mkdir, readFile, writeFile } from "node:fs/promises"
import { DailyFoodAtomicAdapter } from "../atomic-sku/adapters/dailyfood-adapter.js"
import { Walldob2bAtomicAdapter } from "../atomic-sku/adapters/walldob2b-adapter.js"
import {
  collectAtomicSkus,
  collectAtomicSkusWithDiagnostics,
  type SupplierCollectionDiagnostics,
} from "../atomic-sku/collect.js"
import {
  buildCrossSupplierProductCandidates,
  type CrossSupplierProductCandidate,
  compareNormalizedOffers,
} from "../atomic-sku/compare.js"
import { FIVE_ITEM_DRY_RUN_PRODUCT_PAIR_RULES } from "../atomic-sku/fixture-rules.js"
import { normalizeAtomicSku } from "../atomic-sku/normalize.js"
import type { SupplierProductReference } from "../atomic-sku/supplier-adapter.js"
import type { AtomicComparisonReport, NormalizedOffer } from "../atomic-sku/types.js"
import { writeAtomicSkuAnalysisReports } from "./atomic-sku-analysis-reports.js"

const TARGETS = [
  { name: "레드루비자몽", pattern: /레드\s*루비.*자몽|자몽.*레드\s*루비/u },
  { name: "흑찰옥수수", pattern: /흑찰.*옥수수|옥수수.*흑찰/u },
  { name: "미백찰옥수수", pattern: /미백\s*찰?.*옥수수|옥수수.*미백/u },
  { name: "성주참외", pattern: /성주.*참외|참외.*성주/u },
  { name: "부사사과", pattern: /부사.*사과|사과.*부사/u },
] as const

async function main(): Promise<void> {
  await loadDotEnv()
  requireCredentials()
  const allAgriculture = process.argv.includes("--all-agriculture")
  const adapters = [
    new DailyFoodAtomicAdapter({
      username: process.env["DAILYFOOD_USERNAME"] ?? process.env["WALLDOB2B_USERNAME"] ?? "",
      password: process.env["DAILYFOOD_PASSWORD"] ?? process.env["WALLDOB2B_PASSWORD"] ?? "",
      browserEndpoint: process.env["ADMINPLUS_BROWSER_ENDPOINT"] ?? "http://localhost:3000",
    }),
    new Walldob2bAtomicAdapter({
      username: process.env["WALLDOB2B_USERNAME"] ?? "",
      password: process.env["WALLDOB2B_PASSWORD"] ?? "",
    }),
  ]
  const collected = allAgriculture
    ? await collectAtomicSkusWithDiagnostics({
        adapters,
        includeProduct: isAgricultural,
      })
    : {
        atomicSkus: await collectAtomicSkus({
          adapters,
          includeProduct: isTarget,
        }),
        suppliers: [],
      }
  const atomicSkus = collected.atomicSkus
  const offers = atomicSkus.map(normalizeAtomicSku)
  const report = compareNormalizedOffers({
    offers,
    productPairRules: FIVE_ITEM_DRY_RUN_PRODUCT_PAIR_RULES,
  })
  const candidates = buildCrossSupplierProductCandidates(
    offers,
    FIVE_ITEM_DRY_RUN_PRODUCT_PAIR_RULES,
  )
  const enriched = {
    ...report,
    testItems: TARGETS.map((target) =>
      buildItemReport(target.name, target.pattern, offers, report),
    ),
  }
  if (allAgriculture) {
    console.log(
      JSON.stringify(
        buildAgricultureConsoleResult(offers, report, collected.suppliers, candidates),
        null,
        2,
      ),
    )
    return
  }
  await mkdir("reports/atomic-sku", { recursive: true })
  await writeFile(
    "reports/atomic-sku/atomic-sku-dry-run.json",
    `${JSON.stringify(enriched, null, 2)}\n`,
    "utf8",
  )
  await writeFile("reports/atomic-sku/atomic-sku-dry-run.md", renderMarkdown(enriched), "utf8")
  await writeAtomicSkuAnalysisReports({ offers, report })
  console.log(
    JSON.stringify({
      mode: report.mode,
      safety: report.safety,
      summary: report.summary,
      testItems: enriched.testItems.map((item) => ({
        item: item.item,
        supplierProducts: item.supplierProducts.length,
        atomicSkus: item.atomicSkus.length,
        reviewQuestions: item.reviewQuestions.length,
      })),
    }),
  )
}

function isTarget(reference: SupplierProductReference): boolean {
  return TARGETS.some((target) => target.pattern.test(reference.originalTitle))
}

function isAgricultural(reference: SupplierProductReference): boolean {
  if (/예치금|충전/u.test(reference.originalTitle)) return false
  return /사과|배(?!추)|자몽|오렌지|귤|감귤|레몬|포도|복숭아|자두|수박|참외|멜론|바나나|키위|망고|망고스틴|체리|블루베리|딸기|감(?!자)|석류|무화과|아보카도|토마토|옥수수|감자|고구마|당근|양파|마늘|대파|쪽파|배추|채소|상추|깻잎|오이|호박|가지|버섯|브로콜리|양배추|파프리카|고추|콩|밤|대추|쌀|잡곡|마카다미아|석가/u.test(
    reference.originalTitle,
  )
}

function buildAgricultureConsoleResult(
  offers: readonly NormalizedOffer[],
  report: AtomicComparisonReport,
  supplierDiagnostics: readonly SupplierCollectionDiagnostics[],
  candidates: readonly CrossSupplierProductCandidate[],
): Readonly<Record<string, unknown>> {
  const activeVariants = report.variants.filter((variant) => variant.activeOfferCount > 0)
  const compared = report.variants
    .filter((variant) => variant.isActuallyCompared)
    .sort(
      (left, right) =>
        right.activeSupplierCount - left.activeSupplierCount ||
        right.activeOfferCount - left.activeOfferCount ||
        left.canonicalVariantKey.localeCompare(right.canonicalVariantKey),
    )
  const offersById = new Map(offers.map((offer) => [offer.atomicSkuId, offer]))
  const variantStatusDistribution = buildVariantStatusDistribution(offers, report)
  const unknownOffers = offers.filter((offer) => offer.productFamily === "unknown")
  const productFamilies = [...new Set(offers.map((offer) => offer.productFamily))].sort()
  return {
    atomicSkuCount: report.summary.atomicSkuCount,
    canonicalProductCount: report.summary.canonicalProductCount,
    canonicalVariantCount: report.summary.canonicalVariantCount,
    comparisonWinnerCount: report.summary.comparisonWinnerCount,
    singleSourceOfferCount: report.summary.singleSourceOfferCount,
    actualComparisonCoverage:
      activeVariants.length === 0 ? 0 : compared.length / activeVariants.length,
    reviewNeededCount: report.summary.reviewNeededCount,
    promotionCount: report.summary.promotionCount,
    unknownProductCount: new Set(
      unknownOffers.map((offer) => `${offer.supplierId}|${offer.sourceProductId}`),
    ).size,
    unknownAtomicSkuCount: unknownOffers.length,
    productFamilyCount: productFamilies.length,
    productFamilies,
    inputScope: supplierDiagnostics.map((diagnostic) => {
      const supplierOffers = offers.filter((offer) => offer.supplierId === diagnostic.supplierId)
      const productFamilies = [
        ...new Set(supplierOffers.map((offer) => offer.productFamily)),
      ].sort()
      return {
        ...diagnostic,
        productFamilyCount: productFamilies.length,
        productFamilies,
      }
    }),
    commonProductFamilies: buildCommonProductFamilies(offers, candidates),
    priorityFamilyDiagnostics: buildPriorityFamilyDiagnostics(offers, candidates),
    variantStatusDistribution,
    variantStatusTotal: Object.values(variantStatusDistribution).reduce(
      (sum, count) => sum + count,
      0,
    ),
    canonicalProducts: buildCanonicalProducts(offers),
    actualReviewQuestionTitles: report.reviewQueue
      .filter((review) => new Set(review.supplierIds).size >= 2)
      .map((review) => [...new Set(review.originalTitles)]),
    topComparedVariants: compared.slice(0, 20).map((variant) => ({
      canonicalVariantKey: variant.canonicalVariantKey,
      activeSupplierCount: variant.activeSupplierCount,
      selectedOffer: compactRankedOffer(variant.selectedOfferAtomicSkuId, offersById),
      crossSupplierBackups: variant.crossSupplierBackupAtomicSkuIds.map((id) =>
        compactRankedOffer(id, offersById),
      ),
    })),
    topReviewBlockedProductPairs: report.reviewQueue
      .filter((review) => new Set(review.supplierIds).size >= 2)
      .slice(0, 20)
      .map((review) => ({
        productFamily: review.productFamily,
        titles: review.originalTitles,
        options: review.originalOptionNames,
        suppliers: review.supplierIds,
        conflictReason: review.conflictReason,
        aiSuggestion: review.aiSuggestion,
      })),
  }
}

function buildVariantStatusDistribution(
  offers: readonly NormalizedOffer[],
  report: AtomicComparisonReport,
): Readonly<Record<string, number>> {
  const result: Record<string, number> = {
    multi_supplier_compared: 0,
    single_source: 0,
    separated_by_rule: 0,
    promotion_only: 0,
    review_blocked: 0,
    no_active_offer: 0,
    invalid: 0,
  }
  for (const variant of report.variants) {
    const members = offers.filter(
      (offer) => offer.canonicalVariantKey === variant.canonicalVariantKey,
    )
    let status: keyof typeof result = variant.comparisonStatus
    if (variant.comparisonStatus === "no_active_offer") {
      if (members.length > 0 && members.every((offer) => offer.status === "promotion")) {
        status = "promotion_only"
      } else if (
        variant.status === "review_needed" ||
        members.some((offer) => offer.status === "review_needed")
      ) {
        status = "review_blocked"
      } else if (
        members.length > 0 &&
        members.every((offer) =>
          ["zero_price_invalid", "expired", "blocked"].includes(offer.status),
        )
      ) {
        status = "invalid"
      }
    }
    result[status] = (result[status] ?? 0) + 1
  }
  return result
}

function buildCommonProductFamilies(
  offers: readonly NormalizedOffer[],
  candidates: readonly CrossSupplierProductCandidate[],
): readonly Readonly<Record<string, unknown>>[] {
  const supplierFamilies = new Map<string, Set<string>>()
  for (const offer of offers) {
    const families = supplierFamilies.get(offer.supplierId) ?? new Set<string>()
    families.add(offer.productFamily)
    supplierFamilies.set(offer.supplierId, families)
  }
  const [first, ...rest] = [...supplierFamilies.values()]
  const common =
    first === undefined
      ? []
      : [...first].filter((family) => rest.every((families) => families.has(family)))
  return common.sort().map((productFamily) => {
    const familyCandidates = candidates.filter(
      (candidate) => candidate.productFamily === productFamily,
    )
    return {
      productFamily,
      suppliers: [...supplierFamilies.keys()].map((supplierId) => ({
        supplierId,
        products: productRows(offers, supplierId, productFamily),
      })),
      candidatePairCount: familyCandidates.length,
      candidateDecisionCounts: {
        same_variant: familyCandidates.filter((candidate) => candidate.decision === "same_variant")
          .length,
        separate_variant: familyCandidates.filter(
          (candidate) => candidate.decision === "separate_variant",
        ).length,
        separate_product: familyCandidates.filter(
          (candidate) => candidate.decision === "separate_product",
        ).length,
        review_needed: familyCandidates.filter(
          (candidate) => candidate.decision === "review_needed",
        ).length,
      },
      candidateNotCreatedReason:
        familyCandidates.length > 0 ? null : "active non-promotion supplier product pair 없음",
    }
  })
}

function buildPriorityFamilyDiagnostics(
  offers: readonly NormalizedOffer[],
  candidates: readonly CrossSupplierProductCandidate[],
): readonly Readonly<Record<string, unknown>>[] {
  return ["사과", "옥수수", "참외", "감자", "당근", "수박"].map((productFamily) => {
    const suppliers = [...new Set(offers.map((offer) => offer.supplierId))]
    const products = suppliers.map((supplierId) => ({
      supplierId,
      products: productRows(offers, supplierId, productFamily),
    }))
    const familyCandidates = candidates.filter(
      (candidate) => candidate.productFamily === productFamily,
    )
    return {
      productFamily,
      suppliers: products,
      candidatePairCount: familyCandidates.length,
      reason: products.every((supplier) => supplier.products.length > 0)
        ? familyCandidates.length > 0
          ? "product_family 기준 후보 생성됨"
          : "active non-promotion offer 없음"
        : "한쪽 이상에서 product_family로 정규화되지 않음",
    }
  })
}

function productRows(
  offers: readonly NormalizedOffer[],
  supplierId: string,
  productFamily: string,
): readonly Readonly<Record<string, unknown>>[] {
  const grouped = new Map<string, NormalizedOffer[]>()
  for (const offer of offers.filter(
    (item) => item.supplierId === supplierId && item.productFamily === productFamily,
  )) {
    const rows = grouped.get(offer.sourceProductId) ?? []
    rows.push(offer)
    grouped.set(offer.sourceProductId, rows)
  }
  return [...grouped.values()].map((rows) => ({
    originalTitle: rows[0]?.originalProductTitle ?? "",
    atomicSkuCount: rows.length,
  }))
}

function buildCanonicalProducts(
  offers: readonly NormalizedOffer[],
): readonly Readonly<Record<string, unknown>>[] {
  const products = new Map<string, NormalizedOffer[]>()
  for (const offer of offers.filter((item) => item.status !== "promotion")) {
    const rows = products.get(offer.canonicalProductKey) ?? []
    rows.push(offer)
    products.set(offer.canonicalProductKey, rows)
  }
  return [...products.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([canonicalProductKey, rows]) => ({
      canonicalProductKey,
      sourceProductCount: new Set(
        rows.map((offer) => `${offer.supplierId}|${offer.sourceProductId}`),
      ).size,
      suppliers: [...new Set(rows.map((offer) => offer.supplierId))],
      originalTitles: [...new Set(rows.map((offer) => offer.originalProductTitle))],
    }))
}

function compactRankedOffer(
  atomicSkuId: string | null,
  offersById: ReadonlyMap<string, NormalizedOffer>,
): Readonly<Record<string, unknown>> | null {
  if (atomicSkuId === null) return null
  const offer = offersById.get(atomicSkuId)
  if (offer === undefined) return null
  return {
    atomicSkuId,
    supplierId: offer.supplierId,
    originalProductTitle: offer.originalProductTitle,
    originalOptionName: offer.originalOptionName,
    finalCost: offer.finalCost,
  }
}

function buildItemReport(
  item: string,
  pattern: RegExp,
  offers: readonly NormalizedOffer[],
  report: AtomicComparisonReport,
) {
  const selected = offers.filter((offer) => pattern.test(offer.originalProductTitle))
  const ids = new Set(selected.map((offer) => offer.atomicSkuId))
  const supplierProducts = [
    ...new Map(
      selected.map((offer) => [
        `${offer.supplierId}|${offer.sourceProductId}`,
        {
          supplierId: offer.supplierId,
          sourceProductId: offer.sourceProductId,
          originalTitle: offer.originalProductTitle,
          detailUrl: offer.productUrl,
          listingStartPrice: offer.listingStartPrice,
          detailMinimumOptionPrice: minimum(
            selected
              .filter(
                (candidate) =>
                  candidate.supplierId === offer.supplierId &&
                  candidate.sourceProductId === offer.sourceProductId,
              )
              .map((candidate) => candidate.supplierPrice),
          ),
        },
      ]),
    ).values(),
  ].map((product) => ({
    ...product,
    listingDetailDifference:
      product.listingStartPrice === null || product.detailMinimumOptionPrice === null
        ? null
        : product.detailMinimumOptionPrice - product.listingStartPrice,
  }))
  return {
    item,
    supplierProducts,
    atomicSkus: selected,
    canonicalProductCandidates: [...new Set(selected.map((offer) => offer.canonicalProductKey))],
    canonicalVariantCandidates: [
      ...new Set(
        selected.flatMap((offer) =>
          offer.canonicalVariantKey === null ? [] : [offer.canonicalVariantKey],
        ),
      ),
    ],
    decisions: report.variants.filter((variant) =>
      [
        ...(variant.selectedOfferAtomicSkuId === null ? [] : [variant.selectedOfferAtomicSkuId]),
        ...variant.rankedOfferAtomicSkuIds,
        ...variant.backupAtomicSkuIds,
        ...variant.excludedAtomicSkuIds,
      ].some((id) => ids.has(id)),
    ),
    reviewQuestions: report.reviewQueue
      .filter((review) => review.extractedOffers.some((offer) => ids.has(offer.atomicSkuId)))
      .map((review) => ({
        reviewKey: review.reviewKey,
        question: questionFor(review.conflictReason),
        reason: review.conflictReason,
        aiSuggestion: review.aiSuggestion,
        allowedDecisions: review.allowedDecisions,
      })),
  }
}

function questionFor(reason: string): string {
  if (reason.includes("without_numeric_spec")) {
    return "공급처별 비수치 등급·크기 표현을 같은 규격으로 승인할까요?"
  }
  if (reason.includes("missing_variant_spec")) {
    return "비교에 필요한 중량·개수·크기 규격 중 무엇이 누락되었나요?"
  }
  if (reason.includes("promotion")) {
    return "행사 상품이 일반상품과 중복되는 임시 offer인지 확인해 주세요."
  }
  return "이 offer를 연결, 분리 또는 제외할 기준을 선택해 주세요."
}

type ItemReport = ReturnType<typeof buildItemReport>

function renderMarkdown(
  report: AtomicComparisonReport & { readonly testItems: readonly ItemReport[] },
): string {
  const lines = [
    "# Atomic SKU 상세 옵션 dry-run 리포트",
    "",
    `생성시각: ${report.generatedAt}`,
    "",
    "운영 안전: WooCommerce 쓰기 0건, 공개 상품 생성 0건, 운영 DB migration 적용 0건.",
    "",
    "## 요약",
    "",
    `- atomic SKU: ${report.summary.atomicSkuCount}`,
    `- canonical variant: ${report.summary.canonicalVariantCount}`,
    `- comparison winner: ${report.summary.comparisonWinnerCount}`,
    `- single source offer: ${report.summary.singleSourceOfferCount}`,
    `- review_needed: ${report.summary.reviewNeededCount}`,
    "",
  ]
  for (const item of report.testItems) {
    lines.push(`## ${item.item}`, "", "### 공급처 상세 검증", "")
    for (const product of item.supplierProducts) {
      lines.push(
        `- ${product.supplierId} / ${product.originalTitle}`,
        `  - 상세 URL: ${product.detailUrl ?? "없음"}`,
        `  - 목록 시작가격: ${money(product.listingStartPrice)}`,
        `  - 상세 최저 옵션가격: ${money(product.detailMinimumOptionPrice)}`,
        `  - 차이: ${money(product.listingDetailDifference)}`,
      )
    }
    lines.push("", "### atomic SKU와 추출 출처", "")
    for (const offer of item.atomicSkus) {
      lines.push(
        `- ${offer.supplierId} / ${offer.originalOptionName} / ${money(offer.supplierPrice)} / ${offer.status}`,
        `  - canonical_product: ${offer.canonicalProductKey}`,
        `  - canonical_variant: ${offer.canonicalVariantKey ?? "missing_spec"}`,
        `  - 속성: ${JSON.stringify(compactAttributes(offer))}`,
        `  - provenance: ${JSON.stringify(offer.provenance)}`,
      )
    }
    lines.push("", "### 연결·분리·차단 및 순위", "")
    for (const decision of item.decisions) {
      lines.push(
        `- ${decision.canonicalVariantKey}: ${decision.status}`,
        `  - selection type: ${decision.selectionType ?? "없음"}`,
        `  - selected offer: ${decision.selectedOfferAtomicSkuId ?? "없음"}`,
        `  - active supplier count: ${decision.activeSupplierCount}`,
        `  - active offer count: ${decision.activeOfferCount}`,
        `  - comparison status: ${decision.comparisonStatus}`,
        `  - winner reason: ${decision.winnerReason}`,
        `  - 전체 순위: ${decision.rankedOfferAtomicSkuIds.join(", ") || "없음"}`,
        `  - backup: ${decision.backupAtomicSkuIds.join(", ") || "없음"}`,
        `  - 이유: ${decision.reasons.join(", ") || "동일 핵심규격 내 final_cost 오름차순"}`,
      )
    }
    if (item.reviewQuestions.length > 0) {
      lines.push("", "### review_needed 질문", "")
      for (const review of item.reviewQuestions) {
        lines.push(`- ${review.question} (${review.reason}, 제안: ${review.aiSuggestion})`)
      }
    }
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

function compactAttributes(offer: NormalizedOffer): Readonly<Record<string, unknown>> {
  return {
    productFamily: offer.productFamily,
    variety: offer.variety,
    processing: offer.processing,
    qualityGrade: offer.qualityGrade,
    usageGrade: offer.usageGrade,
    sizeLabel: offer.sizeLabel,
    sizeMin: offer.sizeMin,
    sizeMax: offer.sizeMax,
    sizeUnit: offer.sizeUnit,
    weight: offer.weight,
    weightBasis: offer.weightBasis,
    count: offer.count,
    optionUnit: offer.optionUnit,
    origin: offer.origin,
    packaging: offer.packaging,
    packageType: offer.packageType,
    availability: offer.status,
    categoryProfile: offer.categoryProfile,
  }
}

function minimum(values: readonly number[]): number | null {
  return values.length === 0 ? null : Math.min(...values)
}

function money(value: number | null): string {
  return value === null ? "확인 불가" : `${value.toLocaleString("ko-KR")}원`
}

function requireCredentials(): void {
  const required = ["WALLDOB2B_USERNAME", "WALLDOB2B_PASSWORD"]
  const missing = required.filter((key) => (process.env[key] ?? "").length === 0)
  if (missing.length > 0)
    throw new Error(`missing required credential names: ${missing.join(", ")}`)
}

async function loadDotEnv(): Promise<void> {
  try {
    const env = await readFile(".env", "utf8")
    for (const line of env.split(/\r?\n/u)) {
      const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line)
      if (match?.[1] !== undefined && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2] ?? ""
      }
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
}

void main()
