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
- `npm run groupbuy:sync-fafane-descriptions -- --execute --force`

## Absolute Prohibitions
- Do not print `.env`, API keys, login information, or credentials.
- Do not delete WooCommerce products or variations.
- Do not modify product names, option names, descriptions, images, or stock quantity unless explicitly authorized for that task. Fafane 공동구매 상품 설명 동기화는 예외적으로 허용된 자동화 단계다.
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

## Fafane Group-buy Description Sync

- n8n `WholesaleHub MVP Sync` runs `npm run groupbuy:sync-fafane-descriptions -- --execute --force` before order Excel generation.
- Scope: Fafane/Imweb 공동구매 product descriptions only.
- It must not change product names, prices, stock, options, status, images, orders, or customer data.
- Reports: `reports/fafane-description-sync.csv`, `reports/fafane-description-sync-summary.md`.

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

## Order Excel Email

- The n8n workflow `WholesaleHub MVP Sync` prepares order Excel attachments after `orders:export-supplier-excels`.
- Email subject format: `[도매허브] 오늘 발주 엑셀 YYYY-MM-DD`.
- Recipient: `tnfwod@naver.com`.
- Automated email sending is gated to 09:00 Asia/Seoul only; 15:00 and 21:00 runs do not send email.
- Test fixture mode uses 3 temporary in-memory orders: walldob2b 2 rows, dailyfood 1 row. It does not create WooCommerce orders.
- Gmail OAuth must be authorized in n8n before the email node can send. Do not write OAuth tokens or passwords into docs, logs, or git.

## Latest Order Excel Email Test

- Result: success.
- Gmail OAuth credential confirmed: true (`Gmail account 2`).
- Fixture orders used: 3 total, walldob2b 2 and dailyfood 1.
- Test email recipient: `tnfwod@naver.com`.
- Subject format: `[도매허브] 오늘 발주 엑셀 YYYY-MM-DD`.
- Attachments: `reports/orders/walldo-order.xlsx`, `reports/orders/dailyfood-order.xlsx`.
- WooCommerce orders/products/prices/stock/order status changed: none.

## Unsold Deletion Policy

The MVP automation now treats options that are not sold by either walldob2b or DailyFood as delete candidates, not draft/private candidates. Safe deletion is permanent and only runs after supplier collection succeeds. DailyFood is crawled directly at 09:00 and the last successful DailyFood snapshot is reused at 15:00/21:00. If supplier collection fails or an order link exists, deletion is blocked/held.
## AI Context Handoff
- New ChatGPT/Codex conversations must start by reading `docs/ai-context/README.md`.
- Read order: `02-rules.md`, `03-site-purpose.md`, `04-next-fixes.md`, `01-history.md`, `05-reporting.md`.
- The folder records the current operating rules, site purpose, unresolved fixes, and reporting format.

