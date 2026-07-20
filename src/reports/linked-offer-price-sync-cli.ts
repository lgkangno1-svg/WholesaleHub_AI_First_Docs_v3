import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import ky from "ky"
import { z } from "zod"
import { fetchMvpWooCatalog, hubSalePriceFromSupplierPrice } from "./mvp-sync-plan.js"

const PRICING_RULE_VERSION = "hub-margin-v1"
const CLASSIFICATIONS = [
  "ready_to_apply",
  "no_change",
  "missing_baseline",
  "match_uncertain",
  "source_unverified",
  "fetch_failed",
  "invalid_price",
  "sold_out",
  "promotion_excluded",
  "source_conflict",
] as const
type Classification = (typeof CLASSIFICATIONS)[number]

type LinkRow = {
  readonly woo_product_id: number
  readonly woo_variation_id: number
  readonly canonical_variant_id: string
  readonly selected_offer_id: string
  readonly atomic_sku_id: string
  readonly supplier_id: string
  readonly supplier_product_id: string
  readonly supplier_option_id: string
  readonly source_product_id: string
  readonly source_option_id: string
  readonly original_title: string
  readonly original_option_name: string
  readonly detail_url: string | null
  readonly stored_final_cost: number
  readonly normalized_status: string
  readonly promotion_flag: number
  readonly sold_out_flag: number
  readonly atomic_status: string
  readonly history_final_cost: number | null
}
type SnapshotOffer = {
  readonly supplierId: string
  readonly sourceProductId: string
  readonly sourceOptionId: string
  readonly originalProductName: string
  readonly originalOptionName: string
  readonly price: number
  readonly shippingFee: number
  readonly stockStatus: string
  readonly productUrl: string
  readonly sourceHash: string
  readonly observedAt: string
}
type Candidate = {
  readonly supplierId: string
  readonly supplierProductId: string | null
  readonly supplierOptionId: string | null
  readonly atomicSkuId: string | null
  readonly selectedOfferId: string | null
  readonly wooProductId: number | null
  readonly wooVariationId: number | null
  readonly originalProductName: string
  readonly originalOptionName: string
  readonly previousSupplierCost: number | null
  readonly observedSupplierCost: number | null
  readonly currentWooPrice: number | null
  readonly calculatedWooPrice: number | null
  readonly classification: Classification
  readonly reason: string
  readonly sourceUrl: string
  readonly sourceHash: string
  readonly observedAt: string
}
type AppliedChange = {
  readonly product_id: number
  readonly variation_id: number
  readonly product_name: string
  readonly option_name: string
  readonly before_price: number
  readonly after_price: number
  readonly difference: number
}

const SnapshotSchema = z.object({
  createdAt: z.string(),
  products: z.array(
    z.object({
      supplierId: z.string(),
      originalProductName: z.string(),
      originalOptionName: z.string().nullable().optional(),
      price: z.number(),
      shippingFee: z.number().default(0),
      stockStatus: z.string(),
      productUrl: z.string().default(""),
      rawJson: z.string(),
    }),
  ),
})
const PlanSchema = z.object({
  rows: z.array(
    z.object({
      action: z.string(),
      product_id: z.number().int().nullable(),
      variation_id: z.number().int().nullable(),
      selected_supplier_id: z.string(),
      selected_source_product_id: z.string(),
      selected_source_option_id: z.string(),
      selected_supplier_price: z.number().nullable().optional(),
      woocommerce_product_name: z.string(),
      woocommerce_option_name: z.string(),
      current_price: z.string(),
      new_price: z.string(),
    }),
  ),
})

async function main(): Promise<void> {
  await loadDotEnv()
  const options = parseArgs(process.argv.slice(2))
  const now = new Date().toISOString()
  const runId = options.runId || `price-sync-${kstStamp(new Date())}`
  const db = new DatabaseSync(resolve(options.dbPath))
  ensureSchema(db, options.migrationPath)
  beginRun(db, runId, now)
  try {
    setStage(db, runId, "crawl_completed")
    const [dailySnapshot, walldoSnapshot, plan, catalog] = await Promise.all([
      readSnapshot(options.dailySnapshot, now),
      readSnapshot(options.walldoSnapshot, now),
      readPlan(options.planPath),
      fetchMvpWooCatalog({
        baseUrl: requiredEnv("WOOCOMMERCE_BASE_URL"),
        consumerKey: requiredEnv("WOOCOMMERCE_CONSUMER_KEY"),
        consumerSecret: requiredEnv("WOOCOMMERCE_CONSUMER_SECRET"),
      }),
    ])
    const appliedVariations = new Set<number>()
    try {
      const rows = db.prepare("SELECT woo_variation_id FROM price_sync_results WHERE run_id = ? AND status = 'applied'").all(runId) as { woo_variation_id: number }[]
      for (const r of rows) {
        if (r.woo_variation_id) appliedVariations.add(r.woo_variation_id)
      }
    } catch (e) {
      // Ignored if table not active yet
    }

    const dailyFetchFailed = dailySnapshot === null
    const walldoFetchFailed = walldoSnapshot === null
    const daily = dailySnapshot ?? []
    const walldo = walldoSnapshot ?? []
    const sourceOffers = new Map(
      [...daily, ...walldo].map((offer) => [sourceKey(offer), offer]),
    )
    const links = readLinks(db)
    const candidates = classifyLinks(links, sourceOffers, catalog, dailyFetchFailed, walldoFetchFailed)
    const fuzzyIssues = classifyUnlinkedPriceRows(plan.rows, links, now)
    const allCandidates = [...candidates, ...fuzzyIssues]
    setStage(db, runId, "preflight_completed")
    const candidateIds = persistCandidates(db, runId, allCandidates)
    const changes: AppliedChange[] = []
    let applyFailures = 0
    for (let index = 0; index < allCandidates.length; index += 1) {
      const candidate = allCandidates[index]
      const candidateId = candidateIds[index]
      if (candidate === undefined || candidateId === undefined) continue

      if (candidate.wooVariationId !== null && appliedVariations.has(candidate.wooVariationId)) {
        console.log(`Variation ${candidate.wooVariationId} already applied in run ${runId}, skipping Woo write.`)
        changes.push({
          product_id: candidate.wooProductId ?? 0,
          variation_id: candidate.wooVariationId ?? 0,
          product_name: candidate.originalProductName,
          option_name: candidate.originalOptionName,
          before_price: candidate.currentWooPrice ?? 0,
          after_price: candidate.calculatedWooPrice ?? 0,
          difference: (candidate.calculatedWooPrice ?? 0) - (candidate.currentWooPrice ?? 0),
        })
        continue
      }

      if (candidate.classification !== "ready_to_apply") {
        persistHeld(db, runId, candidateId, candidate)
        continue
      }
      if (!options.execute) continue
      const result = await applyCandidate(candidate)
      persistApplyResult(db, runId, candidateId, candidate, result)
      if (result.ok) {
        changes.push({
          product_id: candidate.wooProductId ?? 0,
          variation_id: candidate.wooVariationId ?? 0,
          product_name: candidate.originalProductName,
          option_name: candidate.originalOptionName,
          before_price: candidate.currentWooPrice ?? 0,
          after_price: result.verifiedPrice,
          difference: result.verifiedPrice - (candidate.currentWooPrice ?? 0),
        })
      } else {
        applyFailures += 1
      }
    }
    const trashedCount = await trashMissingProducts(db, runId, allCandidates, options.execute, dailyFetchFailed, walldoFetchFailed)
    setStage(db, runId, options.execute ? "apply_completed" : "preflight_completed")
    const readyCount = allCandidates.filter((row) => row.classification === "ready_to_apply").length
    const heldCount = allCandidates.filter(
      (row) => !["ready_to_apply", "no_change"].includes(row.classification),
    ).length
    const baselineCount = persistPriceHistory(db, runId, allCandidates, changes, now)
    const status =
      applyFailures > 0 || heldCount > 0
        ? changes.length > 0 || allCandidates.some((row) => row.classification === "no_change")
          ? "partial_success"
          : "failed"
        : changes.length > 0
          ? "success"
          : "no_change"
    finishRun(db, runId, {
      status,
      checked: allCandidates.length,
      changed: readyCount,
      applied: changes.length,
      failed: applyFailures,
      held: heldCount,
      baseline: baselineCount,
    })
    const report = buildReport(runId, now, status, allCandidates, changes, applyFailures, options.execute)
    await writeJson(options.outputPath, report)
    console.log(
      JSON.stringify({
        runId,
        status,
        checkedCount: allCandidates.length,
        priceChangeDetected: readyCount,
        appliedCount: changes.length,
        failedCount: applyFailures,
        noChangeCount: allCandidates.filter((row) => row.classification === "no_change").length,
        baselineCreatedCount: baselineCount,
        heldCount,
        trashedCount,
        legacy82Processed: fuzzyIssues.length,
        legacy82Held: fuzzyIssues.length,
        reportPath: options.outputPath,
      }),
    )
    if (applyFailures > 0) process.exitCode = 2
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failRun(db, runId, message)
    await writeJson(options.outputPath, buildFailureReport(runId, now, message))
    throw error
  } finally {
    db.close()
  }
}

function classifyLinks(
  links: readonly LinkRow[],
  sourceOffers: ReadonlyMap<string, SnapshotOffer>,
  catalog: Awaited<ReturnType<typeof fetchMvpWooCatalog>>,
  dailyFetchFailed: boolean,
  walldoFetchFailed: boolean,
): readonly Candidate[] {
  return links.map((link) => {
    const observed = sourceOffers.get(
      `${link.supplier_id}|${link.source_product_id}|${link.source_option_id}`,
    )
    const product = catalog.find((row) => row.id === link.woo_product_id)
    const variation = product?.variations.find((row) => row.id === link.woo_variation_id)
    const currentWooPrice = variation === undefined ? null : numberOrNull(variation.price ?? "")
    const baseline = link.history_final_cost ?? link.stored_final_cost ?? null
    const common = {
      supplierId: link.supplier_id,
      supplierProductId: link.supplier_product_id,
      supplierOptionId: link.supplier_option_id,
      atomicSkuId: link.atomic_sku_id,
      selectedOfferId: link.selected_offer_id,
      wooProductId: link.woo_product_id,
      wooVariationId: link.woo_variation_id,
      originalProductName: link.original_title,
      originalOptionName: link.original_option_name,
      previousSupplierCost: baseline,
      observedSupplierCost: observed?.price ?? null,
      currentWooPrice,
      calculatedWooPrice:
        observed !== undefined && validPrice(observed.price)
          ? hubSalePriceFromSupplierPrice(observed.price)
          : null,
      sourceUrl: observed?.productUrl || link.detail_url || "",
      sourceHash: observed?.sourceHash ?? "",
      observedAt: observed?.observedAt ?? new Date().toISOString(),
    }
    if (observed === undefined) {
      if (link.supplier_id === "dailyfood" && dailyFetchFailed) {
        return { ...common, classification: "fetch_failed", reason: "DailyFood snapshot fetch failed" }
      }
      if (link.supplier_id === "walldob2b" && walldoFetchFailed) {
        return { ...common, classification: "fetch_failed", reason: "Walldo snapshot fetch failed" }
      }
      return { ...common, classification: "source_unverified", reason: "linked source option was not collected" }
    }
    if (product === undefined || variation === undefined)
      return { ...common, classification: "fetch_failed", reason: "linked Woo variation was not found" }
    if (link.promotion_flag === 1 || link.normalized_status === "promotion")
      return { ...common, classification: "promotion_excluded", reason: "promotion offer is excluded" }
    if (
      link.sold_out_flag === 1 ||
      link.atomic_status === "sold_out" ||
      observed.stockStatus === "out_of_stock"
    )
      return { ...common, classification: "sold_out", reason: "supplier offer is sold out" }
    if (
      link.normalized_status !== "active" ||
      link.atomic_status !== "active"
    )
      return { ...common, classification: "source_unverified", reason: `offer status is ${link.normalized_status}/${link.atomic_status}` }
    if (!validPrice(observed.price))
      return { ...common, classification: "invalid_price", reason: "supplier price is invalid" }
    const calculated = hubSalePriceFromSupplierPrice(observed.price)
    if (currentWooPrice === calculated)
      return { ...common, classification: "no_change", reason: baseline === null ? "initial baseline created; Woo price already matches" : "Woo price already matches" }
    return {
      ...common,
      classification: "ready_to_apply",
      reason:
        baseline === null
          ? "authoritative link and current source price verified; initial baseline created"
          : observed.price === baseline
            ? "authoritative link verified; Woo price differs from pricing rule"
            : "authoritative link verified; supplier price changed",
    }
  })
}

function classifyUnlinkedPriceRows(
  rows: z.infer<typeof PlanSchema>["rows"],
  links: readonly LinkRow[],
  observedAt: string,
): readonly Candidate[] {
  const linkByVariation = new Map(links.map((link) => [link.woo_variation_id, link]))
  return rows
    .filter((row) => ["update_price", "switch_supplier_and_update_price"].includes(row.action))
    .filter((row) => row.variation_id === null || !linkByVariation.has(row.variation_id))
    .map((row) => {
      const link = row.variation_id === null ? undefined : linkByVariation.get(row.variation_id)
      const sourceMatches =
        link !== undefined &&
        link.supplier_id === row.selected_supplier_id &&
        link.source_product_id === row.selected_source_product_id &&
        link.source_option_id === row.selected_source_option_id
      return {
        supplierId: row.selected_supplier_id,
        supplierProductId: null,
        supplierOptionId: null,
        atomicSkuId: null,
        selectedOfferId: sourceMatches ? link.selected_offer_id : null,
        wooProductId: row.product_id,
        wooVariationId: row.variation_id,
        originalProductName: row.woocommerce_product_name,
        originalOptionName: row.woocommerce_option_name,
        previousSupplierCost: null,
        observedSupplierCost: row.selected_supplier_price ?? null,
        currentWooPrice: numberOrNull(row.current_price),
        calculatedWooPrice: numberOrNull(row.new_price),
        classification: "match_uncertain" as const,
        reason: link === undefined
          ? "no authoritative woo_variation_offer_link"
          : sourceMatches
            ? "duplicate heuristic candidate; authoritative linked candidate is evaluated separately"
            : "heuristic source differs from authoritative selected_offer link",
        sourceUrl: "",
        sourceHash: "",
        observedAt,
      }
    })
}

async function applyCandidate(
  candidate: Candidate,
): Promise<{ readonly ok: true; readonly verifiedPrice: number } | { readonly ok: false; readonly error: string }> {
  if (
    candidate.wooProductId === null ||
    candidate.wooVariationId === null ||
    candidate.calculatedWooPrice === null
  )
    return { ok: false, error: "candidate target is incomplete" }
  const url = `${requiredEnv("WOOCOMMERCE_BASE_URL").replace(/\/$/u, "")}/wp-json/wc/v3/products/${candidate.wooProductId}/variations/${candidate.wooVariationId}`
  const headers = {
    Authorization: `Basic ${Buffer.from(`${requiredEnv("WOOCOMMERCE_CONSUMER_KEY")}:${requiredEnv("WOOCOMMERCE_CONSUMER_SECRET")}`).toString("base64")}`,
  }
  let lastError = "verification failed"
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await ky.put(url, {
        headers,
        json: { regular_price: String(candidate.calculatedWooPrice) },
        timeout: 60_000,
        retry: { limit: 0 },
      })
      const after = z.object({ price: z.string().nullable().optional(), regular_price: z.string().nullable().optional() }).parse(
        await ky.get(url, { headers, timeout: 30_000, retry: { limit: 0 } }).json(),
      )
      const verified = numberOrNull(after.price ?? after.regular_price ?? "")
      if (verified === candidate.calculatedWooPrice) return { ok: true, verifiedPrice: verified }
      lastError = `read-back mismatch expected=${candidate.calculatedWooPrice} actual=${verified ?? "null"}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  // Verification failed after 2 attempts -> roll back to currentWooPrice if available
  if (candidate.currentWooPrice !== null) {
    console.warn(`WooCommerce update failed for variation ${candidate.wooVariationId}. Rolling back to ${candidate.currentWooPrice}...`)
    try {
      await ky.put(url, {
        headers,
        json: { regular_price: String(candidate.currentWooPrice) },
        timeout: 60_000,
        retry: { limit: 0 },
      })
      lastError += " (successfully rolled back)"
    } catch (rollbackError) {
      const rollbackMsg = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
      lastError += ` (rollback failed: ${rollbackMsg})`
    }
  }
  return { ok: false, error: lastError }
}

async function trashMissingProducts(
  db: DatabaseSync,
  runId: string,
  allCandidates: readonly Candidate[],
  execute: boolean,
  dailyFetchFailed: boolean,
  walldoFetchFailed: boolean,
): Promise<number> {
  const productCandidates = new Map<number, Candidate[]>()
  for (const c of allCandidates) {
    if (c.wooProductId !== null && c.wooProductId !== 0) {
      const list = productCandidates.get(c.wooProductId) ?? []
      list.push(c)
      productCandidates.set(c.wooProductId, list)
    }
  }

  let trashedCount = 0
  const headers = {
    Authorization: `Basic ${Buffer.from(`${requiredEnv("WOOCOMMERCE_CONSUMER_KEY")}:${requiredEnv("WOOCOMMERCE_CONSUMER_SECRET")}`).toString("base64")}`,
  }

  for (const [wooProductId, candidates] of productCandidates.entries()) {
    const eligible = candidates.every((c) => {
      if (c.supplierId === "dailyfood" && dailyFetchFailed) return false
      if (c.supplierId === "walldob2b" && walldoFetchFailed) return false
      return true
    })
    if (!eligible) continue

    const allMissing = candidates.every(
      (c) => c.classification === "source_unverified" && c.reason.includes("not collected")
    )

    if (allMissing) {
      console.log(`Product ${wooProductId} ("${candidates[0]?.originalProductName}") is completely missing from supplier snapshots.`)
      
      db.prepare(
        `INSERT OR REPLACE INTO price_sync_issues (
           run_id, candidate_id, issue_type, supplier_id, woo_product_id,
           woo_variation_id, original_product_name, original_option_name, detail
         ) VALUES (?, NULL, 'product_missing_at_source', ?, ?, NULL, ?, '', ?)`
      ).run(
        runId,
        candidates[0]?.supplierId ?? "",
        wooProductId,
        candidates[0]?.originalProductName ?? "",
        execute ? "Parent product trashed due to missing supplier source" : "Parent product would be trashed (dry-run)"
      )

      if (execute) {
        try {
          const url = `${requiredEnv("WOOCOMMERCE_BASE_URL").replace(/\/$/u, "")}/wp-json/wc/v3/products/${wooProductId}`
          await ky.delete(url, { headers, timeout: 60_000, retry: { limit: 0 } })
          console.log(`Successfully trashed WooCommerce product ${wooProductId}`)
          trashedCount += 1
        } catch (error) {
          console.error(`Failed to trash WooCommerce product ${wooProductId}:`, error)
          db.prepare(
            `INSERT OR REPLACE INTO price_sync_issues (
               run_id, candidate_id, issue_type, supplier_id, woo_product_id,
               woo_variation_id, original_product_name, original_option_name, detail
             ) VALUES (?, NULL, 'product_trash_failed', ?, ?, NULL, ?, '', ?)`
          ).run(
            runId,
            candidates[0]?.supplierId ?? "",
            wooProductId,
            candidates[0]?.originalProductName ?? "",
            error instanceof Error ? error.message : String(error)
          )
        }
      } else {
        trashedCount += 1
      }
    }
  }
  return trashedCount
}

function readLinks(db: DatabaseSync): readonly LinkRow[] {
  return db.prepare(
    `SELECT
       l.woo_product_id, l.woo_variation_id, l.canonical_variant_id, l.selected_offer_id,
       ask.atomic_sku_id, sp.supplier_id, sp.supplier_product_id, so.supplier_option_id,
       sp.source_product_id, so.source_option_id, sp.original_title,
       so.original_option_name, sp.detail_url, no.final_cost AS stored_final_cost,
       no.status AS normalized_status, no.promotion_flag, no.sold_out_flag,
       ask.status AS atomic_status,
       (SELECT oph.final_cost
          FROM offer_price_history oph
         WHERE oph.atomic_sku_id = ask.atomic_sku_id
         ORDER BY oph.observed_at DESC
         LIMIT 1) AS history_final_cost
     FROM woo_variation_offer_links l
     JOIN normalized_offers no ON no.normalized_offer_id = l.selected_offer_id
     JOIN atomic_supplier_skus ask ON ask.atomic_sku_id = no.atomic_sku_id
     JOIN supplier_products sp ON sp.supplier_product_id = ask.supplier_product_id
     JOIN supplier_options so ON so.supplier_option_id = ask.supplier_option_id
     ORDER BY l.woo_product_id, l.woo_variation_id`,
  ).all() as unknown as readonly LinkRow[]
}

async function readSnapshot(path: string, runStartedAt: string): Promise<readonly SnapshotOffer[] | null> {
  try {
    const content = await readFile(path, "utf8")
    const snapshot = SnapshotSchema.parse(JSON.parse(content))
    const ageMilliseconds = new Date(runStartedAt).getTime() - new Date(snapshot.createdAt).getTime()
    if (!Number.isFinite(ageMilliseconds) || ageMilliseconds < 0 || ageMilliseconds > 30 * 60_000) {
      console.warn(`Snapshot at ${path} is too old or invalid: ${ageMilliseconds}ms`)
      return null
    }
    return snapshot.products.map((product) => {
      const raw = safeObject(product.rawJson)
      return {
        supplierId: product.supplierId,
        sourceProductId: stringValue(raw["sourceProductId"]),
        sourceOptionId: stringValue(raw["sourceOptionId"]),
        originalProductName: product.originalProductName,
        originalOptionName: product.originalOptionName ?? "기본",
        price: product.price + product.shippingFee,
        shippingFee: product.shippingFee,
        stockStatus: product.stockStatus,
        productUrl: product.productUrl,
        sourceHash: sha256(product.rawJson),
        observedAt: snapshot.createdAt,
      }
    }).filter((row) => row.sourceProductId.length > 0 && row.sourceOptionId.length > 0)
  } catch (error) {
    console.warn(`Failed to read or parse snapshot at ${path}:`, error)
    return null
  }
}

async function readPlan(path: string): Promise<z.infer<typeof PlanSchema>> {
  return PlanSchema.parse(JSON.parse(await readFile(path, "utf8")))
}

function persistCandidates(db: DatabaseSync, runId: string, candidates: readonly Candidate[]): readonly number[] {
  const insert = db.prepare(
    `INSERT INTO price_sync_candidates (
       run_id, supplier_id, supplier_product_id, supplier_option_id,
       atomic_supplier_sku_id, selected_offer_id, woo_product_id, woo_variation_id,
       original_product_name, original_option_name, previous_supplier_cost,
       observed_supplier_cost, current_woo_price, calculated_woo_price,
       classification, reason, source_url, source_hash, observed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, supplier_id, woo_variation_id, selected_offer_id, supplier_option_id) DO UPDATE SET
       observed_supplier_cost = excluded.observed_supplier_cost,
       calculated_woo_price = excluded.calculated_woo_price,
       observed_at = excluded.observed_at`,
  )
  const ids: number[] = []
  db.exec("BEGIN IMMEDIATE")
  try {
    for (const row of candidates) {
      const result = insert.run(
        runId, row.supplierId, row.supplierProductId, row.supplierOptionId,
        row.atomicSkuId, row.selectedOfferId, row.wooProductId, row.wooVariationId,
        row.originalProductName, row.originalOptionName, row.previousSupplierCost,
        row.observedSupplierCost, row.currentWooPrice, row.calculatedWooPrice,
        row.classification, row.reason, row.sourceUrl, row.sourceHash, row.observedAt,
      )
      ids.push(Number(result.lastInsertRowid))
    }
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
  return ids
}

function persistHeld(db: DatabaseSync, runId: string, candidateId: number, candidate: Candidate): void {
  db.prepare(
    `INSERT OR REPLACE INTO price_sync_results (
       run_id, candidate_id, woo_product_id, woo_variation_id, status,
       old_woo_price, new_woo_price, verified_woo_price, applied_at, error_message
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    runId, candidateId, candidate.wooProductId ?? 0, candidate.wooVariationId ?? 0,
    candidate.classification === "no_change" ? "no_change" : "held",
    candidate.currentWooPrice, candidate.calculatedWooPrice, candidate.currentWooPrice,
    null, candidate.classification === "no_change" ? null : candidate.reason,
  )
  if (!["ready_to_apply", "no_change"].includes(candidate.classification))
    db.prepare(
      `INSERT OR REPLACE INTO price_sync_issues (
         run_id, candidate_id, issue_type, supplier_id, woo_product_id,
         woo_variation_id, original_product_name, original_option_name, detail
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      runId, candidateId, candidate.classification, candidate.supplierId,
      candidate.wooProductId, candidate.wooVariationId,
      candidate.originalProductName, candidate.originalOptionName, candidate.reason,
    )
}

function persistApplyResult(
  db: DatabaseSync,
  runId: string,
  candidateId: number,
  candidate: Candidate,
  result: Awaited<ReturnType<typeof applyCandidate>>,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO price_sync_results (
       run_id, candidate_id, woo_product_id, woo_variation_id, status,
       old_woo_price, new_woo_price, verified_woo_price, applied_at, error_message
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    runId, candidateId, candidate.wooProductId ?? 0, candidate.wooVariationId ?? 0,
    result.ok ? "applied" : "apply_failed", candidate.currentWooPrice,
    candidate.calculatedWooPrice, result.ok ? result.verifiedPrice : null,
    result.ok ? new Date().toISOString() : null, result.ok ? null : result.error,
  )
  if (!result.ok)
    db.prepare(
      `INSERT OR REPLACE INTO price_sync_issues (
         run_id, candidate_id, issue_type, supplier_id, woo_product_id,
         woo_variation_id, original_product_name, original_option_name, detail
       ) VALUES (?, ?, 'apply_failed', ?, ?, ?, ?, ?, ?)`,
    ).run(
      runId, candidateId, candidate.supplierId, candidate.wooProductId,
      candidate.wooVariationId, candidate.originalProductName,
      candidate.originalOptionName, result.error,
    )
}

function persistPriceHistory(
  db: DatabaseSync,
  runId: string,
  candidates: readonly Candidate[],
  changes: readonly AppliedChange[],
  observedAt: string,
): number {
  const changedVariations = new Set(changes.map((row) => row.variation_id))
  let baselines = 0
  const insert = db.prepare(
    `INSERT OR IGNORE INTO price_sync_price_history (
       run_id, supplier_id, atomic_supplier_sku_id, selected_offer_id,
       woo_product_id, woo_variation_id, old_supplier_cost, new_supplier_cost,
       old_woo_price, new_woo_price, pricing_rule_version, observed_at,
       applied_at, source_hash, event_type
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const row of candidates) {
    if (
      row.selectedOfferId === null ||
      row.wooProductId === null ||
      row.wooVariationId === null ||
      row.observedSupplierCost === null ||
      !["ready_to_apply", "no_change"].includes(row.classification)
    ) continue
    const eventType =
      row.previousSupplierCost === null ? "baseline_created" :
      row.previousSupplierCost !== row.observedSupplierCost ? "price_changed" : null
    if (eventType === null && !changedVariations.has(row.wooVariationId)) continue
    if (eventType === "baseline_created") baselines += 1
    insert.run(
      runId, row.supplierId, row.atomicSkuId, row.selectedOfferId,
      row.wooProductId, row.wooVariationId, row.previousSupplierCost,
      row.observedSupplierCost, row.currentWooPrice, row.calculatedWooPrice,
      PRICING_RULE_VERSION, observedAt,
      changedVariations.has(row.wooVariationId) ? new Date().toISOString() : null,
      row.sourceHash, eventType ?? "price_changed",
    )
  }
  return baselines
}

function ensureSchema(db: DatabaseSync, migrationPath: string): void {
  const sql = readFileSync(migrationPath, "utf8")
  db.exec("BEGIN IMMEDIATE")
  try {
    db.exec(sql)
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

function beginRun(db: DatabaseSync, runId: string, now: string): void {
  db.prepare(
    `INSERT INTO price_sync_runs (
       run_id, scheduled_at, started_at, status, current_stage
     ) VALUES (?, ?, ?, 'running', 'crawl_started')
     ON CONFLICT(run_id) DO UPDATE SET
       started_at = excluded.started_at,
       status = 'running',
       current_stage = 'crawl_started',
       error_message = NULL`,
  ).run(runId, now, now)
  db.prepare("DELETE FROM price_sync_issues WHERE run_id = ? AND candidate_id NOT IN (SELECT candidate_id FROM price_sync_results WHERE run_id = ? AND status = 'applied')").run(runId, runId)
  db.prepare("DELETE FROM price_sync_results WHERE run_id = ? AND status != 'applied'").run(runId)
  db.prepare("DELETE FROM price_sync_candidates WHERE run_id = ? AND candidate_id NOT IN (SELECT candidate_id FROM price_sync_results WHERE run_id = ? AND status = 'applied')").run(runId, runId)
}

function setStage(db: DatabaseSync, runId: string, stage: string): void {
  db.prepare("UPDATE price_sync_runs SET current_stage = ? WHERE run_id = ?").run(stage, runId)
}
function finishRun(
  db: DatabaseSync,
  runId: string,
  totals: { status: string; checked: number; changed: number; applied: number; failed: number; held: number; baseline: number },
): void {
  db.prepare(
    `UPDATE price_sync_runs SET
       completed_at = ?, status = ?, current_stage = 'verify_completed',
       checked_count = ?, changed_count = ?, applied_count = ?, failed_count = ?,
       held_count = ?, baseline_created_count = ?
     WHERE run_id = ?`,
  ).run(
    new Date().toISOString(), totals.status, totals.checked, totals.changed,
    totals.applied, totals.failed, totals.held, totals.baseline, runId,
  )
}
function failRun(db: DatabaseSync, runId: string, error: string): void {
  db.prepare(
    `UPDATE price_sync_runs SET completed_at = ?, status = 'failed',
       error_message = ? WHERE run_id = ?`,
  ).run(new Date().toISOString(), error.slice(0, 1000), runId)
}

function buildReport(
  runId: string,
  runAt: string,
  status: string,
  candidates: readonly Candidate[],
  changes: readonly AppliedChange[],
  failed: number,
  executed: boolean,
) {
  const issueCounts = Object.fromEntries(
    CLASSIFICATIONS.filter((value) => !["ready_to_apply", "no_change"].includes(value))
      .map((value) => [value, candidates.filter((row) => row.classification === value).length])
      .filter(([, count]) => Number(count) > 0),
  )
  const suppliers = ["dailyfood", "walldob2b"].map((supplier) => ({
    supplier_id: supplier,
    checked_count: candidates.filter((row) => row.supplierId === supplier).length,
    changed_count: candidates.filter((row) => row.supplierId === supplier && row.classification === "ready_to_apply").length,
    applied_count: changes.filter((row) => {
      const candidate = candidates.find((item) => item.wooVariationId === row.variation_id)
      return candidate?.supplierId === supplier
    }).length,
    held_count: candidates.filter(
      (row) => row.supplierId === supplier && !["ready_to_apply", "no_change"].includes(row.classification),
    ).length,
  }))
  return {
    report_id: sha256(`${runId}|${status}|${runAt}`),
    run_id: runId,
    run_at: runAt,
    pipeline_status: executed ? status : "dry_run",
    supplier_summaries: suppliers,
    totals: {
      checked_count: candidates.length,
      price_change_detected: candidates.filter((row) => row.classification === "ready_to_apply").length,
      applied_count: changes.length,
      failed_count: failed,
      no_change_count: candidates.filter((row) => row.classification === "no_change").length,
      held_count: candidates.filter((row) => !["ready_to_apply", "no_change"].includes(row.classification)).length,
    },
    issue_counts: issueCounts,
    issue_examples: candidates
      .filter((row) => !["ready_to_apply", "no_change"].includes(row.classification))
      .slice(0, 10)
      .map((row) => ({
        classification: row.classification,
        supplier_id: row.supplierId,
        product_name: row.originalProductName,
        option_name: row.originalOptionName,
        reason: row.reason,
      })),
    product_count: new Set(changes.map((row) => row.product_id)).size,
    change_count: changes.length,
    changes,
  }
}
function buildFailureReport(runId: string, runAt: string, error: string) {
  return {
    report_id: sha256(`${runId}|failed|${runAt}`),
    run_id: runId,
    run_at: runAt,
    pipeline_status: "failed",
    supplier_summaries: [],
    totals: {
      checked_count: 0, price_change_detected: 0, applied_count: 0,
      failed_count: 1, no_change_count: 0, held_count: 0,
    },
    issue_counts: { pipeline_failed: 1 },
    issue_examples: [{ classification: "pipeline_failed", reason: error.slice(0, 500) }],
    product_count: 0,
    change_count: 0,
    changes: [],
  }
}

function parseArgs(args: readonly string[]) {
  const values = new Map<string, string>()
  let execute = false
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    if (key === "--execute") {
      execute = true
      continue
    }
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--"))
      throw new Error(`invalid argument: ${key ?? "unknown"}`)
    values.set(key, value)
    index += 1
  }
  return {
    execute,
    runId: values.get("--run-id") ?? "",
    planPath: values.get("--plan") ?? "reports/mvp-sync-plan.json",
    dbPath: values.get("--db") ?? "/home/tnfwod/avocadoss-wordpress/wp_data/wp-content/uploads/wholesalehub/wholesalehub.sqlite",
    migrationPath: values.get("--migration") ?? "migrations/003_price_sync_pipeline.sql",
    dailySnapshot: values.get("--daily-snapshot") ?? "reports/snapshots/dailyfood-latest-success.json",
    walldoSnapshot: values.get("--walldo-snapshot") ?? "reports/snapshots/walldob2b-latest-success.json",
    outputPath: values.get("--out") ?? "reports/mvp-price-change-telegram-report.json",
  }
}

function sourceKey(offer: SnapshotOffer): string {
  return `${offer.supplierId}|${offer.sourceProductId}|${offer.sourceOptionId}`
}
function validPrice(value: number): boolean {
  return Number.isFinite(value) && value >= 1000
}
function numberOrNull(value: string): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
function safeObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : ""
}
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
function kstStamp(value: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(value).replace(/[-: ]/gu, "").slice(0, 12)
}
async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
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
      if (match?.[1] !== undefined && process.env[match[1]] === undefined)
        process.env[match[1]] = match[2] ?? ""
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = process.exitCode || 1
})
