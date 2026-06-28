import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { z } from "zod"
import type { ParsingRule } from "./parsing-rule-types.js"
import type {
  ProductGroupPlanReport,
  ProductGroupPlanRow,
  ProductOptionPlanRow,
  WooProductPlan,
} from "./product-group-plan.js"

const GroupSchema = z.object({
  product_group_key: z.string(),
  display_product_name: z.string(),
  category: z.string(),
  family: z.string(),
  included_supplier_count: z.number(),
  option_count: z.number(),
  recommended_action: z.enum([
    "update_existing_product",
    "create_new_variable_product",
    "review_needed",
  ]),
  matched_woocommerce_product_id: z.number().nullable(),
  reason: z.string(),
})

const OptionSchema = z.object({
  product_group_key: z.string(),
  display_product_name: z.string(),
  option_display_name: z.string(),
  normalized_option_key: z.string(),
  selected_supplier_id: z.string(),
  selected_supplier_original_product_name: z.string(),
  selected_supplier_original_option_name: z.string().nullable(),
  selected_price: z.number(),
  alternative_suppliers_summary: z.string(),
  compared_exact_same_option: z.boolean(),
  recommended_action: z.enum([
    "update_existing_variation_candidate",
    "create_variation_candidate",
    "review_needed",
  ]),
})

export type RuleApplicationSummary = {
  readonly answeredRuleCount: number
  readonly unansweredMatchedRuleCount: number
  readonly changedOptionCount: number
  readonly reviewNeededOptionCount: number
  readonly productGroupCount: number
}

export async function readPlanInputs(
  groupPath: string,
  optionPath: string,
): Promise<{
  readonly groups: readonly ProductGroupPlanRow[]
  readonly options: readonly ProductOptionPlanRow[]
}> {
  const groups = z.array(GroupSchema).parse(JSON.parse(await readFile(groupPath, "utf8")))
  const options = z.array(OptionSchema).parse(JSON.parse(await readFile(optionPath, "utf8")))
  return { groups, options }
}

export function applyParsingRulesToPlans(
  groups: readonly ProductGroupPlanRow[],
  options: readonly ProductOptionPlanRow[],
  rules: readonly ParsingRule[],
): { readonly report: ProductGroupPlanReport; readonly summary: RuleApplicationSummary } {
  const groupByKey = new Map(groups.map((row) => [row.product_group_key, row]))
  const changedOptions = options.map((row) => applyRulesToOption(row, rules))
  const changedCount = changedOptions.filter((row, index) => row !== options[index]).length
  const reportGroups = rebuildGroups(changedOptions, groupByKey)
  const wooPlans = buildWooPlans(reportGroups, changedOptions)
  return {
    report: {
      supplierOptionCount: changedOptions.length,
      productGroups: reportGroups,
      productOptions: changedOptions,
      wooCreatePlans: wooPlans.filter((row) => row.action === "create"),
      wooUpdatePlans: wooPlans.filter((row) => row.action === "update"),
      exactComparedOptionCount: changedOptions.filter((row) => row.compared_exact_same_option)
        .length,
    },
    summary: {
      answeredRuleCount: rules.filter((rule) => rule.answered).length,
      unansweredMatchedRuleCount: countUnansweredMatches(options, rules),
      changedOptionCount: changedCount,
      reviewNeededOptionCount: changedOptions.filter(
        (row) => row.recommended_action === "review_needed",
      ).length,
      productGroupCount: reportGroups.length,
    },
  }
}

function applyRulesToOption(
  row: ProductOptionPlanRow,
  rules: readonly ParsingRule[],
): ProductOptionPlanRow {
  const text = `${row.display_product_name} ${row.selected_supplier_original_product_name} ${row.selected_supplier_original_option_name ?? ""} ${row.option_display_name}`
  let next = row
  for (const rule of rules) {
    if (!text.includes(rule.term)) continue
    if (!rule.answered) next = { ...next, recommended_action: "review_needed" }
    if (rule.answered && rule.effective_action === "separate_product_group") {
      const display = appendTerm(next.display_product_name, rule.term)
      next = {
        ...next,
        product_group_key: groupKey(display),
        display_product_name: display,
      }
    }
    if (rule.answered && rule.effective_action === "block") {
      next = { ...next, recommended_action: "review_needed" }
    }
  }
  return next
}

function rebuildGroups(
  options: readonly ProductOptionPlanRow[],
  oldGroups: ReadonlyMap<string, ProductGroupPlanRow>,
): readonly ProductGroupPlanRow[] {
  const grouped = new Map<string, ProductOptionPlanRow[]>()
  for (const option of options) {
    grouped.set(option.product_group_key, [
      ...(grouped.get(option.product_group_key) ?? []),
      option,
    ])
  }
  return [...grouped.entries()]
    .map(([key, rows]) => toGroup(key, rows, oldGroups))
    .sort((left, right) =>
      left.display_product_name.localeCompare(right.display_product_name, "ko-KR"),
    )
}

function toGroup(
  key: string,
  rows: readonly ProductOptionPlanRow[],
  oldGroups: ReadonlyMap<string, ProductGroupPlanRow>,
): ProductGroupPlanRow {
  const first = rows[0]
  if (first === undefined) throw new Error("empty rule-applied group")
  const old = oldGroups.get(key)
  const review = rows.some((row) => row.recommended_action === "review_needed")
  return {
    product_group_key: key,
    display_product_name: first.display_product_name,
    category: old?.category ?? "농산물",
    family: old?.family ?? first.display_product_name,
    included_supplier_count: new Set(rows.map((row) => row.selected_supplier_id)).size,
    option_count: rows.length,
    recommended_action: review
      ? "review_needed"
      : (old?.recommended_action ?? "create_new_variable_product"),
    matched_woocommerce_product_id: review ? null : (old?.matched_woocommerce_product_id ?? null),
    reason: review
      ? "parsing rule requires review"
      : (old?.reason ?? "created by parsing rule application"),
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

function countUnansweredMatches(
  options: readonly ProductOptionPlanRow[],
  rules: readonly ParsingRule[],
): number {
  return rules
    .filter((rule) => !rule.answered)
    .filter((rule) =>
      options.some((option) =>
        `${option.display_product_name} ${option.selected_supplier_original_product_name} ${option.selected_supplier_original_option_name ?? ""}`.includes(
          rule.term,
        ),
      ),
    ).length
}

function appendTerm(name: string, term: string): string {
  return name.includes(term) ? name : `${name} ${term}`
}

function groupKey(value: string): string {
  return createHash("sha1")
    .update(value.replace(/[^가-힣a-zA-Z0-9]/gu, "").toLowerCase())
    .digest("hex")
}
