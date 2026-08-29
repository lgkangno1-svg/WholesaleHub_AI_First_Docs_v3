# Task: Repair Telegram → Codex / OpenCodex / WholesaleHub control plane

Read first:

1. `PROJECT_NORTH_STAR.md`
2. `AGENTS.md`
3. `AI_HANDOFF.md`
4. `docs/TELEGRAM_AI_CONTROL_PLANE_CONTRACT.md`
5. `docs/TELEGRAM_AI_RUNTIME_HANDOFF_2026-08-28.md`

## Mission

Repair the real MiniPC Telegram AI runtime so all three user requirements are proven end-to-end:

1. **OpenCodex route** can use Antigravity and OpenCode Go DeepSeek Flash.
2. **Codex selection** uses the directly authenticated Codex CLI/account and Codex usage, not OpenCodex.
3. Telegram can instruct the AI worker to inspect, change, test and safely deploy the project behind `https://hub.avocadoss.co.kr`.

Do not declare success from repository inspection alone. The final result requires runtime evidence from the MiniPC and Telegram.

## Existing evidence

- Repository path: `/home/tnfwod/projects/wholesalehub`.
- `scripts/ai-worker.sh` already supports OpenCode with model `openrouter/deepseek/deepseek-v4-flash` under `flash`, but this does not prove Telegram routes to it.
- `scripts/telegram-ai-diagnose.sh` / `.ps1` exist for metadata-only runtime discovery.
- Previous Telegram screenshots show model-selection UI is reachable, Korean replies can become `???`, and Codex reported a `bwrap` / unprivileged user namespace sandbox failure.
- The repository does not contain a proven Telegram router source. Discover the real service/source before editing anything.

## Required procedure

### A. Preflight and backup

- Confirm latest GitHub `main` and current MiniPC project state.
- Identify the actual Telegram bot process, service unit, working directory and source files.
- Identify the actual OpenCodex process/service/listening endpoint and its supported provider/model routes.
- Identify direct `codex`, `opencode`, and any Antigravity/Gemini runtime used by OpenCodex.
- Before editing the runtime bot/service, make timestamped local backups of only the proven files/unit overrides that will be touched.
- Never print tokens, auth-store contents, API keys or raw `ExecStart` secrets in reports.

### B. Explicit routing architecture

Implement one central dispatcher with three explicit route IDs. Names may differ internally, but behavior must be equivalent:

- `codex_direct` → direct local `codex` CLI/account. Must bypass OpenCodex.
- `opencodex_deepseek_flash` → OpenCodex/OpenCode Go → DeepSeek Flash.
- `opencodex_antigravity` → OpenCodex → actual Antigravity route discovered at runtime.

Rules:

- no silent fallback between routes;
- selected route and resolved provider/model label must be returned to Telegram;
- route failure must fail closed with a clear error;
- one Telegram update/callback ID must not execute twice;
- UTF-8 environment and I/O must be explicit end-to-end;
- timeouts must terminate child processes and return a useful error;
- child process environment must preserve only needed auth/config environment; do not dump it.

### C. Codex sandbox repair

Reproduce the Codex project-read failure from the exact service context.

Determine whether the root cause is:

- systemd sandboxing/hardening;
- nested `bwrap`;
- kernel user namespace policy;
- Codex sandbox mode/flags;
- running under the wrong user/HOME/PATH;
- project path permission/mount issue.

Apply the narrowest fix possible. Do **not** globally weaken `kernel.unprivileged_userns_clone`, AppArmor/SELinux, filesystem permissions, or host sandboxing unless the exact need and security impact are proven and no narrower fix exists.

Verify direct Codex can read the project and make a disposable repository-only test edit in its intended working context.

### D. OpenCodex routes

For DeepSeek Flash:

- verify the runtime route actually uses OpenCodex/OpenCode Go;
- verify DeepSeek Flash identity from safe provider/model metadata;
- PONG smoke must pass;
- no fallback to another model.

For Antigravity:

- discover the real OpenCodex Antigravity provider/adapter;
- do not assume the standalone `gemini` CLI equals Antigravity;
- run a PONG smoke and prove route identity without exposing credentials.

### E. WholesaleHub control

For code-changing Telegram jobs:

- working project must be `/home/tnfwod/projects/wholesalehub` or the current canonical path explicitly proven by repository/deploy config;
- read North Star/Handoff before work;
- inspect latest Git state and preserve unrelated user changes;
- do not `reset --hard`, `clean -fd`, destructive checkout, destructive DB operations, or overwrite runtime secrets;
- write changes to Git-tracked source, run relevant tests/CI/preflight;
- use the repository's safe Production deploy wrapper for approved site deployment;
- verify public site after deploy;
- report changed files, commit/branch, tests and deploy result to Telegram.

Do not let a general Telegram instruction execute real payments, supplier orders, refunds or tax issuance without separate explicit authorization.

### F. Acceptance matrix

Run and capture safe evidence for all tests in `docs/TELEGRAM_AI_CONTROL_PLANE_CONTRACT.md`.

Minimum proof required before closing:

- Korean UTF-8 round trip PASS;
- Codex direct PONG PASS and OpenCodex bypass proven;
- OpenCodex DeepSeek Flash PONG PASS;
- OpenCodex Antigravity PONG PASS;
- each coding-capable route reads WholesaleHub `PROJECT_NORTH_STAR.md` and reports HEAD;
- disposable safe write/test PASS;
- invalid-route/model fails without fallback;
- duplicate Telegram callback is idempotent;
- no token/credential leakage;
- service restart healthy;
- Telegram receives concise PASS/FAIL status.

## Deliverables

1. Actual Telegram router/service/source fix on the MiniPC.
2. Any reusable non-secret router/helper code that belongs in GitHub committed through a PR.
3. Regression tests for dispatcher selection, UTF-8, no-fallback and duplicate execution.
4. Updated `AI_HANDOFF.md` with exact runtime source/service paths and verified route architecture.
5. Final report using only:
   - 완료
   - 검증
   - 남은 문제
   - 사용자가 해줄 일

If a step needs an account login, provider re-authentication, or other user-only credential action, stop only at that exact step and report the minimal action required. Continue everything else independently.
