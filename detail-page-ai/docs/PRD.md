# Detail Page AI — Product Requirements Document

Status: MVP development baseline
Updated: 2026-08-30
Owner: Authentic / WholesaleHub repository

## 1. Product goal

Create a 24/7 fully automated Korean ecommerce detail-page generation service for food sellers.

A customer should be able to enter only the information they know, upload any related files in one place, choose a small number of visual preferences, pay, and receive a downloadable image package without human production work.

The service is always optimized for **sales conversion**. Customers do not choose between internal prompt engines.

## 2. Supported categories

- fruit
- vegetables
- meat
- seafood
- processed food

## 3. Commercial plans

### Trial — 9,900 KRW

- 1 thumbnail
- 8 body images
- 9 final images total
- image quality: Medium
- uploaded reference use: selective
- reference shortlist target: up to 3 strong sources
- automatic generation-failure retry: 1

### Standard — 14,900 KRW

- 2 thumbnails
- 10–12 body images
- 12–14 final images total
- image quality: High
- uploaded reference use: active
- reference shortlist target: up to 6 strong sources
- automatic generation-failure retry: up to 2

The customer-selected plan always overrides defaults contained inside master prompts.

## 4. Customer-facing order form

The form must stay compact. Do not expose internal prompt routing, ecommerce-channel selection, or upload-type selectors.

### Required

1. Product name
2. Category
3. Product description — free text
4. Plan — Trial / Standard
5. Main visual style
   - male model
   - female model
   - farm / production-site feeling
   - product-centered, no model
   - premium studio
6. Model-cut count
   - 0
   - 2
   - 4
   - 6
7. Overall tone
   - white
   - beige
   - black
   - natural green
   - luxury dark
8. Copy mood
   - emotional
   - professional
   - trust-led
   - sales-led
   - gift-led
9. Information density
   - simple
   - standard
   - rich
10. Emphasis points — multi-select
   - freshness
   - price
   - origin
   - taste
   - nutrition / health information
   - gift use
   - bulk quantity
   - value for money
11. Thumbnail character
   - strong sales
   - emotional
   - premium
   - information-led
12. AI image text-risk acknowledgement

### Optional

13. Product composition / specification
14. Selling price
15. Must-include information
16. Must-exclude information
17. Related files upload — one multi-file field only

No separate fields for product photo, package photo, certificate, review screenshot, farm photo, reference design, etc. The system classifies uploaded material automatically.

## 5. Missing-information policy

Missing factual information must be **omitted, not invented and not shown as a placeholder in final customer images**.

Examples:

- no composition/specification → no composition/spec claim or dedicated specification content
- no selling price → no price claim, price comparison, or price CTA
- no origin → do not invent an origin
- no certification/test report → do not claim certification or test results
- no shipping method → do not invent chilled/ambient/frozen shipping
- no real review data → do not create fake review counts, ratings, nicknames, purchase counts, or repurchase badges

The orchestrator may replace a missing persuasion axis with another supported axis so the requested body-image count is still fulfilled.

## 6. Claim safety

Classify information internally as:

- CONFIRMED — directly provided by the customer or visibly supported by uploaded material
- SAFE_INFERENCE — category-level consumer context that can be expressed without presenting it as a product-specific fact
- UNVERIFIED — values, certification, superiority, health effect, origin, grade, quantity, price, shipping condition, sales volume, review metric, or other factual claims lacking support

UNVERIFIED material must never be rendered as fact.

Health/nutrition selection is a direction request, not permission to invent medical efficacy. Do not claim disease prevention/treatment, guaranteed weight loss, infant safety, pregnancy safety, immunity improvement, blood-pressure improvement, blood-sugar improvement, or similar effects without adequate supplied evidence.

## 7. Customer-upload processing

### 7.1 Unified upload

Customers upload any related files through one multi-file field. Supported material may include:

- product photos
- close-ups and cross-sections
- package and shipping-box photos
- farm / production photos
- certificates and test reports
- existing detail pages
- design references
- real review captures
- product documents

### 7.2 Automatic classification

The system should infer each asset role, such as:

- PRODUCT_GROUND_TRUTH
- CLOSEUP_OR_CUT
- PACKAGE
- DELIVERY
- FARM_OR_PROCESS
- PROOF_DOCUMENT
- REAL_REVIEW
- DESIGN_REFERENCE
- PRODUCT_DOCUMENT
- UNKNOWN

### 7.3 Reference scoring

Rank reference usefulness using at least:

- sharpness / readability
- product visibility
- fidelity to real color/shape/package
- uniqueness versus other uploads
- suitability for thumbnail/body/proof/review use
- evidence value

Near-duplicate images should collapse to one representative source.

### 7.4 Ground-truth rule

When an uploaded real product image exists, it outranks generative assumptions for:

- product identity
- shape and proportions
- skin/flesh/material color
- natural texture and imperfections
- package/container structure
- label/logo placement where legible
- real cultivar/product characteristics

AI may change background, lighting, table/props, camera angle, lifestyle setting, whitespace, and layout, but must not silently turn the product into a different product.

### 7.5 Cost control

Do not attach every uploaded image to every generation request.

- Trial: shortlist up to 3 high-value references by default
- Standard: shortlist up to 6 high-value references by default
- Per generated image: attach only the references needed for that image role
- Reuse deterministic classification and similarity results

## 8. Prompt system

Customers see only one product concept: **sales-conversion detail page**.

Internally there are two approved master-prompt paths supplied by the product owner.

### Path A — direct sales-conversion master

Source: `유튜브 그대로 상페 (1).txt`

Use when the product can be effectively structured from the customer input and visual references without a deeper evidence/brand reasoning pass.

### Path B — TED analysis + improved master

Sources:

1. `TED 상페- 고객님 정보요청.txt`
2. `마스터프롬프트 개선버전.txt`

Pipeline:

1. AI reads the order plus uploaded material.
2. AI automatically completes the Q1–Q10 TED/WHY-HOW-WHAT intake.
3. Unsupported hard facts remain omitted rather than invented.
4. The completed Q1–Q10 is injected into the improved master prompt.
5. The resulting plan is still optimized for sales conversion.

Customers are never asked to choose Path A or Path B.

### Suggested automatic routing

Prefer Path B when the order contains strong evidence or meaningful differentiation, for example test reports, certification, production/process evidence, brand principles, differentiated logistics/selection process, premium positioning, or rich supporting material.

Otherwise use Path A.

Routing must be deterministic/auditable and can evolve after real conversion/quality data is collected.

## 9. Instruction priority

When instructions conflict, apply this exact priority:

1. Safety and factual truth
2. Customer-uploaded real product/evidence material
3. Customer-entered facts
4. Customer-selected options
5. Purchased plan contract
6. Internal routing/strategy decisions
7. Master-prompt defaults
8. Internal diversity/randomization

A master prompt can never force a model count, background tone, page count, price, specification, or other value against the customer's choice or missing-data state.

## 10. Diversity engine

Prevent same-prompt customers from receiving near-identical pages.

Internal variation may choose from controlled families such as:

- hero layout
- crop/composition
- typography hierarchy
- section order where persuasion logic permits
- badge/icon language
- texture/background treatment
- CTA framing
- infographic ratio
- full-bleed vs editorial vs split vs macro vs table layouts

Randomization must never change facts or override customer-selected options.

Store a generation seed/style fingerprint per order for audit and reproducibility.

## 11. Image-text typo disclosure — mandatory

Korean text rendered inside AI-generated raster images can contain typos, malformed glyphs, missing characters, spacing errors, incorrect numerals, or other text defects.

### Customer-facing notice

Show this notice before the order can proceed:

> AI 이미지 생성 특성상 이미지 안의 한글·숫자·기호에 오타, 글자 깨짐, 누락 또는 잘못된 표기가 발생할 수 있습니다. 이미지에 합성된 글자는 일반 문서의 텍스트처럼 부분 수정이 어려워 수정이 필요한 경우 해당 이미지 또는 영역을 다시 생성해야 할 수 있으며, 재생성 후에도 동일한 구성이나 완벽한 오타 교정을 보장할 수 없습니다. 서비스는 자동 검수와 재생성을 통해 오류를 줄이지만 모든 이미지 내 텍스트의 100% 정확성을 보장하지 않습니다.

The user must explicitly acknowledge this before checkout/order submission.

Store acknowledgement version: `image-text-risk-v1`.

### Automated mitigation

The service should still reduce the problem through:

- short image copy
- semantic/copy QA before rendering
- post-generation visual/text anomaly checks where feasible
- targeted retry for high-confidence defects
- keeping factual numbers short and source-backed

Do not promise perfect correction.

## 12. Automated generation flow

1. Receive order
2. Validate plan and acknowledgement
3. Normalize optional fields
4. Analyze and classify uploads
5. Build Product Ground Truth
6. Separate CONFIRMED / SAFE_INFERENCE / UNVERIFIED
7. Select internal master path
8. Build page architecture according to plan
9. Apply customer options
10. Build per-image prompts and references
11. Generate images
12. Run automatic QA
13. Retry failed images only within plan limits
14. Package final PNG/JPG assets and ZIP
15. Expose secure download result
16. Store cost/quality telemetry without leaking private customer material

## 13. Automatic QA

Minimum checks:

- expected thumbnail/body count
- no missing price/spec leakage when fields were empty
- no unsupported certification/metric/review claims
- customer-selected model-count compliance
- customer-selected tone/style compliance at planning layer
- duplicate/near-duplicate visual roles
- generated-file integrity
- obvious generation failure
- product-ground-truth consistency where references exist
- prompt/output audit metadata exists

Text typo QA is best-effort and is not a guarantee.

## 14. Technical architecture target

- web frontend: responsive order form, payment, status, download
- application API: order creation, validation, job/status/result endpoints
- object storage: customer uploads + generated outputs with private access
- durable job queue: 24/7 asynchronous generation and retries
- orchestrator: facts, prompt routing, page architecture, cost guardrails
- text reasoning provider: low-cost structured analysis where appropriate
- image provider: OpenAI image generation/editing with plan-based quality
- QA worker: deterministic checks first, model-assisted checks only where valuable
- database: order, plan snapshot, acknowledgement, job state, generation metadata, cost ledger
- cleanup/retention policy: configurable deletion of uploads and outputs

Never use a browser ChatGPT/Codex subscription session as the production 24/7 serving backend. Production generation needs a supported server-side provider/API path.

## 15. Cost-control rules

- deterministic parsing before model calls
- cache upload fingerprints and classification results
- do not resend irrelevant references
- generate only the purchased number of images
- retry individual failed images rather than full orders
- enforce maximum retries by plan
- record estimated and actual provider cost per image/order where available
- configurable per-order spend ceiling with fail-safe hold instead of runaway retries

## 16. Security/privacy

- API keys/server credentials never enter client bundles or Git history
- uploads private by default
- signed/expiring download access
- strip EXIF where not required
- do not expose one customer's assets/results to another customer
- validate file type/size and reject executable payloads
- do not log raw secrets
- master-prompt source text is proprietary operational material and should not be committed to this public repository; load it through a protected server-side secret/object source

## 17. MVP acceptance criteria

The MVP is ready for paid test orders when all are true:

1. Order form implements only the agreed customer-visible fields.
2. Optional price/specification are completely omitted when empty.
3. Unified multi-file upload works.
4. Uploads are classified and references selected automatically.
5. Trial outputs exactly 1 thumbnail + 8 body images at Medium.
6. Standard outputs exactly 2 thumbnails + configurable 10–12 body images at High.
7. Customer options override master defaults.
8. Image-text risk acknowledgement is mandatory and versioned.
9. Both internal master paths can be invoked without customer selection.
10. Unsupported factual claims are blocked.
11. Failed image jobs retry individually with bounded retries.
12. Final images and ZIP are downloadable.
13. Per-order cost telemetry exists.
14. One end-to-end test order completes without human production work.

## 18. Delivery phases

### Phase 1 — contracts and orchestration foundation

- PRD
- order schema/normalization
- plan catalog
- disclosure contract
- upload/reference-selection contract
- prompt-route contract
- customer-priority merge logic
- unit tests

### Phase 2 — web order experience

- responsive order form
- unified uploader
- client/server validation
- disclosure acknowledgement
- order status UX

### Phase 3 — provider integration and durable jobs

- private storage
- queue/worker
- text analysis
- protected prompt retrieval
- image generation/editing
- retries and spend ceilings

### Phase 4 — QA, packaging and payment

- automatic QA
- ZIP packaging
- result delivery
- payment integration
- webhook/idempotency

### Phase 5 — production hardening

- rate limits
- abuse controls
- privacy retention
- observability/alerts
- failure recovery
- production smoke tests
