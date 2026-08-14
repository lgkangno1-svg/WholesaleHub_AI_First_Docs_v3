#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SCRIPT="$ROOT/scripts/n8n-supplier-catalog-sync.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
contains() { grep -Fq "$2" "$1" || fail "missing $2 in $1"; }
absent() { ! grep -Fq "$2" "$1" || fail "unexpected $2 in $1"; }
json() { /usr/bin/node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));' "$1"; }
marker_json() { sed -n 's/^WHOLESALEHUB_RESULT_JSON=//p' "$1" | /usr/bin/node -e 'let s=""; process.stdin.on("data", c => s += c).on("end", () => JSON.parse(s));'; }
make_case() {
  D=$1; mkdir -p "$D/bin" "$D/reports/rebuild" "$D/scripts/supplier-catalog"
  touch "$D/scripts/supplier-catalog/collect-dailyfood-catalog.mjs" "$D/scripts/supplier-catalog/collect-walldob2b-catalog.mjs" "$D/scripts/supplier-catalog/build-catalog-plan.mjs" "$D/scripts/supplier-catalog/generate-daily-shipping-audit.mjs" "$D/scripts/supplier-catalog/sync-woocommerce-catalog.php"
  printf '%s\n' '#!/usr/bin/env bash' 'if [ "$1" = "--check" ]; then printf "node-check %s\n" "$2" >>"$MOCK_TRACE"; exit 0; fi' 'printf "node %s\n" "$1" >>"$MOCK_TRACE"' 'case "$1" in *collect-dailyfood-catalog.mjs*) if [ "${MOCK_MODE:-ok}" = timeout ] || [ "${MOCK_MODE:-ok}" = signal ]; then (sleep 30 & echo $! >"$MOCK_CHILD_PID"); sleep 30; fi; [ "${MOCK_MODE:-ok}" = failure ] && exit 1;; esac' 'exit 0' >"$D/bin/node"
  printf '%s\n' '#!/usr/bin/env bash' 'printf "docker %s\n" "$1" >>"$MOCK_TRACE"' 'exit 0' >"$D/bin/docker"
  printf '%s\n' '#!/usr/bin/env bash' 'case "$*" in *+%H*) echo 11;; *+%F*) echo 2026-08-09;; *) /bin/date "$@";; esac' >"$D/bin/date"
  chmod +x "$D/bin/node" "$D/bin/docker" "$D/bin/date"
}
run_case() {
  D="$TMP/$1"; make_case "$D"; : >"$D/trace"; set +e
  PATH="$D/bin:$PATH" WHOLESALEHUB_PROJECT_DIR="$D" WHOLESALEHUB_JSON_NODE=/usr/bin/node WHOLESALEHUB_CRAWLER_TIMEOUT=1s WHOLESALEHUB_NETWORK_TIMEOUT=1s MOCK_MODE="${2:-ok}" MOCK_TRACE="$D/trace" MOCK_CHILD_PID="$D/child.pid" "$SCRIPT" >"$D/output" 2>"$D/error"; CODE=$?
  set -e; marker_json "$D/output"; json "$D/reports/runtime/supplier-catalog-sync-status.json"
}
run_case normal
[ "$CODE" -eq 0 ] || fail "normal exit $CODE"
contains "$D/output" '"status":"completed"'; contains "$D/reports/runtime/supplier-catalog-sync-status.json" '"last_success_at":"'; contains "$D/reports/runtime/supplier-catalog-sync-status.json" '"current_step":"completed"'; contains "$D/reports/runtime/supplier-catalog-sync-status.json" '"started_at":"'; contains "$D/reports/runtime/supplier-catalog-sync-status.json" '"finished_at":"'; contains "$D/error" 'step=dailyfood_collect status=running'
LOCK="$TMP/lock"; make_case "$LOCK"; : >"$LOCK/trace"; mkdir -p "$LOCK/reports/runtime" "$LOCK/reports"
printf '%s\n' '{"status":"running","run_id":"owner","started_at":"x","finished_at":"x","current_step":"dailyfood_collect","last_success_at":"old-success","last_failure_at":"old-failure","duration_seconds":1,"exit_code":0,"failure_reason":null,"pid":1}' >"$LOCK/reports/runtime/supplier-catalog-sync-status.json"
exec 8>"$LOCK/reports/supplier-catalog-sync.lock"; flock -n 8; set +e
PATH="$LOCK/bin:$PATH" WHOLESALEHUB_PROJECT_DIR="$LOCK" WHOLESALEHUB_JSON_NODE=/usr/bin/node MOCK_TRACE="$LOCK/trace" "$SCRIPT" >"$LOCK/output" 2>"$LOCK/error"; CODE=$?
set -e; [ "$CODE" -eq 75 ] || fail "lock exit $CODE"; marker_json "$LOCK/output"; json "$LOCK/reports/runtime/supplier-catalog-sync-status.json"
contains "$LOCK/output" '"status":"skipped_locked"'; absent "$LOCK/output" '"status":"completed"'; contains "$LOCK/reports/runtime/supplier-catalog-sync-status.json" '"run_id":"owner"'; contains "$LOCK/reports/runtime/supplier-catalog-sync-status.json" '"last_failure_at":"old-failure"'
run_case timeout timeout
[ "$CODE" -eq 124 ] || fail "timeout exit $CODE"; contains "$D/output" '"step":"dailyfood_collect"'; contains "$D/output" '"reason":"timeout"'; contains "$D/reports/runtime/supplier-catalog-sync-status.json" '"status":"failed"'; contains "$D/reports/runtime/supplier-catalog-sync-status.json" '"last_failure_at":"'
[ -s "$D/child.pid" ] || fail "timeout mock did not create child"; sleep 1; if kill -0 "$(cat "$D/child.pid")" 2>/dev/null; then fail "timeout descendant still running"; fi
TERM="$TMP/external-sigterm"; make_case "$TERM"; : >"$TERM/trace"
PATH="$TERM/bin:$PATH" WHOLESALEHUB_PROJECT_DIR="$TERM" WHOLESALEHUB_JSON_NODE=/usr/bin/node WHOLESALEHUB_CRAWLER_TIMEOUT=1m WHOLESALEHUB_NETWORK_TIMEOUT=1s WHOLESALEHUB_SIGNAL_GRACE_SECONDS=1 MOCK_MODE=signal MOCK_TRACE="$TERM/trace" MOCK_CHILD_PID="$TERM/child.pid" "$SCRIPT" >"$TERM/output" 2>"$TERM/error" &
TERM_PID=$!
for _ in 1 2 3 4 5; do [ -s "$TERM/child.pid" ] && break; sleep 1; done
[ -s "$TERM/child.pid" ] || fail "signal mock did not create child"
TERM_STARTED=$SECONDS
kill -TERM "$TERM_PID"
set +e; wait "$TERM_PID"; CODE=$?; set -e
[ "$CODE" -eq 143 ] || fail "SIGTERM exit $CODE"
[ "$((SECONDS - TERM_STARTED))" -le 3 ] || fail "SIGTERM shutdown was not prompt"
[ "$(grep -c '^WHOLESALEHUB_RESULT_JSON=' "$TERM/output")" -eq 1 ] || fail "SIGTERM marker count"
marker_json "$TERM/output"; json "$TERM/reports/runtime/supplier-catalog-sync-status.json"
contains "$TERM/output" '"status":"failed"'; contains "$TERM/output" '"exit_code":143'; contains "$TERM/output" '"step":"dailyfood_collect"'; contains "$TERM/output" '"reason":"terminated"'
contains "$TERM/reports/runtime/supplier-catalog-sync-status.json" '"status":"failed"'; contains "$TERM/reports/runtime/supplier-catalog-sync-status.json" '"current_step":"dailyfood_collect"'; contains "$TERM/reports/runtime/supplier-catalog-sync-status.json" '"failure_reason":"terminated"'
if kill -0 "$(cat "$TERM/child.pid")" 2>/dev/null; then fail "SIGTERM descendant still running"; fi
run_case failure failure
[ "$CODE" -eq 1 ] || fail "failure exit $CODE"; contains "$D/output" '"step":"dailyfood_collect"'; contains "$D/output" '"reason":"command_failed"'; contains "$D/trace" 'node scripts/supplier-catalog/collect-dailyfood-catalog.mjs'; absent "$D/trace" 'node scripts/supplier-catalog/collect-walldob2b-catalog.mjs'; absent "$D/trace" 'node scripts/supplier-catalog/build-catalog-plan.mjs'; absent "$D/trace" 'docker cp'
printf 'PASS supplier catalog sync stability: normal, lock, timeout and SIGTERM descendant cleanup, command failure downstream stop, status JSON\n'
