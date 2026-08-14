#!/usr/bin/env bash
set -Eeuo pipefail

fail_json() {
  node -e 'process.stdout.write(JSON.stringify({schemaVersion:1,processStatus:"failed",fatal:true,error:process.argv[1]})+"\n")' "$1"
  exit "${2:-3}"
}

required_env() {
  local name=$1
  [ -n "${!name:-}" ] || fail_json "missing_env:$name" 3
}

for name in \
  WHOLESALEHUB_SUPPLIER_LANE_DB \
  WHOLESALEHUB_DAILYFOOD_SNAPSHOT_V2 \
  WHOLESALEHUB_WALLDOB2B_SNAPSHOT_V2 \
  WHOLESALEHUB_SUPPLIER_LANE_PIPELINE_RUN_ID \
  WHOLESALEHUB_SOURCE_GIT_COMMIT; do
  required_env "$name"
done

PROJECT_DIR="${WHOLESALEHUB_SUPPLIER_LANE_PROJECT_DIR:-$(pwd)}"
OUTPUT_DIR="${WHOLESALEHUB_SUPPLIER_LANE_OUTPUT_DIR:-$PROJECT_DIR/artifacts/supplier-lane-ops/runtime}"
MODE="${WHOLESALEHUB_SUPPLIER_LANE_MODE:-no-write}"
RUN_ID="${WHOLESALEHUB_SUPPLIER_LANE_RUN_ID:-supplier-lane-$(date +%Y%m%d%H%M%S)-$$}"
NOW_MS="${WHOLESALEHUB_SUPPLIER_LANE_NOW_MS:-$(node -e 'process.stdout.write(String(Date.now()))')}"
MAX_AGE_MS="${WHOLESALEHUB_SUPPLIER_LANE_MAX_AGE_MS:-1800000}"
mkdir -p "$OUTPUT_DIR"

args=(
  "$PROJECT_DIR/dist/reports/supplier-lane-sync-cli.js"
  --mode "$MODE"
  --run-id "$RUN_ID"
  --pipeline-run-id "$WHOLESALEHUB_SUPPLIER_LANE_PIPELINE_RUN_ID"
  --db-path "$WHOLESALEHUB_SUPPLIER_LANE_DB"
  --daily-snapshot "$WHOLESALEHUB_DAILYFOOD_SNAPSHOT_V2"
  --walldo-snapshot "$WHOLESALEHUB_WALLDOB2B_SNAPSHOT_V2"
  --source-git-commit "$WHOLESALEHUB_SOURCE_GIT_COMMIT"
  --dist-git-commit "$WHOLESALEHUB_SOURCE_GIT_COMMIT"
  --plan-file "$OUTPUT_DIR/plan.json"
  --result-file "$OUTPUT_DIR/result.json"
  --now-ms "$NOW_MS"
  --max-age-ms "$MAX_AGE_MS"
)

if [ -n "${WHOLESALEHUB_DAILYFOOD_PREVIOUS_COUNT:-}" ]; then
  args+=(--daily-previous-count "$WHOLESALEHUB_DAILYFOOD_PREVIOUS_COUNT")
fi
if [ -n "${WHOLESALEHUB_WALLDOB2B_PREVIOUS_COUNT:-}" ]; then
  args+=(--walldo-previous-count "$WHOLESALEHUB_WALLDOB2B_PREVIOUS_COUNT")
fi
if [ "$MODE" = "execute" ]; then
  [ "${WHOLESALEHUB_SUPPLIER_LANE_APPROVED:-0}" = "1" ] ||
    fail_json "execute_requires_WHOLESALEHUB_SUPPLIER_LANE_APPROVED=1" 3
  required_env WHOLESALEHUB_SUPPLIER_LANE_REVIEWED_PLAN_HASH
  export WHOLESALEHUB_SUPPLIER_LANE_MODE=1
  args+=(--confirm-execute --plan-hash "$WHOLESALEHUB_SUPPLIER_LANE_REVIEWED_PLAN_HASH")
elif [ "$MODE" != "no-write" ]; then
  fail_json "invalid_mode:$MODE" 3
fi

set +e
output="$(node "${args[@]}")"
code=$?
set -e
line_count="$(printf '%s\n' "$output" | awk 'NF { count++ } END { print count + 0 }')"
[ "$line_count" -eq 1 ] || fail_json "invalid_cli_stdout_line_count:$line_count" 4
printf '%s' "$output" | node -e '
  let raw="";
  process.stdin.on("data", chunk => raw += chunk);
  process.stdin.on("end", () => {
    const value = JSON.parse(raw);
    if (value === null || typeof value !== "object" || Array.isArray(value)) process.exit(1);
  });
' || fail_json "invalid_cli_json" 4
printf '%s\n' "$output"
exit "$code"
