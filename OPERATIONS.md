# WholesaleHub MVP Operations

## Site Purpose
This site is not for bulk public product creation. Its main purpose is to keep existing WooCommerce DailyFood/walldob2b products synchronized with current supplier price and availability while keeping one customer-facing hub variation per same product/same option.

## Daily Automated Run
- n8n workflow name: `WholesaleHub MVP Sync`
- Schedule: 09:00, 15:00, 21:00 Asia/Seoul
- SSH command: `cd /home/tnfwod/projects/wholesalehub && bash scripts/n8n-mvp-sync.sh`
- Import fallback: `docs/n8n-wholesalehub-mvp-sync.workflow.json`

The automation runs supplier collection, existing variation sync, safe new option add_variation, draft/private new product creation, customer QA, review export, and handoff refresh. New products must remain draft/private until a human reviews them in WordPress and manually publishes them.

## Manual Run Order
1. `npm run mvp:plan`
2. Review `reports/mvp-sync-summary.md` and `reports/mvp-sync-plan.csv`.
3. Existing variation sync when approved:
   - `npm run mvp:sync-existing -- --execute --confirm EXECUTE_MVP_SYNC_EXISTING_VARIATIONS_ONLY`
4. Safe add/create when approved:
   - `npm run mvp:add-create -- --execute --confirm EXECUTE_MVP_ADD_VARIATIONS_AND_CREATE_DRAFTS`
5. Customer QA:
   - `npm run mvp:qa`
6. Export review reports:
   - `npm run mvp:export-review`
7. Refresh handoff docs:
   - `npm run mvp:handoff`

## Dry Run vs Execute
- Dry-run/report commands read supplier and WooCommerce data and write reports only.
- Execute commands change WooCommerce and require both `--execute` and the exact `--confirm` value.
- `mvp:sync-existing` is only for existing variation price, selected supplier meta, and stock status actions allowed by its safety gate.
- `mvp:add-create` is only for safe variation additions and draft/private product creation. It must not publish drafts.

## Operational Commands
- `npm run mvp:plan`
- `npm run mvp:sync-existing -- --execute --confirm EXECUTE_MVP_SYNC_EXISTING_VARIATIONS_ONLY`
- `npm run mvp:add-create -- --execute --confirm EXECUTE_MVP_ADD_VARIATIONS_AND_CREATE_DRAFTS`
- `npm run mvp:qa`
- `npm run mvp:export-review`
- `npm run mvp:handoff`
- `npm run mvp:n8n-run`
- `npm run orders:supplier-report -- --days 7`

## Absolute Prohibitions
- Do not print `.env`, API keys, login information, or credentials.
- Do not delete WooCommerce products or variations.
- Do not modify product names, option names, descriptions, images, or stock quantity unless explicitly authorized for that task.
- Do not create public new products automatically.
- Do not publish draft/private products automatically.
- Do not run orders, payments, deposits, auto-order, or AdminPlus auto-order flows.
- Do not expose supplier_id, supplier cost, source URL, or original supplier URL on customer pages.

## Admin Supplier Tools
- WooCommerce admin product list shows a supplier-only `공급처` column.
- Variation edit rows show read-only supplier/source metadata for admins.
- New order line items store `_hub_*` supplier snapshot meta at checkout time; hidden from customer views and emails.
- Supplier labels are fixed as `데일리`, `월억`, and `미확인`.
- `npm run orders:supplier-report -- --days 7` creates recent order fulfillment CSV/summary without WooCommerce writes.

## Key Report Locations
- `reports/mvp-sync-plan.json`
- `reports/mvp-sync-plan.csv`
- `reports/mvp-sync-summary.md`
- `reports/mvp-sync-safety-review.csv`
- `reports/mvp-sync-safety-review-summary.md`
- `reports/mvp-sync-execute-log.json`
- `reports/mvp-sync-execute-summary.md`
- `reports/mvp-sync-execute-verification.json`
- `reports/mvp-add-create-safety-review.csv`
- `reports/mvp-add-create-execute-log.json`
- `reports/mvp-add-create-execute-summary.md`
- `reports/mvp-add-create-verification.json`
- `reports/mvp-customer-qa-summary.md`
- `reports/mvp-customer-qa-results.csv`
- `reports/mvp-customer-qa-leak-check.json`
- `reports/mvp-customer-qa-cart-check.json`
- `reports/mvp-final-summary.md`
- `reports/mvp-handoff-summary.md`
- `reports/order-supplier-fulfillment-report.csv`
- `reports/order-supplier-fulfillment-summary.md`

## Incident Files to Check
- `reports/n8n-run-latest.log`
- `reports/n8n-run-YYYYMMDD-HHMM.log`
- `reports/mvp-customer-qa-results.csv`
- `reports/mvp-customer-qa-cart-check.json`
- `reports/mvp-customer-qa-leak-check.json`
- `reports/mvp-sync-execute-verification.json`
- `reports/mvp-add-create-verification.json`
- `reports/windows-export-unavailable.md`

## Windows Review Folder
- Windows: `C:\Users\tnfwo\Desktop\hub검수`
- Linux/WSL: `/mnt/c/Users/tnfwo/Desktop/hub검수`

## GitHub Push
1. `git status --short --branch`
2. `git log --oneline origin/main..main`
3. `git push origin main`
4. Re-check `git status --short --branch`.

## First Files for the Next Developer
1. `OPERATIONS.md`
2. `docs/n8n-operations.md`
3. `AI_HANDOFF.md`
4. `reports/mvp-final-summary.md`

## n8n Test Status
- Workflow: `WholesaleHub MVP Sync` (`jVFfCJtfEax1GeDQ`)
- Schedule: 09:00, 15:00, 21:00 Asia/Seoul
- Last test: 2026-06-29T23:16:45+0900
- Manual Test Trigger exists and is connected to `Run WholesaleHub MVP Sync`.
- Schedule Trigger remains connected to `Run WholesaleHub MVP Sync`.
- Manual Trigger workflow execution succeeded and reached the SSH node.
- `scripts/n8n-mvp-sync.sh` returned exit code 0 and refreshed `reports/n8n-run-latest.log`.
- Workflow is active.
- Test report: `reports/n8n-test-summary.md`
