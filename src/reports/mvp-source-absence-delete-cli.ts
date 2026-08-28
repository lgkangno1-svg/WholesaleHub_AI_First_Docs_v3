import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import ky from "ky"
import { z } from "zod"

const CONFIRM = "DELETE_SOURCE_ABSENT_PRODUCTS"
const MIN_DAILYFOOD_OPTIONS = 380
export const ABS_MIN_WALLDO_PRODUCTS = 15
export const ABS_MIN_WALLDO_OPTIONS = 100
export const MIN_RATIO_VS_LAST_GOOD_PRODUCTS = 0.6
export const MIN_RATIO_VS_LAST_GOOD_OPTIONS = 0.6
const ZERO_ABSENCE_STATS: AbsenceStats = { absentOnce: 0, absentConfirmed: 0, resets: 0 }

type Credentials = { baseUrl: string; consumerKey: string; consumerSecret: string }
type WooClient = ReturnType<typeof woo>
type DeleteRow = {
  product_id: number
  variation_id: number | null
  product_name: string
  option_name: string
  status_before: string
  categories: string
  action:
    | "delete_product"
    | "delete_variation"
    | "delete_product_empty_after_variations"
    | "keep"
  deleted: "yes" | "no" | "skipped"
  reason_korean: string
}

const PlanSchema = z.object({
  summary: z.object({
    runFailed: z.boolean(),
    dailyFoodOptionCount: z.number().int(),
    walldob2bOptionCount: z.number().int(),
    failureReasons: z.array(z.string()).default([]),
  }),
  rows: z.array(
    z.object({
      product_id: z.number().int().nullable(),
      variation_id: z.number().int().nullable(),
      available_supplier_count: z.number().int(),
      action: z.string(),
    }),
  ),
})

const ProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  status: z.string(),
  type: z.string().default(""),
  meta_data: z.array(z.object({ key: z.string(), value: z.unknown() })).default([]),
  categories: z
    .array(z.object({ id: z.number().int(), name: z.string(), slug: z.string() }))
    .default([]),
})
const VariationSchema = z.object({
  id: z.number().int(),
  attributes: z
    .array(z.object({ name: z.string().default(""), option: z.string().default("") }))
    .default([]),
})
const ProductsSchema = z.array(ProductSchema)
const VariationsSchema = z.array(VariationSchema)

type Product = z.infer<typeof ProductSchema>
type Variation = z.infer<typeof VariationSchema>

const WalldoSnapshotSchema = z.object({
  complete: z.boolean(),
  counts: z.object({
    products: z.number().int().nonnegative(),
    options: z.number().int().nonnegative(),
    excluded: z.number().int().nonnegative(),
    authoritative: z.number().int().nonnegative(),
    duplicateProductIds: z.number().int().nonnegative(),
    duplicateOptionIds: z.number().int().nonnegative(),
    withImages: z.number().int().nonnegative(),
    missingImages: z.number().int().nonnegative(),
    terminalExcluded: z.number().int().nonnegative(),
  }),
  products: z.array(
    z.object({
      sourceProductId: z.union([z.string(), z.number()]),
      options: z.array(z.unknown()),
    }),
  ),
  exclusions: z.array(z.unknown()),
})

const AbsenceEntrySchema = z.object({
  count: z.number().int().positive(),
  firstAbsentAt: z.string().min(1),
  lastAbsentAt: z.string().min(1),
})
const AbsenceStateSchema = z.object({
  schemaVersion: z.literal(1),
  lastGood: z
    .object({
      products: z.number().int().nonnegative(),
      options: z.number().int().nonnegative(),
      validatedAt: z.string().min(1),
    })
    .optional(),
  absence: z.record(z.string(), AbsenceEntrySchema),
})

export type WalldoCounts = { products: number; options: number }
export type LastGood = WalldoCounts & { validatedAt: string }
export type WalldoHealth = {
  valid: boolean
  complete: boolean
  duplicateProductIds: number
  duplicateOptionIds: number
  invalidReason?: "snapshot_missing" | "snapshot_unparseable" | "snapshot_invalid"
}
export type WalldoGateResult = {
  blocked: boolean
  currentProducts: number | null
  currentOptions: number | null
  lastGoodProducts: number | null
  lastGoodOptions: number | null
  ratioProducts: number | null
  ratioOptions: number | null
  reasons: string[]
}
export type AbsenceState = z.infer<typeof AbsenceStateSchema>
export type AbsenceStats = { absentOnce: number; absentConfirmed: number; resets: number }
export type AbsenceUpdate = {
  state: AbsenceState
  eligibleKeys: Set<string>
  stats: AbsenceStats
}

type Args = {
  execute: boolean
  confirm: string
  planPath: string
  outDir: string
  walldoSnapshotPath: string
  statePath: string
}

async function main(): Promise<void> {
  await loadDotEnv()
  const args = parseArgs(process.argv.slice(2))
  if (!args.execute || args.confirm !== CONFIRM) {
    throw new Error(`--execute --confirm "${CONFIRM}" is required`)
  }
  const plan = PlanSchema.parse(JSON.parse(await readFile(args.planPath, "utf8")))
  validatePlan(plan)
  const keep = keepSets(plan.rows)
  const [snapshot, state] = await Promise.all([
    readWalldoSnapshot(args.walldoSnapshotPath),
    readAbsenceState(args.statePath),
  ])
  const gate = evaluateWalldoGate(snapshot.current, state.lastGood ?? null, snapshot.health)
  if (gate.blocked) {
    const summary = createSummary(plan, keep, gate, ZERO_ABSENCE_STATS, {
      scannedProducts: 0,
      keptProducts: 0,
      deletedProducts: 0,
      deletedVariations: 0,
    })
    await writeReports(args.outDir, summary, [])
    console.error(walldoBlockedLog(gate))
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  const credentials = {
    baseUrl: env("WOOCOMMERCE_BASE_URL"),
    consumerKey: env("WOOCOMMERCE_CONSUMER_KEY"),
    consumerSecret: env("WOOCOMMERCE_CONSUMER_SECRET"),
  }
  const client = woo(credentials)
  const products = (await fetchProducts(client)).filter((product) => product.status !== "trash")
  const rows: DeleteRow[] = []
  const scans: { product: Product; variations: Variation[] }[] = []
  // Plan rows only expose Woo IDs, so p:<product_id> and v:<variation_id> are the stable keys available.
  const presentKeys = new Set<string>([
    ...[...keep.products].map((id) => productKey(id)),
    ...[...keep.variations].map((id) => variationKey(id)),
  ])
  const absentKeys = new Set<string>()
  let deletedProducts = 0
  let deletedVariations = 0
  let keptProducts = 0
  for (const product of products) {
    if (isMvpCreatedProduct(product)) {
      keptProducts += 1
      rows.push(
        row(
          product,
          null,
          "keep",
          "skipped",
          "n8n MVP가 생성한 검토 상품은 발행 후에도 source plan 재매칭 전까지 유지",
        ),
      )
      presentKeys.add(productKey(product.id))
      continue
    }
    const variations = product.type === "variable" ? await fetchVariations(client, product.id) : []
    scans.push({ product, variations })
    const hasPresentVariation = variations.some((variation) => keep.variations.has(variation.id))
    const productIsPresent = keep.products.has(product.id) || hasPresentVariation
    const productKeys = productIsPresent ? presentKeys : absentKeys
    productKeys.add(productKey(product.id))
    for (const variation of variations) {
      const variationKeys = keep.variations.has(variation.id) ? presentKeys : absentKeys
      variationKeys.add(variationKey(variation.id))
    }
  }

  const now = new Date().toISOString()
  const absence = updateAbsenceState(
    {
      ...state,
      lastGood: {
        products: gate.currentProducts as number,
        options: gate.currentOptions as number,
        validatedAt: now,
      },
    },
    absentKeys,
    presentKeys,
    { now },
  )

  for (const { product, variations } of scans) {
    const productIsPresent = presentKeys.has(productKey(product.id))
    if (!productIsPresent && absence.eligibleKeys.has(productKey(product.id))) {
      await deleteProduct(client, product.id)
      deletedProducts += 1
      deletedVariations += variations.length
      rows.push(
        row(
          product,
          null,
          "delete_product",
          "yes",
          "최신 DailyFood/월억 source plan에서 2회 연속 상품군 없음 (ABSENT_CONFIRMED)",
        ),
      )
      continue
    }
    if (!productIsPresent) {
      rows.push(
        row(
          product,
          null,
          "keep",
          "no",
          "최신 DailyFood/월억 source plan에서 최초 부재 (ABSENT_ONCE)",
        ),
      )
    }
    if (product.type !== "variable") {
      keptProducts += 1
      if (productIsPresent) {
        rows.push(
          row(product, null, "keep", "skipped", "최신 source plan에 유지 대상 상품으로 존재"),
        )
      }
      continue
    }
    let removedVariation = false
    for (const variation of variations) {
      if (keep.variations.has(variation.id)) continue
      if (!absence.eligibleKeys.has(variationKey(variation.id))) {
        rows.push(
          row(
            product,
            variation,
            "keep",
            "no",
            "최신 DailyFood/월억 source plan에서 최초 옵션 부재 (ABSENT_ONCE)",
          ),
        )
        continue
      }
      await deleteVariation(client, product.id, variation.id)
      removedVariation = true
      deletedVariations += 1
      rows.push(
        row(
          product,
          variation,
          "delete_variation",
          "yes",
          "최신 DailyFood/월억 source plan에서 2회 연속 해당 옵션 없음 (ABSENT_CONFIRMED)",
        ),
      )
    }
    const remaining = removedVariation ? await fetchVariations(client, product.id) : variations
    if (removedVariation && remaining.length === 0) {
      await deleteProduct(client, product.id)
      deletedProducts += 1
      rows.push(
        row(
          product,
          null,
          "delete_product_empty_after_variations",
          "yes",
          "source 없는 옵션 삭제 후 남은 옵션 없음",
        ),
      )
    } else {
      keptProducts += 1
    }
  }
  await writeAbsenceState(args.statePath, absence.state)
  const summary = createSummary(plan, keep, gate, absence.stats, {
    scannedProducts: products.length,
    keptProducts,
    deletedProducts,
    deletedVariations,
  })
  await writeReports(args.outDir, summary, rows)
  console.log(JSON.stringify(summary, null, 2))
}

export function evaluateWalldoGate(
  current: WalldoCounts | null,
  lastGood: LastGood | null,
  health: WalldoHealth,
): WalldoGateResult {
  const reasons: string[] = []
  const ratioProducts = ratio(current?.products, lastGood?.products)
  const ratioOptions = ratio(current?.options, lastGood?.options)

  if (!health.valid || current === null) {
    reasons.push(health.invalidReason ?? "snapshot_invalid")
  } else {
    if (!health.complete) reasons.push("complete=false")
    if (health.duplicateProductIds > 0) reasons.push("duplicate_product_ids")
    if (health.duplicateOptionIds > 0) reasons.push("duplicate_option_ids")
    if (current.products < ABS_MIN_WALLDO_PRODUCTS) reasons.push("products_below_absolute_floor")
    if (current.options < ABS_MIN_WALLDO_OPTIONS) reasons.push("options_below_absolute_floor")
    if (
      lastGood !== null &&
      current.products < lastGood.products * MIN_RATIO_VS_LAST_GOOD_PRODUCTS
    ) {
      reasons.push("products_below_last_good_ratio")
    }
    if (
      lastGood !== null &&
      current.options < lastGood.options * MIN_RATIO_VS_LAST_GOOD_OPTIONS
    ) {
      reasons.push("options_below_last_good_ratio")
    }
  }

  return {
    blocked: reasons.length > 0,
    currentProducts: current?.products ?? null,
    currentOptions: current?.options ?? null,
    lastGoodProducts: lastGood?.products ?? null,
    lastGoodOptions: lastGood?.options ?? null,
    ratioProducts,
    ratioOptions,
    reasons,
  }
}

export function updateAbsenceState(
  state: AbsenceState,
  absentKeys: Iterable<string>,
  presentKeys: Iterable<string>,
  options: { now?: string; blocked?: boolean } = {},
): AbsenceUpdate {
  const next = structuredClone(state)
  const stats: AbsenceStats = { ...ZERO_ABSENCE_STATS }
  const eligibleKeys = new Set<string>()
  if (options.blocked === true) return { state: next, eligibleKeys, stats }

  const now = options.now ?? new Date().toISOString()
  const present = new Set(presentKeys)
  for (const key of present) {
    if (next.absence[key] !== undefined) {
      delete next.absence[key]
      stats.resets += 1
    }
  }
  for (const key of new Set(absentKeys)) {
    if (present.has(key)) continue
    const previous = next.absence[key]
    const count = (previous?.count ?? 0) + 1
    next.absence[key] = {
      count,
      firstAbsentAt: previous?.firstAbsentAt ?? now,
      lastAbsentAt: now,
    }
    if (count >= 2) {
      eligibleKeys.add(key)
      stats.absentConfirmed += 1
    } else {
      stats.absentOnce += 1
    }
  }
  return { state: next, eligibleKeys, stats }
}

export async function readAbsenceState(path: string): Promise<AbsenceState> {
  try {
    return AbsenceStateSchema.parse(JSON.parse(await readFile(path, "utf8")))
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return { schemaVersion: 1, absence: {} }
    throw new Error(`invalid walldob2b absence state: ${errorMessage(error)}`)
  }
}

export async function writeAbsenceState(path: string, state: AbsenceState): Promise<void> {
  const parsed = AbsenceStateSchema.parse(state)
  await mkdir(resolve(path, ".."), { recursive: true })
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8")
}

async function readWalldoSnapshot(path: string): Promise<{
  current: WalldoCounts | null
  health: WalldoHealth
}> {
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (error) {
    return {
      current: null,
      health: {
        valid: false,
        complete: false,
        duplicateProductIds: 0,
        duplicateOptionIds: 0,
        invalidReason: isNodeError(error, "ENOENT") ? "snapshot_missing" : "snapshot_invalid",
      },
    }
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return {
      current: null,
      health: {
        valid: false,
        complete: false,
        duplicateProductIds: 0,
        duplicateOptionIds: 0,
        invalidReason: "snapshot_unparseable",
      },
    }
  }
  const parsed = WalldoSnapshotSchema.safeParse(json)
  if (!parsed.success) {
    return {
      current: null,
      health: {
        valid: false,
        complete: false,
        duplicateProductIds: 0,
        duplicateOptionIds: 0,
        invalidReason: "snapshot_invalid",
      },
    }
  }
  return {
    current: { products: parsed.data.counts.products, options: parsed.data.counts.options },
    health: {
      valid: true,
      complete: parsed.data.complete,
      duplicateProductIds: parsed.data.counts.duplicateProductIds,
      duplicateOptionIds: parsed.data.counts.duplicateOptionIds,
    },
  }
}

function ratio(current: number | undefined, previous: number | undefined): number | null {
  if (current === undefined || previous === undefined || previous === 0) return null
  return current / previous
}

function productKey(id: number): string {
  return `p:${id}`
}

function variationKey(id: number): string {
  return `v:${id}`
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMvpCreatedProduct(product: Product): boolean {
  return product.meta_data.some(
    (item) => item.key === "_wholesalehub_mvp_created" && item.value === "draft_candidate",
  )
}

function validatePlan(plan: z.infer<typeof PlanSchema>): void {
  if (plan.summary.runFailed) {
    throw new Error(
      `source absence delete blocked: plan failed (${plan.summary.failureReasons.join("; ")})`,
    )
  }
  if (plan.summary.dailyFoodOptionCount < MIN_DAILYFOOD_OPTIONS) {
    throw new Error(
      `source absence delete blocked: dailyfood option count too low (${plan.summary.dailyFoodOptionCount})`,
    )
  }
  if (plan.rows.length === 0) throw new Error("source absence delete blocked: empty plan rows")
}

function keepSets(rows: readonly z.infer<typeof PlanSchema>["rows"][number][]) {
  const products = new Set<number>()
  const variations = new Set<number>()
  for (const planRow of rows) {
    if (planRow.available_supplier_count <= 0) continue
    if (["create_draft_product_candidate", "add_variation_candidate"].includes(planRow.action))
      continue
    if (planRow.product_id !== null) products.add(planRow.product_id)
    if (planRow.variation_id !== null) variations.add(planRow.variation_id)
  }
  return { products, variations }
}

function parseArgs(args: readonly string[]): Args {
  const map = new Map<string, string>()
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i]
    if (key === "--execute") {
      map.set(key, "true")
      continue
    }
    const value = args[i + 1]
    if (!key || !value || !key.startsWith("--"))
      throw new Error(`invalid argument: ${key ?? "unknown"}`)
    map.set(key, value)
    i += 1
  }
  return {
    execute: map.get("--execute") === "true",
    confirm: map.get("--confirm") ?? "",
    planPath: map.get("--plan") ?? "reports/mvp-sync-plan.json",
    outDir: map.get("--out-dir") ?? "reports",
    walldoSnapshotPath:
      map.get("--walldo-snapshot") ?? "reports/rebuild/walldob2b-catalog-snapshot.json",
    statePath: map.get("--state") ?? "reports/walldob2b-absence-state.json",
  }
}

async function fetchProducts(client: WooClient): Promise<Product[]> {
  const rows: Product[] = []
  for (let page = 1; page <= 50; page += 1) {
    const pageRows = ProductsSchema.parse(
      await ky
        .get(`${client.baseUrl}/wp-json/wc/v3/products`, {
          headers: client.headers,
          searchParams: { status: "any", per_page: "100", page: String(page) },
          timeout: 60000,
          retry: { limit: 1 },
        })
        .json(),
    )
    rows.push(...pageRows)
    if (pageRows.length < 100) break
  }
  return rows
}

async function fetchVariations(client: WooClient, productId: number): Promise<Variation[]> {
  const rows: Variation[] = []
  for (let page = 1; page <= 20; page += 1) {
    const pageRows = VariationsSchema.parse(
      await ky
        .get(`${client.baseUrl}/wp-json/wc/v3/products/${productId}/variations`, {
          headers: client.headers,
          searchParams: { status: "any", per_page: "100", page: String(page) },
          timeout: 60000,
          retry: { limit: 1 },
        })
        .json(),
    )
    rows.push(...pageRows)
    if (pageRows.length < 100) break
  }
  return rows
}

async function deleteVariation(
  client: WooClient,
  productId: number,
  variationId: number,
): Promise<void> {
  await ky
    .delete(`${client.baseUrl}/wp-json/wc/v3/products/${productId}/variations/${variationId}`, {
      headers: client.headers,
      searchParams: { force: "true" },
      timeout: 60000,
      retry: { limit: 0 },
    })
    .json()
}

async function deleteProduct(client: WooClient, productId: number): Promise<void> {
  await ky
    .delete(`${client.baseUrl}/wp-json/wc/v3/products/${productId}`, {
      headers: client.headers,
      searchParams: { force: "true" },
      timeout: 60000,
      retry: { limit: 0 },
    })
    .json()
}

function row(
  product: Product,
  variation: Variation | null,
  action: DeleteRow["action"],
  deleted: DeleteRow["deleted"],
  reason: string,
): DeleteRow {
  return {
    product_id: product.id,
    variation_id: variation?.id ?? null,
    product_name: product.name,
    option_name: variation === null ? "" : optionName(variation),
    status_before: product.status,
    categories: product.categories.map((category) => category.name).join("|"),
    action,
    deleted,
    reason_korean: reason,
  }
}

function optionName(variation: Variation): string {
  return variation.attributes
    .map((attribute) => attribute.option || attribute.name)
    .filter(Boolean)
    .join(" / ")
}

function createSummary(
  plan: z.infer<typeof PlanSchema>,
  keep: ReturnType<typeof keepSets>,
  gate: WalldoGateResult,
  absence: AbsenceStats,
  counts: {
    scannedProducts: number
    keptProducts: number
    deletedProducts: number
    deletedVariations: number
  },
) {
  return {
    generatedAt: new Date().toISOString(),
    planRows: plan.rows.length,
    dailyFoodOptions: plan.summary.dailyFoodOptionCount,
    walldoOptions: plan.summary.walldob2bOptionCount,
    keepProducts: keep.products.size,
    keepVariations: keep.variations.size,
    ...counts,
    wooCommerceChanged: counts.deletedProducts > 0 || counts.deletedVariations > 0,
    rule: "DailyFood/월억 최신 source plan에서 2회 연속 부재한 상품/옵션은 삭제",
    walldoGate: {
      result: gate.blocked ? "blocked" : "passed",
      currentProducts: gate.currentProducts,
      currentOptions: gate.currentOptions,
      lastGoodProducts: gate.lastGoodProducts,
      lastGoodOptions: gate.lastGoodOptions,
      ratioProducts: gate.ratioProducts,
      ratioOptions: gate.ratioOptions,
      blockReasons: gate.reasons,
    },
    absence: { ...absence },
  }
}

function walldoBlockedLog(gate: WalldoGateResult): string {
  return [
    "WALLDO_SOURCE_SANITY_BLOCKED",
    `current_products=${gate.currentProducts ?? "unknown"}`,
    `current_options=${gate.currentOptions ?? "unknown"}`,
    `last_good_products=${gate.lastGoodProducts ?? "none"}`,
    `last_good_options=${gate.lastGoodOptions ?? "none"}`,
    `ratio_products=${gate.ratioProducts?.toFixed(3) ?? "n/a"}`,
    `ratio_options=${gate.ratioOptions?.toFixed(3) ?? "n/a"}`,
    `reason=${gate.reasons.join(",")}`,
  ].join(" ")
}

async function writeReports(
  outDir: string,
  summary: unknown,
  rows: readonly DeleteRow[],
): Promise<void> {
  const dir = resolve(outDir)
  await mkdir(dir, { recursive: true })
  await Promise.all([
    writeFile(
      resolve(dir, "source-absence-delete-summary.json"),
      `${JSON.stringify({ summary, rows }, null, 2)}\n`,
      "utf8",
    ),
    writeFile(resolve(dir, "source-absence-delete-report.csv"), toCsv(rows), "utf8"),
    writeFile(
      resolve(dir, "source-absence-delete-final-summary.md"),
      markdown(summary as Record<string, unknown>),
      "utf8",
    ),
  ])
}

function toCsv(rows: readonly DeleteRow[]): string {
  const headers = [
    "product_id",
    "variation_id",
    "product_name",
    "option_name",
    "status_before",
    "categories",
    "action",
    "deleted",
    "reason_korean",
  ] as const
  return `${headers.join(",")}\n${rows.map((row) => headers.map((header) => csvCell(String(row[header] ?? ""))).join(",")).join("\n")}\n`
}

function markdown(summary: Record<string, unknown>): string {
  const gate = summary["walldoGate"] as Record<string, unknown>
  const absence = summary["absence"] as Record<string, unknown>
  return `${[
    "# Source Absence Delete Summary",
    "",
    `- generated_at: ${summary["generatedAt"]}`,
    `- dailyfood_options: ${summary["dailyFoodOptions"]}`,
    `- walldo_options: ${summary["walldoOptions"]}`,
    `- scanned_products: ${summary["scannedProducts"]}`,
    `- kept_products: ${summary["keptProducts"]}`,
    `- deleted_products: ${summary["deletedProducts"]}`,
    `- deleted_variations: ${summary["deletedVariations"]}`,
    `- walldo_gate: ${gate["result"]}`,
    `- walldo_current_products: ${gate["currentProducts"] ?? "unknown"}`,
    `- walldo_current_options: ${gate["currentOptions"] ?? "unknown"}`,
    `- walldo_last_good_products: ${gate["lastGoodProducts"] ?? "none"}`,
    `- walldo_last_good_options: ${gate["lastGoodOptions"] ?? "none"}`,
    `- walldo_ratio_products: ${gate["ratioProducts"] ?? "n/a"}`,
    `- walldo_ratio_options: ${gate["ratioOptions"] ?? "n/a"}`,
    `- walldo_block_reasons: ${(gate["blockReasons"] as string[]).join(",") || "none"}`,
    `- absence_once: ${absence["absentOnce"]}`,
    `- absence_confirmed: ${absence["absentConfirmed"]}`,
    `- absence_resets: ${absence["resets"]}`,
    `- rule: ${summary["rule"]}`,
    "- source failure safety: failed plan, low DailyFood count, or failed Walldo gate blocks deletion",
  ].join("\n")}\n`
}

function csvCell(value: string): string {
  return `"${value.replace(/"/gu, '""')}"`
}

function woo(credentials: Credentials) {
  const baseUrl = credentials.baseUrl.replace(/\/$/u, "")
  return {
    baseUrl,
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.consumerKey}:${credentials.consumerSecret}`).toString("base64")}`,
    },
  }
}

async function loadDotEnv(): Promise<void> {
  try {
    const text = await readFile(".env", "utf8")
    for (const line of text.split(/\r?\n/u)) {
      const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line)
      if (match?.[1] && process.env[match[1]] === undefined) process.env[match[1]] = match[2] ?? ""
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
}

function env(key: string): string {
  const value = (process.env[key] ?? "").trim()
  if (!value) throw new Error(`${key} is required`)
  return value
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(errorMessage(error))
    process.exitCode = 1
  })
}
