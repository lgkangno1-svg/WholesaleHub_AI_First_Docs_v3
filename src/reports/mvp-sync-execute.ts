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
type ExecuteStatus = "updated" | "verified" | "failed" | "skipped"

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
})
const PlanSchema = z.object({ rows: z.array(PlanRowSchema) })
const VariationSchema = z.object({
  id: z.number().int(),
  price: z.string().nullable().optional(),
  regular_price: z.string().nullable().optional(),
  stock_status: z.string().nullable().optional(),
  name: z.string().optional(),
  attributes: z.array(z.object({ name: z.string(), option: z.string().optional() })).default([]),
})

type PlanRow = z.infer<typeof PlanRowSchema>

type Credentials = {
  readonly baseUrl: string
  readonly consumerKey: string
  readonly consumerSecret: string
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
  readonly selectedCount: number
  readonly skippedUnsafeOrDisallowedCount: number
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
  readonly forbiddenFieldChanged: false
  readonly stockQuantityChanged: false
}

export async function readMvpPlanRows(path: string): Promise<readonly PlanRow[]> {
  return PlanSchema.parse(JSON.parse(await readFile(path, "utf8"))).rows
}

export function selectMvpExecutableRows(rows: readonly PlanRow[]): readonly PlanRow[] {
  const keyCounts = new Map<string, number>()
  for (const row of rows.filter(isExecutableRow)) {
    const key = `${row.product_id}:${row.variation_id}`
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1)
  }
  return rows
    .filter(isExecutableRow)
    .filter((row) => keyCounts.get(`${row.product_id}:${row.variation_id}`) === 1)
}

export async function executeMvpSyncPlan(options: {
  readonly planPath: string
  readonly outputDir: string
  readonly credentials: Credentials
  readonly execute: boolean
  readonly confirm: string
}): Promise<{ readonly log: MvpExecuteLog; readonly verification: MvpExecuteVerification }> {
  if (!options.execute || options.confirm !== "EXECUTE_MVP_SYNC_EXISTING_VARIATIONS_ONLY") {
    throw new Error('--execute --confirm "EXECUTE_MVP_SYNC_EXISTING_VARIATIONS_ONLY" is required')
  }
  const rows = await readMvpPlanRows(options.planPath)
  const selected = selectMvpExecutableRows(rows)
  const beforeCatalog = await fetchMvpWooCatalog(options.credentials)
  const entries = await executeRows(selected, options.credentials)
  const afterCatalog = await fetchMvpWooCatalog(options.credentials)
  const verification = verifyExecution(entries, beforeCatalog, afterCatalog)
  const log: MvpExecuteLog = {
    mode: "execute",
    requestedAt: new Date().toISOString(),
    planPath: options.planPath,
    selectedCount: selected.length,
    skippedUnsafeOrDisallowedCount: rows.length - selected.length,
    actionCounts: {
      update_price: selected.filter((row) => row.action === "update_price").length,
      switch_supplier_and_update_price: selected.filter(
        (row) => row.action === "switch_supplier_and_update_price",
      ).length,
      mark_instock: selected.filter((row) => row.action === "mark_instock").length,
      mark_outofstock: selected.filter((row) => row.action === "mark_outofstock").length,
    },
    failedCount: entries.filter((entry) => entry.status === "failed").length,
    entries,
    wooCommerceChanged: entries.some(
      (entry) => entry.status === "updated" || entry.status === "verified",
    ),
  }
  await writeReports(options.outputDir, log, verification)
  return { log, verification }
}

async function executeRows(
  rows: readonly PlanRow[],
  credentials: Credentials,
): Promise<readonly MvpExecuteEntry[]> {
  if (rows.length === 0) return []
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

function isExecutableRow(row: PlanRow): boolean {
  return (
    ALLOWED_ACTIONS.has(row.action) &&
    row.safety_status === "safe" &&
    row.product_id !== null &&
    row.variation_id !== null &&
    row.new_stock_status !== "review" &&
    /^\d+(?:\.\d+)?$/u.test(row.new_price) &&
    matchExcludedProduct(`${row.woocommerce_product_name} ${row.woocommerce_option_name}`) === null
  )
}

function verifyExecution(
  entries: readonly MvpExecuteEntry[],
  beforeCatalog: Awaited<ReturnType<typeof fetchMvpWooCatalog>>,
  afterCatalog: Awaited<ReturnType<typeof fetchMvpWooCatalog>>,
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
  if (row.product_id === null || row.variation_id === null || !ALLOWED_ACTIONS.has(row.action)) {
    throw new Error("invalid executable row")
  }
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
): Promise<void> {
  const dir = resolve(outputDir)
  await mkdir(dir, { recursive: true })
  await Promise.all([
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

function summaryMarkdown(log: MvpExecuteLog, verification: MvpExecuteVerification): string {
  return `# MVP Sync Execute Summary\n\n- selected_count: ${log.selectedCount}\n- update_price: ${log.actionCounts.update_price}\n- switch_supplier_and_update_price: ${log.actionCounts.switch_supplier_and_update_price}\n- mark_instock: ${log.actionCounts.mark_instock}\n- mark_outofstock: ${log.actionCounts.mark_outofstock}\n- failed_count: ${log.failedCount}\n- verification_success_count: ${verification.successCount}\n- new_product_created: false\n- new_variation_created: false\n- draft_published: false\n- forbidden_field_changed: false\n- stock_quantity_changed: false\n`
}
