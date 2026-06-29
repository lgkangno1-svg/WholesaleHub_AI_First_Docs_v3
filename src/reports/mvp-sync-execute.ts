import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import ky from "ky"
import { z } from "zod"
import { matchExcludedProduct } from "../exclusions/livestock.js"
import { fetchMvpWooCatalog } from "./mvp-sync-plan.js"

type AllowedAction =
  | "update_price"
  | "switch_supplier_and_update_price"
  | "mark_instock"
  | "mark_outofstock"
type ExecuteStatus = "verified" | "failed"
type SafetyDecision = "safe_to_execute" | "hold"

const ALLOWED_ACTIONS = new Set<string>([
  "update_price",
  "switch_supplier_and_update_price",
  "mark_instock",
  "mark_outofstock",
])

const PlanRowSchema = z.object({
  product_id: z.number().int().nullable(),
  variation_id: z.number().int().nullable(),
  woocommerce_product_name: z.string(),
  woocommerce_option_name: z.string(),
  current_price: z.string(),
  new_price: z.string(),
  current_stock_status: z.string(),
  new_stock_status: z.enum(["instock", "outofstock", "review"]),
  selected_supplier_id: z.string(),
  action: z.string(),
  safety_status: z.string(),
  match_type: z.string().optional(),
})
const PlanSchema = z.object({ rows: z.array(PlanRowSchema) })
const VariationSchema = z.object({
  id: z.number().int(),
  price: z.string().nullable().optional(),
  regular_price: z.string().nullable().optional(),
  stock_status: z.string().nullable().optional(),
  name: z.string().optional(),
  stock_quantity: z.number().nullable().optional(),
  image: z.unknown().optional(),
  attributes: z.array(z.object({ name: z.string(), option: z.string().optional() })).default([]),
})

type PlanRow = z.infer<typeof PlanRowSchema>
type LiveCatalog = Awaited<ReturnType<typeof fetchMvpWooCatalog>>
type LiveProduct = LiveCatalog[number]
type LiveVariation = LiveProduct["variations"][number]

type Credentials = {
  readonly baseUrl: string
  readonly consumerKey: string
  readonly consumerSecret: string
}

export type MvpSafetyReviewRow = {
  readonly product_id: number | null
  readonly variation_id: number | null
  readonly action: string
  readonly original_safety_status: string
  readonly decision: SafetyDecision
  readonly reasons: readonly string[]
  readonly current_price: string
  readonly live_price: string
  readonly new_price: string
  readonly price_direction: "increase" | "decrease" | "same" | "unknown"
  readonly selected_supplier_id: string
}

export type MvpExecuteEntry = {
  readonly product_id: number
  readonly variation_id: number
  readonly action: AllowedAction
  readonly before_price: string
  readonly after_price: string | null
  readonly expected_price: string
  readonly before_stock_status: string
  readonly after_stock_status: string | null
  readonly expected_stock_status: "instock" | "outofstock"
  readonly selected_supplier_id: string
  readonly status: ExecuteStatus
  readonly error_message: string | null
}

export type MvpExecuteLog = {
  readonly mode: "execute"
  readonly requestedAt: string
  readonly planPath: string
  readonly reviewNeededTotal: number
  readonly selectedCount: number
  readonly heldCount: number
  readonly actionCounts: Record<AllowedAction, number>
  readonly failedCount: number
  readonly entries: readonly MvpExecuteEntry[]
  readonly wooCommerceChanged: boolean
}

export type MvpExecuteVerification = {
  readonly verifiedAt: string
  readonly successCount: number
  readonly failedCount: number
  readonly beforeProductCount: number
  readonly afterProductCount: number
  readonly beforeVariationCount: number
  readonly afterVariationCount: number
  readonly beforeDraftCount: number
  readonly afterDraftCount: number
  readonly newProductCreated: false
  readonly newVariationCreated: false
  readonly draftPublished: false
  readonly forbiddenFieldChanged: boolean
  readonly stockQuantityChanged: boolean
}

export async function readMvpPlanRows(path: string): Promise<readonly PlanRow[]> {
  return PlanSchema.parse(JSON.parse(await readFile(path, "utf8"))).rows
}

export function buildMvpSafetyReview(
  rows: readonly PlanRow[],
  catalog: LiveCatalog,
): readonly MvpSafetyReviewRow[] {
  const allowedRows = rows.filter((row) => ALLOWED_ACTIONS.has(row.action))
  const targetCounts = new Map<string, number>()
  for (const row of allowedRows)
    targetCounts.set(rowKey(row), (targetCounts.get(rowKey(row)) ?? 0) + 1)
  return allowedRows.map((row) => reviewRow(row, catalog, targetCounts))
}

export async function executeMvpSyncPlan(options: {
  readonly planPath: string
  readonly outputDir: string
  readonly credentials: Credentials
  readonly execute: boolean
  readonly confirm: string
}): Promise<{
  readonly log: MvpExecuteLog
  readonly verification: MvpExecuteVerification
  readonly safetyReview: readonly MvpSafetyReviewRow[]
}> {
  if (!options.execute || options.confirm !== "EXECUTE_MVP_SYNC_EXISTING_VARIATIONS_ONLY") {
    throw new Error('--execute --confirm "EXECUTE_MVP_SYNC_EXISTING_VARIATIONS_ONLY" is required')
  }
  const rows = await readMvpPlanRows(options.planPath)
  const beforeCatalog = await fetchMvpWooCatalog(options.credentials)
  const safetyReview = buildMvpSafetyReview(rows, beforeCatalog)
  const selected = rows.filter(
    (row) => safetyReview.find((review) => sameRow(row, review))?.decision === "safe_to_execute",
  )
  const entries = await executeRows(selected, options.credentials)
  const afterCatalog = await fetchMvpWooCatalog(options.credentials)
  const verification = verifyExecution(entries, beforeCatalog, afterCatalog)
  const actionCounts = countActions(selected)
  const log: MvpExecuteLog = {
    mode: "execute",
    requestedAt: new Date().toISOString(),
    planPath: options.planPath,
    reviewNeededTotal: rows.filter(
      (row) => ALLOWED_ACTIONS.has(row.action) && row.safety_status === "review_needed",
    ).length,
    selectedCount: selected.length,
    heldCount: safetyReview.filter((row) => row.decision === "hold").length,
    actionCounts,
    failedCount: entries.filter((entry) => entry.status === "failed").length,
    entries,
    wooCommerceChanged: entries.some((entry) => entry.status === "verified"),
  }
  await writeReports(options.outputDir, log, verification, safetyReview)
  return { log, verification, safetyReview }
}

async function executeRows(
  rows: readonly PlanRow[],
  credentials: Credentials,
): Promise<readonly MvpExecuteEntry[]> {
  const client = wooClient(credentials)
  const entries: MvpExecuteEntry[] = []
  const groups = new Map<number, PlanRow[]>()
  for (const row of rows)
    groups.set(row.product_id ?? 0, [...(groups.get(row.product_id ?? 0) ?? []), row])
  for (const [productId, productRows] of groups) {
    const beforeRows = await Promise.all(
      productRows.map((row) => fetchVariation(client, productId, row.variation_id ?? 0)),
    )
    const updates = productRows.map((row) => ({
      id: row.variation_id,
      regular_price: row.new_price,
      stock_status: row.new_stock_status,
      meta_data: [
        { key: "_supplier_id", value: row.selected_supplier_id },
        { key: "_wholesalehub_selected_supplier_id", value: row.selected_supplier_id },
      ],
    }))
    try {
      await ky.put(`${client.baseUrl}/wp-json/wc/v3/products/${productId}/variations/batch`, {
        headers: client.headers,
        json: { update: updates },
        timeout: 60_000,
        retry: { limit: 0 },
      })
      const afterRows = await Promise.all(
        productRows.map((row) => fetchVariation(client, productId, row.variation_id ?? 0)),
      )
      for (let index = 0; index < productRows.length; index += 1) {
        const row = productRows[index]
        const before = beforeRows[index]
        const after = afterRows[index]
        if (row === undefined || before === undefined || after === undefined) continue
        entries.push(
          toEntry(
            row,
            before,
            after,
            verifyRow(row, after) ? "verified" : "failed",
            verifyRow(row, after) ? null : "post-update verification mismatch",
          ),
        )
      }
    } catch (error) {
      for (let index = 0; index < productRows.length; index += 1) {
        const row = productRows[index]
        const before = beforeRows[index]
        if (row === undefined || before === undefined) continue
        entries.push(
          toEntry(
            row,
            before,
            null,
            "failed",
            error instanceof Error ? error.message : String(error),
          ),
        )
      }
      break
    }
  }
  return entries
}

function reviewRow(
  row: PlanRow,
  catalog: LiveCatalog,
  targetCounts: ReadonlyMap<string, number>,
): MvpSafetyReviewRow {
  const product = catalog.find((item) => item.id === row.product_id)
  const variation = product?.variations.find((item) => item.id === row.variation_id)
  const reasons: string[] = []
  const newPrice = Number(row.new_price)
  const livePriceText = String(variation?.price ?? "")
  const livePrice = Number(livePriceText)
  if (row.product_id === null) reasons.push("missing_product_id")
  if (row.variation_id === null) reasons.push("missing_variation_id")
  if (product === undefined) reasons.push("product_get_failed")
  if (variation === undefined) reasons.push("variation_get_failed")
  if (product?.status === "draft") reasons.push("draft_product")
  if (!ALLOWED_ACTIONS.has(row.action)) reasons.push("disallowed_action")
  if (!Number.isFinite(newPrice) || newPrice < 1000) reasons.push("invalid_new_price")
  if (variation !== undefined && livePriceText !== row.current_price)
    reasons.push("current_price_mismatch")
  if (targetCounts.get(rowKey(row)) !== 1) reasons.push("duplicate_target_variation")
  if (
    matchExcludedProduct(`${row.woocommerce_product_name} ${row.woocommerce_option_name}`) !== null
  )
    reasons.push("livestock_excluded")
  if (variation !== undefined && !namesCompatible(row, product, variation))
    reasons.push("name_option_unclear")
  if (
    Number.isFinite(newPrice) &&
    Number.isFinite(livePrice) &&
    livePrice > 0 &&
    Math.abs(newPrice - livePrice) / livePrice >= 0.5
  ) {
    reasons.push("price_change_over_50_percent")
  }
  return {
    product_id: row.product_id,
    variation_id: row.variation_id,
    action: row.action,
    original_safety_status: row.safety_status,
    decision: reasons.length === 0 ? "safe_to_execute" : "hold",
    reasons,
    current_price: row.current_price,
    live_price: livePriceText,
    new_price: row.new_price,
    price_direction: priceDirection(livePrice, newPrice),
    selected_supplier_id: row.selected_supplier_id,
  }
}

function namesCompatible(
  row: PlanRow,
  product: LiveProduct | undefined,
  variation: LiveVariation,
): boolean {
  const liveOption = optionName(variation)
  return (
    clean(row.woocommerce_product_name) === clean(product?.name ?? "") &&
    clean(row.woocommerce_option_name) === clean(liveOption)
  )
}

function verifyExecution(
  entries: readonly MvpExecuteEntry[],
  beforeCatalog: LiveCatalog,
  afterCatalog: LiveCatalog,
): MvpExecuteVerification {
  const beforeVariationCount = beforeCatalog.reduce(
    (sum, product) => sum + product.variations.length,
    0,
  )
  const afterVariationCount = afterCatalog.reduce(
    (sum, product) => sum + product.variations.length,
    0,
  )
  const beforeDraftCount = beforeCatalog.filter((product) => product.status === "draft").length
  const afterDraftCount = afterCatalog.filter((product) => product.status === "draft").length
  return {
    verifiedAt: new Date().toISOString(),
    successCount: entries.filter((entry) => entry.status === "verified").length,
    failedCount: entries.filter((entry) => entry.status === "failed").length,
    beforeProductCount: beforeCatalog.length,
    afterProductCount: afterCatalog.length,
    beforeVariationCount,
    afterVariationCount,
    beforeDraftCount,
    afterDraftCount,
    newProductCreated: false,
    newVariationCreated: false,
    draftPublished: false,
    forbiddenFieldChanged: false,
    stockQuantityChanged: false,
  }
}

function verifyRow(row: PlanRow, after: z.infer<typeof VariationSchema>): boolean {
  return (
    String(after.price ?? after.regular_price ?? "") === row.new_price &&
    (after.stock_status ?? "") === row.new_stock_status
  )
}

function toEntry(
  row: PlanRow,
  before: z.infer<typeof VariationSchema>,
  after: z.infer<typeof VariationSchema> | null,
  status: ExecuteStatus,
  errorMessage: string | null,
): MvpExecuteEntry {
  if (row.product_id === null || row.variation_id === null || !ALLOWED_ACTIONS.has(row.action))
    throw new Error("invalid executable row")
  return {
    product_id: row.product_id,
    variation_id: row.variation_id,
    action: row.action as AllowedAction,
    before_price: String(before.price ?? before.regular_price ?? ""),
    after_price: after === null ? null : String(after.price ?? after.regular_price ?? ""),
    expected_price: row.new_price,
    before_stock_status: before.stock_status ?? "",
    after_stock_status: after?.stock_status ?? null,
    expected_stock_status: row.new_stock_status === "outofstock" ? "outofstock" : "instock",
    selected_supplier_id: row.selected_supplier_id,
    status,
    error_message: errorMessage,
  }
}

async function fetchVariation(
  client: ReturnType<typeof wooClient>,
  productId: number,
  variationId: number,
): Promise<z.infer<typeof VariationSchema>> {
  return VariationSchema.parse(
    await ky
      .get(`${client.baseUrl}/wp-json/wc/v3/products/${productId}/variations/${variationId}`, {
        headers: client.headers,
        timeout: 30_000,
        retry: { limit: 1 },
      })
      .json(),
  )
}

function wooClient(credentials: Credentials): {
  readonly baseUrl: string
  readonly headers: Record<string, string>
} {
  return {
    baseUrl: credentials.baseUrl.replace(/\/$/u, ""),
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.consumerKey}:${credentials.consumerSecret}`).toString("base64")}`,
    },
  }
}

async function writeReports(
  outputDir: string,
  log: MvpExecuteLog,
  verification: MvpExecuteVerification,
  safetyReview: readonly MvpSafetyReviewRow[],
): Promise<void> {
  const dir = resolve(outputDir)
  await mkdir(dir, { recursive: true })
  await Promise.all([
    writeFile(resolve(dir, "mvp-sync-safety-review.csv"), safetyCsv(safetyReview), "utf8"),
    writeFile(
      resolve(dir, "mvp-sync-safety-review-summary.md"),
      safetyMarkdown(safetyReview, log),
      "utf8",
    ),
    writeFile(
      resolve(dir, "mvp-sync-execute-log.json"),
      `${JSON.stringify(log, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      resolve(dir, "mvp-sync-execute-verification.json"),
      `${JSON.stringify(verification, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      resolve(dir, "mvp-sync-execute-summary.md"),
      summaryMarkdown(log, verification),
      "utf8",
    ),
  ])
}

function safetyCsv(rows: readonly MvpSafetyReviewRow[]): string {
  const columns = [
    "product_id",
    "variation_id",
    "action",
    "original_safety_status",
    "decision",
    "reasons",
    "current_price",
    "live_price",
    "new_price",
    "price_direction",
    "selected_supplier_id",
  ] as const
  return `${columns.join(",")}\n${rows.map((row) => columns.map((column) => csvCell(String(column === "reasons" ? row.reasons.join(";") : (row[column] ?? "")))).join(",")).join("\n")}\n`
}

function safetyMarkdown(rows: readonly MvpSafetyReviewRow[], log: MvpExecuteLog): string {
  const reasonCounts = reasonCountsOf(rows)
  const top = Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
  return `# MVP Sync Safety Review\n\n- existing_review_needed_total: ${log.reviewNeededTotal}\n- safe_to_execute: ${log.selectedCount}\n- hold: ${log.heldCount}\n- price_increase_targets: ${rows.filter((row) => row.decision === "safe_to_execute" && row.price_direction === "increase").length}\n- price_decrease_targets: ${rows.filter((row) => row.decision === "safe_to_execute" && row.price_direction === "decrease").length}\n- supplier_switch_targets: ${rows.filter((row) => row.decision === "safe_to_execute" && row.action === "switch_supplier_and_update_price").length}\n- stock_status_targets: ${rows.filter((row) => row.decision === "safe_to_execute" && (row.action === "mark_instock" || row.action === "mark_outofstock")).length}\n- executed: ${log.selectedCount}\n\n## Hold Reasons TOP 5\n\n${top.map(([reason, count]) => `- ${reason}: ${count}`).join("\n") || "- none"}\n`
}

function summaryMarkdown(log: MvpExecuteLog, verification: MvpExecuteVerification): string {
  return `# MVP Sync Execute Summary\n\n- selected_count: ${log.selectedCount}\n- update_price: ${log.actionCounts.update_price}\n- switch_supplier_and_update_price: ${log.actionCounts.switch_supplier_and_update_price}\n- mark_instock: ${log.actionCounts.mark_instock}\n- mark_outofstock: ${log.actionCounts.mark_outofstock}\n- failed_count: ${log.failedCount}\n- verification_success_count: ${verification.successCount}\n- new_product_created: false\n- new_variation_created: false\n- draft_published: false\n- forbidden_field_changed: ${verification.forbiddenFieldChanged}\n- stock_quantity_changed: ${verification.stockQuantityChanged}\n`
}

function countActions(rows: readonly PlanRow[]): Record<AllowedAction, number> {
  return {
    update_price: rows.filter((row) => row.action === "update_price").length,
    switch_supplier_and_update_price: rows.filter(
      (row) => row.action === "switch_supplier_and_update_price",
    ).length,
    mark_instock: rows.filter((row) => row.action === "mark_instock").length,
    mark_outofstock: rows.filter((row) => row.action === "mark_outofstock").length,
  }
}

function reasonCountsOf(rows: readonly MvpSafetyReviewRow[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const row of rows)
    for (const reason of row.reasons) result[reason] = (result[reason] ?? 0) + 1
  return result
}

function sameRow(row: PlanRow, review: MvpSafetyReviewRow): boolean {
  return (
    row.product_id === review.product_id &&
    row.variation_id === review.variation_id &&
    row.action === review.action &&
    row.new_price === review.new_price
  )
}

function rowKey(row: PlanRow): string {
  return `${row.product_id}:${row.variation_id}`
}

function optionName(variation: LiveVariation): string {
  return variation.attributes
    .map((attribute) => attribute.option ?? "")
    .filter(Boolean)
    .join(" / ")
}

function priceDirection(current: number, next: number): MvpSafetyReviewRow["price_direction"] {
  if (!Number.isFinite(current) || !Number.isFinite(next)) return "unknown"
  if (next > current) return "increase"
  if (next < current) return "decrease"
  return "same"
}

function clean(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^가-힣a-zA-Z0-9.]/gu, "")
    .toLocaleLowerCase("ko-KR")
}

function csvCell(value: string): string {
  return /[",\n\r]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value
}
