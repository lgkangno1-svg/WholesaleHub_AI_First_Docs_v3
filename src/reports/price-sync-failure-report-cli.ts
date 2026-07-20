import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

const runId = required("--run-id")
const step = required("--step")
const outputPath = required("--out")
const runAt = new Date().toISOString()
const report = {
  report_id: createHash("sha256").update(`${runId}|failed|${step}`).digest("hex"),
  run_id: runId,
  run_at: runAt,
  pipeline_status: "failed",
  supplier_summaries: [],
  totals: {
    checked_count: 0,
    price_change_detected: 0,
    applied_count: 0,
    failed_count: 1,
    no_change_count: 0,
    held_count: 0,
  },
  issue_counts: { pipeline_failed: 1 },
  issue_examples: [
    {
      classification: "pipeline_failed",
      product_name: "가격 동기화 파이프라인",
      option_name: step,
      reason: `pipeline stopped at ${step}`,
    },
  ],
  product_count: 0,
  change_count: 0,
  changes: [],
}

await mkdir(dirname(resolve(outputPath)), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
console.log(JSON.stringify({ runId, status: "failed", step, reportPath: outputPath }))

function required(key: string): string {
  const index = process.argv.indexOf(key)
  const value = index < 0 ? "" : (process.argv[index + 1] ?? "")
  if (!value) throw new Error(`${key} is required`)
  return value
}
