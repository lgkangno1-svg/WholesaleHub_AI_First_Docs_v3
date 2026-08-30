# AI_HANDOFF

> Current operational handoff. Product/engineering policy is defined by `PROJECT_NORTH_STAR.md`.
>
> **Last reviewed against GitHub `main`: 2026-08-30 KST**
> **Reviewed HEAD:** `2ad712c8665a3d70ffac0b90ce64640aa40cc419`
>
> The SHA above is an audit marker, not permission to assume it is still current. Before every new task, fetch the latest `main`, recent PRs/commits, and the files directly related to the task.

## Canonical Reading Order

1. `PROJECT_NORTH_STAR.md` — top-level product, safety, automation, UX, cost and deployment policy.
2. Latest GitHub `main` + recent PRs/commits — source of truth for what is actually implemented now.
3. `AGENTS.md` — common execution rules.
4. `AI_HANDOFF.md` — current operational state, known evidence and next priorities.
5. Task-specific `PRD/`, `OPERATIONS.md`, `docs/`, tests and deployment scripts.

Do not treat old conversation memory, old handoff counts, a MiniPC working tree, or an earlier deployment marker as newer than GitHub `main` without verification.

## Current Project

- Canonical repository: `lgkangno1-svg/WholesaleHub_AI_First_Docs_v3`
- MiniPC project path historically used by runtime: `/home/tnfwod/projects/wholesalehub`
- Canonical development branch: `main`
- Purpose: run WholesaleHub as a B2B operating platform that safely unifies supplier products/options/prices/shipping conditions, keeps the customer-facing catalog coherent, reduces repetitive purchasing work, and hides internal supplier structure from customers.
- Core data model: `Canonical Product -> Public Option -> Supplier Offer`.

## Current MVP State — historical execution snapshot

The figures below are proven historical execution results and must not be assumed to be today's live counts without regenerating current reports.

- MVP 1 sync plan complete: DailyFood 448 options, walldob2b 225 options, WooCommerce 218 products / 789 variations at plan time, no WooCommerce changes.
- MVP 2 existing variation sync complete: 87 existing variations updated across two executions, failures 0, no new products or variations.
- MVP 3 add/create complete: 61 variations added to existing products, 11 draft/private products created, 125 new variations created, public new products 0, livestock applied 0.
- MVP 4 customer QA complete: duplicate option suspects 0 after QA refinement, cart QA failures 0, supplier/cost/source URL exposure 0, public new product exposure 0, draft/private customer exposure 0.

Before acting on held/review/draft counts, regenerate or inspect the current reports instead of reusing old `60 held` / `11 draft` figures.

## Operational Commands

- `npm run mvp:plan`
- `npm run mvp:sync-existing -- --execute --confirm "EXECUTE_MVP_SYNC_EXISTING_VARIATIONS_ONLY"`
- `npm run mvp:add-create -- --execute --confirm "EXECUTE_MVP_ADD_VARIATIONS_AND_CREATE_DRAFTS"`
- `npm run mvp:qa`
- `npm run mvp:handoff`
- `npm run mvp:export-review`
- `npm run mvp:n8n-run`

Read-only production diagnostics now also exist for catalog/order health, current Woo order state, Telegram AI control-plane discovery, and the customer purchase funnel. Prefer these evidence collectors before making speculative runtime changes.

## Key Reports

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
- `reports/mvp-final-summary.md`
- `reports/mvp-handoff-summary.md`

## Automation and Supplier Freshness

### WholesaleHub MVP Sync

- Workflow name: `WholesaleHub MVP Sync`.
- Historical configured schedule: 09:00, 15:00, 21:00 Asia/Seoul.
- SSH command: `cd /home/tnfwod/projects/wholesalehub && bash scripts/n8n-mvp-sync.sh`.
- Automation includes supplier collection, existing variation sync, safe add-variation flow, draft/private product creation, customer QA, review export and handoff refresh.
- New products must stay draft/private until the approved human/Telegram review path publishes them.
- Import JSON fallback: `docs/n8n-wholesalehub-mvp-sync.workflow.json`.

### DailyFood freshness policy — current

PR #32 / commit `7d43bd0d910bbce774700d55ae9484893d1b9174` changed the canonical catalog behavior:

- Do **not** restore same-day DailyFood snapshot reuse after the first crawl.
- Every configured supplier-catalog synchronization run must perform a fresh DailyFood crawl and a fresh Walldo crawl before grouping/Woo synchronization.
- Newly discovered products/options remain approval-gated and must not silently become public.
- Existing image-detail evidence may still be reused where safe; correctness of product/option/price/stock/shipping/spec change detection takes priority over crawl savings.
- Binding policy: `docs/DAILYFOOD_REFRESH_POLICY.md`.

### Catalog watchdog

- Walldo watchdog logic is schedule-aware rather than a naive absolute 14-hour threshold.
- The known schedule used by the watchdog is 11:00 and 18:00 KST with grace windows.
- PR #29 fixed the normal overnight 18:00 -> morning gap being misreported as stale.
- PR #30 added a read-only catalog/order health diagnostic.
- PR #31 aligned order screening with the real supplier exporter rather than obsolete line-item assumptions.

## Latest Proven Operations Evidence — 2026-08-29

A read-only operations diagnostic at approximately 09:52 KST showed:

- DailyFood snapshot complete/fresh: 132 products / 663 options.
- Walldo snapshot complete/fresh: 30 products / 157 options.
- Catalog runtime completed successfully with exit 0.
- WordPress container was running and bootstrap succeeded.
- Supplier-order exporter screening found 0 pending rows, 0 pending orders, 0 pending-before-07:00 rows and 0 source-unmapped orders.
- Therefore the observed zero-order Telegram report at 07:00 was consistent with exporter state at that time rather than evidence of an order-system failure.

These are point-in-time facts, not permanent catalog counts. Re-run the read-only diagnostic for current production truth.

## Purchase Funnel Diagnostics — 2026-08-30

Latest `main` added a read-only purchase-funnel diagnostic plus Windows wrapper:

- `scripts/purchase-funnel-diagnose.sh` — commit `85570435e121bd8576888955a6e4206ab736dad6`.
- `scripts/purchase-funnel-diagnose.ps1` — commit `2ad712c8665a3d70ffac0b90ce64640aa40cc419`.

The diagnostic is designed to inspect, without customer PII or mutation:

- membership approval counts and recent signups;
- missing pending-approval notices;
- approved users with zero orders / zero points balance;
- 7-day / 30-day order counts and statuses;
- paid/processing orders and charge-payment-pending state;
- cart / checkout / account page existence;
- enabled payment gateways and WholesaleHub points gateway presence;
- a sample of published products for stock and positive-price sanity.

Use this to locate whether a real conversion problem is in approval, balance/top-up, checkout/payment, or catalog availability before changing purchase UX or payment logic.

## Telegram AI Control Plane — current evidence

The old 2026-08-28 statement that the actual runtime had not been discovered is **superseded** by the 2026-08-29 diagnostic.

Proven runtime evidence:

- Telegram AI service: `telegram-codex-bot.service`.
- Telegram AI working directory: `/home/tnfwod/telegram-codex-bot`.
- Router source candidate containing all route tags: `/home/tnfwod/telegram-codex-bot/telegram_codex_bot.py`.
- OpenCodex proxy service: `opencodex-proxy.service`.
- OpenCodex proxy reachable on local TCP `127.0.0.1:10100` during the diagnostic.
- Direct Codex CLI found at `/usr/local/bin/codex`, version `0.150.1` at diagnostic time.
- Antigravity server installation exists under the user's `.antigravity-server` tree.
- OpenCode was not resolved from the diagnostic shell `PATH`, but OpenCode configuration/auth evidence exists. Do not install a duplicate OpenCode runtime until the real service environment is inspected.

Binding documents:

- `docs/TELEGRAM_AI_CONTROL_PLANE_CONTRACT.md`
- `docs/TELEGRAM_AI_CONTROL_PLANE_STATUS_2026-08-29.md`
- `docs/TELEGRAM_AI_RUNTIME_FINDINGS_2026-08-29_095842.md`
- `ai/tasks/TELEGRAM_AI_CONTROL_PLANE_REPAIR.md`

### Telegram/control-plane remaining blockers

Do not mark the control plane complete until all of the following are proven through the real Telegram path:

1. explicit `codex_direct` route;
2. explicit `opencodex_deepseek_flash` route;
3. explicit `opencodex_antigravity` route;
4. Korean UTF-8 round trip without `???` or mojibake;
5. direct Codex sandbox works in the actual service context using the narrowest safe fix;
6. no silent model/provider fallback;
7. a harmless authorized Hub change can go source -> tests -> safe deploy -> public smoke with rollback evidence.

Do not globally weaken sysctl, AppArmor, sandboxing, systemd hardening or file permissions merely to make an AI route work.

## Critical MiniPC Git Worktree Drift

The 2026-08-29 diagnostic proved a serious source-control hygiene issue on the MiniPC:

- MiniPC `.git` HEAD was older than the deployed artifact marker.
- Tracked dirty count was 384 at diagnostic time.
- The deployment wrapper can overlay release files into `/home/tnfwod/projects/wholesalehub` without advancing that checkout's Git metadata.

Consequences:

- Do not treat that dirty worktree as a trustworthy representation of GitHub `main`.
- Do not run `git reset --hard` or `git clean` without first proving no local work is at risk.
- Before enabling Telegram AI to modify WholesaleHub, use a dedicated clean checkout/worktree for AI development whenever possible, then deploy through the canonical verified deployment path.
- An AI worker must not claim the existing hundreds of dirty files as changes it created.

See `docs/MINIPC_SOURCE_GIT_DRIFT_2026-08-29.md` and the runtime findings document.

## Frontend Regression Hardening — 2026-08-28

- PR #17 merged to `main` as `b04a14bd49c9c023a69a7bfe06d27bb8996ac53a`.
- Added `wordpress/mu-plugins/wholesalehub-frontend-regressions.php`.
- Product search requests such as `/?s=자두&post_type=product` remove the custom `WholesaleHub_Homepage` template/style hooks so normal WooCommerce/theme search rendering wins.
- Customer order totals hide only the zero-cost Woo `shipping` row when the order has a positive fee named `배송비`; monetary totals and any real non-zero Woo shipping remain unchanged.
- Supplier-lane product content converts historical literal escaped CR/LF tokens to visible line breaks at render time without mutating stored product data.
- Added `tests/wholesalehub-frontend-regressions.test.php` and CI coverage.

## SEO · AEO · GEO · LLMO · NEO Hardening — 2026-08-28

- Methodology reviewed from the public MIT-licensed `leopard627/fire-your-seo-agency` skill. Only changes compatible with WholesaleHub's real B2B behavior were adopted; no backlink spam, cloaking, fake schema, hidden SEO copy, invented testimonials or unsupported price claims were added.
- `wordpress/mu-plugins/avocadoss-security-headers.php` owns conservative search visibility behavior while retaining existing security headers.
- Added `/llms.txt` and `/llms-full.txt`, explicit AI/search crawler policy, WordPress sitemap declaration, Markdown `Accept` negotiation and Markdown 404 recovery with real HTTP 404 status.
- Added `noindex,follow` for internal search, cart, checkout and account surfaces.
- Added root canonical, meta description, OG metadata and `WebSite` + `SearchAction` JSON-LD while leaving Product/Breadcrumb schema ownership to WooCommerce/current SEO tooling.
- Public AI guidance forbids inference/exposure of hidden wholesale prices, supplier names, source IDs or supplier costs.
- PR #21 merged as `87fda2fc74e14f4ec2814f7d2fcdde1dac5b2b1f`; PR #22 merged as `db67a3ae64e9c1ca173413268ec5f83ead593cf2`.

## Product-First Homepage + Markdown Follow-up — 2026-08-28

- Merchandising and clean product discovery outrank promotional/SEO explainer blocks on the visible homepage.
- Removed the oversized four-card service explanation block from prime storefront space.
- Hero navigation prioritizes recent updates, price drops, business-popular products and categories.
- Product sections appear immediately after the hero; cards retain image/title/price/shipping facts and a clear product-view affordance.
- Search/AI context remains primarily in metadata, JSON-LD, llms files and Markdown representation.
- PR #23 merged to `main` as `0ac5ddd6604b0a5c79337a8b1b6d862f580834ac`.

## Production Verification History — 2026-08-28 to 2026-08-29

- Production deployment of `0ac5ddd6604b0a5c79337a8b1b6d862f580834ac` succeeded through `scripts/deploy-wholesalehub.ps1` with source/archive preflight, managed plugin verification, PHP validation, deployed-HEAD verification and homepage/search HTTP checks.
- Sitemap smoke was corrected to follow the legitimate canonical redirect while still requiring final 2xx XML with `<sitemapindex>`.
- A later prior-main deployment referenced in the 2026-08-29 control-plane status also succeeded with homepage/search HTTP 200 and managed plugin verification.

For any current production claim, inspect the live deployed marker and smoke results again. Do not infer that every later GitHub commit is deployed merely because it is merged.

## Absolute Prohibitions

- Do not print or commit `.env`, API keys, login information, bot tokens, passwords or credentials.
- Do not delete WooCommerce products or variations unless the user has explicitly approved the exact destructive operation and the current safety policy permits it. Legacy hard-delete paths are not a default maintenance mechanism.
- Do not modify customer-facing product names, option names, descriptions, images, prices, stock state or quantities outside an explicitly authorized, tested sync/change path.
- Do not create or publish public products/variations outside the approved mapping/approval flow.
- Do not automatically publish draft/private products.
- Do not run real customer orders, payments, deposits/top-ups, refunds, tax issuance, supplier orders or AdminPlus auto-order flows as QA.
- Do not expose supplier IDs/names, supplier cost, source URL, original supplier URL or internal price-comparison results to customers.
- Do not use CAPTCHA bypass, blocking bypass, hidden credential/token extraction or speculative security weakening.

## Current Execution Priorities — 2026-08-30

1. **Use GitHub latest-main as the development source of truth.** Before every change, audit latest `main`, recent PRs and task-related files; do not inherit the stale MiniPC dirty worktree as a development baseline.
2. **Establish a clean AI development worktree/checkout on the MiniPC** before Telegram AI is allowed to make WholesaleHub code changes.
3. **Finish Telegram AI control-plane acceptance** for direct Codex, OpenCode DeepSeek Flash and Antigravity, including UTF-8 and sandbox fixes with no silent fallback.
4. **Run/consume the read-only purchase-funnel diagnostic** and use evidence to determine whether approval, balance/top-up, checkout/payment or catalog state is limiting real purchases.
5. **Keep supplier freshness fail-visible.** DailyFood refreshes on every configured catalog sync; Walldo schedule-aware watchdog and operations-health diagnostics stay enabled/verified.
6. **Verify real order and CS flow in production** without executing synthetic real-money actions.
7. **Recompute held/review/draft catalog counts before manual cleanup**; old handoff counts are historical only.
8. **Verify the current production deploy marker and frontend smoke** before claiming a merged feature is live.
9. **Complete account-bound search registration work** (Google Search Console, Bing Webmaster Tools, Naver Search Advisor, sitemap submission and baseline measurement) when credentials/ownership access are available.

## Recent Notable Changes

- `2ad712c` — Windows wrapper for read-only purchase-funnel diagnostic.
- `8557043` — read-only purchase-funnel diagnostic.
- `7d43bd0` — DailyFood refresh on every configured catalog sync; policy/test/CI locked.
- `6d71437` — Windows wrapper for live Woo order checker.
- `2de691b` — read-only live Woo order checker.
- `cfeae42` — documented proven Telegram AI runtime findings.
- `5f5df12` — documented MiniPC Git metadata/worktree drift affecting AI workers.
- `69e8826` / related control-plane commits — Telegram AI diagnostic contract and CI validation.
- PR #31 — operations order screening aligned to the real supplier exporter.
- PR #30 — read-only catalog/order health diagnostic.
- PR #29 — Walldo catalog watchdog aligned to 11:00/18:00 KST schedule.
- PR #28 — `PROJECT_NORTH_STAR.md` established as the canonical product/engineering/improvement charter.

## Documentation Maintenance Rule

After any meaningful implementation, bug fix, deployment or runtime discovery:

- update `AI_HANDOFF.md` in the same change/PR when the current operational state or next priorities changed;
- update `PROJECT_NORTH_STAR.md` in the same change/PR **only** when product goals, operating policy, automation scope, safety/security boundaries, UX direction, cost principles or development/deployment standards changed;
- do not edit North Star just to record routine implementation details;
- when this handoff conflicts with newer GitHub code/tests/PR evidence, the newer verified evidence wins and this handoff must be corrected.
