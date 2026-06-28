import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { writeParsingRuleQuestions } from "./parsing-rule-files.js"
import { buildParsingRuleQuestions } from "./parsing-rule-questions.js"

const OptionsSchema = z.object({
  databasePath: z.string().min(1),
  limit: z.number().int().positive(),
})
type Options = z.infer<typeof OptionsSchema>

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const database = new DatabaseSync(resolve(options.databasePath), { readOnly: true })
  try {
    const questions = buildParsingRuleQuestions(database, options.limit)
    await writeParsingRuleQuestions(questions)
    console.log(
      JSON.stringify(
        { questionCount: questions.length, outputPath: "reports/parsing-rule-questions.csv" },
        null,
        2,
      ),
    )
  } finally {
    database.close()
  }
}

function parseArguments(args: readonly string[]): Options {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error(`Invalid parsing question argument: ${key ?? "unknown"}`)
    }
    values.set(key, value)
  }
  return OptionsSchema.parse({
    databasePath: values.get("--db") ?? "data/wholesalehub.sqlite",
    limit: values.has("--limit") ? Number(values.get("--limit")) : 30,
  })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
