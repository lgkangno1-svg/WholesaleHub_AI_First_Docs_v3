#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="/home/tnfwod/projects/wholesalehub"
SHARED_DIR="/home/tnfwod/avocadoss-wordpress/wp_data/wp-content/uploads/wholesalehub"
DB_PATH="$SHARED_DIR/wholesalehub.sqlite"
SOURCE_DB="$PROJECT_DIR/data/wholesalehub.sqlite"
RUN_ID="${WHOLESALEHUB_RUN_ID:-daily-$(TZ=Asia/Seoul date +%Y%m%d-%H%M%S)}"
RUN_DIR="$PROJECT_DIR/reports/daily-pipeline/$RUN_ID"
SNAPSHOT_PATH="$RUN_DIR/daily-collect.json"
CURRENT_STAGE="startup"

fail_stage() {
  local code=$?
  if [ "$CURRENT_STAGE" != "startup" ] && [ -f "$DB_PATH" ]; then
    node "$PROJECT_DIR/dist/reports/pipeline-checkpoint-cli.js" \
      --db "$DB_PATH" \
      --run-id "$RUN_ID" \
      --stage "$CURRENT_STAGE" \
      --status failed \
      --error "stage failed with exit code $code" >/dev/null 2>&1 || true
  fi
  exit "$code"
}
trap fail_stage ERR

stage_done() {
  node "$PROJECT_DIR/dist/reports/pipeline-checkpoint-cli.js" \
    --db "$DB_PATH" \
    --run-id "$RUN_ID" \
    --stage "$1" \
    --status started \
    --is-complete >/dev/null 2>&1
}

mkdir -p "$RUN_DIR" "$SHARED_DIR"
if [ ! -f "$DB_PATH" ]; then
  cp "$SOURCE_DB" "$DB_PATH"
fi
cp "$DB_PATH" "$SHARED_DIR/wholesalehub-before-$RUN_ID.sqlite"

cd "$PROJECT_DIR"
npm run build
node dist/reports/isolated-migration-cli.js \
  --db "$DB_PATH" \
  --migration "$PROJECT_DIR/migrations/003_daily_pipeline_and_order_snapshot.sql"

CURRENT_STAGE="collect_products"
if ! stage_done collect_products; then
  RESUME_ARGS=()
  if [ -f "$SNAPSHOT_PATH" ]; then
    RESUME_ARGS+=(--resume)
  fi
  node dist/reports/daily-stable-collect-cli.js \
    --db "$DB_PATH" \
    --run-id "$RUN_ID" \
    --output "$SNAPSHOT_PATH" \
    "${RESUME_ARGS[@]}" |
    tee "$RUN_DIR/collect-result.json"
fi

CURRENT_STAGE="normalize"
if ! stage_done sync_comparison; then
  node dist/reports/atomic-sku-apply-cli.js \
    --db "$DB_PATH" \
    --daily-snapshot "$SNAPSHOT_PATH" |
    tee "$RUN_DIR/atomic-sync-result.json"

  for stage in normalize validate_prices sync_comparison; do
    node dist/reports/pipeline-checkpoint-cli.js \
      --db "$DB_PATH" \
      --run-id "$RUN_ID" \
      --stage "$stage" \
      --status completed \
      --artifact "$RUN_DIR/atomic-sync-result.json"
  done
fi

CURRENT_STAGE="create_woo_drafts"
DAILYFOOD_SNAPSHOT_PATH="$SNAPSHOT_PATH" \
  node dist/reports/mvp-sync-plan-cli.js
node dist/reports/safe-daily-draft-plan-cli.js \
  --db "$DB_PATH" \
  --plan "$PROJECT_DIR/reports/mvp-sync-plan.json" \
  --output "$RUN_DIR/safe-draft-plan.json" |
  tee "$RUN_DIR/safe-draft-plan-result.json"

if ! stage_done create_woo_drafts; then
  node dist/reports/mvp-add-create-cli.js \
    --execute \
    --confirm "EXECUTE_MVP_ADD_VARIATIONS_AND_CREATE_DRAFTS" \
    --plan "$RUN_DIR/safe-draft-plan.json" \
    --out-dir "$RUN_DIR" |
    tee "$RUN_DIR/draft-result.json"
  node dist/reports/pipeline-checkpoint-cli.js \
    --db "$DB_PATH" \
    --run-id "$RUN_ID" \
    --stage create_woo_drafts \
    --status completed \
    --artifact "$RUN_DIR/draft-result.json"
fi

CURRENT_STAGE="link_variations"
if ! stage_done link_variations; then
  node dist/reports/woo-variation-offer-link-cli.js --db "$DB_PATH" |
    tee "$RUN_DIR/link-result.json"
  node dist/reports/pipeline-checkpoint-cli.js \
    --db "$DB_PATH" \
    --run-id "$RUN_ID" \
    --stage link_variations \
    --status completed \
    --artifact "$RUN_DIR/link-result.json"
fi

node dist/reports/supplier-order-snapshot-csv-cli.js \
  --db "$DB_PATH" \
  --output-dir "$RUN_DIR/supplier-orders" |
  tee "$RUN_DIR/supplier-export-result.json"

python3 - "$DB_PATH" "$RUN_DIR" <<'PY'
import json
import sqlite3
import sys
from pathlib import Path

db_path, run_dir = sys.argv[1], Path(sys.argv[2])
collect = json.loads((run_dir / "collect-result.json").read_text())
draft = json.loads((run_dir / "mvp-add-create-execute-log.json").read_text())
link = json.loads((run_dir / "link-result.json").read_text())
with sqlite3.connect(db_path) as db:
    source_unmapped = db.execute(
        "SELECT count(*) FROM woo_order_item_source_unmapped"
    ).fetchone()[0]
summary = {
    "dailyExpected": collect["expectedProductCount"],
    "dailyCollected": collect["collectedProductCount"],
    "atomicOptionCount": collect["atomicOptionCount"],
    "incomplete": collect["incomplete"],
    "newDraftCount": draft["executedDraftProductCount"],
    "missingOptionsCount": collect["missingOptionsCount"],
    "sourceMismatchCount": collect["sourceMismatchCount"],
    "newVariationLinkCount": link["newLinkCount"],
    "sourceUnmappedOrderCount": source_unmapped,
    "existingOperatingProductChangeCount": 0,
}
(run_dir / "summary.json").write_text(
    json.dumps(summary, ensure_ascii=False, indent=2) + "\n"
)
print(json.dumps(summary, ensure_ascii=False))
PY

CURRENT_STAGE="notify"
if ! stage_done notify; then
  docker cp "$RUN_DIR/summary.json" avocadoss-wp:/tmp/wholesalehub-summary.json
  docker exec avocadoss-wp \
    wp avocadoss telegram-wholesalehub-summary /tmp/wholesalehub-summary.json --allow-root
  node dist/reports/pipeline-checkpoint-cli.js \
    --db "$DB_PATH" \
    --run-id "$RUN_ID" \
    --stage notify \
    --status completed \
    --artifact "$RUN_DIR/summary.json"
fi

CURRENT_STAGE="startup"
printf '%s\n' "$RUN_DIR"
