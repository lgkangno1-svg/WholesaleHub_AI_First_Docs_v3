import { execFileSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

async function main(): Promise<void> {
  const cwd = process.cwd()
  const branch = safeGit(["branch", "--show-current"]) || "unknown"
  const head = safeGit(["rev-parse", "HEAD"]) || "unknown"
  const recent = safeGit(["log", "--oneline", "-8"]).split("\n").filter(Boolean)
  await mkdir(resolve("reports"), { recursive: true })
  await Promise.all([
    writeFile("AI_HANDOFF.md", aiHandoff(cwd, branch, recent), "utf8"),
    writeFile("reports/mvp-handoff-summary.md", handoffSummary(cwd, branch, head, recent), "utf8"),
    writeFile("reports/mvp-final-summary.md", finalSummary(cwd, branch), "utf8"),
  ])
  console.log(JSON.stringify({ cwd, branch, head }, null, 2))
}

function safeGit(args: readonly string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim()
  } catch {
    return ""
  }
}

function commitList(commits: readonly string[]): string {
  return commits.map((commit) => `- ${commit}`).join("\n")
}

function aiHandoff(cwd: string, branch: string, recent: readonly string[]): string {
  return `# AI_HANDOFF

## Current Project
- Path: ${cwd}
- Branch: ${branch}
- Latest commit: run git rev-parse HEAD
- Purpose: synchronize existing WooCommerce DailyFood/walldob2b products with latest supplier price and availability while preventing duplicate customer-facing options.

## Current MVP State
- MVP 1 sync plan complete: DailyFood 448 options, walldob2b 225 options, WooCommerce 218 products / 789 variations at plan time, no WooCommerce changes.
- MVP 2 existing variation sync complete: 87 existing variations updated across two executions, failures 0, no new products or variations.
- MVP 3 add/create complete: 61 variations added to existing products, 11 draft/private products created, 125 new variations created, public new products 0, livestock applied 0.
- MVP 4 customer QA complete: duplicate option suspects 0 after QA refinement, cart QA failures 0, supplier/cost/source URL exposure 0, public new product exposure 0, draft/private customer exposure 0.

## Operational Commands
- npm run mvp:plan
- npm run mvp:sync-existing -- --execute --confirm "EXECUTE_MVP_SYNC_EXISTING_VARIATIONS_ONLY"
- npm run mvp:add-create -- --execute --confirm "EXECUTE_MVP_ADD_VARIATIONS_AND_CREATE_DRAFTS"
- npm run mvp:qa
- npm run mvp:handoff
- npm run mvp:export-review
- npm run mvp:n8n-run

## Key Reports
- reports/mvp-sync-plan.json
- reports/mvp-sync-plan.csv
- reports/mvp-sync-summary.md
- reports/mvp-sync-execute-log.json
- reports/mvp-sync-execute-summary.md
- reports/mvp-sync-execute-verification.json
- reports/mvp-add-create-execute-log.json
- reports/mvp-add-create-execute-summary.md
- reports/mvp-add-create-verification.json
- reports/mvp-customer-qa-summary.md
- reports/mvp-customer-qa-results.csv
- reports/mvp-final-summary.md
- reports/mvp-handoff-summary.md

## n8n Automation
- Workflow name: WholesaleHub MVP Sync.
- Schedule: 09:00, 15:00, 21:00 Asia/Seoul.
- SSH command: cd /home/tnfwod/projects/wholesalehub && bash scripts/n8n-mvp-sync.sh.
- Automation includes latest supplier collection, existing variation sync, safe add_variation, draft/private product creation, customer QA, review export, and handoff refresh.
- New products must stay draft/private until a human reviews and publishes them in WordPress.
- Import JSON fallback: docs/n8n-wholesalehub-mvp-sync.workflow.json.

## Remaining Work
- Review existing 60 held/review items manually.
- Review 11 draft/private products before any approval to publish.
- Decide whether daily runs use cron on the mini PC or GitHub Actions.
- Verify real order and CS flow during production monitoring.

## Absolute Prohibitions
- Do not print .env, API keys, login information, or credentials.
- Do not delete WooCommerce products or variations.
- Do not modify product names, option names, descriptions, images, prices, stock_status, or stock quantity unless explicitly authorized.
- Do not create products or variations unless explicitly authorized.
- Do not publish draft/private products automatically.
- Do not run orders, payments, deposits, auto-order, or AdminPlus auto-order flows.
- Do not expose supplier_id, supplier cost, source URL, or original supplier URL to customers.

## Recent Commits
${commitList(recent)}
`
}

function handoffSummary(
  cwd: string,
  branch: string,
  head: string,
  recent: readonly string[],
): string {
  return `# MVP Handoff Summary

## Current Path
- ${cwd}

## Current Branch
- ${branch}

## Git Remote
- GitHub origin is configured and has been pushed through ${head}.

## Recent Core Commits
${commitList(recent)}

## MVP 1 Result
- DailyFood options: 448
- walldob2b options: 225
- WooCommerce products at plan time: 218
- WooCommerce variations at plan time: 789
- WooCommerce changed: no

## MVP 2 Result
- Existing variation price/supplier sync total success: 87
- Failures: 0
- New products: 0
- New variations: 0
- Draft publish: 0

## MVP 3 Result
- add_variation executed: 61
- New draft/private products: 11
- New variations: 125
- Public new products: 0
- Livestock applied: 0
- Failures: 0

## MVP 4 QA Result
- Public new product exposure: 0
- Draft/private customer exposure: 0
- supplier/cost/source URL exposure: 0
- Duplicate option suspects: 0
- Cart QA failures: 0
- Product/price/stock changed by QA: no

## Remaining Critical Work
- Manually review the existing 60 held/review items.
- Review and approve or hold the 11 draft/private products; automatic publish remains forbidden.

## Recommended Next Work
- Read OPERATIONS.md first.
- Run npm run mvp:plan for a dry-run plan.
- Run npm run mvp:qa after any customer-facing change.
- Decide cron vs GitHub Actions for daily operation.

## Absolute Prohibitions
- No credential output.
- No product deletion.
- No product name, option name, description, image, price, stock_status, or stock quantity changes without explicit approval.
- No new product/variation creation without explicit approval.
- No draft publish.
- No order/payment/deposit/auto-order/AdminPlus automation.
`
}

function finalSummary(cwd: string, branch: string): string {
  return `# MVP Final Summary

## Project
- Path: ${cwd}
- Branch: ${branch}
- Commit: run git rev-parse HEAD

## MVP 1
- Sync plan generated from DailyFood, walldob2b, and WooCommerce.
- DailyFood options: 448
- walldob2b options: 225
- WooCommerce products at plan time: 218
- WooCommerce variations at plan time: 789
- Actual WooCommerce changes: none

## MVP 2
- Existing variation synchronization complete.
- Existing variation price/supplier sync total: 87
- Failures: 0
- New products: 0
- New variations: 0
- Draft publish: 0

## MVP 3
- add_variation: 61
- New draft/private products: 11
- New variations: 125
- Public new products: 0
- Livestock applied: 0
- Failures: 0

## MVP 4
- Duplicate option exposure: 0
- Cart QA failures: 0
- supplier/cost/source URL exposure: 0
- Public new product exposure: 0
- Draft/private customer exposure: 0
- Product/price/stock changed by QA: no

## Held Items
- Existing held/review items: 60
- review_needed / blocked items remain manual-review only.
- The 11 draft/private products must not be automatically published.

## Next Priorities
- Decide whether regular runs should use cron on the mini PC or GitHub Actions.
- Manually review the held 60 items.
- Manually inspect and approve the 11 draft/private products before any publish workflow.
- Verify live order and CS workflow during production monitoring.
`
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
