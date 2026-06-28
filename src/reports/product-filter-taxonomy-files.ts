import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type {
  ProductFilterTaxonomyReport,
  ProductFilterTaxonomyRow,
} from "./product-filter-taxonomy.js"

const HEADER = [
  "filter_type",
  "filter_label",
  "item_count",
  "option_count",
  "example_product_groups",
  "recommended_display_order",
  "should_show_in_top_filter",
  "memo_korean",
] as const

export async function writeProductFilterTaxonomyFiles(
  report: ProductFilterTaxonomyReport,
): Promise<void> {
  await writeOutput("reports/product-filter-taxonomy.json", JSON.stringify(report.rows, null, 2))
  await writeOutput("reports/product-filter-taxonomy.csv", toCsv(report.rows))
  await writeOutput("reports/product-filter-summary.md", summaryMarkdown(report))
}

function summaryMarkdown(report: ProductFilterTaxonomyReport): string {
  const topItems = report.summary.topExposedItems.join(", ") || "없음"
  return [
    "# 상품 필터 구조 요약",
    "",
    `- 기준 상품군 수: ${report.summary.sourceGroupCount}`,
    `- 기준 옵션 후보 수: ${report.summary.sourceOptionCount}`,
    `- 메인 카테고리 수: ${report.summary.mainCategoryCount}`,
    `- 실제 품목 필터 수: ${report.summary.productItemFilterCount}`,
    `- 속성 필터 종류 수: ${report.summary.attributeFilterKindCount}`,
    `- 상단 노출 추천 품목: ${topItems}`,
    "- 고객 화면에는 공급처명/원가/원본 URL을 노출하지 않는다.",
  ].join("\n")
}

function toCsv(rows: readonly ProductFilterTaxonomyRow[]): string {
  return `${[HEADER, ...rows.map((row) => HEADER.map((field) => row[field]))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n")}\n`
}

function csvCell(value: string | number | boolean): string {
  return `"${String(value).replace(/"/gu, '""')}"`
}

async function writeOutput(path: string, value: string): Promise<void> {
  const target = resolve(path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${value}\n`, "utf8")
}
