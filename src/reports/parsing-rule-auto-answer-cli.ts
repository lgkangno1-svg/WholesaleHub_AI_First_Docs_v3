import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { z } from "zod"
import { readParsingRuleQuestions } from "./parsing-rule-files.js"
import type { ParsingRuleQuestion, RuleAction } from "./parsing-rule-types.js"

const OptionsSchema = z.object({ questionsPath: z.string().min(1) })
type Options = z.infer<typeof OptionsSchema>

type RuleDecision = {
  readonly action: RuleAction
  readonly memo: string
}

const QUESTION_HEADER = [
  "term",
  "detected_context",
  "example_supplier_id",
  "example_product_name",
  "example_option_name",
  "current_parser_guess",
  "question",
  "suggested_rule_type",
  "suggested_action",
  "user_answer",
  "user_memo",
] as const

const DECISIONS: ReadonlyMap<string, RuleDecision> = new Map([
  ["참외", decision("same_product", "참외/성주참외는 같은 품목 후보")],
  ["성주참외", decision("same_product", "참외/성주참외는 같은 품목 후보")],
  ["가정용", decision("separate_product_group", "품질/용도 차이로 product_group 분리")],
  ["특품", decision("separate_product_group", "품질/등급 차이로 product_group 분리")],
  ["선물용", decision("separate_product_group", "용도 차이로 product_group 분리")],
  ["못난이", decision("separate_product_group", "품질 차이로 product_group 분리")],
  ["흠과", decision("separate_product_group", "품질 차이로 product_group 분리")],
  ["소과", decision("option_attribute", "크기 차이는 옵션 속성")],
  ["중과", decision("option_attribute", "크기 차이는 옵션 속성")],
  ["대과", decision("option_attribute", "크기 차이는 옵션 속성")],
  ["소", decision("option_attribute", "크기 차이는 옵션 속성")],
  ["중", decision("option_attribute", "크기 차이는 옵션 속성")],
  ["대", decision("option_attribute", "크기 차이는 옵션 속성")],
  ["박스", decision("option_attribute", "포장/구성은 옵션 속성")],
  ["팩", decision("option_attribute", "포장/구성은 옵션 속성")],
  ["망", decision("option_attribute", "포장/구성은 옵션 속성")],
  ["망고스틴", decision("block", "망고와 망고스틴은 절대 병합 금지")],
  ["무지개망고", decision("separate_product_group", "망고 품종 차이로 product_group 분리")],
  ["마하차녹망고", decision("separate_product_group", "망고 품종 차이로 product_group 분리")],
  ["애플망고", decision("separate_product_group", "망고 품종 차이로 product_group 분리")],
  ["망고", decision("same_product", "망고 큰 품목 후보. 품종은 별도 분리")],
  ["수박", decision("same_product", "수박 계열 후보. 하우스 여부는 별도 검토")],
  ["복숭아", decision("same_product", "복숭아 큰 품목 후보. 품종은 별도 분리")],
  ["신비복숭아", decision("separate_product_group", "신비복숭아는 별도 품종")],
  ["천도", decision("separate_product_group", "천도복숭아는 별도 품종")],
  ["감자", decision("same_product", "감자 큰 품목 후보")],
  ["홍감자", decision("separate_product_group", "홍감자는 품종/상품군으로 유지")],
  ["햇감자", decision("ignore_for_grouping", "햇감자는 시즌/수식어")],
  ["옥수수", decision("same_product", "옥수수 큰 품목 후보")],
  ["찰옥수수", decision("separate_product_group", "찰옥수수는 별도 product_group")],
  ["초당옥수수", decision("separate_product_group", "초당옥수수는 별도 product_group")],
  ["체리", decision("same_product", "체리는 체리끼리")],
])

const NEEDS_USER_TERMS = new Set(["하우스수박"])

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const questions = await readParsingRuleQuestions(options.questionsPath)
  const answered = questions.map(autoAnswer)
  const needsUser = answered.filter((row) => row.user_answer.length === 0)
  await writeCsv("reports/parsing-rule-questions.csv", answered)
  await writeJson("reports/parsing-rule-questions.json", answered)
  await writeCsv("reports/parsing-rule-questions-needs-user.csv", needsUser)
  await writeJson("reports/parsing-rule-questions-needs-user.json", needsUser)
  console.log(
    JSON.stringify(
      { answeredCount: answered.length - needsUser.length, needsUserCount: needsUser.length },
      null,
      2,
    ),
  )
}

export function autoAnswer(row: ParsingRuleQuestion): ParsingRuleQuestion {
  if (NEEDS_USER_TERMS.has(row.term)) return row
  const found = DECISIONS.get(row.term)
  if (found === undefined) return row
  return { ...row, user_answer: found.action, user_memo: found.memo }
}

function decision(action: RuleAction, memo: string): RuleDecision {
  return { action, memo }
}

function parseArguments(args: readonly string[]): Options {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error(`Invalid parsing rule auto-answer argument: ${key ?? "unknown"}`)
    }
    values.set(key, value)
  }
  return OptionsSchema.parse({
    questionsPath: values.get("--questions") ?? "reports/parsing-rule-questions.csv",
  })
}

async function writeCsv(path: string, rows: readonly ParsingRuleQuestion[]): Promise<void> {
  const values = [QUESTION_HEADER, ...rows.map((row) => QUESTION_HEADER.map((field) => row[field]))]
  await writeOutput(path, `${values.map((row) => row.map(csvCell).join(",")).join("\n")}\n`)
}

async function writeJson(path: string, rows: readonly ParsingRuleQuestion[]): Promise<void> {
  await writeOutput(path, `${JSON.stringify(rows, null, 2)}\n`)
}

function csvCell(value: string): string {
  return `"${value.replace(/"/gu, '""')}"`
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
