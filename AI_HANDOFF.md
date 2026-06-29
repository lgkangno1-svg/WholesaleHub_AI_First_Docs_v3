# AI_HANDOFF

## Current Project
- Path: /home/tnfwod/projects/wholesalehub
- Branch: main
- Latest commit: run git rev-parse HEADf132cd291f2d64e76d4e00fdd9a71605b8c22927
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
- f132cd2 Refine MVP customer QA checks
- 27063d7 Add MVP customer QA report
- 3d8877d Add MVP add-create executor
- 9eaebbd Consolidate duplicate MVP sync targets
- a1c366f Promote strict safe MVP sync rows
- 952daa9 Add MVP existing variation sync executor
- 624b623 Add MVP sync plan report
- 69eaa0a Add draft vs existing merge report
