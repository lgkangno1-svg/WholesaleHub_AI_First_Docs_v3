#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/tnfwod/projects/wholesalehub"
SCRIPT="$ROOT/scripts/openrouter-direct-worker.mjs"

[[ -d "$ROOT/.git" ]] || { echo '{"success":false,"result":"PROJECT_ROOT_INVALID"}'; exit 66; }
[[ -f "$SCRIPT" ]] || { echo '{"success":false,"result":"WORKER_NOT_FOUND"}'; exit 66; }

cd "$ROOT"
timeout --signal=TERM --kill-after=5s 65s node "$SCRIPT"
