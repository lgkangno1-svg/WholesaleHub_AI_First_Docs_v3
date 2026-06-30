#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="/home/tnfwod/projects/wholesalehub"
REPORT_DIR="$PROJECT_DIR/reports"
LOCK_FILE="$REPORT_DIR/n8n-mvp-sync.lock"
STAMP="$(TZ=Asia/Seoul date +%Y%m%d-%H%M)"
LATEST_LOG="$REPORT_DIR/n8n-run-latest.log"
RUN_LOG="$REPORT_DIR/n8n-run-$STAMP.log"

mkdir -p "$REPORT_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -Is)] another n8n MVP sync run is already active" | tee "$LATEST_LOG" "$RUN_LOG"
  exit 1
fi

run() {
  echo "[$(date -Is)] $*"
  "$@"
}

{
  echo "[$(date -Is)] n8n MVP sync started"
  cd "$PROJECT_DIR"
  RUN_HOUR="${WHOLESALEHUB_RUN_HOUR:-$(TZ=Asia/Seoul date +%H)}"
  if [ "$RUN_HOUR" = "09" ]; then
    DAILYFOOD_MODE="crawl"
  else
    DAILYFOOD_MODE="snapshot"
  fi
  echo "[$(date -Is)] run_hour=$RUN_HOUR dailyfood_mode=$DAILYFOOD_MODE"
  run npm run mvp:plan -- --dailyfood-mode "$DAILYFOOD_MODE"
  run npm run mvp:sync-existing -- --execute --confirm "EXECUTE_MVP_SYNC_EXISTING_VARIATIONS_ONLY"
  run npm run mvp:delete-unsold -- --execute --confirm "PERMANENT_DELETE_UNSOLD_VARIATIONS_ONLY" --dailyfood-mode snapshot
  if [ "$RUN_HOUR" = "09" ]; then
    run npm run mvp:add-create -- --execute --confirm "EXECUTE_MVP_ADD_VARIATIONS_AND_CREATE_DRAFTS"
  fi
  run npm run mvp:qa
  run npm run mvp:export-review
  run npm run mvp:handoff
  run npm run orders:export-supplier-excels
  echo "[$(date -Is)] n8n MVP sync completed"
} > >(tee "$RUN_LOG" "$LATEST_LOG") 2>&1
