# WholesaleHub MVP Operations

## Site Purpose
This site is not for bulk public product creation. Its main purpose is to keep existing WooCommerce DailyFood/walldob2b products synchronized with current supplier price and availability while keeping one customer-facing hub variation per same product/same option.

## Daily Run Order
1. `npm run mvp:plan`
   - Collects latest DailyFood and walldob2b data.
   - Reads WooCommerce products/variations.
   - Writes `reports/mvp-sync-plan.*`.
   - Does not change WooCommerce data.
2. Review `reports/mvp-sync-summary.md` and `reports/mvp-sync-plan.csv`.
3. Execute existing variation sync only when approved:
   - `npm run mvp:sync-existing -- --execute --confirm EXECUTE_MVP_SYNC_EXISTING_VARIATIONS_ONLY`
4. Run customer QA:
   - `npm run mvp:qa`
5. Refresh handoff docs:
   - `npm run mvp:handoff`

## Manual Execution Order
1. Start from `/home/tnfwod/projects/wholesalehub`.
2. Confirm `git status --short --branch`.
3. Run `npm run mvp:plan`.
4. Inspect CSV/JSON/summary reports before any execute command.
5. Run execute commands only with the exact required confirmation string.
6. Run `npm run mvp:qa` after any execute step.
7. Commit code/docs only; reports are ignored by git unless explicitly changed later.

## Dry Run vs Execute
- Dry-run/report commands read supplier and WooCommerce data and write reports only.
- Execute commands change WooCommerce and require both `--execute` and the exact `--confirm` value.
- `mvp:sync-existing` is only for existing variation price, selected supplier meta, and stock status actions allowed by its safety gate.
- `mvp:add-create` is only for approved safe variation additions and draft/private product creation. It must not publish drafts.

## Operational Commands
- `npm run mvp:plan`
- `npm run mvp:sync-existing -- --execute --confirm EXECUTE_MVP_SYNC_EXISTING_VARIATIONS_ONLY`
- `npm run mvp:add-create -- --execute --confirm EXECUTE_MVP_ADD_VARIATIONS_AND_CREATE_DRAFTS`
- `npm run mvp:qa`
- `npm run mvp:handoff`

## Absolute Prohibitions
- Do not print `.env`, API keys, login information, or credentials.
- Do not delete WooCommerce products or variations.
- Do not modify product names, option names, descriptions, images, prices, stock status, or stock quantity unless explicitly authorized for that task.
- Do not create products or variations unless explicitly authorized for that task.
- Do not publish draft/private products automatically.
- Do not run orders, payments, deposits, auto-order, or AdminPlus auto-order flows.
- Do not expose supplier_id, supplier cost, source URL, or original supplier URL on customer pages.

## Key Report Locations
- `reports/mvp-sync-plan.json`
- `reports/mvp-sync-plan.csv`
- `reports/mvp-sync-summary.md`
- `reports/mvp-sync-execute-log.json`
- `reports/mvp-sync-execute-summary.md`
- `reports/mvp-sync-execute-verification.json`
- `reports/mvp-add-create-execute-log.json`
- `reports/mvp-add-create-execute-summary.md`
- `reports/mvp-add-create-verification.json`
- `reports/mvp-customer-qa-summary.md`
- `reports/mvp-customer-qa-results.csv`
- `reports/mvp-customer-qa-leak-check.json`
- `reports/mvp-customer-qa-cart-check.json`
- `reports/mvp-final-summary.md`
- `reports/mvp-handoff-summary.md`

## Incident Files to Check
- `reports/mvp-customer-qa-results.csv` for customer-facing duplicate, leak, price, and cart issues.
- `reports/mvp-customer-qa-cart-check.json` for cart flow failures.
- `reports/mvp-customer-qa-leak-check.json` for supplier/source/cost exposure.
- `reports/mvp-sync-execute-verification.json` for existing variation sync verification.
- `reports/mvp-add-create-verification.json` for add/create verification.

## GitHub Push
1. `git status --short --branch`
2. `git log --oneline origin/main..main`
3. `git push origin main`
4. Re-check `git status --short --branch`.

## First Files for the Next Developer
1. `OPERATIONS.md`
2. `AI_HANDOFF.md`
3. `reports/mvp-final-summary.md`
4. `reports/mvp-customer-qa-summary.md`
