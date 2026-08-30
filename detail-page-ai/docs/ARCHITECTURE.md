# Detail Page AI — Architecture

## Core principle

The customer-facing product is simple; complexity stays inside the service.

The system must be able to accept orders 24/7 and complete them without human production work.

## Boundary map

### Web

Responsible for:
- plan selection
- compact order form
- unified multi-file upload
- mandatory typo-risk acknowledgement
- payment initiation
- order status/result download

Must not contain provider secrets or master prompts.

### API

Responsible for:
- order validation
- immutable purchased-plan snapshot
- optional-field normalization
- acknowledgement version persistence
- upload metadata registration
- job creation/idempotency
- status/result access control

### Storage

Private object storage for:
- customer uploads
- derived reference assets
- generated images
- final ZIP packages

Use signed/expiring access. Customer assets are private by default.

### Orchestrator

Responsible for:
- Product Ground Truth construction
- CONFIRMED / SAFE_INFERENCE / UNVERIFIED classification
- automatic master-path routing
- Q1–Q10 generation for TED path
- customer-option override layer
- purchased-plan page architecture
- per-image reference selection
- deterministic diversity seed/style fingerprint
- cost ceiling enforcement

### Prompt source boundary

Raw product-owner prompts are proprietary operational material.

Do not commit them to this public repository. Resolve them at runtime through a protected server-side source using stable IDs:
- `sales_conversion_v1`
- `ted_intake_v1`
- `improved_master_v1`

Persist prompt IDs/versions in order-generation metadata, not raw secret prompt text.

### Text reasoning

Use low-cost structured reasoning for:
- upload-role interpretation when deterministic metadata is insufficient
- Q1–Q10 auto-completion
- claim classification support
- page/message planning
- semantic duplicate detection

Deterministic parsing/validation remains first priority.

### Image provider

Use supported server-side image generation/editing APIs.

Plan mapping:
- Trial → Medium
- Standard → High

The image request builder must receive only relevant reference assets for each image job.

### QA worker

Deterministic checks first:
- expected page count
- optional price/spec omission
- unsupported claim flags
- model-count contract
- duplicate job IDs
- output integrity
- retry limit
- cost ceiling

Model-assisted visual checks can be added where they materially improve reliability.

Korean rasterized text typo checking is best-effort and cannot be represented as guaranteed correction.

## Suggested state machine

`draft → awaiting_payment → paid → queued → analyzing → planning → generating → qa → packaging → complete`

Failure states:
- `payment_failed`
- `generation_held`
- `failed`
- `refunded` (only after real payment integration and explicit business rules)

Retries occur at image-job level rather than restarting the whole order.

## Data model outline

### Order
- id
- customer_id
- plan_id
- plan_snapshot_json
- product_name
- category
- description
- optional_spec
- optional_price
- visual_options_json
- must_include
- must_exclude
- disclosure_version
- disclosure_accepted_at
- status
- created_at / updated_at

### Upload
- id
- order_id
- object_key
- mime_type
- sha256
- size_bytes
- inferred_role
- quality_score
- similarity_group
- selected_as_reference

### GenerationRun
- id
- order_id
- prompt_path
- prompt_version_ids
- diversity_seed
- style_fingerprint
- confirmed_facts_json
- safe_inferences_json
- blocked_claims_json
- estimated_cost
- actual_cost
- status

### ImageJob
- id
- run_id
- role
- sequence
- quality
- prompt_hash
- reference_upload_ids
- retry_count
- max_retries
- provider_request_id
- output_object_key
- qa_status
- cost

## Security requirements

- no `.env`, API keys, bot tokens, passwords, or provider secrets in Git
- no customer upload served publicly
- validate upload MIME/type/size and reject executable content
- isolate customer/order object prefixes
- signed result URLs
- webhook idempotency for payment/provider callbacks
- do not log raw prompt secrets or full private documents unnecessarily
- cost ceilings fail closed

## Development strategy

Phase 1 intentionally uses zero-dependency Node.js ESM contracts so core rules are easy to test and can later be imported into the production API/worker stack.
