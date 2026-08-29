# Telegram AI control plane

Primary files:

- Contract: `docs/TELEGRAM_AI_CONTROL_PLANE_CONTRACT.md`
- Runtime status: `docs/TELEGRAM_AI_CONTROL_PLANE_STATUS_2026-08-29.md`
- Codex repair task: `ai/tasks/TELEGRAM_AI_CONTROL_PLANE_REPAIR.md`
- Ready-to-paste Codex command: `docs/TELEGRAM_AI_CONTROL_PLANE_CODEX_COMMAND.md`
- Runtime diagnostic: `scripts/telegram-ai-control-plane-diagnose.sh`
- Windows wrapper: `scripts/telegram-ai-control-plane-diagnose.ps1`

The runtime diagnostic is read-only. It does not modify sysctl, restart services, edit Production, place orders, process refunds or reveal credential values.
