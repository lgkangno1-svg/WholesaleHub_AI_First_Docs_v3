# AI_HANDOFF

## Current Project
- Path: /home/tnfwod/projects/wholesalehub
- Branch: main
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
- Verify the merged frontend regression guard after the next Production deploy: product search must not render the custom homepage template; order detail must not show a zero-cost `무료 배송` row when a positive WholesaleHub `배송비` fee exists; historical escaped description linebreaks must render cleanly.

## Absolute Prohibitions
- Do not print .env, API keys, login information, or credentials.
- Do not delete WooCommerce products or variations.
- Do not modify product names, option names, descriptions, images, prices, stock_status, or stock quantity unless explicitly authorized.
- Do not create products or variations unless explicitly authorized.
- Do not publish draft/private products automatically.
- Do not run orders, payments, deposits, auto-order, or AdminPlus auto-order flows.
- Do not expose supplier_id, supplier cost, source URL, or original supplier URL to customers.

## Frontend Regression Hardening — 2026-08-28
- PR #17 merged to `main` as `b04a14bd49c9c023a69a7bfe06d27bb8996ac53a`.
- Added `wordpress/mu-plugins/wholesalehub-frontend-regressions.php`.
- Product search requests such as `/?s=자두&post_type=product` remove the custom `WholesaleHub_Homepage` template/style hooks so normal WooCommerce/theme search rendering wins.
- Customer order totals hide only the zero-cost Woo `shipping` row when the order has a positive fee named `배송비`; monetary totals and any real non-zero Woo shipping remain unchanged.
- Supplier-lane product content converts historical literal `\\r\\n`, `\\n`, and `\\r` tokens to visible line breaks at render time without mutating stored product data.
- Added `tests/wholesalehub-frontend-regressions.test.php` and CI coverage. PR workflow `deploy-wrapper-ci` completed successfully.
- Production deploy was not performed from the GitHub-only session; deploy through the existing safe PowerShell wrapper and verify live HTTP/UI before closing the incident.

## Recent Commits
- b04a14b Harden product search and order shipping display
- 4fdf778 Keep Fafane group-buy products visible
- 9bd4ef4 Add Fafane description sync to n8n run
- c37c4e6 Sync Fafane group-buy descriptions
- 1f5a1b1 Apply hub margin in MVP sync plan
- 9a445e6 Redirect customer logins to homepage
- 59b060c Exclude marketing empty box products
- aed2f3c Update rebuild-public-catalog-v2-cli to use direct site crawler and update handoff
- c197b4b Refactor DailyFood direct site crawler
