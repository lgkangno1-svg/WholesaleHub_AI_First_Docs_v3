import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { parse } from "csv-parse/sync"
import { z } from "zod"
import {
  type ParsingRule,
  type ParsingRuleQuestion,
  ParsingRuleQuestionSchema,
  RuleActionSchema,
} from "./parsing-rule-types.js"

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

type CsvValue = string | number | boolean | null

export async function writeParsingRuleQuestions(
  rows: readonly ParsingRuleQuestion[],
): Promise<void> {
  await writeOutput("reports/parsing-rule-questions.json", JSON.stringify(rows, null, 2))
  await writeOutput("reports/parsing-rule-questions.csv", toCsv(QUESTION_HEADER, rows))
}

export async function readParsingRuleQuestions(
  path: string,
): Promise<readonly ParsingRuleQuestion[]> {
  const content = await readFile(path, "utf8")
  const records = parse(content, { columns: true, skip_empty_lines: true })
  return z.array(ParsingRuleQuestionSchema).parse(records)
}

export async function writeParsingRules(rows: readonly ParsingRule[]): Promise<void> {
  await writeOutput("config/parsing-rules.json", JSON.stringify(rows, null, 2))
}

export function toRules(rows: readonly ParsingRuleQuestion[]): readonly ParsingRule[] {
  return rows.map((row) => {
    const parsedAnswer = RuleActionSchema.safeParse(row.user_answer.trim())
    const answered = parsedAnswer.success
    return {
      ...row,
      effective_action: answered ? parsedAnswer.data : row.suggested_action,
      answered,
    }
  })
}

function toCsv<T extends Record<string, CsvValue>>(
  header: readonly string[],
  rows: readonly T[],
): string {
  const values = [header, ...rows.map((row) => header.map((field) => row[field] ?? ""))]
  return `${values.map((row) => row.map(csvCell).join(",")).join("\n")}\n`
}

function csvCell(value: CsvValue): string {
  return `"${String(value ?? "").replace(/"/gu, '""')}"`
}

async function writeOutput(path: string, value: string): Promise<void> {
  const target = resolve(path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${value}\n`, "utf8")
}
