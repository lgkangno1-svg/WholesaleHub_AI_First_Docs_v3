# Telegram AI Runtime Handoff — 2026-08-28

## User-visible incident

Telegram `codex봇` currently reaches the model-selection UI, but two runtime symptoms remain unresolved on the MiniPC:

1. Korean text in some bot replies is rendered as `???`.
2. Codex reports that project file access/modification is blocked by the host sandbox, mentioning `bwrap` / `kernel.unprivileged_userns_clone` restrictions.
3. The OpenCode (DeepSeek) route must be verified independently end-to-end.

The repository does **not** contain a proven source file for the Telegram router itself. Do not guess or patch an unrelated service. The next repair must begin from runtime evidence collected on the MiniPC.

## Repository evidence already confirmed

WholesaleHub contains supported OpenCode/OpenRouter helpers:

- `scripts/ai-worker.sh`
  - project root: `/home/tnfwod/projects/wholesalehub`
  - `cheap`: `openrouter/xiaomi/mimo-v2.5`
  - `pro`: `openrouter/deepseek/deepseek-v4-pro`
  - `flash`: `openrouter/deepseek/deepseek-v4-flash`
  - runs OpenCode with `--pure`, a dedicated `whh-worker` agent, JSON output and before/after Git status evidence.
- `scripts/ai-direct-worker.sh`
- `scripts/openrouter-direct-worker.mjs`

These helpers prove OpenCode/OpenRouter integration exists in the WholesaleHub repository, but they do not prove that the Telegram bot is calling them.

## Runtime diagnostic added

Use:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\telegram-ai-diagnose.ps1"
```

The Windows wrapper uploads and runs `scripts/telegram-ai-diagnose.sh` through the existing `minipc` SSH alias and writes a report to the Windows Desktop.

The collector is designed to be diagnostic-only. It checks:

- OS and executable availability/versions;
- locale and UTF-8/Python stdout encoding;
- `kernel.unprivileged_userns_clone`, `user.max_user_namespaces`, `unshare -Ur` and `bwrap` availability;
- OpenCode auth-store presence and provider **names only**;
- safe OpenCode config metadata (model/provider/agent names through `jq`, never raw config lines);
- repository AI helper presence/hashes;
- AI process names without command-line arguments;
- matching systemd unit metadata without `ExecStart` arguments;
- candidate source file paths/hashes/tags without printing source contents;
- recent matching journal **counts only**, never raw log lines;
- optional isolated DeepSeek V4 Flash `PONG` smoke in a temporary directory outside the project.

The collector must not change user namespaces, security sysctls, service configuration, Telegram tokens, project files, WordPress, orders or payments.

## Next repair decision tree

After the report is returned:

1. **UTF-8 issue**
   - identify the actual Telegram service/runtime and its locale/environment;
   - repair encoding at the service/process boundary, not by replacing Korean text with ASCII;
   - verify a Korean round-trip message in Telegram.

2. **Codex sandbox issue**
   - identify the exact service command and Codex invocation first;
   - determine whether the failure is caused by kernel user-namespace policy, an unnecessary nested `bwrap`, service hardening, container confinement, or a Codex-specific sandbox mode;
   - prefer the narrowest fix. Do not globally enable unprivileged user namespaces merely to make one bot work without reviewing the host security impact.

3. **OpenCode (DeepSeek)**
   - compare the isolated smoke result with the Telegram route;
   - if the isolated smoke passes but Telegram fails, repair router/service integration rather than OpenRouter credentials;
   - if it fails, diagnose provider/model/config/auth compatibility without printing credentials.

4. **Telegram command routing**
   - once the actual source/service is identified, back it up before edits;
   - verify `/codex`, Codex/Terra selection, OpenCode/DeepSeek selection and Korean response rendering;
   - restart only the proven matching service and verify status/logs afterward.

## Storefront UX work completed in GitHub

The floating `빠른주문 / 엑셀 대량주문` card now has a progressive collapse/expand helper:

- desktop default: expanded;
- mobile (`<=768px`) default: collapsed;
- explicit visitor choice persisted in `localStorage` when available;
- accessible `aria-controls` / `aria-expanded` button;
- existing bulk-order URLs, upload flow, checkout flow and order logic are untouched;
- the Production deploy wrapper backs up, deploys, byte-verifies and PHP-lints the new MU helper.

This is GitHub-complete but is not Production-complete until `scripts/deploy-wholesalehub.ps1` is run from the dedicated Windows deploy clone.

## Safety invariants

- No Telegram/API tokens or secrets in GitHub.
- No raw OpenCode auth/config payloads in diagnostic output.
- No raw service ExecStart/process args/candidate source contents/journal lines in the diagnostic report.
- No sysctl/security-policy mutation by diagnostics.
- No actual customer order/payment/refund/supplier-order operation.
- No destructive Git/DB operation on the MiniPC source worktree.
