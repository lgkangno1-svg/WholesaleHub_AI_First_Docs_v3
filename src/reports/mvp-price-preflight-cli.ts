import { readFile } from "node:fs/promises"
import { z } from "zod"
import { validateMvpPriceRows } from "./mvp-price-preflight.js"

const PlanSchema = z.object({ rows: z.array(z.unknown()) })

async function main(): Promise<void> {
  const planPath = valueAfter("--plan") || "reports/mvp-sync-plan.json"
  const plan = PlanSchema.parse(JSON.parse(await readFile(planPath, "utf8")))
  const result = validateMvpPriceRows(plan.rows)
  console.log(JSON.stringify(result))
  if (!result.ok) throw new Error(`MVP price preflight failed: ${result.reasons.join(", ")}`)
}

function valueAfter(flag: string): string {
  const index = process.argv.indexOf(flag)
  return index < 0 ? "" : process.argv[index + 1] ?? ""
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
