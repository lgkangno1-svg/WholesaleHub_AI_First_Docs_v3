#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="/home/tnfwod/projects/wholesalehub"
REPORT_DIR="$PROJECT_DIR/reports"
PENDING_REPORT_DIR="$REPORT_DIR/price-sync-telegram-pending"
LOCK_FILE="$REPORT_DIR/n8n-mvp-sync.lock"
STAMP="$(TZ=Asia/Seoul date +%Y%m%d-%H%M)"
LATEST_LOG="$REPORT_DIR/n8n-run-latest.log"
RUN_LOG="$REPORT_DIR/n8n-run-$STAMP.log"
RUN_ID="$STAMP-$$"
CURRENT_STEP="startup"
ALLOW_DESTRUCTIVE_SYNC="${WHOLESALEHUB_ALLOW_DESTRUCTIVE_SYNC:-0}"
ALLOW_STOCK_VISIBILITY_SYNC="${WHOLESALEHUB_ALLOW_STOCK_VISIBILITY_SYNC:-0}"
ALLOW_DRAFT_CREATE="${WHOLESALEHUB_ALLOW_DRAFT_CREATE:-0}"
ALLOW_DESCRIPTION_SYNC="${WHOLESALEHUB_ALLOW_DESCRIPTION_SYNC:-0}"
DRY_RUN="${WHOLESALEHUB_DRY_RUN:-0}"
PRICE_REPORT_SENT=0

mkdir -p "$REPORT_DIR"
mkdir -p "$PENDING_REPORT_DIR"
rm -f "$REPORT_DIR/mvp-price-change-telegram-report.json"
exec > >(tee "$RUN_LOG" "$LATEST_LOG") 2>&1

finish() {
  local code=$?
  local status="failed"
  if [ "$code" -ne 0 ] && [ ! -s "$REPORT_DIR/mvp-price-change-telegram-report.json" ] &&
    [ -f "$PROJECT_DIR/dist/reports/price-sync-failure-report-cli.js" ]; then
    node "$PROJECT_DIR/dist/reports/price-sync-failure-report-cli.js" \
      --run-id "$RUN_ID" --step "$CURRENT_STEP" \
      --out "$REPORT_DIR/mvp-price-change-telegram-report.json" >/dev/null 2>&1 || true
  fi
  if [ "$PRICE_REPORT_SENT" -ne 1 ] && [ -s "$REPORT_DIR/mvp-price-change-telegram-report.json" ]; then
    cp "$REPORT_DIR/mvp-price-change-telegram-report.json" "$PENDING_REPORT_DIR/$RUN_ID.json" >/dev/null 2>&1 || true
    docker cp "$REPORT_DIR/mvp-price-change-telegram-report.json" avocadoss-wp:/tmp/mvp-price-change-telegram-report.json >/dev/null 2>&1 &&
      docker exec avocadoss-wp wp avocadoss telegram-price-report /tmp/mvp-price-change-telegram-report.json --allow-root >/dev/null 2>&1 &&
      node "$PROJECT_DIR/dist/reports/price-sync-mark-telegram-cli.js" --run-id "$RUN_ID" --status sent >/dev/null 2>&1 &&
      rm -f "$PENDING_REPORT_DIR/$RUN_ID.json" ||
      node "$PROJECT_DIR/dist/reports/price-sync-mark-telegram-cli.js" --run-id "$RUN_ID" --status failed >/dev/null 2>&1 || true
  fi
  docker exec avocadoss-wp rm -f /tmp/mvp-price-change-telegram-report.json >/dev/null 2>&1 || true
  if [ "$code" -eq 0 ]; then status="completed"; fi
  printf 'WHOLESALEHUB_RESULT_JSON={"status":"%s","exit_code":%d,"step":"%s","run_id":"%s"}\n' \
    "$status" "$code" "$CURRENT_STEP" "$RUN_ID"
}
trap finish EXIT

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  CURRENT_STEP="lock"
  echo "[$(date -Is)] another n8n MVP sync run is already active"
  exit 75
fi

run_step() {
  CURRENT_STEP="$1"
  shift
  echo "[$(date -Is)] step=$CURRENT_STEP command=$*"
  "$@"
}

skip_step() {
  echo "[$(date -Is)] step=$1 skipped reason=$2"
}

retry_pending_price_reports() {
  local pending pending_run_id
  for pending in "$PENDING_REPORT_DIR"/*.json; do
    [ -f "$pending" ] || return 0
    pending_run_id="$(basename "$pending" .json)"
    if docker cp "$pending" avocadoss-wp:/tmp/mvp-price-change-telegram-report.json >/dev/null 2>&1 &&
      docker exec avocadoss-wp wp avocadoss telegram-price-report /tmp/mvp-price-change-telegram-report.json --allow-root >/dev/null 2>&1; then
      node "$PROJECT_DIR/dist/reports/price-sync-mark-telegram-cli.js" --run-id "$pending_run_id" --status sent >/dev/null 2>&1 || true
      rm -f "$pending"
    fi
  done
}

echo "[$(date -Is)] n8n MVP sync started run_id=$RUN_ID"
cd "$PROJECT_DIR"
RUN_HOUR="${WHOLESALEHUB_RUN_HOUR:-$(TZ=Asia/Seoul date +%H)}"
echo "[$(date -Is)] run_hour=$RUN_HOUR dailyfood_mode=actual-site dry_run=$DRY_RUN destructive=$ALLOW_DESTRUCTIVE_SYNC stock_visibility=$ALLOW_STOCK_VISIBILITY_SYNC draft_create=$ALLOW_DRAFT_CREATE description_sync=$ALLOW_DESCRIPTION_SYNC category_sync=manual_only"

run_step build npm run build
run_step retry_pending_price_reports retry_pending_price_reports
run_step product_identity_preflight docker exec avocadoss-wp wp avocadoss verify-product-identities --allow-root
run_step collect_and_plan node dist/reports/mvp-sync-plan-cli.js

PRICE_SYNC_ARGS=(
  --run-id "$RUN_ID"
  --plan "$REPORT_DIR/mvp-sync-plan.json"
  --db "/home/tnfwod/avocadoss-wordpress/wp_data/wp-content/uploads/wholesalehub/wholesalehub.sqlite"
  --migration "$PROJECT_DIR/migrations/003_price_sync_pipeline.sql"
  --out "$REPORT_DIR/mvp-price-change-telegram-report.json"
)
if [ "$DRY_RUN" = "1" ]; then
  run_step linked_offer_price_preflight node dist/reports/linked-offer-price-sync-cli.js "${PRICE_SYNC_ARGS[@]}"
else
  run_step linked_offer_price_sync node dist/reports/linked-offer-price-sync-cli.js --execute "${PRICE_SYNC_ARGS[@]}"
  run_step queue_price_report cp "$REPORT_DIR/mvp-price-change-telegram-report.json" "$PENDING_REPORT_DIR/$RUN_ID.json"
  run_step copy_price_report docker cp "$REPORT_DIR/mvp-price-change-telegram-report.json" avocadoss-wp:/tmp/mvp-price-change-telegram-report.json
  run_step send_price_report docker exec avocadoss-wp wp avocadoss telegram-price-report /tmp/mvp-price-change-telegram-report.json --allow-root
  run_step mark_price_report_sent node dist/reports/price-sync-mark-telegram-cli.js --run-id "$RUN_ID" --status sent
  run_step remove_queued_price_report rm -f "$PENDING_REPORT_DIR/$RUN_ID.json"
  PRICE_REPORT_SENT=1
  run_step remove_price_report docker exec avocadoss-wp rm -f /tmp/mvp-price-change-telegram-report.json
fi

PREFLIGHT_ARGS=(--plan "$REPORT_DIR/mvp-sync-plan.json")
if [ "$ALLOW_DESTRUCTIVE_SYNC" = "1" ] || [ "$ALLOW_STOCK_VISIBILITY_SYNC" = "1" ]; then
  PREFLIGHT_ARGS+=(--destructive)
fi
run_step preflight node dist/reports/mvp-sync-preflight-cli.js "${PREFLIGHT_ARGS[@]}"

if [ "$DRY_RUN" = "1" ]; then
  run_step audit_thumbnails node dist/reports/repair-public-product-images-cli.js --strict
  CURRENT_STEP="completed"
  echo "[$(date -Is)] n8n MVP sync dry-run completed run_id=$RUN_ID"
  exit 0
fi

run_step sync_walldo_confirmed_stockout node dist/reports/walldob2b-stock-sync-cli.js --execute --confirm "MARK_CONFIRMED_WALLDO_OUTOFSTOCK"
run_step repair_thumbnails node dist/reports/repair-public-product-images-cli.js --execute --confirm "REPAIR_PUBLIC_PRODUCT_IMAGES"
skip_step classify_categories "existing product categories are manual-only"

if [ "$ALLOW_DESTRUCTIVE_SYNC" = "1" ]; then
  run_step delete_source_absent node dist/reports/mvp-source-absence-delete-cli.js --execute --confirm "DELETE_SOURCE_ABSENT_NON_GROUPBUY_PRODUCTS"
else
  skip_step delete_source_absent "WHOLESALEHUB_ALLOW_DESTRUCTIVE_SYNC is not 1"
fi

if [ "$ALLOW_STOCK_VISIBILITY_SYNC" = "1" ]; then
  run_step sync_stock_visibility node dist/reports/hide-unsold-public-variations-cli.js --execute --confirm "HIDE_UNSOLD_PUBLIC_VARIATIONS"
else
  skip_step sync_stock_visibility "WHOLESALEHUB_ALLOW_STOCK_VISIBILITY_SYNC is not 1"
fi

if [ "$RUN_HOUR" = "09" ] && [ "$ALLOW_DRAFT_CREATE" = "1" ]; then
  run_step add_variations_and_drafts node dist/reports/mvp-add-create-cli.js --execute --confirm "EXECUTE_MVP_ADD_VARIATIONS_AND_CREATE_DRAFTS"
else
  skip_step add_variations_and_drafts "not enabled or not 09 KST"
fi
run_step product_identity_postflight docker exec avocadoss-wp wp avocadoss verify-product-identities --allow-root

run_step crawl_detail_images node dist/reports/supplier-detail-image-crawl-cli.js
if [ "$ALLOW_DESCRIPTION_SYNC" = "1" ]; then
  run_step sync_detail_descriptions /home/tnfwod/b2b-sync/venv/bin/python3 /home/tnfwod/b2b-sync/sync_supplier_detail_images.py \
    --manifest "$REPORT_DIR/supplier-detail-images.json" \
    --report "$REPORT_DIR/supplier-detail-images-sync-report.json" \
    --apply
else
  skip_step sync_detail_descriptions "WHOLESALEHUB_ALLOW_DESCRIPTION_SYNC is not 1"
fi

run_step customer_qa node dist/reports/mvp-customer-qa-cli.js
run_step export_review node dist/reports/mvp-export-review-cli.js
run_step handoff node dist/reports/mvp-handoff-cli.js
run_step export_orders node dist/reports/order-supplier-excel-export-cli.js
CURRENT_STEP="completed"
echo "[$(date -Is)] n8n MVP sync completed run_id=$RUN_ID"
