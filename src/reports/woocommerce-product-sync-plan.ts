import { readFile } from "node:fs/promises"
import type { WooCatalogItem } from "../woocommerce/catalog.js"

type Mode = "update-existing" | "create-new" | "all"
type Action =
  | "update_existing_product"
  | "create_new_variable_product"
  | "add_variation"
  | "update_variation_price"
  | "no_op"
  | "review_needed"
  | "blocked"
type Safety = "safe" | "review_needed" | "blocked"

type GroupPlan = {
  readonly product_group_key: string
  readonly display_product_name: string
  readonly matched_woocommerce_product_id: number | null
}

type OptionPlan = {
  readonly product_group_key: string
  readonly display_product_name: string
  readonly option_display_name: string
  readonly normalized_option_key: string
  readonly selected_supplier_id: string
  readonly selected_supplier_original_product_name: string
  readonly selected_supplier_original_option_name: string | null
  readonly selected_price: number
  readonly compared_exact_same_option: boolean
}

export type WooProductSyncPlanRow = {
  readonly mode: "update-existing" | "create-new"
  readonly product_group_key: string
  readonly display_product_name: string
  readonly matched_woocommerce_product_id: number | null
  readonly action: Action
  readonly option_display_name: string
  readonly normalized_option_key: string
  readonly selected_supplier_id: string
  readonly selected_supplier_original_product_name: string
  readonly selected_supplier_original_option_name: string | null
  readonly selected_price: number
  readonly current_woocommerce_price: string | null
  readonly current_woocommerce_variation_id: number | null
  readonly compared_exact_same_option: boolean
  readonly safety_status: Safety
  readonly safety_reason: string
  readonly internal_supplier_meta_plan: readonly string[]
}

export type WooProductSyncSummary = {
  readonly totalActionCount: number
  readonly updateExistingCount: number
  readonly createNewCount: number
  readonly addVariationCount: number
  readonly updateVariationPriceCount: number
  readonly noOpCount: number
  readonly reviewNeededCount: number
  readonly blockedCount: number
}

export async function readProductPlans(
  groupPath: string,
  optionPath: string,
): Promise<{ readonly groups: readonly GroupPlan[]; readonly options: readonly OptionPlan[] }> {
  return {
    groups: JSON.parse(await readFile(groupPath, "utf8")) as readonly GroupPlan[],
    options: JSON.parse(await readFile(optionPath, "utf8")) as readonly OptionPlan[],
  }
}

export function buildWooProductSyncPlan(
  groups: readonly GroupPlan[],
  options: readonly OptionPlan[],
  catalog: readonly WooCatalogItem[],
  mode: Mode,
): readonly WooProductSyncPlanRow[] {
  const groupByKey = new Map(groups.map((group) => [group.product_group_key, group]))
  return options
    .flatMap((option) =>
      toRows(option, groupByKey.get(option.product_group_key) ?? null, catalog, mode),
    )
    .sort((left, right) =>
      `${left.display_product_name}|${left.option_display_name}`.localeCompare(
        `${right.display_product_name}|${right.option_display_name}`,
        "ko-KR",
      ),
    )
}

export function summarizeWooProductSyncPlan(
  rows: readonly WooProductSyncPlanRow[],
): WooProductSyncSummary {
  return {
    totalActionCount: rows.length,
    updateExistingCount: rows.filter((row) => row.mode === "update-existing").length,
    createNewCount: rows.filter((row) => row.mode === "create-new").length,
    addVariationCount: rows.filter((row) => row.action === "add_variation").length,
    updateVariationPriceCount: rows.filter((row) => row.action === "update_variation_price").length,
    noOpCount: rows.filter((row) => row.action === "no_op").length,
    reviewNeededCount: rows.filter((row) => row.safety_status === "review_needed").length,
    blockedCount: rows.filter((row) => row.safety_status === "blocked").length,
  }
}

function toRows(
  option: OptionPlan,
  group: GroupPlan | null,
  catalog: readonly WooCatalogItem[],
  mode: Mode,
): readonly WooProductSyncPlanRow[] {
  const syncMode = group?.matched_woocommerce_product_id === null ? "create-new" : "update-existing"
  if (mode !== "all" && mode !== syncMode) return []
  const variation = findVariation(group?.matched_woocommerce_product_id ?? null, option, catalog)
  const matchedProduct = findMatchedProduct(group?.matched_woocommerce_product_id ?? null, catalog)
  return [toRow(option, group, syncMode, variation, matchedProduct)]
}

function toRow(
  option: OptionPlan,
  group: GroupPlan | null,
  mode: "update-existing" | "create-new",
  variation: WooCatalogItem | null,
  matchedProduct: WooCatalogItem | null,
): WooProductSyncPlanRow {
  const safety = safetyOf(option, group, mode, variation, matchedProduct)
  return {
    mode,
    product_group_key: option.product_group_key,
    display_product_name: option.display_product_name,
    matched_woocommerce_product_id: group?.matched_woocommerce_product_id ?? null,
    action: actionOf(mode, variation, option, safety.status),
    option_display_name: option.option_display_name,
    normalized_option_key: option.normalized_option_key,
    selected_supplier_id: option.selected_supplier_id,
    selected_supplier_original_product_name: option.selected_supplier_original_product_name,
    selected_supplier_original_option_name: option.selected_supplier_original_option_name,
    selected_price: option.selected_price,
    current_woocommerce_price: variation?.price ?? null,
    current_woocommerce_variation_id: variation?.variationId ?? null,
    compared_exact_same_option: option.compared_exact_same_option,
    safety_status: safety.status,
    safety_reason: safety.reason,
    internal_supplier_meta_plan: [
      "_wholesalehub_supplier_id",
      "_wholesalehub_source_product_id",
      "_wholesalehub_source_option_id",
    ],
  }
}

function actionOf(
  mode: "update-existing" | "create-new",
  variation: WooCatalogItem | null,
  option: OptionPlan,
  safety: Safety,
): Action {
  if (safety === "blocked") return "blocked"
  if (mode === "create-new") return "create_new_variable_product"
  if (variation === null) return safety === "safe" ? "add_variation" : "review_needed"
  if (Number(variation.price) === option.selected_price) return "no_op"
  return safety === "safe" ? "update_variation_price" : "review_needed"
}

function safetyOf(
  option: OptionPlan,
  group: GroupPlan | null,
  mode: "update-existing" | "create-new",
  variation: WooCatalogItem | null,
  matchedProduct: WooCatalogItem | null,
): { readonly status: Safety; readonly reason: string } {
  if (option.product_group_key.length === 0)
    return { status: "blocked", reason: "missing product_group_key" }
  if (option.option_display_name.length === 0)
    return { status: "blocked", reason: "missing option name" }
  if (option.selected_price < 1000)
    return { status: "blocked", reason: "price below minimum guard" }
  if (option.selected_supplier_id.length === 0)
    return { status: "blocked", reason: "missing supplier tracking" }
  if (mode === "create-new")
    return { status: "safe", reason: "new draft/private variable product candidate" }
  if (group?.matched_woocommerce_product_id === null)
    return { status: "blocked", reason: "missing matched WooCommerce product" }
  if (variation === null && matchedProduct !== null && matchedProduct.type !== "variable") {
    return {
      status: "review_needed",
      reason: "matched WooCommerce product is not variable; cannot add variation automatically",
    }
  }
  if (variation === null)
    return { status: "safe", reason: "existing product; new variation candidate" }
  return optionLooksSame(option, variation)
    ? { status: "safe", reason: "existing variation option matched" }
    : { status: "review_needed", reason: "existing variation option is ambiguous" }
}

function findMatchedProduct(
  productId: number | null,
  catalog: readonly WooCatalogItem[],
): WooCatalogItem | null {
  if (productId === null) return null
  return catalog.find((item) => item.productId === productId && item.variationId === null) ?? null
}

function findVariation(
  productId: number | null,
  option: OptionPlan,
  catalog: readonly WooCatalogItem[],
): WooCatalogItem | null {
  if (productId === null) return null
  const variations = catalog.filter(
    (item) => item.productId === productId && item.variationId !== null,
  )
  return variations.find((item) => optionLooksSame(option, item)) ?? null
}

function optionLooksSame(option: OptionPlan, item: WooCatalogItem): boolean {
  const left = clean(option.option_display_name)
  const right = clean(`${item.productName} ${item.optionName ?? ""}`)
  const weight = weightToken(option.normalized_option_key)
  return (
    (weight.length > 0 && weight === weightToken(right)) ||
    (left.length >= 2 && right.includes(left))
  )
}

function weightToken(value: string): string {
  return /\d+(?:\.\d+)?kg/iu.exec(value)?.[0]?.toLowerCase() ?? ""
}

function clean(value: string): string {
  return value.replace(/[^가-힣a-zA-Z0-9.]/gu, "").toLowerCase()
}
