import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import ky from "ky"
import { z } from "zod"
import type { CollectedProduct } from "../domain/product.js"
import { matchExcludedProduct } from "../exclusions/livestock.js"

export type MvpSyncAction =
  | "no_op"
  | "update_price"
  | "switch_supplier_and_update_price"
  | "mark_instock"
  | "mark_outofstock"
  | "add_variation_candidate"
  | "create_draft_product_candidate"
  | "duplicate_draft_hold"
  | "review_needed"
  | "blocked"

type SafetyStatus = "safe" | "review_needed" | "blocked"
type MatchType = "hard_meta" | "soft_normalized" | "draft_soft" | "none"

const ProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  status: z.string(),
  type: z.string(),
  price: z.string().nullable().optional(),
  stock_status: z.string().nullable().optional(),
  meta_data: z.array(z.object({ key: z.string(), value: z.unknown() })).default([]),
})
const VariationSchema = z.object({
  id: z.number().int(),
  price: z.string().nullable().optional(),
  stock_status: z.string().nullable().optional(),
  attributes: z.array(z.object({ name: z.string(), option: z.string().optional() })).default([]),
  meta_data: z.array(z.object({ key: z.string(), value: z.unknown() })).default([]),
})

type WooProductBase = z.infer<typeof ProductSchema>
export type MvpWooVariation = z.infer<typeof VariationSchema> & { readonly productId: number }
export type MvpWooProduct = WooProductBase & { readonly variations: readonly MvpWooVariation[] }

export type MvpSupplierCandidate = {
  readonly supplierId: string
  readonly sourceProductId: string
  readonly sourceOptionId: string
  readonly originalProductName: string
  readonly originalOptionName: string
  readonly price: number
  readonly stockStatus: CollectedProduct["stockStatus"]
  readonly productGroupKey: string
  readonly normalizedOptionKey: string
}

export type MvpSyncPlanRow = {
  readonly product_id: number | null
  readonly variation_id: number | null
  readonly woocommerce_product_name: string
  readonly woocommerce_option_name: string
  readonly current_price: string
  readonly new_price: string
  readonly current_stock_status: string
  readonly new_stock_status: "instock" | "outofstock" | "review"
  readonly current_supplier_id: string
  readonly selected_supplier_id: string
  readonly available_supplier_count: number
  readonly supplier_candidates_summary: string
  readonly match_type: MatchType
  readonly confidence: number
  readonly action: MvpSyncAction
  readonly safety_status: SafetyStatus
  readonly reason_korean: string
}

export type MvpSyncPlanReport = {
  readonly summary: {
    readonly generatedAt: string
    readonly runFailed: boolean
    readonly failureReasons: readonly string[]
    readonly dailyFoodOptionCount: number
    readonly walldob2bOptionCount: number
    readonly excludedSupplierOptionCount: number
    readonly wooProductCount: number
    readonly wooVariationCount: number
    readonly draftProductCount: number
    readonly duplicateExposureSuspectCount: number
    readonly actionCounts: Record<MvpSyncAction, number>
    readonly safetyCounts: Record<SafetyStatus, number>
    readonly wooCommerceChanged: false
  }
  readonly rows: readonly MvpSyncPlanRow[]
}

const ACTIONS: readonly MvpSyncAction[] = [
  "no_op",
  "update_price",
  "switch_supplier_and_update_price",
  "mark_instock",
  "mark_outofstock",
  "add_variation_candidate",
  "create_draft_product_candidate",
  "duplicate_draft_hold",
  "review_needed",
  "blocked",
]
const SAFETY: readonly SafetyStatus[] = ["safe", "review_needed", "blocked"]
const REQUIRED_ENV = [
  "WOOCOMMERCE_BASE_URL",
  "WOOCOMMERCE_CONSUMER_KEY",
  "WOOCOMMERCE_CONSUMER_SECRET",
  "WALLDOB2B_USERNAME",
  "WALLDOB2B_PASSWORD",
] as const

export function hubSalePriceFromSupplierPrice(price: number): number {
  if (!Number.isFinite(price) || price < 0) throw new Error(`invalid supplier price: ${price}`)
  if (price < 10_000) return price + 1_500
  if (price < 20_000) return price + 2_000
  if (price < 30_000) return price + 3_000
  return price + 4_000
}

export function missingMvpCredentialKeys(env: NodeJS.ProcessEnv): readonly string[] {
  return REQUIRED_ENV.filter((key) => (env[key] ?? "").trim().length === 0)
}

export async function fetchMvpWooCatalog(options: {
  readonly baseUrl: string
  readonly consumerKey: string
  readonly consumerSecret: string
}): Promise<readonly MvpWooProduct[]> {
  const baseUrl = options.baseUrl.replace(/\/$/u, "")
  const headers = {
    Authorization: `Basic ${Buffer.from(`${options.consumerKey}:${options.consumerSecret}`).toString("base64")}`,
  }
  const bases = z.array(ProductSchema).parse(
    await fetchAllPages((page) =>
      ky.get(`${baseUrl}/wp-json/wc/v3/products`, {
        headers,
        searchParams: { per_page: "100", page: String(page), status: "any" },
        timeout: 60_000,
        retry: { limit: 1 },
      }),
    ),
  )
  const variationMap = new Map<number, readonly MvpWooVariation[]>()
  let cursor = 0
  async function worker(): Promise<void> {
    for (;;) {
      const product = bases[cursor]
      cursor += 1
      if (product === undefined) return
      if (product.type !== "variable") continue
      const variations = z.array(VariationSchema).parse(
        await fetchAllPages((page) =>
          ky.get(`${baseUrl}/wp-json/wc/v3/products/${product.id}/variations`, {
            headers,
            searchParams: { per_page: "100", page: String(page), status: "any" },
            timeout: 60_000,
            retry: { limit: 1 },
          }),
        ),
      )
      variationMap.set(
        product.id,
        variations.map((variation) => ({ ...variation, productId: product.id })),
      )
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => worker()))
  return bases.map((product) => ({ ...product, variations: variationMap.get(product.id) ?? [] }))
}

export function buildMvpSyncPlanReport(input: {
  readonly dailyFoodProducts: readonly CollectedProduct[]
  readonly walldob2bProducts: readonly CollectedProduct[]
  readonly wooProducts: readonly MvpWooProduct[]
  readonly failureReasons?: readonly string[]
}): MvpSyncPlanReport {
  const failureReasons = input.failureReasons ?? []
  const rows =
    failureReasons.length > 0
      ? []
      : [
          ...groupCandidates(
            [...input.dailyFoodProducts, ...input.walldob2bProducts]
              .filter((product) => matchExcludedProduct(candidateText(product)) === null)
              .map(toCandidate),
          ).values(),
        ].map((candidates) => planRow(candidates, input.wooProducts))
  return makeReport(input, rows, failureReasons)
}

export async function writeMvpSyncPlanReport(
  report: MvpSyncPlanReport,
  outputDir = "reports",
): Promise<void> {
  const dir = resolve(outputDir)
  await mkdir(dir, { recursive: true })
  await Promise.all([
    writeFile(resolve(dir, "mvp-sync-plan.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(resolve(dir, "mvp-sync-plan.csv"), csv(report.rows), "utf8"),
    writeFile(resolve(dir, "mvp-sync-summary.md"), markdown(report), "utf8"),
  ])
}

function makeReport(
  input: {
    readonly dailyFoodProducts: readonly CollectedProduct[]
    readonly walldob2bProducts: readonly CollectedProduct[]
    readonly wooProducts: readonly MvpWooProduct[]
  },
  rows: readonly MvpSyncPlanRow[],
  failureReasons: readonly string[],
): MvpSyncPlanReport {
  return {
    summary: {
      generatedAt: new Date().toISOString(),
      runFailed: failureReasons.length > 0,
      failureReasons,
      dailyFoodOptionCount: input.dailyFoodProducts.length,
      walldob2bOptionCount: input.walldob2bProducts.length,
      excludedSupplierOptionCount: [...input.dailyFoodProducts, ...input.walldob2bProducts].filter(
        (product) => matchExcludedProduct(candidateText(product)) !== null,
      ).length,
      wooProductCount: input.wooProducts.length,
      wooVariationCount: input.wooProducts.reduce(
        (sum, product) => sum + product.variations.length,
        0,
      ),
      draftProductCount: input.wooProducts.filter((product) => product.status === "draft").length,
      duplicateExposureSuspectCount: duplicateExposureSuspects(input.wooProducts),
      actionCounts: countBy(rows, ACTIONS, (row) => row.action),
      safetyCounts: countBy(rows, SAFETY, (row) => row.safety_status),
      wooCommerceChanged: false,
    },
    rows,
  }
}

function planRow(
  candidates: readonly MvpSupplierCandidate[],
  wooProducts: readonly MvpWooProduct[],
): MvpSyncPlanRow {
  const first = requireFirst(candidates)
  const available = candidates
    .filter(
      (candidate) =>
        candidate.stockStatus !== "out_of_stock" &&
        Number.isFinite(candidate.price) &&
        candidate.price >= 1_000,
    )
    .sort(
      (left, right) => left.price - right.price || left.supplierId.localeCompare(right.supplierId),
    )
  const selected = available[0] ?? null
  const selectedSalePrice = selected === null ? null : hubSalePriceFromSupplierPrice(selected.price)
  const matched = matchWoo(candidates, wooProducts)
  const currentSupplierId =
    metaValue(matched.variation?.meta_data ?? [], "_supplier_id") ||
    metaValue(matched.variation?.meta_data ?? [], "_wholesalehub_supplier_id")
  const action = actionOf({ matched, selected, selectedSalePrice, currentSupplierId })
  const safety = safetyOf(action, matched.matchType)
  return {
    product_id: matched.product?.id ?? null,
    variation_id: matched.variation?.id ?? null,
    woocommerce_product_name:
      matched.product?.name ?? selected?.originalProductName ?? first.originalProductName,
    woocommerce_option_name:
      matched.variation === null ? first.originalOptionName : optionName(matched.variation),
    current_price: matched.variation?.price ?? "",
    new_price: selectedSalePrice === null ? "" : String(selectedSalePrice),
    current_stock_status: matched.variation?.stock_status ?? "",
    new_stock_status: selected === null ? "outofstock" : "instock",
    current_supplier_id: currentSupplierId,
    selected_supplier_id: selected?.supplierId ?? "",
    available_supplier_count: available.length,
    supplier_candidates_summary: candidates
      .map(
        (candidate) =>
          `${candidate.supplierId}:${candidate.price}->${hubSalePriceFromSupplierPrice(candidate.price)}:${candidate.stockStatus}`,
      )
      .join(" | "),
    match_type: matched.matchType,
    confidence: confidenceOf(matched.matchType),
    action,
    safety_status: safety,
    reason_korean: reasonOf(action, matched.matchType, available.length),
  }
}

function actionOf(input: {
  readonly matched: MatchResult
  readonly selected: MvpSupplierCandidate | null
  readonly selectedSalePrice: number | null
  readonly currentSupplierId: string
}): MvpSyncAction {
  if (input.matched.product?.status === "draft") return "duplicate_draft_hold"
  if (input.matched.product === null)
    return input.selected === null ? "review_needed" : "create_draft_product_candidate"
  if (input.matched.variation === null)
    return input.selected === null ? "review_needed" : "add_variation_candidate"
  if (input.selected === null) return "mark_outofstock"
  if (input.currentSupplierId.length > 0 && input.currentSupplierId !== input.selected.supplierId) {
    return "switch_supplier_and_update_price"
  }
  if ((input.matched.variation.stock_status ?? "") === "outofstock") return "mark_instock"
  return numberOrNull(input.matched.variation.price ?? "") === input.selectedSalePrice
    ? "no_op"
    : "update_price"
}

function safetyOf(action: MvpSyncAction, matchType: MatchType): SafetyStatus {
  if (action === "blocked") return "blocked"
  if (action === "create_draft_product_candidate" || action === "duplicate_draft_hold")
    return "review_needed"
  return matchType === "hard_meta" ? "safe" : "review_needed"
}

type MatchResult = {
  readonly product: MvpWooProduct | null
  readonly variation: MvpWooVariation | null
  readonly matchType: MatchType
}

function matchWoo(
  candidates: readonly MvpSupplierCandidate[],
  wooProducts: readonly MvpWooProduct[],
): MatchResult {
  const hard = hardMatch(candidates, wooProducts)
  if (hard !== null) return { ...hard, matchType: "hard_meta" }
  const first = requireFirst(candidates)
  const product = bestProduct(
    first.productGroupKey,
    wooProducts.filter((item) => item.status !== "draft"),
  )
  if (product !== null) {
    const matchingSupplierVariations = product.variations.filter(
      (item) => variationSupplierId(item) === first.supplierId,
    )
    const variation =
      matchingSupplierVariations.find(
        (item) => optionKey(optionName(item)) === first.normalizedOptionKey,
      ) ?? null
    const hasForeignSupplier = product.variations.some((item) => {
      const supplier = variationSupplierId(item)
      return supplier.length > 0 && supplier !== first.supplierId
    })
    if (variation === null && hasForeignSupplier)
      return { product: null, variation: null, matchType: "none" }
    return { product, variation, matchType: "soft_normalized" }
  }
  const draft = bestProduct(
    first.productGroupKey,
    wooProducts.filter((item) => item.status === "draft"),
  )
  return { product: draft, variation: null, matchType: draft === null ? "none" : "draft_soft" }
}

function hardMatch(
  candidates: readonly MvpSupplierCandidate[],
  products: readonly MvpWooProduct[],
): { readonly product: MvpWooProduct; readonly variation: MvpWooVariation } | null {
  for (const product of products) {
    for (const variation of product.variations) {
      if (candidates.some((candidate) => variationMetaMatches(variation, candidate)))
        return { product, variation }
    }
  }
  return null
}

function variationMetaMatches(
  variation: MvpWooVariation,
  candidate: MvpSupplierCandidate,
): boolean {
  const meta = variation.meta_data
  const productKey =
    metaValue(meta, "_product_group_key") || metaValue(meta, "_wholesalehub_product_group_key")
  const option =
    metaValue(meta, "_normalized_option_key") ||
    metaValue(meta, "_wholesalehub_normalized_option_key")
  const supplier = variationSupplierId(variation)
  if (supplier !== candidate.supplierId) return false
  const sourceProduct =
    metaValue(meta, "_source_product_id") || metaValue(meta, "_wholesalehub_source_product_id")
  const sourceOption =
    metaValue(meta, "_source_option_id") || metaValue(meta, "_wholesalehub_source_option_id")
  if (sourceProduct.length > 0 || sourceOption.length > 0)
    return sourceProduct === candidate.sourceProductId && sourceOption === candidate.sourceOptionId
  if (productKey === candidate.productGroupKey && option === candidate.normalizedOptionKey)
    return true
  return (
    optionKey(optionName(variation)) === candidate.normalizedOptionKey &&
    productKey === candidate.productGroupKey
  )
}

function bestProduct(groupKey: string, products: readonly MvpWooProduct[]): MvpWooProduct | null {
  return products.find((product) => sameText(groupKey, productGroupKey(product.name))) ?? null
}

function toCandidate(product: CollectedProduct): MvpSupplierCandidate {
  const raw = safeJson(product.rawJson)
  const option = product.originalOptionName ?? "기본"
  return {
    supplierId: product.supplierId,
    sourceProductId:
      stringValue(raw["sourceProductId"]) || stableSourceId(product.originalProductName),
    sourceOptionId: stringValue(raw["sourceOptionId"]) || stableSourceId(option),
    originalProductName: product.originalProductName,
    originalOptionName: option,
    price: product.price,
    stockStatus: product.stockStatus,
    productGroupKey: productGroupKey(product.originalProductName),
    normalizedOptionKey: optionKey(`${product.originalProductName} ${option}`),
  }
}

function groupCandidates(
  candidates: readonly MvpSupplierCandidate[],
): Map<string, readonly MvpSupplierCandidate[]> {
  const groups = new Map<string, MvpSupplierCandidate[]>()
  for (const candidate of candidates) {
    const key = `${candidate.supplierId}|${candidate.sourceProductId}|${candidate.sourceOptionId}`
    groups.set(key, [...(groups.get(key) ?? []), candidate])
  }
  return new Map(
    [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, "ko-KR")),
  )
}

function productGroupKey(value: string): string {
  return cleanKey(
    value
      .replace(/\[[^\]]*\]|\([^)]*\)/gu, " ")
      .replace(/\d+(?:\.\d+)?\s*(?:kg|g|개입|개|팩|봉|박스|망|과|R)/giu, " "),
  )
}

function optionKey(value: string): string {
  const matches = [...value.matchAll(/\d+(?:\.\d+)?\s*(?:kg|g|개입|개|팩|봉|박스|망|과|R)/giu)].map(
    (match) => cleanKey(match[0] ?? ""),
  )
  return matches.length > 0 ? matches.join("|") : cleanKey(value)
}

function duplicateExposureSuspects(products: readonly MvpWooProduct[]): number {
  let count = 0
  for (const product of products) {
    const seen = new Set<string>()
    for (const variation of product.variations) {
      const key = optionKey(optionName(variation))
      if (seen.has(key)) count += 1
      seen.add(key)
    }
  }
  return count
}

function csv(rows: readonly MvpSyncPlanRow[]): string {
  const columns = [
    "product_id",
    "variation_id",
    "woocommerce_product_name",
    "woocommerce_option_name",
    "current_price",
    "new_price",
    "current_stock_status",
    "new_stock_status",
    "current_supplier_id",
    "selected_supplier_id",
    "available_supplier_count",
    "supplier_candidates_summary",
    "match_type",
    "confidence",
    "action",
    "safety_status",
    "reason_korean",
  ] as const
  return `${columns.join(",")}\n${rows.map((row) => columns.map((column) => csvCell(String(row[column] ?? ""))).join(",")).join("\n")}\n`
}

function markdown(report: MvpSyncPlanReport): string {
  return `# MVP Sync Plan Summary\n\n- run_failed: ${report.summary.runFailed}\n- dailyfood_option_count: ${report.summary.dailyFoodOptionCount}\n- walldob2b_option_count: ${report.summary.walldob2bOptionCount}\n- woo_product_count: ${report.summary.wooProductCount}\n- woo_variation_count: ${report.summary.wooVariationCount}\n- woocommerce_changed: false\n\n## Actions\n\n${ACTIONS.map((action) => `- ${action}: ${report.summary.actionCounts[action]}`).join("\n")}\n\n## Failure Reasons\n\n${report.summary.failureReasons.map((reason) => `- ${reason}`).join("\n") || "- none"}\n`
}

function countBy<T extends string>(
  rows: readonly MvpSyncPlanRow[],
  keys: readonly T[],
  selector: (row: MvpSyncPlanRow) => T,
): Record<T, number> {
  const result = Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>
  for (const row of rows) result[selector(row)] += 1
  return result
}

async function fetchAllPages(
  request: (page: number) => ReturnType<typeof ky.get>,
): Promise<unknown[]> {
  const rows: unknown[] = []
  for (let page = 1; page <= 50; page += 1) {
    const pageRows = z.array(z.unknown()).parse(await request(page).json())
    rows.push(...pageRows)
    if (pageRows.length < 100) break
  }
  return rows
}

function optionName(variation: MvpWooVariation): string {
  return variation.attributes
    .map((attribute) => attribute.option ?? "")
    .filter(Boolean)
    .join(" / ")
}

function reasonOf(action: MvpSyncAction, matchType: MatchType, availableCount: number): string {
  if (action === "mark_outofstock") return "두 공급처 모두 판매 가능한 후보가 없어 품절 후보입니다."
  if (action === "switch_supplier_and_update_price")
    return "현재 공급처 대신 판매 가능한 최저가 공급처로 전환하고 가격 갱신 후보입니다."
  if (action === "mark_instock") return "판매 가능한 공급처가 있어 instock 전환 후보입니다."
  if (action === "add_variation_candidate")
    return "기존 상품에는 있으나 동일 옵션 variation이 없어 추가 후보입니다."
  if (action === "create_draft_product_candidate")
    return "WooCommerce에 매칭 상품이 없어 draft 생성 후보입니다."
  if (action === "duplicate_draft_hold")
    return "기존 draft 상품과 중복 가능성이 있어 publish 없이 보류합니다."
  if (action === "update_price") return "선택된 최저가 공급처 가격과 현재 가격이 다릅니다."
  if (action === "no_op") return "현재 가격과 품절 상태가 선택 공급처 기준과 일치합니다."
  return availableCount > 0 && matchType === "none"
    ? "매칭 신뢰도가 낮아 검토가 필요합니다."
    : "검토가 필요합니다."
}

function confidenceOf(matchType: MatchType): number {
  if (matchType === "hard_meta") return 1
  if (matchType === "soft_normalized") return 0.72
  if (matchType === "draft_soft") return 0.6
  return 0.3
}

function candidateText(product: CollectedProduct): string {
  return `${product.originalProductName} ${product.originalOptionName ?? ""}`
}

function cleanKey(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/&nbsp;/giu, " ")
    .replace(/[^가-힣a-zA-Z0-9.]/gu, "")
    .toLocaleLowerCase("ko-KR")
}

function sameText(left: string, right: string): boolean {
  return left.length >= 2 && left === right
}

function variationSupplierId(variation: MvpWooVariation): string {
  return (
    metaValue(variation.meta_data, "_supplier_id") ||
    metaValue(variation.meta_data, "_wholesalehub_supplier_id") ||
    metaValue(variation.meta_data, "_wholesalehub_selected_supplier_id")
  )
}

function metaValue(
  meta: readonly { readonly key: string; readonly value: unknown }[],
  key: string,
): string {
  const value = meta.find((item) => item.key === key)?.value
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : ""
}

function numberOrNull(value: string): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function safeJson(value: string): Record<string, unknown> {
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
  return typeof value === "string" || typeof value === "number" ? String(value) : ""
}

function stableSourceId(value: string): string {
  return cleanKey(value).slice(0, 120)
}

function requireFirst<T>(values: readonly T[]): T {
  const first = values[0]
  if (first === undefined) throw new Error("empty candidate group")
  return first
}

function csvCell(value: string): string {
  return /[",\n\r]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value
}
