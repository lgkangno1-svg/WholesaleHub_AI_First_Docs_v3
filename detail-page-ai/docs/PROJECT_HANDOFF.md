# Detail Page AI — Project Handoff

Updated: 2026-08-30
Branch: `feat/detail-page-ai-service-bootstrap`

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

## Completed in current branch

- comprehensive PRD
- service architecture
- living handoff
- plan/order/policy/orchestration foundation (being implemented in this branch)
- unit-test foundation

## Next implementation priorities

1. finish Phase 1 contracts/tests
2. responsive customer order form
3. private unified uploader
4. durable order/job persistence
5. protected master-prompt retrieval
6. upload classifier/reference selector
7. text planning/Q1–Q10 generation
8. image generation/editing provider integration
9. automated QA and bounded retry
10. packaging/download
11. payment + webhook/idempotency
12. production observability and cost ceiling

## Risk register

- Korean text inside generated images can contain typos or malformed glyphs; disclose and mitigate but do not promise perfect correction.
- High quality + retries can compress margin; enforce per-order cost ceilings and retry only failed images.
- reference-image overuse increases cost and can reduce visual variety; shortlist and attach only role-relevant references.
- unsupported product claims create legal/customer-trust risk; missing hard facts must be omitted, not inferred.
- public repository must never contain provider credentials or raw proprietary master prompts.

## Development rules

Before each material change, re-check latest `main`, recent commits, open PRs, this handoff, and the affected service subtree. Do not assume remembered state is current.

After each meaningful implementation change, update this handoff in the same PR when the current state or next priorities materially change.
