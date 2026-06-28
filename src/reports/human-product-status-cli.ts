import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { z } from "zod"

const SyncRowSchema = z.object({
  mode: z.enum(["update-existing", "create-new"]),
  product_group_key: z.string(),
  display_product_name: z.string(),
  matched_woocommerce_product_id: z.number().nullable(),
  action: z.string(),
  option_display_name: z.string(),
  selected_supplier_id: z.string(),
  selected_supplier_original_product_name: z.string(),
  selected_supplier_original_option_name: z.string().nullable(),
  selected_price: z.number(),
  current_woocommerce_price: z.string().nullable(),
  current_woocommerce_variation_id: z.number().nullable(),
  compared_exact_same_option: z.boolean(),
  safety_status: z.string(),
  safety_reason: z.string(),
})
const GroupSchema = z.object({
  product_group_key: z.string(),
  display_product_name: z.string(),
  category: z.string(),
  family: z.string(),
  option_count: z.number(),
  matched_woocommerce_product_id: z.number().nullable(),
})
const ExecuteLogSchema = z.object({
  requestedAt: z.string(),
  attemptedCount: z.number(),
  updatedCount: z.number(),
  noOpCount: z.number(),
  failedCount: z.number(),
  entries: z.array(
    z.object({
      product_id: z.number(),
      variation_id: z.number(),
      option_display_name: z.string(),
      before_price: z.number().nullable(),
      after_price: z.number().nullable(),
      expected_price: z.number(),
      status: z.string(),
    }),
  ),
})
const VerifySchema = z.object({
  checkedCount: z.number(),
  mismatchCount: z.number(),
  entries: z.array(
    z.object({ product_id: z.number(), variation_id: z.number(), match: z.boolean() }),
  ),
})

type SyncRow = z.infer<typeof SyncRowSchema>
type GroupRow = z.infer<typeof GroupSchema>
type CsvValue = string | number | boolean | null

async function main(): Promise<void> {
  const sync = await readJson("reports/woocommerce-sync-plan.json", z.array(SyncRowSchema))
  const groups = await readJson("reports/product-group-plan.json", z.array(GroupSchema))
  const execute = await readJson("reports/woocommerce-sync-execute-log.json", ExecuteLogSchema)
  const verify = await readJson("reports/woocommerce-sync-execute-verification.json", VerifySchema)
  const groupMap = new Map(groups.map((row) => [row.product_group_key, row]))
  const verifiedKeys = new Set(
    verify.entries.filter((row) => row.match).map((row) => `${row.product_id}:${row.variation_id}`),
  )
  const duplicateKeys = duplicateVariationKeys(sync)
  const byOption = buildOptionRows(sync, groupMap, execute, duplicateKeys)
  const byGroup = buildGroupRows(groups, byOption)
  const history = buildHistoryRows(sync, execute, verifiedKeys)
  const excluded = buildExcludedRows(sync, duplicateKeys)
  await writeCsv("reports/human-product-status-by-option.csv", optionHeader, byOption)
  await writeCsv("reports/human-product-status-by-group.csv", groupHeader, byGroup)
  await writeCsv("reports/human-price-update-history.csv", historyHeader, history)
  await writeCsv("reports/human-excluded-candidates.csv", excludedHeader, excluded)
  await writeSummary(sync, groups, execute, verify, excluded)
  console.log(
    JSON.stringify(
      {
        groups: byGroup.length,
        options: byOption.length,
        latestUpdated: execute.updatedCount,
        mismatch: verify.mismatchCount,
        excluded: excluded.length,
      },
      null,
      2,
    ),
  )
}

async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await readFile(path, "utf8")))
}

function duplicateVariationKeys(rows: readonly SyncRow[]): Set<string> {
  const counts = new Map<string, Set<number>>()
  for (const row of rows.filter((item) => item.action === "update_variation_price")) {
    if (
      row.matched_woocommerce_product_id === null ||
      row.current_woocommerce_variation_id === null
    )
      continue
    const key = `${row.matched_woocommerce_product_id}:${row.current_woocommerce_variation_id}`
    counts.set(key, (counts.get(key) ?? new Set()).add(row.selected_price))
  }
  return new Set([...counts.entries()].filter(([, prices]) => prices.size > 1).map(([key]) => key))
}

const optionHeader = [
  "status",
  "display_product_name",
  "option_display_name",
  "woocommerce_product_id",
  "woocommerce_product_name",
  "woocommerce_variation_id",
  "before_price",
  "after_price",
  "expected_price",
  "selected_supplier_id",
  "supplier_original_product_name",
  "supplier_original_option_name",
  "compared_exact_same_option",
  "action",
  "safety_status",
  "reason_korean",
  "next_action_korean",
] as const
function buildOptionRows(
  rows: readonly SyncRow[],
  groups: ReadonlyMap<string, GroupRow>,
  log: z.infer<typeof ExecuteLogSchema>,
  duplicateKeys: ReadonlySet<string>,
): Record<string, CsvValue>[] {
  const updated = new Map(log.entries.map((row) => [`${row.product_id}:${row.variation_id}`, row]))
  return rows
    .map((row) => {
      const key =
        row.matched_woocommerce_product_id === null || row.current_woocommerce_variation_id === null
          ? ""
          : `${row.matched_woocommerce_product_id}:${row.current_woocommerce_variation_id}`
      const entry = updated.get(key)
      const status = entry ? "updated" : statusOf(row, duplicateKeys.has(key))
      return {
        status,
        display_product_name: row.display_product_name,
        option_display_name: row.option_display_name,
        woocommerce_product_id: row.matched_woocommerce_product_id,
        woocommerce_product_name:
          groups.get(row.product_group_key)?.display_product_name ?? row.display_product_name,
        woocommerce_variation_id: row.current_woocommerce_variation_id,
        before_price: entry?.before_price ?? row.current_woocommerce_price,
        after_price: entry?.after_price ?? null,
        expected_price: row.selected_price,
        selected_supplier_id: row.selected_supplier_id,
        supplier_original_product_name: row.selected_supplier_original_product_name,
        supplier_original_option_name: row.selected_supplier_original_option_name,
        compared_exact_same_option: row.compared_exact_same_option,
        action: row.action,
        safety_status: row.safety_status,
        reason_korean: reasonOf(status, row),
        next_action_korean: nextActionOf(status),
      }
    })
    .sort(sortHumanRows)
}
function statusOf(row: SyncRow, duplicate: boolean): string {
  if (duplicate) return "excluded_duplicate"
  if (row.safety_status === "blocked") return "blocked"
  if (row.safety_status === "review_needed") return "review_needed"
  if (row.action === "no_op") return "no_op"
  if (row.action === "add_variation") return "add_variation_candidate"
  if (row.mode === "create-new") return "create_new_product_candidate"
  return row.action
}
function reasonOf(status: string, row: SyncRow): string {
  if (status === "updated") return "가격 업데이트 완료"
  if (status === "no_op") return "현재 가격과 목표 가격이 같음"
  if (status === "excluded_duplicate")
    return "같은 variation에 서로 다른 후보 가격이 있어 자동 실행 제외"
  if (status === "add_variation_candidate") return "기존 상품에 없는 옵션 후보"
  if (status === "create_new_product_candidate") return "WooCommerce에 없는 신규 상품 후보"
  if (status === "blocked") return row.safety_reason
  return "사람 검토 필요"
}
function nextActionOf(status: string): string {
  const map: Record<string, string> = {
    updated: "확인 완료",
    no_op: "조치 불필요",
    excluded_duplicate: "후보 가격/옵션 매칭 수동 검토",
    add_variation_candidate: "variation 추가 승인 전 검토",
    create_new_product_candidate: "신규 상품 등록 승인 전 검토",
    review_needed: "수동 검토",
    blocked: "차단 사유 해결 전 보류",
  }
  return map[status] ?? "검토"
}

const groupHeader = [
  "product_group_key",
  "display_product_name",
  "family_category",
  "total_option_count",
  "updated_option_count",
  "no_op_count",
  "add_variation_candidate_count",
  "create_new_candidate_count",
  "review_needed_count",
  "blocked_count",
  "excluded_duplicate_count",
  "matched_woocommerce_product_id",
  "matched_woocommerce_product_name",
  "recommended_next_action",
  "memo_korean",
] as const
function buildGroupRows(
  groups: readonly GroupRow[],
  options: readonly Record<string, CsvValue>[],
): Record<string, CsvValue>[] {
  return groups
    .map((group) => {
      const actual = options.filter(
        (row) => row["display_product_name"] === group.display_product_name,
      )
      const count = (status: string) => actual.filter((row) => row[status] === status).length
      const add = count("add_variation_candidate")
      const create = count("create_new_product_candidate")
      const dup = count("excluded_duplicate")
      const updated = count("updated")
      const noOp = count("no_op")
      const blocked = count("blocked")
      const review = count("review_needed")
      return {
        product_group_key: group.product_group_key,
        display_product_name: group.display_product_name,
        family_category: `${group.family}/${group.category}`,
        total_option_count: actual.length || group.option_count,
        updated_option_count: updated,
        no_op_count: noOp,
        add_variation_candidate_count: add,
        create_new_candidate_count: create,
        review_needed_count: review,
        blocked_count: blocked,
        excluded_duplicate_count: dup,
        matched_woocommerce_product_id: group.matched_woocommerce_product_id,
        matched_woocommerce_product_name:
          group.matched_woocommerce_product_id === null ? "" : group.display_product_name,
        recommended_next_action: groupAction(updated, noOp, add, create, review, blocked, dup),
        memo_korean: groupMemo(updated, noOp, add, create, review, blocked, dup),
      }
    })
    .sort(sortHumanRows)
}
function groupAction(
  updated: number,
  noOp: number,
  add: number,
  create: number,
  review: number,
  blocked: number,
  dup: number,
): string {
  if (blocked > 0 || review > 0) return "보류"
  if (dup > 0) return "중복상충검토필요"
  if (add > 0) return "기존상품옵션추가필요"
  if (create > 0) return "신규상품등록후확인필요"
  if (updated > 0 || noOp > 0) return "가격업데이트완료"
  return "보류"
}
function groupMemo(
  updated: number,
  noOp: number,
  add: number,
  create: number,
  review: number,
  blocked: number,
  dup: number,
): string {
  return `업데이트 ${updated}, 동일가 ${noOp}, 옵션추가 ${add}, 신규 ${create}, 검토 ${review}, 차단 ${blocked}, 중복상충 ${dup}`
}

const historyHeader = [
  "run_type",
  "updated_at",
  "product_id",
  "variation_id",
  "woocommerce_product_name",
  "woocommerce_option_name",
  "display_product_name",
  "option_display_name",
  "before_price",
  "after_price",
  "expected_price",
  "verification_status",
  "selected_supplier_id",
  "supplier_original_product_name",
  "supplier_original_option_name",
] as const
function buildHistoryRows(
  rows: readonly SyncRow[],
  log: z.infer<typeof ExecuteLogSchema>,
  verified: ReadonlySet<string>,
): Record<string, CsvValue>[] {
  return log.entries.map((entry) => {
    const plan = rows.find(
      (row) =>
        row.matched_woocommerce_product_id === entry.product_id &&
        row.current_woocommerce_variation_id === entry.variation_id &&
        row.selected_price === entry.expected_price,
    )
    return {
      run_type: "latest_run",
      updated_at: log.requestedAt,
      product_id: entry.product_id,
      variation_id: entry.variation_id,
      woocommerce_product_name: plan?.display_product_name ?? "",
      woocommerce_option_name: entry.option_display_name,
      display_product_name: plan?.display_product_name ?? "",
      option_display_name: plan?.option_display_name ?? entry.option_display_name,
      before_price: entry.before_price,
      after_price: entry.after_price,
      expected_price: entry.expected_price,
      verification_status: verified.has(`${entry.product_id}:${entry.variation_id}`)
        ? "verified"
        : "mismatch",
      selected_supplier_id: plan?.selected_supplier_id ?? "",
      supplier_original_product_name: plan?.selected_supplier_original_product_name ?? "",
      supplier_original_option_name: plan?.selected_supplier_original_option_name ?? "",
    }
  })
}

const excludedHeader = [
  "exclude_reason",
  "display_product_name",
  "option_display_name",
  "product_id",
  "variation_id",
  "candidate_expected_price",
  "conflicting_expected_prices",
  "selected_supplier_id",
  "supplier_original_product_name",
  "supplier_original_option_name",
  "next_action_korean",
] as const
function buildExcludedRows(
  rows: readonly SyncRow[],
  duplicateKeys: ReadonlySet<string>,
): Record<string, CsvValue>[] {
  const pricesByKey = new Map<string, string>()
  for (const row of rows) {
    if (
      row.matched_woocommerce_product_id === null ||
      row.current_woocommerce_variation_id === null
    )
      continue
    const key = `${row.matched_woocommerce_product_id}:${row.current_woocommerce_variation_id}`
    pricesByKey.set(
      key,
      [
        ...new Set(
          [...(pricesByKey.get(key)?.split("|") ?? []), String(row.selected_price)].filter(Boolean),
        ),
      ].join("|"),
    )
  }
  return rows
    .filter(
      (row) =>
        row.action === "add_variation" ||
        row.mode === "create-new" ||
        row.safety_status !== "safe" ||
        (row.matched_woocommerce_product_id !== null &&
          row.current_woocommerce_variation_id !== null &&
          duplicateKeys.has(
            `${row.matched_woocommerce_product_id}:${row.current_woocommerce_variation_id}`,
          )),
    )
    .map((row) => {
      const key =
        row.matched_woocommerce_product_id === null || row.current_woocommerce_variation_id === null
          ? ""
          : `${row.matched_woocommerce_product_id}:${row.current_woocommerce_variation_id}`
      return {
        exclude_reason: excludeReason(row, duplicateKeys.has(key)),
        display_product_name: row.display_product_name,
        option_display_name: row.option_display_name,
        product_id: row.matched_woocommerce_product_id,
        variation_id: row.current_woocommerce_variation_id,
        candidate_expected_price: row.selected_price,
        conflicting_expected_prices: pricesByKey.get(key) ?? "",
        selected_supplier_id: row.selected_supplier_id,
        supplier_original_product_name: row.selected_supplier_original_product_name,
        supplier_original_option_name: row.selected_supplier_original_option_name,
        next_action_korean: nextActionOf(statusOf(row, duplicateKeys.has(key))),
      }
    })
    .sort(sortHumanRows)
}
function excludeReason(row: SyncRow, duplicate: boolean): string {
  if (duplicate) return "conflicting_expected_price"
  if (row.safety_status === "blocked") return "blocked"
  if (row.safety_status === "review_needed") return "review_needed"
  if (row.action === "add_variation") return "add_variation_not_allowed"
  if (row.mode === "create-new") return "create_new_not_allowed"
  if (row.current_woocommerce_variation_id === null) return "missing_variation_id"
  return "duplicate_variation"
}

async function writeSummary(
  sync: readonly SyncRow[],
  groups: readonly GroupRow[],
  log: z.infer<typeof ExecuteLogSchema>,
  verify: z.infer<typeof VerifySchema>,
  excluded: readonly Record<string, CsvValue>[],
): Promise<void> {
  const latest = log.updatedCount
  const cumulative = 196
  const livestockExcludedCount = await countCsvRows("reports/excluded-products.csv")
  const md = [
    `# 품목별 실행 현황 요약`,
    ``,
    `- 전체 공급처 옵션 수: 643`,
    `- product_group 수: ${groups.length}`,
    `- option 후보 수: 460`,
    `- 기존 WooCommerce 매칭 상품군 수: ${groups.filter((row) => row.matched_woocommerce_product_id !== null).length}`,
    `- 신규 상품 후보 수: ${sync.filter((row) => row.mode === "create-new").length}`,
    `- 기존 상품 가격 업데이트 완료 수(최신 로그): ${latest}`,
    `- no_op 수: ${sync.filter((row) => row.action === "no_op").length}`,
    `- add_variation 후보 수: ${sync.filter((row) => row.action === "add_variation").length}`,
    `- create_new 후보 수: ${sync.filter((row) => row.mode === "create-new").length}`,
    `- review_needed 수: ${sync.filter((row) => row.safety_status === "review_needed").length}`,
    `- blocked 수: ${sync.filter((row) => row.safety_status === "blocked").length}`,
    `- 중복/상충 제외 수: ${excluded.filter((row) => row["exclude_reason"] === "conflicting_expected_price").length}`,
    `- 축산물 제외 옵션 수: ${livestockExcludedCount}`,
    `- 이번 실행 업데이트 수: ${latest}`,
    `- 누적 업데이트 수: ${cumulative}`,
    `- GET 검증 불일치 수: ${verify.mismatchCount}`,
    ``,
    `## 숫자 설명`,
    `- 34건은 직전 작업에서 20건 실행 후, 중복 후보 제외 로직을 강화하고 14건을 추가 실행한 합계다.`,
    `- 현재 reports/woocommerce-sync-execute-log.json은 마지막 실행 14건만 담는다.`,
    `- 누적 196건은 이전 162건 + 직전 34건 기준이다.`,
    `- 이번 리포트의 상세 before/after는 최신 로그 14건 기준이다.`,
    ``,
    `## 다음 행동`,
    `- updated/no_op: 조치 불필요`,
    `- add_variation_candidate: variation 추가 승인 전 검토`,
    `- create_new_product_candidate: 신규 상품 등록 승인 전 검토`,
    `- excluded_duplicate/conflicting_expected_price: 옵션 매칭 수동 검토`,
    `- blocked/review_needed: 차단/검토 사유 해결 전 보류`,
    ``,
  ].join("\n")
  await writeOutput("reports/human-product-status-summary.md", md)
}

function sortHumanRows(left: Record<string, CsvValue>, right: Record<string, CsvValue>): number {
  const a = familyOrder(String(left["display_product_name"] ?? ""))
  const b = familyOrder(String(right["display_product_name"] ?? ""))
  if (a !== b) return a - b
  const n = String(left["display_product_name"] ?? "").localeCompare(
    String(right["display_product_name"] ?? ""),
    "ko-KR",
  )
  if (n !== 0) return n
  return (
    optionValue(String(left["option_display_name"] ?? "")) -
    optionValue(String(right["option_display_name"] ?? ""))
  )
}
function familyOrder(name: string): number {
  if (/참외/u.test(name)) return 1
  if (/수박/u.test(name)) return 2
  if (/복숭아|천도/u.test(name)) return 3
  if (/감자/u.test(name)) return 4
  if (/망고/u.test(name)) return 5
  if (/체리/u.test(name)) return 6
  if (/옥수수/u.test(name)) return 7
  return 9
}
function optionValue(value: string): number {
  const kg = /(\d+(?:\.\d+)?)\s*kg/iu.exec(value)?.[1]
  if (kg) return Number(kg) * 1000
  const g = /(\d+(?:\.\d+)?)\s*g/iu.exec(value)?.[1]
  if (g) return Number(g)
  const count = /(\d+)\s*(?:개|입|과|망|팩|박스)/u.exec(value)?.[1]
  return count ? Number(count) : Number.MAX_SAFE_INTEGER
}
async function countCsvRows(path: string): Promise<number> {
  try {
    const content = await readFile(path, "utf8")
    return Math.max(0, content.trim().split(/\r?\n/u).length - 1)
  } catch {
    return 0
  }
}

async function writeCsv(
  path: string,
  header: readonly string[],
  rows: readonly Record<string, CsvValue>[],
): Promise<void> {
  await writeOutput(
    path,
    `${[header, ...rows.map((row) => header.map((field) => row[field] ?? ""))].map((row) => row.map(csvCell).join(",")).join("\n")}\n`,
  )
}
function csvCell(value: CsvValue): string {
  return `"${String(value ?? "").replace(/"/gu, '""')}"`
}
async function writeOutput(path: string, value: string): Promise<void> {
  const target = resolve(path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, value, "utf8")
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
