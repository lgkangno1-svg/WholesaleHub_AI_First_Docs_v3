import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { DailyFoodAtomicAdapter } from "../atomic-sku/adapters/dailyfood-adapter.js"
import { Walldob2bAtomicAdapter } from "../atomic-sku/adapters/walldob2b-adapter.js"
import { collectAtomicSkusWithDiagnostics } from "../atomic-sku/collect.js"
import { compareNormalizedOffers } from "../atomic-sku/compare.js"
import { FIVE_ITEM_DRY_RUN_PRODUCT_PAIR_RULES } from "../atomic-sku/fixture-rules.js"
import { normalizeAtomicSku } from "../atomic-sku/normalize.js"
import type { SupplierProductReference } from "../atomic-sku/supplier-adapter.js"
import type {
  AtomicComparisonReport,
  AtomicReviewQueueItem,
  AtomicSupplierSku,
  CanonicalVariantResult,
  NormalizedOffer,
} from "../atomic-sku/types.js"

async function main(): Promise<void> {
  await loadDotEnv()
  const databasePath = resolve(argument("--db") ?? "data/wholesalehub.sqlite")
  const migrationPath = resolve(
    argument("--migration") ?? "migrations/001_atomic_sku_comparison.sql",
  )
  const traceabilityMigrationPath = resolve(
    argument("--traceability-migration") ?? "migrations/002_supplier_offer_traceability.sql",
  )
  const startedAt = new Date().toISOString()
  const syncRunId = hash(`atomic-sync|${startedAt}`)
  const collected = await collectAtomicSkusWithDiagnostics({
    adapters: [
      new DailyFoodAtomicAdapter({
        username:
          process.env["DAILYFOOD_USERNAME"] ?? process.env["WALLDOB2B_USERNAME"] ?? "",
        password:
          process.env["DAILYFOOD_PASSWORD"] ?? process.env["WALLDOB2B_PASSWORD"] ?? "",
        browserEndpoint:
          process.env["ADMINPLUS_BROWSER_ENDPOINT"] ?? "http://localhost:3000",
        ...(argument("--daily-snapshot") === null
          ? {}
          : { snapshotPath: argument("--daily-snapshot") as string }),
      }),
      new Walldob2bAtomicAdapter({
        username: requiredEnv("WALLDOB2B_USERNAME"),
        password: requiredEnv("WALLDOB2B_PASSWORD"),
      }),
    ],
    includeProduct: isAgricultural,
    collectedAt: startedAt,
  })
  const failedDetails = collected.suppliers.reduce(
    (sum, supplier) => sum + supplier.detailFailureCount,
    0,
  )
  if (failedDetails > 0) {
    throw new Error(`atomic collection incomplete: ${failedDetails} detail pages failed`)
  }
  const offers = collected.atomicSkus.map(normalizeAtomicSku)
  const report = compareNormalizedOffers({
    offers,
    productPairRules: FIVE_ITEM_DRY_RUN_PRODUCT_PAIR_RULES,
    generatedAt: startedAt,
  })
  assertComparisonSafety(offers, report)
  const migration = await readFile(migrationPath, "utf8")
  const traceabilityMigration = await readFile(traceabilityMigrationPath, "utf8")
  const completedAt = new Date().toISOString()
  const database = new DatabaseSync(databasePath)
  try {
    database.exec("PRAGMA foreign_keys = ON")
    database.exec("PRAGMA busy_timeout = 5000")
    database.exec("BEGIN IMMEDIATE")
    try {
      database.exec(migration)
      if (!hasColumn(database, "comparison_variant_results", "selected_offer_id")) {
        database.exec(traceabilityMigration)
      }
      persistSync(database, {
        syncRunId,
        startedAt,
        completedAt,
        atomicSkus: collected.atomicSkus,
        offers,
        report,
        supplierCount: collected.suppliers.length,
      })
      database.exec("COMMIT")
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    }
  } finally {
    database.close()
  }
  console.log(
    JSON.stringify({
      migrationSuccess: true,
      syncRunId,
      atomicSkuCount: report.summary.atomicSkuCount,
      canonicalProductCount: report.summary.canonicalProductCount,
      canonicalVariantCount: report.summary.canonicalVariantCount,
      comparisonWinnerCount: report.summary.comparisonWinnerCount,
      singleSourceCount: report.summary.singleSourceOfferCount,
      excludedPromotionCount: offers.filter((offer) => offer.status === "promotion").length,
      excludedOutofstockCount: offers.filter((offer) => offer.status === "sold_out").length,
      excludedMissingSpecCount: offers.filter(
        (offer) => offer.canonicalVariantKey === null || offer.status === "review_needed",
      ).length,
    }),
  )
}

function hasColumn(database: DatabaseSync, table: string, column: string): boolean {
  return database
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row["name"] === column)
}

function persistSync(
  database: DatabaseSync,
  input: {
    readonly syncRunId: string
    readonly startedAt: string
    readonly completedAt: string
    readonly atomicSkus: readonly AtomicSupplierSku[]
    readonly offers: readonly NormalizedOffer[]
    readonly report: AtomicComparisonReport
    readonly supplierCount: number
  },
): void {
  database
    .prepare(
      `INSERT INTO atomic_sync_runs (
        sync_run_id, started_at, completed_at, supplier_count, atomic_sku_count, summary_json
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.syncRunId,
      input.startedAt,
      input.completedAt,
      input.supplierCount,
      input.atomicSkus.length,
      JSON.stringify(input.report.summary),
    )
  const offersByAtomicId = new Map(input.offers.map((offer) => [offer.atomicSkuId, offer]))
  for (const offer of input.offers) {
    persistOffer(database, offer, input.syncRunId, input.completedAt)
  }
  persistCanonicalGraph(
    database,
    input.offers,
    input.report,
    offersByAtomicId,
    input.syncRunId,
    input.completedAt,
  )
  for (const review of input.report.reviewQueue) {
    persistReview(database, review, input.syncRunId, input.completedAt)
  }
}

function persistOffer(
  database: DatabaseSync,
  offer: NormalizedOffer,
  syncRunId: string,
  normalizedAt: string,
): void {
  const supplierProductId = hash(`${offer.supplierId}|${offer.sourceProductId}`)
  const supplierOptionId = hash(
    `${offer.supplierId}|${offer.sourceProductId}|${offer.sourceOptionId}`,
  )
  database
    .prepare(
      `INSERT INTO supplier_products (
        supplier_product_id, supplier_id, source_product_id, original_title, detail_url,
        listing_start_price, detail_description, image_urls_json, detail_verified_at,
        raw_json, last_seen_sync_run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(supplier_product_id) DO UPDATE SET
        original_title=excluded.original_title, detail_url=excluded.detail_url,
        listing_start_price=excluded.listing_start_price,
        detail_description=excluded.detail_description,
        image_urls_json=excluded.image_urls_json,
        detail_verified_at=excluded.detail_verified_at, raw_json=excluded.raw_json,
        last_seen_sync_run_id=excluded.last_seen_sync_run_id`,
    )
    .run(
      supplierProductId,
      offer.supplierId,
      offer.sourceProductId,
      offer.originalProductTitle,
      offer.productUrl,
      offer.listingStartPrice,
      offer.detailDescription,
      JSON.stringify(offer.imageUrl === null ? [] : [offer.imageUrl]),
      offer.detailVerifiedAt,
      JSON.stringify({
        supplierId: offer.supplierId,
        sourceProductId: offer.sourceProductId,
      }),
      syncRunId,
    )
  database
    .prepare(
      `INSERT INTO supplier_options (
        supplier_option_id, supplier_product_id, source_option_id, original_option_name,
        option_price, shipping_fee, stock_status, raw_json, last_seen_sync_run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(supplier_option_id) DO UPDATE SET
        original_option_name=excluded.original_option_name,
        option_price=excluded.option_price, shipping_fee=excluded.shipping_fee,
        stock_status=excluded.stock_status, raw_json=excluded.raw_json,
        last_seen_sync_run_id=excluded.last_seen_sync_run_id`,
    )
    .run(
      supplierOptionId,
      supplierProductId,
      offer.sourceOptionId,
      offer.originalOptionName,
      offer.supplierPrice,
      offer.shippingFee,
      offer.stockStatus,
      JSON.stringify({
        optionGroupTitle: offer.optionGroupTitle ?? null,
        structuredAttributes: offer.structuredAttributes ?? {},
        priceAnomaly: offer.priceAnomaly,
      }),
      syncRunId,
    )
  const inputFingerprint = hash(
    JSON.stringify({
      supplierId: offer.supplierId,
      sourceProductId: offer.sourceProductId,
      sourceOptionId: offer.sourceOptionId,
      optionPrice: offer.supplierPrice,
      stockStatus: offer.stockStatus,
      verifiedAt: offer.detailVerifiedAt,
    }),
  )
  database
    .prepare(
      `INSERT INTO atomic_supplier_skus (
        atomic_sku_id, supplier_product_id, supplier_option_id, input_fingerprint,
        status, collected_at, last_seen_sync_run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(atomic_sku_id) DO UPDATE SET
        input_fingerprint=excluded.input_fingerprint, status=excluded.status,
        collected_at=excluded.collected_at,
        last_seen_sync_run_id=excluded.last_seen_sync_run_id`,
    )
    .run(
      offer.atomicSkuId,
      supplierProductId,
      supplierOptionId,
      inputFingerprint,
      offer.status,
      offer.collectedAt,
      syncRunId,
    )
  database
    .prepare(
      `INSERT INTO normalized_offers (
        normalized_offer_id, atomic_sku_id, product_family, variety, product_type,
        peach_skin_type, cultivation_method, processing, quality_grade, usage_grade,
        size_label, size_min, size_max, size_unit, weight, count_value, option_unit,
        origin, packaging, weight_basis, package_type, promotion_flag, preorder_flag,
        sold_out_flag, shipping_fee, final_cost, confidence, confidence_reason,
        provenance_json, provenance_candidates_json, spec_conflicts_json,
        category_profile_json, removed_marketing_terms_json, status_reasons_json,
        price_anomaly, status, canonical_product_key, canonical_variant_key,
        normalized_at, last_seen_sync_run_id
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(normalized_offer_id) DO UPDATE SET
        product_family=excluded.product_family, variety=excluded.variety,
        product_type=excluded.product_type, peach_skin_type=excluded.peach_skin_type,
        cultivation_method=excluded.cultivation_method, processing=excluded.processing,
        quality_grade=excluded.quality_grade, usage_grade=excluded.usage_grade,
        size_label=excluded.size_label, size_min=excluded.size_min, size_max=excluded.size_max,
        size_unit=excluded.size_unit, weight=excluded.weight, count_value=excluded.count_value,
        option_unit=excluded.option_unit, origin=excluded.origin, packaging=excluded.packaging,
        weight_basis=excluded.weight_basis, package_type=excluded.package_type,
        promotion_flag=excluded.promotion_flag, preorder_flag=excluded.preorder_flag,
        sold_out_flag=excluded.sold_out_flag, shipping_fee=excluded.shipping_fee,
        final_cost=excluded.final_cost, confidence=excluded.confidence,
        confidence_reason=excluded.confidence_reason,
        provenance_json=excluded.provenance_json,
        provenance_candidates_json=excluded.provenance_candidates_json,
        spec_conflicts_json=excluded.spec_conflicts_json,
        category_profile_json=excluded.category_profile_json,
        removed_marketing_terms_json=excluded.removed_marketing_terms_json,
        status_reasons_json=excluded.status_reasons_json,
        price_anomaly=excluded.price_anomaly, status=excluded.status,
        canonical_product_key=excluded.canonical_product_key,
        canonical_variant_key=excluded.canonical_variant_key,
        normalized_at=excluded.normalized_at,
        last_seen_sync_run_id=excluded.last_seen_sync_run_id`,
    )
    .run(
      offer.atomicSkuId,
      offer.atomicSkuId,
      offer.productFamily,
      offer.variety,
      offer.productType,
      offer.peachSkinType,
      offer.cultivationMethod,
      offer.processing,
      offer.qualityGrade,
      offer.usageGrade,
      offer.sizeLabel,
      offer.sizeMin,
      offer.sizeMax,
      offer.sizeUnit,
      offer.weight,
      offer.count,
      offer.optionUnit,
      offer.origin,
      offer.packaging,
      offer.weightBasis,
      offer.packageType,
      Number(offer.promotionFlag),
      Number(offer.preorderFlag),
      Number(offer.soldOutFlag),
      offer.shippingFee,
      offer.finalCost,
      offer.confidence,
      offer.confidenceReason,
      JSON.stringify(offer.provenance),
      JSON.stringify(offer.provenanceCandidates),
      JSON.stringify(offer.specConflicts),
      JSON.stringify(offer.categoryProfile),
      JSON.stringify(offer.removedMarketingTerms),
      JSON.stringify(offer.statusReasons),
      Number(offer.priceAnomaly),
      offer.status,
      offer.canonicalProductKey,
      offer.canonicalVariantKey,
      normalizedAt,
      syncRunId,
    )
  database
    .prepare(
      `INSERT INTO offer_price_history (
        atomic_sku_id, observed_at, supplier_price, shipping_fee, final_cost,
        status, observation_fingerprint
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(observation_fingerprint) DO NOTHING`,
    )
    .run(
      offer.atomicSkuId,
      offer.collectedAt,
      offer.supplierPrice,
      offer.shippingFee,
      offer.finalCost,
      offer.status,
      hash(
        `${offer.atomicSkuId}|${offer.collectedAt}|${offer.supplierPrice}|${offer.finalCost}|${offer.status}`,
      ),
    )
}

function persistCanonicalGraph(
  database: DatabaseSync,
  offers: readonly NormalizedOffer[],
  report: AtomicComparisonReport,
  offersByAtomicId: ReadonlyMap<string, NormalizedOffer>,
  syncRunId: string,
  calculatedAt: string,
): void {
  const currentProductKeys = new Set(
    offers.filter((offer) => offer.status !== "promotion").map((offer) => offer.canonicalProductKey),
  )
  for (const canonicalProductKey of currentProductKeys) {
    const members = offers.filter(
      (offer) =>
        offer.status !== "promotion" && offer.canonicalProductKey === canonicalProductKey,
    )
    const first = members[0]
    if (first === undefined) continue
    database
      .prepare(
        `INSERT INTO canonical_products (
          canonical_product_id, canonical_product_key, product_family, grade_group,
          attributes_json, last_seen_sync_run_id
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(canonical_product_id) DO UPDATE SET
          product_family=excluded.product_family, grade_group=excluded.grade_group,
          attributes_json=excluded.attributes_json,
          last_seen_sync_run_id=excluded.last_seen_sync_run_id`,
      )
      .run(
        hash(canonicalProductKey),
        canonicalProductKey,
        first.productFamily,
        null,
        JSON.stringify({
          variety: first.variety,
          productType: first.productType,
          peachSkinType: first.peachSkinType,
          processing: first.processing,
        }),
        syncRunId,
      )
  }
  for (const variant of report.variants) {
    persistVariant(database, variant, offersByAtomicId, syncRunId, calculatedAt)
  }
}

function persistVariant(
  database: DatabaseSync,
  variant: CanonicalVariantResult,
  offersByAtomicId: ReadonlyMap<string, NormalizedOffer>,
  syncRunId: string,
  calculatedAt: string,
): void {
  const canonicalVariantId = hash(variant.canonicalVariantKey)
  const canonicalProductId = hash(variant.canonicalProductKey)
  const members = [...offersByAtomicId.values()].filter(
    (offer) => offer.canonicalVariantKey === variant.canonicalVariantKey,
  )
  const first = members[0]
  database
    .prepare(
      `INSERT INTO canonical_variants (
        canonical_variant_id, canonical_product_id, canonical_variant_key,
        specification_json, last_seen_sync_run_id
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(canonical_variant_id) DO UPDATE SET
        canonical_product_id=excluded.canonical_product_id,
        specification_json=excluded.specification_json,
        last_seen_sync_run_id=excluded.last_seen_sync_run_id`,
    )
    .run(
      canonicalVariantId,
      canonicalProductId,
      variant.canonicalVariantKey,
      JSON.stringify(
        first === undefined
          ? {}
          : {
              qualityGrade: first.qualityGrade,
              usageGrade: first.usageGrade,
              sizeLabel: first.sizeLabel,
              sizeMin: first.sizeMin,
              sizeMax: first.sizeMax,
              sizeUnit: first.sizeUnit,
              weight: first.weight,
              weightBasis: first.weightBasis,
              count: first.count,
              optionUnit: first.optionUnit,
              packageType: first.packageType,
            },
      ),
      syncRunId,
    )
  const ranks = new Map(
    variant.rankedOfferAtomicSkuIds.map((atomicSkuId, index) => [atomicSkuId, index + 1]),
  )
  for (const offer of members) {
    const linkStatus =
      variant.comparisonStatus === "review_blocked" || offer.status === "review_needed"
        ? "review_needed"
        : offer.status === "blocked"
          ? "blocked"
          : offer.status === "active"
            ? "linked"
            : "excluded"
    database
      .prepare(
        `INSERT INTO canonical_variant_offers (
          canonical_variant_id, normalized_offer_id, link_status, rank_position,
          is_winner, linked_at, last_seen_sync_run_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(canonical_variant_id, normalized_offer_id) DO UPDATE SET
          link_status=excluded.link_status, rank_position=excluded.rank_position,
          is_winner=excluded.is_winner, linked_at=excluded.linked_at,
          last_seen_sync_run_id=excluded.last_seen_sync_run_id`,
      )
      .run(
        canonicalVariantId,
        offer.atomicSkuId,
        linkStatus,
        ranks.get(offer.atomicSkuId) ?? null,
        Number(variant.comparisonWinnerAtomicSkuId === offer.atomicSkuId),
        calculatedAt,
        syncRunId,
      )
  }
  database
    .prepare(
      `INSERT INTO comparison_variant_results (
        canonical_variant_id, comparison_status, selection_type,
        selected_normalized_offer_id, selected_offer_id,
        active_supplier_count, active_offer_count,
        backup_count, cross_supplier_backup_count, supplier_alternate_offer_count,
        is_actually_compared, winner_reason, reasons_json, calculated_at,
        last_seen_sync_run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(canonical_variant_id) DO UPDATE SET
        comparison_status=excluded.comparison_status,
        selection_type=excluded.selection_type,
        selected_normalized_offer_id=excluded.selected_normalized_offer_id,
        selected_offer_id=excluded.selected_offer_id,
        active_supplier_count=excluded.active_supplier_count,
        active_offer_count=excluded.active_offer_count,
        backup_count=excluded.backup_count,
        cross_supplier_backup_count=excluded.cross_supplier_backup_count,
        supplier_alternate_offer_count=excluded.supplier_alternate_offer_count,
        is_actually_compared=excluded.is_actually_compared,
        winner_reason=excluded.winner_reason, reasons_json=excluded.reasons_json,
        calculated_at=excluded.calculated_at,
        last_seen_sync_run_id=excluded.last_seen_sync_run_id`,
    )
    .run(
      canonicalVariantId,
      variant.comparisonStatus,
      variant.selectionType,
      variant.selectedOfferAtomicSkuId,
      variant.selectedOfferAtomicSkuId,
      variant.activeSupplierCount,
      variant.activeOfferCount,
      variant.backupCount,
      variant.crossSupplierBackupCount,
      variant.supplierAlternateOfferCount,
      Number(variant.isActuallyCompared),
      variant.winnerReason,
      JSON.stringify(variant.reasons),
      calculatedAt,
      syncRunId,
    )
}

function persistReview(
  database: DatabaseSync,
  review: AtomicReviewQueueItem,
  syncRunId: string,
  timestamp: string,
): void {
  const offerFingerprint = hash(
    review.extractedOffers
      .map((offer) => offer.atomicSkuId)
      .sort()
      .join("|"),
  )
  database
    .prepare(
      `INSERT INTO normalization_review_queue (
        review_key, product_family, canonical_variant_key, offer_fingerprint,
        conflict_reason, payload_json, ai_suggestion, review_status,
        admin_decision, created_at, updated_at, last_seen_sync_run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?)
      ON CONFLICT(review_key) DO UPDATE SET
        product_family=excluded.product_family,
        canonical_variant_key=excluded.canonical_variant_key,
        offer_fingerprint=excluded.offer_fingerprint,
        conflict_reason=excluded.conflict_reason,
        payload_json=excluded.payload_json,
        ai_suggestion=excluded.ai_suggestion,
        updated_at=excluded.updated_at,
        last_seen_sync_run_id=excluded.last_seen_sync_run_id`,
    )
    .run(
      review.reviewKey,
      review.productFamily,
      review.canonicalVariantKey,
      offerFingerprint,
      review.conflictReason,
      JSON.stringify(review),
      review.aiSuggestion,
      timestamp,
      timestamp,
      syncRunId,
    )
}

function assertComparisonSafety(
  offers: readonly NormalizedOffer[],
  report: AtomicComparisonReport,
): void {
  for (const variant of report.variants) {
    if (
      variant.selectionType === "comparison_winner" &&
      (!variant.isActuallyCompared ||
        variant.activeSupplierCount < 2 ||
        variant.comparisonWinnerAtomicSkuId === null)
    ) {
      throw new Error(`invalid comparison winner: ${variant.canonicalVariantKey}`)
    }
    if (
      variant.selectionType === "single_source_offer" &&
      (variant.activeSupplierCount !== 1 || variant.comparisonWinnerAtomicSkuId !== null)
    ) {
      throw new Error(`single source mislabeled as winner: ${variant.canonicalVariantKey}`)
    }
    const selected =
      variant.selectedOfferAtomicSkuId === null
        ? null
        : offers.find((offer) => offer.atomicSkuId === variant.selectedOfferAtomicSkuId)
    if (
      selected !== null &&
      selected !== undefined &&
      (selected.status === "promotion" ||
        selected.status === "sold_out" ||
        selected.status === "review_needed" ||
        selected.canonicalVariantKey === null)
    ) {
      throw new Error(`excluded offer selected: ${selected.atomicSkuId}`)
    }
  }
}

function isAgricultural(reference: SupplierProductReference): boolean {
  if (/예치금|충전/u.test(reference.originalTitle)) return false
  return /사과|배(?!추)|자몽|오렌지|귤|감귤|레몬|포도|복숭아|자두|수박|참외|멜론|바나나|키위|망고|망고스틴|체리|블루베리|딸기|감(?!자)|석류|무화과|아보카도|토마토|옥수수|감자|고구마|당근|양파|마늘|대파|쪽파|배추|채소|상추|깻잎|오이|호박|가지|버섯|브로콜리|양배추|파프리카|고추|콩|밤|대추|쌀|잡곡|마카다미아|석가/u.test(
    reference.originalTitle,
  )
}

function argument(key: string): string | null {
  const index = process.argv.indexOf(key)
  return index < 0 ? null : (process.argv[index + 1] ?? null)
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`${key} is required`)
  return value
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
