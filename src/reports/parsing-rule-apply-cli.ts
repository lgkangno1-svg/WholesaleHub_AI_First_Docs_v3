import { writeFile } from "node:fs/promises"
import { z } from "zod"
import { applyParsingRulesToPlans, readPlanInputs } from "./parsing-rule-apply.js"
import { readParsingRuleQuestions, toRules, writeParsingRules } from "./parsing-rule-files.js"
import { writeProductGroupPlanFiles } from "./product-group-plan-files.js"

const OptionsSchema = z.object({
  questionsPath: z.string().min(1),
  groupPath: z.string().min(1),
  optionPath: z.string().min(1),
})
type Options = z.infer<typeof OptionsSchema>

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const questions = await readParsingRuleQuestions(options.questionsPath)
  const rules = toRules(questions)
  await writeParsingRules(rules)
  const plans = await readPlanInputs(options.groupPath, options.optionPath)
  const applied = applyParsingRulesToPlans(plans.groups, plans.options, rules)
  await writeProductGroupPlanFiles(applied.report)
  await writeFile(
    "reports/parsing-rule-application-summary.json",
    `${JSON.stringify(applied.summary, null, 2)}\n`,
    "utf8",
  )
  console.log(JSON.stringify(applied.summary, null, 2))
}

function parseArguments(args: readonly string[]): Options {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error(`Invalid parsing rule apply argument: ${key ?? "unknown"}`)
    }
    values.set(key, value)
  }
  return OptionsSchema.parse({
    questionsPath: values.get("--questions") ?? "reports/parsing-rule-questions.csv",
    groupPath: values.get("--groups") ?? "reports/product-group-plan.json",
    optionPath: values.get("--options") ?? "reports/product-option-plan.json",
  })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
