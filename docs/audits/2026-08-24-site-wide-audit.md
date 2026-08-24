# WholesaleHub site-wide audit — 2026-08-24

## Scope

Repository: `lgkangno1-svg/WholesaleHub_AI_First_Docs_v3`

Baseline audited: `main` at `779799740967cfca1502e57fc6ec44f3f99d4f64`

Areas reviewed:

- supplier crawlers and catalog synchronization
- source/snapshot/plan/approval/publication safety
- WooCommerce payment and recharge paths
- Telegram operational notifications and approval messages
- customer order / defect-refund workflow
- homepage UX, mobile-first discoverability and basic accessibility
- SEO, answer-engine discoverability (AEO/GEO), structured data and crawl controls
- security headers / public REST surface
- destructive synchronization paths
- build/test/CI health
- production deployment and rollback ergonomics

This audit distinguishes **safe changes implemented now** from **financial/security changes that require dedicated production-equivalent integration QA**.

---

## Executive result

### Fixed in PR #6

1. **Deposit webhook fail-open risk**
   - The legacy permission callback could compare an empty incoming key with an empty missing configuration value.
   - Added an MU guard that fails closed if the secret is not configured and uses `hash_equals()` for configured requests.

2. **DailyFood afternoon freshness blind spot**
   - Later scheduled runs reused the 11:00 snapshot and therefore could not discover source changes made later that day.
   - Added a lightweight authenticated source fingerprint. Later runs perform a full DailyFood collection when the source has changed.

3. **Silent duplicate-run failure mode**
   - A date directory was created before a successful crawl and later treated as a duplicate-run gate. A failed early run could therefore block retries for the rest of the day without a Telegram message.
   - Removed that directory as a gate. `flock` is the concurrency authority; validated successful DailyFood runs now write an atomic success marker for audit only.

4. **Silent lock skip**
   - A scheduled run that cannot acquire the process lock now attempts an operator Telegram notice instead of disappearing silently.

5. **Supplier approval Telegram opt-in trap**
   - Supplier approval notification previously stayed silent when `WHOLESALEHUB_TELEGRAM_APPROVAL_AUTO_SEND` was undefined.
   - Added an MU policy that defaults this operator workflow to enabled while preserving an explicit production override.

6. **Legacy permanent Woo deletion path**
   - The old MVP wrapper could still call the source-absence CLI that contains permanent Woo product/variation deletion logic when a legacy environment switch was enabled.
   - The production wrapper now permanently skips that hard-delete step. Stock visibility/deactivation remains a separate, controlled operation.

7. **Homepage first-use UX**
   - Added explicit product-card CTAs, a four-step “how to use WholesaleHub” section, and visible customer FAQ content.
   - The changes are incremental and preserve the recent visual redesign rather than replacing it.

8. **SEO/AEO crawl baseline**
   - Added `noindex,follow` for cart, checkout, account and internal search surfaces.
   - Added conservative `WebSite`/site-search structured data on the storefront.
   - Kept Product/Breadcrumb data owned by WooCommerce/SEO tooling to avoid duplicate graph conflicts.
   - Added visible Q&A content rather than AI-only hidden text.

9. **CI baseline**
   - Added PHP lint, shell syntax checks, unit tests, a syntax check for the Daily freshness probe and a visible non-blocking TypeScript baseline check.
   - Existing repository-wide type/lint debt is tracked separately rather than hidden by weakening compiler settings.

10. **Surgical Cloudflare deployment helper**
   - Added `scripts/deploy-site-hardening-cloudflare.ps1` for the established `tnfwod@ssh.avocadoss.co.kr` Cloudflare Access path.
   - It fetches the exact Git commit into a temporary worktree, uploads only the approved manifest, backs up each target, copies source + deployed WordPress files, runs syntax/bootstrap/live smoke checks, flushes cache, and can optionally execute a controlled catalog catch-up.
   - It does not `git pull`, reset, stash, or replace the production tree wholesale.

---

## Supplier crawler / catalog audit

### DailyFood

Observed design strengths:

- authenticated AdminPlus source is authoritative
- explicit source identity is preserved
- collector has bounded pagination and detailed snapshot metadata
- catalog plan remains separate from Woo synchronization
- newly discovered products/options go through approval rather than being silently published

Main operational defect found:

- full Daily collection was effectively anchored to the morning snapshot; later scheduled runs could miss newly added products.

New behavior:

```text
scheduled run
→ authenticated Daily source fingerprint
→ unchanged + valid same-day snapshot: reuse snapshot
→ changed / missing / invalid same-day snapshot: full Daily collection
→ validated success marker
→ Walldo collection
→ catalog plan
→ Woo sync / approval staging
→ snapshot publish
→ Telegram summary
```

Manual incident recovery is explicit:

```text
WHOLESALEHUB_FORCE_FULL_DAILY=1
```

This runs the existing pipeline; it does not create a parallel crawler or bypass approval.

### Walldo

Recent work already replaced the stale fixed option-count assumption with dynamic safety logic. This audit does not revert that work.

Required invariant remains:

```text
source identity → snapshot → plan → parent link / supplier offer → public option
```

Supplier offers must append/update without erasing another supplier lane.

### Deletion policy

Permanent product/variation deletion is not an acceptable automatic response to a transient supplier-source absence.

The legacy wrapper now makes the hard-delete path unreachable. Existing safe stock visibility / deactivation tools remain opt-in and separately controlled.

---

## Telegram audit

There are two separate operator paths and both must remain observable:

1. catalog completion/failure/skip messages
2. supplier product/option approval messages

Previous silent conditions:

- lock/date duplicate skip could finish without a catalog message
- approval staging could remain silent if the auto-send constant was undefined

Changes address both conditions.

Expected production behavior after deployment:

- a real supplier-source change detected in a scheduled run results in approval staging and approval Telegram messages
- the catalog pipeline sends its own completion/failure message
- a concurrency skip is visible to the operator
- Telegram token/chat values are never logged

The customer defect/refund Telegram workflow is independent and was previously live-E2E validated with synthetic orders/evidence. This audit does not alter that workflow.

---

## Payment / recharge audit

### Immediate security fix

The deposit REST webhook now has an MU fail-closed guard before application dispatch. A missing server-side secret can no longer authenticate an empty request key.

### Remaining financial correctness item — Issue #7

The current points balance model still uses read → arithmetic → `update_user_meta()` in multiple financial paths.

This can create a race when two payment/deposit operations mutate the same customer balance concurrently.

This was **not** opportunistically rewritten in PR #6 because a correct repair requires:

- one authoritative credit/debit service
- per-user serialization / transaction or advisory locking
- financial-event idempotency
- append-only ledger
- simultaneous-checkout and webhook-retry integration tests

Tracked as:

- `#7 P1: make points balance mutations atomic and idempotent`

No real payment, refund, wallet change or customer order was executed during this audit.

---

## Customer UX / design audit

Existing strengths retained:

- recent homepage design system and responsive product grid
- product search at the hero
- clear recent/price-drop/popular discovery sections
- category entry points
- order-level and product-level customer-service work already exists
- customer claim workflow has four explicit evidence categories and private authorized downloads

Improvements added:

- explicit “상품 자세히 보기” on cards instead of relying only on implicit clickable image/title affordance
- “처음 이용하시나요?” four-step onboarding section
- visible FAQ with operationally accurate answers
- navigation anchor from hero to the onboarding section
- semantic `<details>` FAQ controls and existing form labels retained for keyboard accessibility

Production still needs a final visual/browser smoke after deployment because this chat has no authenticated production-browser session.

---

## SEO / AEO / GEO audit

### Principles used

Current Google guidance does not require a special “GEO file”, AI-only page, or separate optimization stack for AI features. The durable requirements are the same fundamentals:

- crawlable/indexable public content
- useful visible text
- internal links
- accurate structured data that matches visible content
- good page experience
- Search Console monitoring

Therefore this PR deliberately avoids speculative `llms.txt`, invisible AI summaries, keyword stuffing, or schema that is not reflected in the page.

### Implemented

- transactional/private surfaces: `noindex,follow`
- storefront: `WebSite` + `SearchAction` JSON-LD
- customer-facing descriptive content and FAQ added to the actual rendered page
- Product/Breadcrumb schema left to WooCommerce/current SEO tooling

### FAQ schema decision

Google removed FAQ rich-result support in 2026. The FAQ remains valuable visible content, but the PR intentionally does **not** add `FAQPage` markup solely to chase a discontinued Google rich result.

### Follow-up live checks after deployment

- Google Search Console coverage / sitemap / crawl status
- Product rich-result / Merchant listing validation
- canonical URLs and duplicate taxonomy/search URLs
- Core Web Vitals using real field data where available
- shipping/return Merchant structured data only when the public policy is confirmed and exactly matches the site

No return/refund policy was invented for schema purposes.

---

## Security audit

Existing MU header baseline already covers:

- HSTS
- MIME sniffing protection
- frame protection
- referrer policy
- permissions policy

Added now:

- deposit webhook fail-closed guard
- constant-time secret comparison
- transactional/account crawl controls
- hard-delete automation guard

Tracked separately:

- `#8 P2: deploy CSP in Report-Only mode after checkout asset inventory`

A strict CSP was intentionally not guessed because checkout/address/payment resources must be inventoried first.

---

## Build / dependency health

New CI found two kinds of pre-existing repository debt:

1. TypeScript strict-mode failures in tests/fixtures
2. npm install reports 5 audit findings (2 moderate, 3 high) and older transitive packages

Tracked:

- `#9 P2: triage npm audit findings without forced dependency upgrades`
- `#10 P2: clear existing TypeScript strict-mode test debt and make typecheck blocking`

The policy is to fix the actual dependency/fixture issue, not disable strictness or run `npm audit fix --force`.

---

## Production deployment contract

Direct SSH execution is not available from this ChatGPT connector session. The established Cloudflare Access endpoint is supported by the committed deployment helper.

From Windows PowerShell after PR #6 is merged:

```powershell
cd "C:\Users\tnfwo\Desktop\WholesaleHub_RECOVERED"
git fetch origin main
powershell -ExecutionPolicy Bypass -File ".\scripts\deploy-site-hardening-cloudflare.ps1" -RunCatalogCatchup
```

Defaults:

```text
TunnelHost = ssh.avocadoss.co.kr
SshUser    = tnfwod
Commit     = origin/main
```

The script performs:

```text
exact commit → temporary worktree
→ staged SCP through cloudflared Access
→ per-file backup
→ surgical source/deployed copy
→ bash/node/PHP lint
→ WordPress MU bootstrap check
→ approval Telegram policy check
→ cache flush
→ live hub HTTP smoke
→ optional controlled Daily/Walldo catch-up + Telegram
```

A failed validation exits non-zero. Production is not declared updated until that command completes successfully.

---

## Deferred backlog created by this audit

| Priority | Issue | Reason |
|---|---|---|
| P1 | #7 Atomic/idempotent points balance | financial concurrency requires dedicated QA |
| P2 | #8 CSP Report-Only rollout | must inventory real checkout origins first |
| P2 | #9 npm audit triage | avoid unsafe forced dependency upgrades |
| P2 | #10 TypeScript baseline debt | fix fixtures/types without weakening compiler |

---

## Safety invariants preserved

```text
manual Woo product creation for crawler misses: NO
supplier approval bypass: NO
actual supplier order/payment/refund during audit: NO
past order mutation: NO
supplier real name leaked to customer: NO
permanent automatic Woo source-absence deletion: DISABLED
Git reset/clean/stash production workflow: NO
production whole-tree overwrite: NO
```

---

## Definition of done

Repository work is complete when PR #6 CI passes and the PR is merged.

Production work is complete only after the committed Cloudflare PowerShell deployment helper exits successfully and, with `-RunCatalogCatchup`, the supplier catalog catch-up returns a successful `WHOLESALEHUB_RESULT_JSON` and the operator receives the expected Telegram messages.
