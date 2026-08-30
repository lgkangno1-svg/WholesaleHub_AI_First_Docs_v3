# Detail Page AI — Project Handoff

Updated: 2026-08-30
Canonical branch: `main`
Phase 1 merged SHA: `6feb4b7e85c7cd71d6035e184d89400d7510c459`
Validation: GitHub Actions `Detail Page AI CI` passed 10/10 tests, failures 0.

## Intent

Launch a 24/7 fully automated paid detail-page production service for food sellers. Human production is not part of the target operating model.

## Product decisions locked

- supported categories: fruit / vegetables / meat / seafood / processed food
- no SmartStore/Coupang purpose selector
- customer sees only sales-conversion detail-page production
- Trial: 9,900 KRW, 1 thumbnail + 8 body, Medium
- Standard: 14,900 KRW, 2 thumbnails + 10–12 body, High
- product composition/specification is optional; absent means omit
- selling price is optional; absent means omit
- unified multi-file upload; AI classifies assets automatically
- customer options override master-prompt defaults
- actual uploaded product material is Product Ground Truth
- typo/text-rendering risk notice is mandatory before order submission
- rasterized image text is difficult to edit surgically and perfect correction is not guaranteed
- customer does not choose internal prompt path
- both owner-supplied master systems remain available internally

## Internal prompt paths

### A. Direct sales conversion
Owner source: `유튜브 그대로 상페 (1).txt`

### B. TED enrichment + improved master
Owner sources:
- `TED 상페- 고객님 정보요청.txt`
- `마스터프롬프트 개선버전.txt`

The repository is public, so raw prompt bodies are not committed. Production must retrieve protected versioned prompt sources server-side.

## Phase 1 complete

- comprehensive PRD
- service architecture
- living handoff + repository index
- Trial/Standard immutable plan contracts
- customer order normalization
- optional price/spec omission contract
- mandatory versioned image-text typo disclosure
- unified-upload reference ranking and near-duplicate collapse
- internal direct-vs-TED prompt routing contract
- customer-over-master instruction priority
- Product Ground Truth handling contract
- plan-aware image request contract
- dedicated GitHub Actions CI
- 10 automated tests passing on GitHub runner

## Next implementation priorities

1. responsive customer order form
2. unified multi-file uploader UX and server contract
3. durable order/job persistence
4. protected master-prompt retrieval
5. upload classifier/reference selector implementation beyond scored metadata
6. text planning/Q1–Q10 generation
7. image generation/editing provider integration
8. automated QA and bounded retry
9. packaging/download
10. payment + webhook/idempotency
11. production observability and per-order cost ceiling

## Risk register

- Korean text inside generated images can contain typos or malformed glyphs; disclose and mitigate but do not promise perfect correction.
- High quality + retries can compress margin; enforce per-order cost ceilings and retry only failed images.
- reference-image overuse increases cost and can reduce visual variety; shortlist and attach only role-relevant references.
- unsupported product claims create legal/customer-trust risk; missing hard facts must be omitted, not inferred.
- public repository must never contain provider credentials or raw proprietary master prompts.

## Development rules

Before each material change, re-check latest `main`, recent commits, open PRs, this handoff, and the affected service subtree. Do not assume remembered state is current.

After each meaningful implementation change, update this handoff in the same PR when the current state or next priorities materially change.
