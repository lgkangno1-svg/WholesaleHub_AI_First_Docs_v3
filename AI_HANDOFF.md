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
- After the search-visibility patch is deployed, register/verify the domain in Google Search Console, Bing Webmaster Tools and Naver Search Advisor, submit `https://hub.avocadoss.co.kr/wp-sitemap.xml`, and record a 14-day baseline for impressions/clicks/index coverage. These account-bound tasks cannot be completed from repository code alone.

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

## SEO · AEO · GEO · LLMO · NEO Hardening — 2026-08-28
- Methodology reviewed from the public MIT-licensed `leopard627/fire-your-seo-agency` skill. Only changes compatible with WholesaleHub's real B2B behavior were adopted; no backlink spam, cloaking, fake schema, hidden SEO copy, invented testimonials or unsupported price claims were added.
- Backup branch before this work: `backup/pre-fire-seo-agency-20260828`.
- `wordpress/mu-plugins/avocadoss-security-headers.php` now also owns conservative search visibility behavior while retaining all existing security headers.
- Adds `/llms.txt` and `/llms-full.txt`, explicit AI/search crawler robots policy (OAI/ChatGPT/Claude/Perplexity/Google-Extended/DeepSeek/Yeti/ora-agent), WordPress sitemap declaration, Markdown `Accept` negotiation for the homepage, and Markdown 404 recovery while preserving real HTTP 404 status.
- Adds `noindex,follow` for internal search, cart, checkout and account surfaces; no authentication boundary is weakened.
- Adds front-page canonical, meta description, OG metadata, optional real-image `og:image`, and `WebSite` + `SearchAction` JSON-LD. WooCommerce remains the owner of Product/Breadcrumb schema to avoid duplicate product graphs.
- `wordpress/plugins/avocadoss-performance/templates/wholesalehub-front-page.php` adds a visible answer-first “도매허브는 어떤 서비스인가요?” section with factual B2B eligibility, public-vs-approved pricing, Excel bulk ordering, and post-purchase claim guidance. This is visible human content, not hidden AI-only copy.
- `tests/search-visibility-policy.test.php` and `.github/workflows/search-visibility-ci.yml` protect the public visibility contract and prohibit accidental exaggerated lowest-price/profit claims.
- Public AI guidance explicitly tells agents not to infer hidden wholesale prices, supplier names, source IDs or supplier costs.
- Production must still be deployed through the safe PowerShell wrapper. After deployment verify HTML/Markdown/robots/llms/sitemap/404 endpoints from the public origin before calling the work complete.

## Recent Commits
- 6a61568 Fix midnight DailyFood catalog catch-up
- 00e4cd2 Fix Production MU deploy on restricted filesystem
- d183c4b Add redundant supplier catalog freshness watchdog
- b04a14b Harden product search and order shipping display
- 4fdf778 Keep Fafane group-buy products visible
- 9bd4ef4 Add Fafane description sync to n8n run
- c37c4e6 Sync Fafane group-buy descriptions
- 1f5a1b1 Apply hub margin in MVP sync plan
- 9a445e6 Redirect customer logins to homepage
- 59b060c Exclude marketing empty box products
