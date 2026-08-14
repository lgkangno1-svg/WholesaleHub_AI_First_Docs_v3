import { mkdir, rename, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { pathToFileURL } from "node:url"
import { SUPPLIER_LANE_MODE_FLAG, supplierLaneModeEnabled } from "../supplier-lane/model.js"
import {
  type LaneOfferState,
  type ProjectionParentLink,
  planApprovedParentProjection,
  planSupplierLane,
  type SnapshotLaneOption,
  type SupplierLanePlan,
} from "../supplier-lane/planner.js"
import {
  evaluateSupplierSnapshotV2,
  hashCanonical,
  type P2Supplier,
  readSupplierSnapshotV2,
  type SupplierSnapshotGate,
  type SupplierSnapshotV2,
} from "./supplier-snapshot-v2.js"

type Options = {
  readonly mode: "no-write" | "execute"
  readonly runId: string
  readonly pipelineRunId: string
  readonly dbPath: string
  readonly dailySnapshot: string
  readonly walldoSnapshot: string
  readonly sourceGitCommit: string
  readonly distGitCommit: string
  readonly planFile: string
  readonly resultFile: string
  readonly confirmExecute: boolean
  readonly expectedPlanHash: string | null
  readonly nowMs: number
  readonly maxAgeMs: number
  readonly absoluteMinimum: Readonly<Record<P2Supplier, number>>
  readonly bootstrapMaximum: Readonly<Record<P2Supplier, number>>
  readonly previousCompleteOptionCount: Readonly<Record<P2Supplier, number | null>>
}

type LaneResult = {
  readonly schemaVersion: 2
  readonly contract: "supplier_lane_checkout"
  readonly runId: string
  readonly mode: "no-write" | "execute"
  readonly processStatus: "completed" | "failed"
  readonly businessStatus:
    | "success"
    | "no_change"
    | "partial_success"
    | "blocked_no_write"
    | "failed"
  readonly fatal: boolean
  readonly stage: string
  readonly mutationAllowed: boolean
  readonly sourceGitCommit: string
  readonly distGitCommit: string
  readonly pipelineRunId: string
  readonly planHash: string
  readonly suppliers: Readonly<Record<P2Supplier, SupplierSnapshotGate>>
  readonly counts: {
    readonly checked: number
    readonly noChange: number
    readonly held: number
    readonly dbWrites: number
    readonly wooWrites: number
    readonly parentLinksChecked: number
    readonly laneAOffersChecked: number
    readonly laneBOffersChecked: number
    readonly exactPriceUpdatesPlanned: number
    readonly exactStockUpdatesPlanned: number
    readonly pendingNewOptions: number
    readonly unavailableOffers: number
    readonly variationsCreated: number
    readonly variationsUpdated: number
    readonly customerExposureViolations: number
    readonly activeBlocking: number
    readonly terminalExcluded: number
    readonly crossSupplierMatches: 0
    readonly winnerSelections: 0
    readonly selectedOfferSwitches: 0
    readonly parentTrashWrites: 0
    readonly newIntents: number
  }
  readonly artifacts: {
    readonly resultFile: string
    readonly planFile: string
    readonly snapshots: readonly string[]
  }
  readonly errors: readonly { readonly code: string; readonly message: string }[]
}

export async function runSupplierLaneSyncCli(args: readonly string[]): Promise<number> {
  let options: Options
  try {
    options = parseArgs(args)
    validateExecutionGate(options)
  } catch (error) {
    const fallback = fatalResult(args, error)
    await emit(fallback, fallback.artifacts.resultFile)
    return 3
  }

  let database: DatabaseSync | null = null
  try {
    const loaded = await loadSnapshots(options)
    database = new DatabaseSync(resolve(options.dbPath), { readOnly: options.mode === "no-write" })
    const existing = readOffers(database)
    const repositoryCounts = readRepositoryCounts(database)
    const plans = (["dailyfood", "walldob2b"] as const).map((supplier) =>
      planSupplierLane({
        supplier,
        gate: loaded[supplier].gate,
        existing,
        incoming:
          loaded[supplier].snapshot === null ? [] : snapshotOptions(loaded[supplier].snapshot),
      }),
    )
    const projectionIncoming = (["dailyfood", "walldob2b"] as const).flatMap((supplier) => {
      const loadedSupplier = loaded[supplier]
      return loadedSupplier.snapshot !== null && loadedSupplier.gate.mutationAllowed
        ? snapshotOptions(loadedSupplier.snapshot)
        : []
    })
    const wooProjection = planApprovedParentProjection({
      parentLinks: readProjectionParentLinks(database),
      existingOffers: existing,
      incoming: projectionIncoming,
    })
    const planDocument = {
      schemaVersion: 1,
      runId: options.runId,
      pipelineRunId: options.pipelineRunId,
      sourceGitCommit: options.sourceGitCommit,
      plans,
      wooProjection,
    }
    const planHash = hashCanonical({ ...planDocument, runId: "" })
    if (
      options.mode === "execute" &&
      (options.expectedPlanHash === null || options.expectedPlanHash !== planHash)
    ) {
      throw new Error("execute_plan_hash_mismatch")
    }
    await atomicJson(options.planFile, { ...planDocument, planHash })
    const applied =
      options.mode === "execute"
        ? applyDatabaseActions(database, plans, loaded, options.pipelineRunId)
        : { dbWrites: 0, variationsUpdated: 0 }
    const result = buildResult(options, loaded, plans, planHash, applied, repositoryCounts)
    await emit(result, options.resultFile)
    return result.processStatus === "completed" ? 0 : 2
  } catch (error) {
    const result = fatalResult(args, error)
    await emit(result, options.resultFile)
    return 10
  } finally {
    database?.close()
  }
}

export function parseArgs(args: readonly string[]): Options {
  const required = (name: string): string => {
    const value = argument(args, name)
    if (value === null || value.length === 0) throw new Error(`${name} is required`)
    return value
  }
  const mode = required("--mode")
  if (mode !== "no-write" && mode !== "execute")
    throw new Error("--mode must be no-write or execute")
  return {
    mode,
    runId: required("--run-id"),
    pipelineRunId: required("--pipeline-run-id"),
    dbPath: required("--db-path"),
    dailySnapshot: required("--daily-snapshot"),
    walldoSnapshot: required("--walldo-snapshot"),
    sourceGitCommit: required("--source-git-commit"),
    distGitCommit: required("--dist-git-commit"),
    planFile: required("--plan-file"),
    resultFile: required("--result-file"),
    confirmExecute: args.includes("--confirm-execute"),
    expectedPlanHash: argument(args, "--plan-hash"),
    nowMs: nonnegativeInteger(args, "--now-ms", Date.now()),
    maxAgeMs: positiveInteger(args, "--max-age-ms", 30 * 60 * 1000),
    absoluteMinimum: {
      dailyfood: nonnegativeInteger(args, "--daily-minimum", 400),
      walldob2b: nonnegativeInteger(args, "--walldo-minimum", 180),
    },
    bootstrapMaximum: {
      dailyfood: positiveInteger(args, "--daily-maximum", 1500),
      walldob2b: positiveInteger(args, "--walldo-maximum", 500),
    },
    previousCompleteOptionCount: {
      dailyfood: optionalNonnegativeInteger(args, "--daily-previous-count"),
      walldob2b: optionalNonnegativeInteger(args, "--walldo-previous-count"),
    },
  }
}

function readProjectionParentLinks(database: DatabaseSync): readonly ProjectionParentLink[] {
  if (
    database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'supplier_lane_parent_links'",
      )
      .get() === undefined
  ) {
    return []
  }
  return database
    .prepare(
      `SELECT id, woo_parent_id AS wooParentId, supplier_id AS supplierId,
        lane_code AS laneCode, source_product_id AS sourceProductId, status
       FROM supplier_lane_parent_links
       ORDER BY woo_parent_id, lane_code`,
    )
    .all() as ProjectionParentLink[]
}

function validateExecutionGate(options: Options): void {
  if (options.sourceGitCommit !== options.distGitCommit) {
    throw new Error("runtime_source_dist_mismatch")
  }
  if (options.mode === "execute") {
    if (!options.confirmExecute) throw new Error("execute_requires_confirm_execute")
    if (!supplierLaneModeEnabled()) {
      throw new Error(`execute_requires_${SUPPLIER_LANE_MODE_FLAG}=1`)
    }
    if (options.expectedPlanHash === null) throw new Error("execute_requires_plan_hash")
  }
}

async function loadSnapshots(options: Options) {
  const load = async (path: string, supplier: P2Supplier) => {
    try {
      const snapshot = await readSupplierSnapshotV2(path)
      const gate = evaluateSupplierSnapshotV2(snapshot, {
        expectedPipelineRunId: options.pipelineRunId,
        previousCompleteOptionCount: options.previousCompleteOptionCount[supplier],
        absoluteMinimum: options.absoluteMinimum[supplier],
        bootstrapMaximum: options.bootstrapMaximum[supplier],
        nowMs: options.nowMs,
        maxAgeMs: options.maxAgeMs,
      })
      return { snapshot, gate, path: resolve(path) }
    } catch (error) {
      return {
        snapshot: null,
        gate: {
          status: "incomplete" as const,
          reasons: [`snapshot_invalid:${message(error)}`],
          mutationAllowed: false,
          productCount: 0,
          optionCount: 0,
          snapshotHash: null,
        },
        path: resolve(path),
      }
    }
  }
  const [dailyfood, walldob2b] = await Promise.all([
    load(options.dailySnapshot, "dailyfood"),
    load(options.walldoSnapshot, "walldob2b"),
  ])
  return { dailyfood, walldob2b }
}

function readOffers(database: DatabaseSync): readonly LaneOfferState[] {
  if (
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'supplier_lane_offers'")
      .get() === undefined
  ) {
    return []
  }
  return database
    .prepare(
      `SELECT
        id, supplier_id AS supplierId, source_product_id AS sourceProductId,
        source_option_id AS sourceOptionId, woo_parent_id AS wooParentId,
        woo_variation_id AS wooVariationId, public_option_label AS publicOptionLabel,
        hard_spec_fingerprint AS hardSpecFingerprint, source_cost AS sourceCost,
        stock_status AS stockStatus, approval_status AS approvalStatus,
        lifecycle_status AS lifecycleStatus, missing_complete_count AS missingCompleteCount
       FROM supplier_lane_offers ORDER BY supplier_id, source_product_id, source_option_id`,
    )
    .all() as LaneOfferState[]
}

function readRepositoryCounts(database: DatabaseSync): {
  readonly parentLinksChecked: number
  readonly terminalExcluded: number
} {
  const tableExists = (name: string): boolean =>
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  return {
    parentLinksChecked: tableExists("supplier_lane_parent_links")
      ? Number(
          (
            database.prepare("SELECT COUNT(*) AS count FROM supplier_lane_parent_links").get() as {
              count: number
            }
          ).count,
        )
      : 0,
    terminalExcluded: tableExists("supplier_lane_offers")
      ? Number(
          (
            database
              .prepare(
                "SELECT COUNT(*) AS count FROM supplier_lane_offers WHERE lifecycle_status = 'terminal'",
              )
              .get() as { count: number }
          ).count,
        )
      : 0,
  }
}

function snapshotOptions(snapshot: SupplierSnapshotV2): readonly SnapshotLaneOption[] {
  return snapshot.products.flatMap((product) => {
    const raw = safeJson(product.rawJson)
    const sourceProductId =
      product.sourceProductId ?? stringValue(raw["sourceProductId"] ?? raw["source_product_id"])
    const sourceOptionId =
      product.sourceOptionId ?? stringValue(raw["sourceOptionId"] ?? raw["source_option_id"])
    if (sourceProductId === null || sourceOptionId === null) return []
    const fingerprint =
      stringValue(raw["hardSpecFingerprint"] ?? raw["hard_spec_fingerprint"]) ??
      hashCanonical({ sourceOptionId, option: product.originalOptionName ?? "" })
    return [
      {
        supplierId: snapshot.supplier,
        sourceProductId,
        sourceOptionId,
        atomicSupplierSkuId:
          stringValue(raw["atomicSupplierSkuId"] ?? raw["atomic_supplier_sku_id"]) ??
          hashCanonical({ supplier: snapshot.supplier, sourceProductId, sourceOptionId }).slice(
            0,
            24,
          ),
        optionLabel: product.originalOptionName ?? product.originalProductName,
        hardSpecFingerprint: fingerprint,
        sourceCost: product.price,
        shippingCost: product.shippingFee,
        stockStatus: product.stockStatus,
      },
    ]
  })
}

function applyDatabaseActions(
  database: DatabaseSync,
  plans: readonly SupplierLanePlan[],
  loaded: Awaited<ReturnType<typeof loadSnapshots>>,
  pipelineRunId: string,
): { readonly dbWrites: number; readonly variationsUpdated: number } {
  let dbWrites = 0
  let variationsUpdated = 0
  database.exec("BEGIN IMMEDIATE")
  try {
    for (const plan of plans) {
      if (!plan.mutationAuthority) continue
      const snapshot = loaded[plan.supplier].snapshot
      if (snapshot === null || snapshot.pipelineRunId !== pipelineRunId) {
        throw new Error(`execute_pipeline_run_mismatch:${plan.supplier}`)
      }
      for (const action of plan.actions) {
        if (action.kind === "mark_missing") {
          dbWrites += Number(
            database
              .prepare("UPDATE supplier_lane_offers SET missing_complete_count = ? WHERE id = ?")
              .run(action.missingCount, action.offerId).changes,
          )
        } else if (action.kind === "mark_unavailable") {
          dbWrites += Number(
            database
              .prepare(
                `UPDATE supplier_lane_offers
                 SET lifecycle_status = 'unavailable', stock_status = 'outofstock'
                 WHERE id = ?`,
              )
              .run(action.offerId).changes,
          )
        } else if (action.kind === "update_exact") {
          variationsUpdated += 1
        }
      }
    }
    database.exec("COMMIT")
  } catch (error) {
    database.exec("ROLLBACK")
    throw error
  }
  return { dbWrites, variationsUpdated }
}

function buildResult(
  options: Options,
  loaded: Awaited<ReturnType<typeof loadSnapshots>>,
  plans: readonly SupplierLanePlan[],
  planHash: string,
  applied: { readonly dbWrites: number; readonly variationsUpdated: number },
  repositoryCounts: { readonly parentLinksChecked: number; readonly terminalExcluded: number },
): LaneResult {
  const a = plans.find((plan) => plan.supplier === "dailyfood")
  const b = plans.find((plan) => plan.supplier === "walldob2b")
  if (a === undefined || b === undefined) throw new Error("supplier_plan_missing")
  const checked = a.counts.checked + b.counts.checked
  const held = [a, b]
    .filter((plan) => !plan.mutationAuthority)
    .reduce((sum, plan) => sum + plan.counts.checked, 0)
  const planned = plans.reduce((sum, plan) => sum + plan.actions.length, 0)
  const complete = plans.filter((plan) => plan.mutationAuthority).length
  return {
    schemaVersion: 2,
    contract: "supplier_lane_checkout",
    runId: options.runId,
    mode: options.mode,
    processStatus: complete === 2 ? "completed" : "failed",
    businessStatus:
      complete === 0
        ? "blocked_no_write"
        : complete === 1
          ? "partial_success"
          : planned + applied.dbWrites > 0
            ? "success"
            : "no_change",
    fatal: false,
    stage: options.mode === "execute" ? "execute_completed" : "no_write_completed",
    mutationAllowed: options.mode === "execute" && complete > 0,
    sourceGitCommit: options.sourceGitCommit,
    distGitCommit: options.distGitCommit,
    pipelineRunId: options.pipelineRunId,
    planHash,
    suppliers: { dailyfood: loaded.dailyfood.gate, walldob2b: loaded.walldob2b.gate },
    counts: {
      checked,
      noChange: checked - planned,
      held,
      dbWrites: applied.dbWrites,
      wooWrites: 0,
      parentLinksChecked: repositoryCounts.parentLinksChecked,
      laneAOffersChecked: a.counts.checked,
      laneBOffersChecked: b.counts.checked,
      exactPriceUpdatesPlanned:
        a.counts.exactPriceUpdatesPlanned + b.counts.exactPriceUpdatesPlanned,
      exactStockUpdatesPlanned:
        a.counts.exactStockUpdatesPlanned + b.counts.exactStockUpdatesPlanned,
      pendingNewOptions: a.counts.pendingNewOptions + b.counts.pendingNewOptions,
      unavailableOffers: a.counts.unavailableOffers + b.counts.unavailableOffers,
      variationsCreated: 0,
      variationsUpdated: applied.variationsUpdated,
      customerExposureViolations: 0,
      activeBlocking: 0,
      terminalExcluded: repositoryCounts.terminalExcluded,
      crossSupplierMatches: 0,
      winnerSelections: 0,
      selectedOfferSwitches: 0,
      parentTrashWrites: 0,
      newIntents: 0,
    },
    artifacts: {
      resultFile: resolve(options.resultFile),
      planFile: resolve(options.planFile),
      snapshots: [resolve(options.dailySnapshot), resolve(options.walldoSnapshot)],
    },
    errors: [],
  }
}

function fatalResult(args: readonly string[], error: unknown): LaneResult {
  const emptyGate: SupplierSnapshotGate = {
    status: "incomplete",
    reasons: [],
    mutationAllowed: false,
    productCount: 0,
    optionCount: 0,
    snapshotHash: null,
  }
  return {
    schemaVersion: 2,
    contract: "supplier_lane_checkout",
    runId: argument(args, "--run-id") ?? "invalid-run",
    mode: argument(args, "--mode") === "execute" ? "execute" : "no-write",
    processStatus: "failed",
    businessStatus: "failed",
    fatal: true,
    stage: "invalid_configuration",
    mutationAllowed: false,
    sourceGitCommit: argument(args, "--source-git-commit") ?? "",
    distGitCommit: argument(args, "--dist-git-commit") ?? "",
    pipelineRunId: argument(args, "--pipeline-run-id") ?? "",
    planHash: "",
    suppliers: { dailyfood: emptyGate, walldob2b: emptyGate },
    counts: {
      checked: 0,
      noChange: 0,
      held: 0,
      dbWrites: 0,
      wooWrites: 0,
      parentLinksChecked: 0,
      laneAOffersChecked: 0,
      laneBOffersChecked: 0,
      exactPriceUpdatesPlanned: 0,
      exactStockUpdatesPlanned: 0,
      pendingNewOptions: 0,
      unavailableOffers: 0,
      variationsCreated: 0,
      variationsUpdated: 0,
      customerExposureViolations: 0,
      activeBlocking: 0,
      terminalExcluded: 0,
      crossSupplierMatches: 0,
      winnerSelections: 0,
      selectedOfferSwitches: 0,
      parentTrashWrites: 0,
      newIntents: 0,
    },
    artifacts: {
      resultFile: resolve(argument(args, "--result-file") ?? "supplier-lane-result.json"),
      planFile: resolve(argument(args, "--plan-file") ?? "supplier-lane-plan.json"),
      snapshots: [],
    },
    errors: [{ code: "supplier_lane_failed", message: message(error) }],
  }
}

async function emit(result: LaneResult, path: string): Promise<void> {
  await atomicJson(path, result)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  const temporary = `${absolute}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  await rename(temporary, absolute)
}

function argument(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name)
  return index < 0 ? null : (args[index + 1] ?? null)
}

function nonnegativeInteger(args: readonly string[], name: string, fallback: number): number {
  const raw = argument(args, name)
  if (raw === null) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${name} must be a nonnegative integer`)
  return value
}

function positiveInteger(args: readonly string[], name: string, fallback: number): number {
  const value = nonnegativeInteger(args, name, fallback)
  if (value === 0) throw new Error(`${name} must be a positive integer`)
  return value
}

function optionalNonnegativeInteger(args: readonly string[], name: string): number | null {
  return argument(args, name) === null ? null : nonnegativeInteger(args, name, 0)
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runSupplierLaneSyncCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
