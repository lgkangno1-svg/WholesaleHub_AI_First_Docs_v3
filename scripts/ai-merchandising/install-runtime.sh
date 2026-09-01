#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT="${WHOLESALEHUB_ROOT:-/home/tnfwod/projects/wholesalehub}"
SERVICE_NAME="wholesalehub-ai-merchandising.service"
TIMER_NAME="wholesalehub-ai-merchandising.timer"
MARKER="# wholesalehub-ai-merchandising"
SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
LOG_DIR="$PROJECT/reports/ai-merchandising"

[[ -f "$PROJECT/systemd/$SERVICE_NAME" ]] || { echo "AI_RUNTIME_INSTALL=SERVICE_MISSING" >&2; exit 66; }
[[ -f "$PROJECT/systemd/$TIMER_NAME" ]] || { echo "AI_RUNTIME_INSTALL=TIMER_MISSING" >&2; exit 66; }
[[ -x "$PROJECT/scripts/ai-merchandising/run-queue.sh" || -f "$PROJECT/scripts/ai-merchandising/run-queue.sh" ]] || { echo "AI_RUNTIME_INSTALL=WORKER_MISSING" >&2; exit 66; }
mkdir -p "$LOG_DIR"
chmod +x "$PROJECT/scripts/ai-merchandising/run-queue.sh"

remove_cron_fallback() {
  command -v crontab >/dev/null 2>&1 || return 0
  local existing
  existing="$(crontab -l 2>/dev/null || true)"
  if grep -Fq "$MARKER" <<<"$existing"; then
    printf '%s\n' "$existing" | grep -Fv "$MARKER" | crontab -
  fi
}

install_cron_fallback() {
  command -v crontab >/dev/null 2>&1 || return 1
  local existing line
  existing="$(crontab -l 2>/dev/null || true)"
  line="* * * * * HOME=$HOME PATH=$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin /usr/bin/env bash $PROJECT/scripts/ai-merchandising/run-queue.sh >> $LOG_DIR/cron.log 2>&1 $MARKER"
  {
    printf '%s\n' "$existing" | grep -Fv "$MARKER" || true
    printf '%s\n' "$line"
  } | awk 'NF' | crontab -
  crontab -l | grep -Fq "$MARKER"
}

if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$SYSTEMD_DIR"
  cp -f "$PROJECT/systemd/$SERVICE_NAME" "$SYSTEMD_DIR/$SERVICE_NAME"
  cp -f "$PROJECT/systemd/$TIMER_NAME" "$SYSTEMD_DIR/$TIMER_NAME"
  chmod 0644 "$SYSTEMD_DIR/$SERVICE_NAME" "$SYSTEMD_DIR/$TIMER_NAME"
  systemctl --user daemon-reload
  systemctl --user enable --now "$TIMER_NAME" >/dev/null
  systemctl --user is-enabled "$TIMER_NAME" >/dev/null
  systemctl --user is-active "$TIMER_NAME" >/dev/null
  remove_cron_fallback
  echo "AI_RUNTIME_INSTALL=OK scheduler=systemd-user"
  exit 0
fi

# Some SSH/non-linger environments do not expose a user systemd bus. Use the
# same user crontab as a no-root fallback; worker-level flock prevents overlap.
if install_cron_fallback; then
  echo "AI_RUNTIME_INSTALL=OK scheduler=cron"
  exit 0
fi

echo "AI_RUNTIME_INSTALL=NO_SCHEDULER" >&2
exit 69
