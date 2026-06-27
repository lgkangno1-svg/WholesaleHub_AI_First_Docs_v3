import { createHash } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import type { WooCatalogItem } from "../woocommerce/catalog.js"

const SourceRowSchema = z.object({
  raw_product_id: z.number().int(),
  supplier_id: z.string(),
  original_product_name: z.string(),
  original_option_name: z.string().nullable(),
  normalized_name: z.string(),
  option_key: z.string(),
  price: z.number(),
  weight_value: z.number().nullable(),
  quantity: z.number().nullable(),
})
type SourceRow = z.infer<typeof SourceRowSchema>

export type ProductGroupPlanRow = {
  readonly product_group_key: string
  readonly display_product_name: string
  readonly category: string
  readonly family: string
  readonly included_supplier_count: number
  readonly option_count: number
  readonly recommended_action:
    | "update_existing_product"
    | "create_new_variable_product"
    | "review_needed"
  readonly matched_woocommerce_product_id: number | null
  readonly reason: string
}

export type ProductOptionPlanRow = {
  readonly product_group_key: string
  readonly display_product_name: string
  readonly option_display_name: string
  readonly normalized_option_key: string
  readonly selected_supplier_id: string
  readonly selected_supplier_original_product_name: string
  readonly selected_supplier_original_option_name: string | null
  readonly selected_price: number
  readonly alternative_suppliers_summary: string
  readonly compared_exact_same_option: boolean
  readonly recommended_action:
    | "update_existing_variation_candidate"
    | "create_variation_candidate"
    | "review_needed"
}

export type WooProductPlan = {
  readonly action: "create" | "update"
  readonly product_id: number | null
  readonly product_group_key: string
  readonly display_product_name: string
  readonly options: readonly {
    readonly option_display_name: string
    readonly regular_price: string
    readonly internal_supplier_tracking_meta_plan: readonly string[]
  }[]
}

export type ProductGroupPlanReport = {
  readonly supplierOptionCount: number
  readonly productGroups: readonly ProductGroupPlanRow[]
  readonly productOptions: readonly ProductOptionPlanRow[]
  readonly wooCreatePlans: readonly WooProductPlan[]
  readonly wooUpdatePlans: readonly WooProductPlan[]
  readonly exactComparedOptionCount: number
}

export function buildProductGroupPlanReport(
  database: DatabaseSync,
  catalog: readonly WooCatalogItem[],
): ProductGroupPlanReport {
  const sourceRows = readSourceRows(database)
  const selectedOptions = selectCheapestOptions(sourceRows)
  const productGroups = buildProductGroups(selectedOptions, catalog)
  const wooPlans = buildWooPlans(productGroups, selectedOptions)
  return {
    supplierOptionCount: sourceRows.length,
    productGroups,
    productOptions: selectedOptions,
    wooCreatePlans: wooPlans.filter((row) => row.action === "create"),
    wooUpdatePlans: wooPlans.filter((row) => row.action === "update"),
    exactComparedOptionCount: selectedOptions.filter((row) => row.compared_exact_same_option)
      .length,
  }
}

function readSourceRows(database: DatabaseSync): readonly SourceRow[] {
  const rows = database
    .prepare(`
      SELECT r.id AS raw_product_id, r.supplier_id, r.original_product_name,
        r.original_option_name, n.normalized_name, n.option_key, n.price,
        n.weight_value, n.quantity
      FROM normalized_products n
      JOIN raw_products r ON r.id = n.raw_product_id
      WHERE n.price > 0 AND COALESCE(n.stock_status, '') != 'out_of_stock'
      ORDER BY n.normalized_name, n.option_key, n.price
    `)
    .all()
  return z.array(SourceRowSchema).parse(rows)
}

function selectCheapestOptions(rows: readonly SourceRow[]): readonly ProductOptionPlanRow[] {
  const groups = new Map<string, SourceRow[]>()
  for (const row of rows) {
    const key = `${productGroup(row).key}|${row.option_key}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.values()].map(toOptionPlan).sort((left, right) => sortOptions(left, right))
}

function toOptionPlan(rows: readonly SourceRow[]): ProductOptionPlanRow {
  const sorted = [...rows].sort((left, right) => left.price - right.price)
  const selected = sorted[0]
  if (selected === undefined) throw new Error("empty option group")
  const group = productGroup(selected)
  return {
    product_group_key: group.key,
    display_product_name: group.displayName,
    option_display_name: optionDisplayName(selected),
    normalized_option_key: selected.option_key,
    selected_supplier_id: selected.supplier_id,
    selected_supplier_original_product_name: selected.original_product_name,
    selected_supplier_original_option_name: selected.original_option_name,
    selected_price: selected.price,
    alternative_suppliers_summary: sorted
      .map((row) => `${row.supplier_id}:${row.price}`)
      .join("; "),
    compared_exact_same_option: new Set(rows.map((row) => row.supplier_id)).size > 1,
    recommended_action: "create_variation_candidate",
  }
}

function buildProductGroups(
  options: readonly ProductOptionPlanRow[],
  catalog: readonly WooCatalogItem[],
): readonly ProductGroupPlanRow[] {
  const groups = new Map<string, ProductOptionPlanRow[]>()
  for (const option of options)
    groups.set(option.product_group_key, [...(groups.get(option.product_group_key) ?? []), option])
  return [...groups.entries()]
    .map(([key, rows]) => toGroupPlan(key, rows, catalog))
    .sort((left, right) =>
      left.display_product_name.localeCompare(right.display_product_name, "ko-KR"),
    )
}

function toGroupPlan(
  key: string,
  rows: readonly ProductOptionPlanRow[],
  catalog: readonly WooCatalogItem[],
): ProductGroupPlanRow {
  const first = rows[0]
  if (first === undefined) throw new Error("empty product group")
  const matchedProductId = matchWooProduct(first.display_product_name, catalog)
  const supplierCount = new Set(rows.map((row) => row.selected_supplier_id)).size
  return {
    product_group_key: key,
    display_product_name: first.display_product_name,
    category: "농산물",
    family: familyOf(first.display_product_name),
    included_supplier_count: supplierCount,
    option_count: rows.length,
    recommended_action:
      matchedProductId === null ? "create_new_variable_product" : "update_existing_product",
    matched_woocommerce_product_id: matchedProductId,
    reason:
      matchedProductId === null
        ? "no similar WooCommerce product"
        : "matched by product group name",
  }
}

function buildWooPlans(
  groups: readonly ProductGroupPlanRow[],
  options: readonly ProductOptionPlanRow[],
): readonly WooProductPlan[] {
  return groups.map((group) => ({
    action: group.matched_woocommerce_product_id === null ? "create" : "update",
    product_id: group.matched_woocommerce_product_id,
    product_group_key: group.product_group_key,
    display_product_name: group.display_product_name,
    options: options
      .filter((option) => option.product_group_key === group.product_group_key)
      .map((option) => ({
        option_display_name: option.option_display_name,
        regular_price: String(option.selected_price),
        internal_supplier_tracking_meta_plan: [
          "_wholesalehub_supplier_id",
          "_wholesalehub_source_product_id",
          "_wholesalehub_source_option_id",
        ],
      })),
  }))
}

function productGroup(row: SourceRow): { readonly key: string; readonly displayName: string } {
  const text = clean(`${row.normalized_name} ${row.original_product_name}`)
  if (text.includes("망고스틴")) return group("망고스틴")
  if (text.includes("무지개망고") || text.includes("마하차녹망고")) return group("무지개망고")
  if (text.includes("골드망고")) return group("골드망고")
  if (text.includes("성주참외") || text.includes("참외")) return group("성주참외")
  if (text.includes("하우스수박") || text.includes("수박")) {
    return group(text.includes("하우스수박") ? "하우스 수박" : "수박")
  }
  if (text.includes("신비복숭아") || text.includes("신비")) return group("신비복숭아")
  if (text.includes("천도")) return group("천도복숭아")
  if (text.includes("복숭아")) return group("복숭아")
  if (text.includes("홍감자")) return group("홍감자")
  if (text.includes("감자")) return group("감자")
  if (text.includes("체리")) return group("체리")
  if (text.includes("옥수수")) return group("미백 찰옥수수")
  return group(row.normalized_name)
}

function group(displayName: string): { readonly key: string; readonly displayName: string } {
  return { key: createHash("sha1").update(clean(displayName)).digest("hex"), displayName }
}

function optionDisplayName(row: SourceRow): string {
  const text = row.original_option_name ?? row.original_product_name
  return text.replace(/\*/gu, "×").replace(/\s+/gu, " ").trim()
}

function matchWooProduct(displayName: string, catalog: readonly WooCatalogItem[]): number | null {
  const target = clean(displayName)
  const matched = catalog.find((item) => {
    const name = clean(item.productName)
    return (
      target.length >= 2 && name.length >= 2 && (target.includes(name) || name.includes(target))
    )
  })
  return matched?.productId ?? null
}

function familyOf(displayName: string): string {
  const text = clean(displayName)
  if (text.includes("망고")) return "망고"
  if (text.includes("참외")) return "참외"
  if (text.includes("수박")) return "수박"
  if (text.includes("복숭아")) return "복숭아"
  if (text.includes("감자")) return "감자"
  if (text.includes("체리")) return "체리"
  if (text.includes("옥수수")) return "옥수수"
  return "기타"
}

function sortOptions(left: ProductOptionPlanRow, right: ProductOptionPlanRow): number {
  const groupCompare = left.display_product_name.localeCompare(right.display_product_name, "ko-KR")
  if (groupCompare !== 0) return groupCompare
  return optionSortValue(left.normalized_option_key) - optionSortValue(right.normalized_option_key)
}

function optionSortValue(optionKey: string): number {
  const kg = /(\d+(?:\.\d+)?)kg/u.exec(optionKey)?.[1]
  if (kg !== undefined) return Number(kg) * 1000
  const count = /(\d+(?:\.\d+)?)(?:개|입|과|망|팩|봉)/u.exec(optionKey)?.[1]
  if (count !== undefined) return Number(count)
  return Number.MAX_SAFE_INTEGER
}

function clean(value: string): string {
  return value.replace(/[^가-힣a-zA-Z0-9]/gu, "").toLowerCase()
}
