# Telegram AI runtime findings — 2026-08-29 09:58 KST

Source: read-only MiniPC control-plane diagnostic generated at `20260829T005858Z`.

## Proven runtime locations

- Telegram AI service: `telegram-codex-bot.service`
- Telegram AI working directory: `/home/tnfwod/telegram-codex-bot`
- Router source candidate with all three route tags: `/home/tnfwod/telegram-codex-bot/telegram_codex_bot.py`
- OpenCodex proxy service: `opencodex-proxy.service`
- OpenCodex proxy TCP: `127.0.0.1:10100` reachable
- Direct Codex CLI: `/usr/local/bin/codex`, version `0.150.1`
- Antigravity server installation present under `/home/tnfwod/.antigravity-server/...`

Both `telegram-codex-bot.service` and `opencodex-proxy.service` were active/running during the diagnostic.

## OpenCode evidence

- Shell `PATH` used by the diagnostic did not resolve `opencode` (`OPENCODE_PATH=NOT_FOUND`).
- OpenCode credential/config stores do exist under the user account.
- Auth store has provider entries for `openai`, `opencode`, and `openrouter` without exposing values.
- WholesaleHub repository helper declares DeepSeek Flash as `openrouter/deepseek/deepseek-v4-flash`.
- Therefore the repair must inspect the actual OpenCodex proxy/service environment and router code before deciding whether OpenCode is missing, only absent from the shell PATH, or invoked by another bundled/runtime path.

Do not install a second unrelated OpenCode binary until the real OpenCodex execution path is inspected.

## Antigravity evidence

- Standalone `gemini` CLI was not found in the diagnostic shell PATH.
- Antigravity server files are present under `~/.antigravity-server`.
- Therefore do not equate the missing Gemini CLI with a missing Antigravity route. Inspect the OpenCodex proxy adapter/provider and the existing Antigravity server integration first.

## Codex sandbox evidence

- `kernel.unprivileged_userns_clone=1`
- `user.max_user_namespaces=62609`
- but `unshare -Ur true` exited `1`
- `bwrap` is installed.

This means the previous `bwrap`/userns failure cannot be safely explained as simply "user namespaces disabled". Reproduce it from the exact `telegram-codex-bot.service` execution context and inspect systemd hardening / AppArmor / seccomp / namespace restrictions / Codex sandbox flags / HOME-PATH-cwd before changing host security.

Do not globally weaken sysctl, AppArmor, permissions or systemd protections without proof.

## UTF-8 evidence

MiniPC locale and Python report UTF-8 (`LANG=en_US.UTF-8`, Python stdout/preferred encoding UTF-8), but the Korean diagnostic canary was rendered as mojibake after transport to Windows.

This proves an encoding boundary still needs investigation, but does **not** by itself prove that the Telegram bot is the only faulty boundary. Test separately:

1. local MiniPC UTF-8 bytes;
2. bot subprocess stdout/stderr decoding;
3. Python Telegram library message text;
4. actual Telegram round trip;
5. Windows SSH/PowerShell capture.

The acceptance criterion remains an actual Telegram message that returns Korean correctly without `???` or mojibake.

## Critical Git-worktree drift

At diagnostic time:

- MiniPC Git HEAD: `25cfd4e260aec32e0e8daf1dd11a04232f6acdbd`
- tracked dirty count: `384`
- latest deployment marker before this control-plane work was newer than the MiniPC `.git` HEAD.

The deployment wrapper overlays release files into `/home/tnfwod/projects/wholesalehub` but does not advance that checkout's `.git` metadata. Do not use `git reset --hard` or `git clean` to fix this because local work could be lost.

Before letting Telegram AI modify WholesaleHub, either:

- prove no local work is at risk and safely realign the canonical worktree, or preferably
- create/use a dedicated clean Git checkout/worktree for Codex/OpenCode development and keep Production deployment as a separate verified artifact path.

The AI worker must not treat the current 384-file drift as its own change set.

## Repair priority now

1. Back up `telegram_codex_bot.py` and the two proven user services before editing.
2. Inspect router dispatch code and service environments without printing credentials.
3. Implement/verify explicit routes:
   - `codex_direct`
   - `opencodex_deepseek_flash`
   - `opencodex_antigravity`
4. Fix actual Telegram UTF-8 round trip.
5. Reproduce/fix direct Codex sandbox in service context using the narrowest change.
6. Verify OpenCodex DeepSeek Flash and Antigravity PONG independently with no silent fallback.
7. Give Telegram AI a coherent clean Git worktree before enabling code-changing Hub jobs.
8. Run the full acceptance matrix in `docs/TELEGRAM_AI_CONTROL_PLANE_CONTRACT.md`.

## Completion gate

Do not mark this control plane complete until the real Telegram bot proves all three routes and an authorized harmless Hub change can go through source → tests → safe deploy → public smoke → rollback evidence.
