import { readFile } from "node:fs/promises"

export type FilterType =
  | "main_category"
  | "product_family"
  | "product_item"
  | "quality_grade"
  | "size"
  | "weight"
  | "quantity"
  | "sale_status"

export type ProductFilterTaxonomyRow = {
  readonly filter_type: FilterType
  readonly filter_label: string
  readonly item_count: number
  readonly option_count: number
  readonly example_product_groups: string
  readonly recommended_display_order: number
  readonly should_show_in_top_filter: boolean
  readonly memo_korean: string
}

type ProductGroupRow = {
  readonly product_group_key: string
  readonly display_product_name: string
  readonly category?: string
  readonly family?: string
  readonly option_count?: number
}

type ProductOptionRow = {
  readonly product_group_key: string
  readonly display_product_name: string
  readonly option_display_name: string
  readonly normalized_option_key: string
}

const TYPE_ORDER: Record<FilterType, number> = {
  main_category: 10,
  product_family: 20,
  product_item: 30,
  quality_grade: 40,
  size: 50,
  weight: 60,
  quantity: 70,
  sale_status: 80,
}

export type ProductFilterTaxonomyReport = {
  readonly rows: readonly ProductFilterTaxonomyRow[]
  readonly summary: {
    readonly mainCategoryCount: number
    readonly productItemFilterCount: number
    readonly attributeFilterKindCount: number
    readonly topExposedItems: readonly string[]
    readonly sourceGroupCount: number
    readonly sourceOptionCount: number
  }
}

export async function buildProductFilterTaxonomyReport(
  groupPath: string,
  optionPath: string,
): Promise<ProductFilterTaxonomyReport> {
  const groups = JSON.parse(await readFile(groupPath, "utf8")) as readonly ProductGroupRow[]
  const options = JSON.parse(await readFile(optionPath, "utf8")) as readonly ProductOptionRow[]
  const rows = applyTopFilterVisibility(
    sortRows([
      ...aggregate(groups, options, "main_category", mainCategoryOf),
      ...aggregate(groups, options, "product_family", familyOf),
      ...aggregate(groups, options, "product_item", (group) => group.display_product_name),
      ...aggregateAttribute(groups, options, "quality_grade", qualityLabels),
      ...aggregateAttribute(groups, options, "size", sizeLabels),
      ...aggregateAttribute(groups, options, "weight", weightLabels),
      ...aggregateAttribute(groups, options, "quantity", quantityLabels),
      ...saleStatusRows(groups, options),
    ]),
  )
  return { rows, summary: summarize(rows, groups.length, options.length) }
}

function aggregate(
  groups: readonly ProductGroupRow[],
  options: readonly ProductOptionRow[],
  filterType: FilterType,
  labelOf: (group: ProductGroupRow) => string,
): readonly ProductFilterTaxonomyRow[] {
  const optionsByGroup = mapOptionsByGroup(options)
  const buckets = new Map<string, { groups: Set<string>; options: number }>()
  for (const group of groups) {
    const label = labelOf(group).trim() || "기타"
    const bucket = buckets.get(label) ?? { groups: new Set<string>(), options: 0 }
    bucket.groups.add(group.display_product_name)
    bucket.options += optionsByGroup.get(group.product_group_key)?.length ?? group.option_count ?? 0
    buckets.set(label, bucket)
  }
  return [...buckets.entries()].map(([label, bucket], index) =>
    toRow(filterType, label, bucket, index),
  )
}

function aggregateAttribute(
  groups: readonly ProductGroupRow[],
  options: readonly ProductOptionRow[],
  filterType: FilterType,
  labelsOf: (option: ProductOptionRow) => readonly string[],
): readonly ProductFilterTaxonomyRow[] {
  const groupName = new Map(
    groups.map((group) => [group.product_group_key, group.display_product_name]),
  )
  const buckets = new Map<string, { groups: Set<string>; options: number }>()
  for (const option of options) {
    for (const label of labelsOf(option)) {
      const bucket = buckets.get(label) ?? { groups: new Set<string>(), options: 0 }
      bucket.groups.add(groupName.get(option.product_group_key) ?? option.display_product_name)
      bucket.options += 1
      buckets.set(label, bucket)
    }
  }
  return [...buckets.entries()].map(([label, bucket], index) =>
    toRow(filterType, label, bucket, index),
  )
}

function saleStatusRows(
  groups: readonly ProductGroupRow[],
  options: readonly ProductOptionRow[],
): readonly ProductFilterTaxonomyRow[] {
  const groupNames = new Set(groups.map((group) => group.display_product_name))
  return [toRow("sale_status", "판매 후보", { groups: groupNames, options: options.length }, 0)]
}

function toRow(
  filterType: FilterType,
  label: string,
  bucket: { readonly groups: ReadonlySet<string>; readonly options: number },
  index: number,
): ProductFilterTaxonomyRow {
  return {
    filter_type: filterType,
    filter_label: label,
    item_count: bucket.groups.size,
    option_count: bucket.options,
    example_product_groups: [...bucket.groups].slice(0, 5).join("; "),
    recommended_display_order: TYPE_ORDER[filterType] + index,
    should_show_in_top_filter: shouldShow(filterType, bucket.options, index),
    memo_korean: memoOf(filterType),
  }
}

function shouldShow(filterType: FilterType, optionCount: number, index: number): boolean {
  if (filterType === "main_category" || filterType === "sale_status") return true
  if (filterType === "product_family") return optionCount >= 8
  if (filterType === "product_item") return index < 12 && optionCount >= 3
  return optionCount >= 5
}

function mainCategoryOf(group: ProductGroupRow): string {
  const text = clean(`${group.display_product_name} ${group.family ?? ""}`)
  if (/감자|옥수수/u.test(text)) return "채소/농산물"
  if (/참외|수박|복숭아|망고|체리|과일/u.test(text)) return "과일"
  return group.category ?? "기타"
}

function familyOf(group: ProductGroupRow): string {
  return group.family?.trim() || familyFromText(group.display_product_name)
}

function familyFromText(value: string): string {
  const text = clean(value)
  if (text.includes("망고스틴")) return "망고스틴"
  if (text.includes("망고")) return "망고"
  if (text.includes("참외")) return "참외"
  if (text.includes("수박")) return "수박"
  if (text.includes("복숭아")) return "복숭아"
  if (text.includes("감자")) return "감자"
  if (text.includes("체리")) return "체리"
  if (text.includes("옥수수")) return "옥수수"
  return "기타"
}

function qualityLabels(option: ProductOptionRow): readonly string[] {
  return uniqueWords(textOf(option), ["가정용", "특품", "선물용", "못난이", "흠과", "랜덤", "혼합"])
}

function sizeLabels(option: ProductOptionRow): readonly string[] {
  const text = textOf(option)
  const exact = ["소과", "중과", "대과"].filter((word) => text.includes(word))
  const loose = ["소", "중", "대"].filter((word) =>
    new RegExp(`(^|[^가-힣])${word}([^가-힣]|$)`, "u").test(text),
  )
  return [...new Set([...exact, ...loose])]
}

function weightLabels(option: ProductOptionRow): readonly string[] {
  const labels = [...textOf(option).matchAll(/(\d+(?:\.\d+)?)\s*(kg|g)/giu)].map((match) => {
    const value = Number(match[1])
    const unit = match[2]?.toLowerCase()
    if (unit === "g" && value >= 1000) return `${value / 1000}kg`
    return `${value}${unit}`
  })
  return [...new Set(labels)]
}

function quantityLabels(option: ProductOptionRow): readonly string[] {
  const labels = [...textOf(option).matchAll(/(\d+)\s*(개|입|과|망|팩|박스)/gu)].map(
    (match) => `${match[1]}${match[2]}`,
  )
  return [...new Set(labels)]
}

function uniqueWords(text: string, words: readonly string[]): readonly string[] {
  return words.filter((word) => text.includes(word))
}

function textOf(option: ProductOptionRow): string {
  return `${option.display_product_name} ${option.option_display_name} ${option.normalized_option_key}`
}

function applyTopFilterVisibility(
  rows: readonly ProductFilterTaxonomyRow[],
): readonly ProductFilterTaxonomyRow[] {
  let productItemIndex = 0
  return rows.map((row) => {
    if (row.filter_type !== "product_item") return row
    const shouldShow = productItemIndex < 20
    productItemIndex += 1
    return { ...row, should_show_in_top_filter: shouldShow }
  })
}

function sortRows(rows: readonly ProductFilterTaxonomyRow[]): readonly ProductFilterTaxonomyRow[] {
  return [...rows].sort((left, right) => {
    const order = TYPE_ORDER[left.filter_type] - TYPE_ORDER[right.filter_type]
    if (order !== 0) return order
    const count = right.option_count - left.option_count
    if (count !== 0) return count
    return left.filter_label.localeCompare(right.filter_label, "ko-KR")
  })
}

function summarize(
  rows: readonly ProductFilterTaxonomyRow[],
  sourceGroupCount: number,
  sourceOptionCount: number,
): ProductFilterTaxonomyReport["summary"] {
  const attributeTypes = rows
    .filter((row) => !["main_category", "product_family", "product_item"].includes(row.filter_type))
    .map((row) => row.filter_type)
  return {
    mainCategoryCount: rows.filter((row) => row.filter_type === "main_category").length,
    productItemFilterCount: rows.filter((row) => row.filter_type === "product_item").length,
    attributeFilterKindCount: new Set(attributeTypes).size,
    topExposedItems: rows
      .filter((row) => row.filter_type === "product_item" && row.should_show_in_top_filter)
      .map((row) => row.filter_label),
    sourceGroupCount,
    sourceOptionCount,
  }
}

function mapOptionsByGroup(
  options: readonly ProductOptionRow[],
): Map<string, readonly ProductOptionRow[]> {
  const map = new Map<string, ProductOptionRow[]>()
  for (const option of options)
    map.set(option.product_group_key, [...(map.get(option.product_group_key) ?? []), option])
  return map
}

function memoOf(filterType: FilterType): string {
  if (filterType === "product_item") return "실제 판매 후보에 존재하는 품목만 노출 후보로 계산"
  if (filterType === "quality_grade") return "품질/용도는 고객 필터 또는 옵션 보조 정보로 사용"
  if (filterType === "size") return "소/중/대·소과/대과는 옵션 속성으로 유지"
  if (filterType === "weight" || filterType === "quantity")
    return "중량/수량이 다른 옵션은 별도 옵션으로 유지"
  return "상단에는 주요/공통 필터만 우선 노출 추천"
}

function clean(value: string): string {
  return value.replace(/\s+/gu, "").toLowerCase()
}
