#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/tnfwod/projects/wholesalehub"
LOG_ROOT="/tmp/whh-ai-worker"
OPENCODE_BIN="$(command -v opencode || true)"

usage() {
  echo "Usage: bash scripts/ai-worker.sh cheap|pro|flash ai/tasks/XXX.md" >&2
  exit 64
}

[[ $# -eq 2 ]] || usage

case "$1" in
  cheap) MODEL="openrouter/xiaomi/mimo-v2.5" ;;
  pro) MODEL="openrouter/deepseek/deepseek-v4-pro" ;;
  flash) MODEL="openrouter/deepseek/deepseek-v4-flash" ;;
  *) usage ;;
esac

[[ -n "$OPENCODE_BIN" ]] || OPENCODE_BIN="$HOME/.local/bin/opencode"
[[ -x "$OPENCODE_BIN" ]] || { echo "OPENCODE_NOT_FOUND" >&2; exit 69; }
[[ -d "$ROOT/.git" ]] || { echo "PROJECT_ROOT_INVALID" >&2; exit 66; }

TASK_INPUT="$2"
[[ "$TASK_INPUT" != /* ]] || { echo "TASK_PATH_INVALID" >&2; exit 66; }
TASK_PATH="$(realpath -e -- "$ROOT/$TASK_INPUT" 2>/dev/null || true)"
TASK_ROOT="$(realpath -e -- "$ROOT/ai/tasks")"
[[ -n "$TASK_PATH" && "$TASK_PATH" == "$TASK_ROOT"/* && -f "$TASK_PATH" ]] || {
  echo "TASK_PATH_INVALID" >&2
  exit 66
}

TASK_SIZE="$(wc -c < "$TASK_PATH")"
(( TASK_SIZE <= 12288 )) || { echo "TASK_TOO_LARGE" >&2; exit 65; }

mkdir -p "$LOG_ROOT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"
EVENT_LOG="$LOG_ROOT/$STAMP.json"
BEFORE_STATUS="$(mktemp /tmp/whh-ai-before-status.XXXXXX)"
BEFORE_DIFF="$(mktemp /tmp/whh-ai-before-diff.XXXXXX)"
AFTER_STATUS="$(mktemp /tmp/whh-ai-after-status.XXXXXX)"
AFTER_DIFF="$(mktemp /tmp/whh-ai-after-diff.XXXXXX)"
trap 'rm -f "$BEFORE_STATUS" "$BEFORE_DIFF" "$AFTER_STATUS" "$AFTER_DIFF"' EXIT

git -C "$ROOT" status --short > "$BEFORE_STATUS"
git -C "$ROOT" diff --name-only > "$BEFORE_DIFF"

set +e
"$OPENCODE_BIN" run \
  --pure \
  --dir "$ROOT" \
  --format json \
  --agent whh-worker \
  --model "$MODEL" \
  "$(<"$TASK_PATH")" > "$EVENT_LOG"
RUN_EXIT=$?
set -e

git -C "$ROOT" status --short > "$AFTER_STATUS"
git -C "$ROOT" diff --name-only > "$AFTER_DIFF"

echo "MODEL=$MODEL"
echo "EVENT_LOG=$EVENT_LOG"
echo "EXIT_CODE=$RUN_EXIT"
echo "BEFORE_STATUS"
cat "$BEFORE_STATUS"
echo "BEFORE_DIFF_NAME_ONLY"
cat "$BEFORE_DIFF"
echo "AFTER_STATUS"
cat "$AFTER_STATUS"
echo "AFTER_DIFF_NAME_ONLY"
cat "$AFTER_DIFF"

node - "$EVENT_LOG" <<'NODE'
const fs = require("fs");
const lines = fs.readFileSync(process.argv[2], "utf8").split(/\r?\n/).filter(Boolean);
let input = 0, output = 0, cost = 0, sawUsage = false, sawCost = false;
for (const line of lines) {
  let event;
  try { event = JSON.parse(line); } catch { continue; }
  const stack = [event];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (value.usage && typeof value.usage === "object") {
      const i = Number(value.usage.input_tokens ?? value.usage.inputTokens ?? value.usage.input ?? 0);
      const o = Number(value.usage.output_tokens ?? value.usage.outputTokens ?? value.usage.output ?? 0);
      if (Number.isFinite(i) || Number.isFinite(o)) { input += i || 0; output += o || 0; sawUsage = true; }
    }
    if (typeof value.cost === "number" && Number.isFinite(value.cost)) { cost += value.cost; sawCost = true; }
    for (const child of Object.values(value)) if (child && typeof child === "object") stack.push(child);
  }
}
console.log(`INPUT_TOKENS=${sawUsage ? input : "UNAVAILABLE"}`);
console.log(`OUTPUT_TOKENS=${sawUsage ? output : "UNAVAILABLE"}`);
console.log(`COST=${sawCost ? cost : "UNAVAILABLE"}`);
NODE

exit "$RUN_EXIT"
