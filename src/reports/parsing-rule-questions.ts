import type { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import type { ParsingRuleQuestion, RuleAction, RuleType } from "./parsing-rule-types.js"

const RawOptionSchema = z.object({
  supplier_id: z.string(),
  original_product_name: z.string(),
  original_option_name: z.string().nullable(),
  normalized_name: z.string().nullable(),
  option_key: z.string().nullable(),
})
type RawOption = z.infer<typeof RawOptionSchema>

type TermSeed = {
  readonly term: string
  readonly context: string
  readonly ruleType: RuleType
  readonly action: RuleAction
  readonly question: string
}

const TERM_SEEDS: readonly TermSeed[] = [
  seed(
    "성주참외",
    "참외 품목명",
    "product_alias",
    "same_product",
    "성주참외와 참외를 같은 품목 후보로 볼까요?",
  ),
  seed(
    "참외",
    "참외 품목명",
    "product_family",
    "same_product",
    "참외 계열을 같은 상품군 후보로 묶을까요?",
  ),
  seed(
    "가정용",
    "품질/용도",
    "usage",
    "separate_product_group",
    "가정용은 별도 product_group으로 분리할까요?",
  ),
  seed(
    "특품",
    "품질/등급",
    "quality_grade",
    "separate_product_group",
    "특품은 별도 product_group으로 분리할까요?",
  ),
  seed("소과", "크기", "size", "option_attribute", "소과는 옵션 속성으로 표시할까요?"),
  seed("대과", "크기", "size", "option_attribute", "대과는 옵션 속성으로 표시할까요?"),
  seed("수박", "수박 품목명", "product_family", "same_product", "수박은 수박끼리만 묶을까요?"),
  seed(
    "하우스수박",
    "수박 재배/품종 표현",
    "variety",
    "separate_product_group",
    "하우스수박은 일반 수박과 분리할까요?",
  ),
  seed(
    "복숭아",
    "복숭아 품목명",
    "product_family",
    "same_product",
    "복숭아 계열을 같은 품목 후보로 볼까요?",
  ),
  seed(
    "신비복숭아",
    "복숭아 품종",
    "variety",
    "separate_product_group",
    "신비복숭아는 일반 복숭아와 분리할까요?",
  ),
  seed(
    "천도",
    "복숭아 품종",
    "variety",
    "separate_product_group",
    "천도는 별도 품종 product_group으로 둘까요?",
  ),
  seed(
    "감자",
    "감자 품목명",
    "product_family",
    "same_product",
    "감자 계열을 같은 품목 후보로 볼까요?",
  ),
  seed(
    "홍감자",
    "감자 품종",
    "variety",
    "separate_product_group",
    "홍감자는 일반 감자와 분리할까요?",
  ),
  seed(
    "햇감자",
    "감자 시즌 표현",
    "exclude_word",
    "ignore_for_grouping",
    "햇감자의 햇 표현은 그룹핑에서 무시할까요?",
  ),
  seed(
    "망고스틴",
    "망고와 다른 품목",
    "must_separate",
    "block",
    "망고스틴은 망고와 절대 분리할까요?",
  ),
  seed(
    "무지개망고",
    "망고 품종",
    "variety",
    "separate_product_group",
    "무지개망고는 망고 안에서 별도 품종으로 분리할까요?",
  ),
  seed(
    "마하차녹망고",
    "망고 품종",
    "variety",
    "separate_product_group",
    "마하차녹망고는 별도 품종으로 분리할까요?",
  ),
  seed(
    "애플망고",
    "망고 품종",
    "variety",
    "separate_product_group",
    "애플망고는 별도 품종으로 분리할까요?",
  ),
  seed(
    "망고",
    "망고 품목명",
    "product_family",
    "same_product",
    "망고 품종끼리 자동 병합하지 않고 품목 후보로만 볼까요?",
  ),
  seed("체리", "체리 품목명", "product_family", "same_product", "체리는 체리끼리만 묶을까요?"),
  seed(
    "옥수수",
    "옥수수 품목명",
    "product_family",
    "same_product",
    "옥수수 계열을 같은 품목 후보로 볼까요?",
  ),
  seed(
    "찰옥수수",
    "옥수수 품종",
    "variety",
    "separate_product_group",
    "찰옥수수는 초당옥수수와 분리할까요?",
  ),
  seed(
    "초당옥수수",
    "옥수수 품종",
    "variety",
    "separate_product_group",
    "초당옥수수는 찰옥수수와 분리할까요?",
  ),
  seed(
    "선물용",
    "용도",
    "usage",
    "separate_product_group",
    "선물용은 별도 product_group으로 분리할까요?",
  ),
  seed(
    "못난이",
    "품질",
    "quality_grade",
    "separate_product_group",
    "못난이는 별도 product_group으로 분리할까요?",
  ),
  seed(
    "흠과",
    "품질",
    "quality_grade",
    "separate_product_group",
    "흠과는 별도 product_group으로 분리할까요?",
  ),
  seed("중과", "크기", "size", "option_attribute", "중과는 옵션 속성으로 표시할까요?"),
  seed("박스", "포장", "packaging", "option_attribute", "박스 표기는 옵션명에 유지할까요?"),
  seed(
    "팩",
    "포장",
    "packaging",
    "option_attribute",
    "팩 구성은 옵션명과 option_key에 반영할까요?",
  ),
  seed(
    "망",
    "포장",
    "packaging",
    "option_attribute",
    "망 구성은 옵션명과 option_key에 반영할까요?",
  ),
] as const

export function buildParsingRuleQuestions(
  database: DatabaseSync,
  limit = 30,
): readonly ParsingRuleQuestion[] {
  const rows = readRawOptions(database)
  return TERM_SEEDS.map((term) => toQuestion(term, rows))
    .filter((row): row is ParsingRuleQuestion => row !== null)
    .sort(
      (left, right) =>
        Number(right.detected_context.split("회")[0]) -
        Number(left.detected_context.split("회")[0]),
    )
    .slice(0, limit)
}

function readRawOptions(database: DatabaseSync): readonly RawOption[] {
  const rows = database
    .prepare(`
    SELECT r.supplier_id, r.original_product_name, r.original_option_name,
      n.normalized_name, n.option_key
    FROM raw_products r
    LEFT JOIN normalized_products n ON n.raw_product_id = r.id
    ORDER BY r.supplier_id, r.original_product_name, r.original_option_name
  `)
    .all()
  return z.array(RawOptionSchema).parse(rows)
}

function toQuestion(seedValue: TermSeed, rows: readonly RawOption[]): ParsingRuleQuestion | null {
  const matches = rows.filter((row) => textOf(row).includes(seedValue.term))
  const example = matches[0]
  if (example === undefined) return null
  return {
    term: seedValue.term,
    detected_context: `${matches.length}회 / ${seedValue.context}`,
    example_supplier_id: example.supplier_id,
    example_product_name: example.original_product_name,
    example_option_name: example.original_option_name ?? "",
    current_parser_guess: `${example.normalized_name ?? ""} | ${example.option_key ?? ""}`.trim(),
    question: seedValue.question,
    suggested_rule_type: seedValue.ruleType,
    suggested_action: seedValue.action,
    user_answer: "",
    user_memo: "",
  }
}

function textOf(row: RawOption): string {
  return `${row.original_product_name} ${row.original_option_name ?? ""} ${row.normalized_name ?? ""}`
}

function seed(
  term: string,
  context: string,
  ruleType: RuleType,
  action: RuleAction,
  question: string,
): TermSeed {
  return { term, context, ruleType, action, question }
}
