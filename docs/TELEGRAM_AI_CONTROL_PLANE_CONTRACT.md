# Telegram AI Control Plane Contract

Status: binding implementation contract for WholesaleHub Telegram AI control plane.

## Goal

Telegram must be able to control and change `hub.avocadoss.co.kr` through the MiniPC while keeping model/provider routing explicit, auditable, reversible, and safe.

## Required routing

### 1. Codex route = direct Codex usage

When the user selects **Codex**, the Telegram router must invoke the locally authenticated Codex CLI/account directly.

- Do not proxy this selection through OpenCodex.
- Do not consume OpenCode Go/OpenRouter/Antigravity usage for this route.
- The runtime must make the selected route visible in the Telegram response, for example `Route: Codex direct`.
- Usage reporting must come from the Codex execution path when available.

### 2. OpenCode DeepSeek Flash route = OpenCodex/OpenCode Go

When the user selects **OpenCode (DeepSeek Flash)**, the Telegram router must use the MiniPC OpenCodex/OpenCode Go path and select DeepSeek Flash.

Target model identity is the configured OpenCode Go DeepSeek Flash route. In the current repository helper this is represented by `openrouter/deepseek/deepseek-v4-flash`; runtime evidence must confirm the actual configured provider/model before repair.

- Do not silently fall back to Codex.
- Do not silently substitute another paid model.
- Report the route/provider/model label without exposing credentials.

### 3. Antigravity route = OpenCodex Antigravity

When the user selects **Antigravity**, the Telegram router must use the MiniPC OpenCodex path that is actually configured for Antigravity/Gemini.

- Discover the real runtime provider/command first; do not assume the `gemini` CLI is identical to Antigravity.
- Do not silently fall back to Codex or OpenCode DeepSeek.
- Report `Route: OpenCodex → Antigravity` or equivalent after successful dispatch.

## WholesaleHub control scope

The Telegram AI worker must be able to inspect and modify the project that controls `hub.avocadoss.co.kr`:

- canonical source: `/home/tnfwod/projects/wholesalehub`
- WordPress runtime/deploy path is discovered from current repository/deploy configuration; do not hard-code a second conflicting source of truth.
- before work: read `PROJECT_NORTH_STAR.md`, `AGENTS.md`, `AI_HANDOFF.md`, then sync/audit latest GitHub `main` and recent changes.
- work should be performed in the canonical Git source and promoted through the repository's tested deployment path rather than editing arbitrary Production files in place.

## Safety boundary

Telegram may request code changes, diagnostics, tests, CI, safe deployments, crawler fixes, UX changes and operational repairs.

Telegram must not autonomously execute real customer payments, real supplier purchases, real refunds, tax issuance, destructive database operations, credential rotation, or broad host-security weakening unless the user explicitly authorizes the specific high-risk action.

Never print tokens, API keys, auth stores, raw credentials, customer PII, supplier cost or private supplier identifiers into Telegram.

## Runtime quality requirements

- Korean/UTF-8 round trip must not produce `???`.
- one user request maps to one execution job/idempotency key.
- explicit model selection must be honored; no silent route fallback.
- timeout and cancellation must return a clear Telegram status.
- failures must identify the failing layer: Telegram router, OpenCodex, Codex CLI, OpenCode, provider/model, sandbox, Git, deploy, or site smoke.
- before/after Git status and changed filenames must be captured for coding jobs.
- Production-changing jobs require a backup/rollback point and post-deploy smoke.
- Telegram response should summarize: route, model/provider label, result, verification, changed files/commit, deploy status, and any user action still required.

## Acceptance tests

The control plane is not complete until all of the following pass on the real MiniPC and Telegram bot:

1. Korean echo: `한글 테스트 정상` returns without corruption.
2. Codex direct PONG: select Codex and prove the OpenCodex/OpenCode route was not used.
3. OpenCode DeepSeek Flash PONG: select OpenCode and prove DeepSeek Flash route was used.
4. Antigravity PONG: select Antigravity and prove the configured OpenCodex Antigravity route was used.
5. Repository read: ask each coding-capable route to report the current WholesaleHub HEAD and read `PROJECT_NORTH_STAR.md`.
6. Safe write test: create/update a disposable test fixture inside the repository, run tests, then remove/revert it; no Production mutation.
7. Safe site-change rehearsal: make a harmless testable source change on a branch, run CI/deploy preflight, and stop before Production unless explicitly authorized.
8. Production control test, when authorized: deploy one harmless visible/non-monetary change through the standard deploy wrapper, verify `hub.avocadoss.co.kr`, and prove rollback exists.
9. Failure test: deliberately select an invalid model in an isolated fixture and verify Telegram reports a route/model error instead of silently falling back.
10. Duplicate test: resend the same Telegram job callback/id and verify it is not executed twice.

## Repair order

1. discover the actual Telegram bot service/source and OpenCodex runtime;
2. back up the proven service/source files;
3. fix UTF-8 boundary;
4. implement explicit three-route dispatch contract;
5. repair Codex sandbox only at the narrowest proven layer;
6. verify OpenCode DeepSeek Flash and Antigravity independently;
7. wire project control to the canonical Git/deploy workflow;
8. run the acceptance matrix;
9. update `AI_HANDOFF.md` with exact service/source paths and final test evidence.
