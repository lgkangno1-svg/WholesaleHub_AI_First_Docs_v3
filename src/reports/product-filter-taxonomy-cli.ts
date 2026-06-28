import { z } from "zod"
import { buildProductFilterTaxonomyReport } from "./product-filter-taxonomy.js"
import { writeProductFilterTaxonomyFiles } from "./product-filter-taxonomy-files.js"

const OptionsSchema = z.object({ groupPath: z.string(), optionPath: z.string() })
type Options = z.infer<typeof OptionsSchema>

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const report = await buildProductFilterTaxonomyReport(options.groupPath, options.optionPath)
  await writeProductFilterTaxonomyFiles(report)
  console.log(JSON.stringify(report.summary, null, 2))
}

function parseArguments(args: readonly string[]): Options {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error(`Invalid product filter taxonomy argument: ${key ?? "unknown"}`)
    }
    values.set(key, value)
    index += 1
  }
  return OptionsSchema.parse({
    groupPath: values.get("--groups") ?? "reports/product-group-plan.json",
    optionPath: values.get("--options") ?? "reports/product-option-plan.json",
  })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
