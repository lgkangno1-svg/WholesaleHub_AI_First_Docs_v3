import { readFile } from "node:fs/promises"
import { validateMvpSyncPreflight } from "./mvp-sync-preflight.js"

async function main(): Promise<void> {
  const planPath = valueAfter("--plan") || "reports/mvp-sync-plan.json"
  const destructive = process.argv.includes("--destructive")
  const plan: unknown = JSON.parse(await readFile(planPath, "utf8"))
  const result = validateMvpSyncPreflight(plan, { destructive })
  console.log(JSON.stringify(result))
  if (!result.ok) throw new Error(`MVP sync preflight failed: ${result.reasons.join(", ")}`)
}

function valueAfter(flag: string): string {
  const index = process.argv.indexOf(flag)
  return index < 0 ? "" : process.argv[index + 1] ?? ""
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
