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
- Verify the merged frontend regression guard during normal production use: product search must not render the custom homepage template; order detail must not show a zero-cost `무료 배송` row when a positive WholesaleHub `배송비` fee exists; historical escaped description linebreaks must render cleanly.
- Pull the latest GitHub `main` onto the MiniPC source mirror before the next smoke run so the sitemap redirect-aware test script is used; no storefront redeploy is required solely for this test-script change.
- Register/verify the domain in Google Search Console, Bing Webmaster Tools and Naver Search Advisor, submit `https://hub.avocadoss.co.kr/wp-sitemap.xml`, and record a 14-day baseline for impressions/clicks/index coverage. These account-bound tasks cannot be completed from repository code alone.

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

## SEO · AEO · GEO · LLMO · NEO Hardening — 2026-08-28
- Methodology reviewed from the public MIT-licensed `leopard627/fire-your-seo-agency` skill. Only changes compatible with WholesaleHub's real B2B behavior were adopted; no backlink spam, cloaking, fake schema, hidden SEO copy, invented testimonials or unsupported price claims were added.
- Backup branch before this work: `backup/pre-fire-seo-agency-20260828`.
- `wordpress/mu-plugins/avocadoss-security-headers.php` owns conservative search visibility behavior while retaining all existing security headers.
- Adds `/llms.txt` and `/llms-full.txt`, explicit AI/search crawler robots policy (OAI/ChatGPT/Claude/Perplexity/Google-Extended/DeepSeek/Yeti/ora-agent), WordPress sitemap declaration, Markdown `Accept` negotiation for the homepage, and Markdown 404 recovery while preserving real HTTP 404 status.
- Adds `noindex,follow` for internal search, cart, checkout and account surfaces; no authentication boundary is weakened.
- Adds root canonical, meta description, OG metadata, optional real-image `og:image`, and `WebSite` + `SearchAction` JSON-LD. WooCommerce remains the owner of Product/Breadcrumb schema to avoid duplicate product graphs.
- Public AI guidance explicitly tells agents not to infer hidden wholesale prices, supplier names, source IDs or supplier costs.
- PR #21 merged as `87fda2fc74e14f4ec2814f7d2fcdde1dac5b2b1f`; PR #22 merged as `db67a3ae64e9c1ca173413268ec5f83ead593cf2`.

## Product-First Homepage + Markdown Follow-up — 2026-08-28
- User priority: merchandising and clean product discovery outrank promotional/SEO explainer blocks on the visible homepage.
- Backup branch before this follow-up: `backup/pre-product-first-home-20260828`.
- Removed the oversized four-card `도매허브는 어떤 서비스인가요?` block from the visible homepage instead of letting SEO content occupy prime merchandising space.
- Hero navigation now points to recent updates, price drops, business-popular products, and categories.
- Product sections appear immediately after the hero. Each product card keeps image/title/price/shipping facts and adds a clear `상품 보기 →` link.
- Search/AI context remains in metadata, JSON-LD, `/llms.txt`, `/llms-full.txt`, and Markdown representation rather than visible promotional blocks.
- Markdown root negotiation no longer depends on `is_front_page()`. The storefront may be represented by WooCommerce `is_shop()`, so canonical path `/` is now the stable root identity for metadata and `Accept: text/markdown` handling.
- PR #23 merged to `main` as `0ac5ddd6604b0a5c79337a8b1b6d862f580834ac`.

## Production Verification — 2026-08-28
- Production deployment of `0ac5ddd6604b0a5c79337a8b1b6d862f580834ac` completed successfully through `scripts/deploy-wholesalehub.ps1`.
- Deployment checks passed: source/archive preflight, live plugin tree verification, managed MU-plugin verification, PHP validation, deployed HEAD verification, homepage HTTP 200, and search HTTP 200.
- Public smoke after deployment passed homepage product-first rendering, homepage Markdown negotiation (`text/markdown; charset=utf-8` with `Vary: Accept,Accept-Encoding`), robots, `/llms.txt`, and `/llms-full.txt`.
- Smoke stopped at sitemap because the public `/wp-sitemap.xml` returns a legitimate HTTP 301 canonical redirect before the final XML response; the old test did not follow redirects.
- `scripts/search-visibility-smoke.sh` now uses `curl -L` only for the sitemap endpoint and still requires the final response to be 2xx and contain `<sitemapindex>`. This is a test-harness correction, not a storefront behavior change.
- No catalog catch-up was run during the product-first deployment; no product/order/payment/refund/Telegram logic was changed.

## Recent Commits
- 0ac5ddd Product-first homepage + root Markdown negotiation fix
- db67a3a Add post-deploy search visibility smoke
- 87fda2f Apply fire-your-seo-agency visibility hardening
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
