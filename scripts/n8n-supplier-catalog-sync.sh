#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="${WHOLESALEHUB_PROJECT_DIR:-/home/tnfwod/projects/wholesalehub}"
REPORT_DIR="$PROJECT_DIR/reports/rebuild"
RUNTIME_DIR="$PROJECT_DIR/reports/runtime"
STATUS_FILE="$RUNTIME_DIR/supplier-catalog-sync-status.json"
LOCK_FILE="$PROJECT_DIR/reports/supplier-catalog-sync.lock"
ADMINPLUS_RUN_DIR="$PROJECT_DIR/reports/adminplus-crawl-runs"
SECONDARY_ONLY="${WHOLESALEHUB_SECONDARY_ONLY:-0}"
CRAWLER_TIMEOUT="${WHOLESALEHUB_CRAWLER_TIMEOUT:-20m}"
NETWORK_TIMEOUT="${WHOLESALEHUB_NETWORK_TIMEOUT:-10m}"
SIGNAL_GRACE_SECONDS="${WHOLESALEHUB_SIGNAL_GRACE_SECONDS:-30}"
JSON_NODE="${WHOLESALEHUB_JSON_NODE:-node}"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
STARTED_AT="$(date -u +%FT%TZ)"
START_SECONDS=$SECONDS
step=init
failure_reason=
finalized=0
managed_pid=
last_success_at=null
last_failure_at=null
RUN_HOUR="$(TZ=Asia/Seoul date +%H)"
RUN_DATE="$(TZ=Asia/Seoul date +%F)"
mkdir -p "$REPORT_DIR" "$RUNTIME_DIR" "$ADMINPLUS_RUN_DIR"

emit_result() {
  local status=$1
  local code=$2
  local step=$3
  local reason=${4:-}
  "$JSON_NODE" -e '
    const [status, code, step, completedAt, runId, duration, reason] = process.argv.slice(1);
    process.stdout.write("WHOLESALEHUB_RESULT_JSON=" + JSON.stringify({
      status, exit_code: Number(code), step, completed_at: completedAt, run_id: runId,
      duration_seconds: Number(duration), reason: reason || null,
    }) + "\n");
  ' "$status" "$code" "$step" "$(date -u +%FT%TZ)" "$RUN_ID" "$((SECONDS - START_SECONDS))" "$reason"
}

read_previous_timestamps() {
  if [ -f "$STATUS_FILE" ]; then
    last_success_at=$("$JSON_NODE" -e 'const o = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(o.last_success_at || "");' "$STATUS_FILE")
    last_failure_at=$("$JSON_NODE" -e 'const o = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(o.last_failure_at || "");' "$STATUS_FILE")
  fi
}

write_status() {
  local status=$1 code=$2 reason=${3:-} finished_at tmp
  finished_at="$(date -u +%FT%TZ)"
  case "$status" in
    completed) last_success_at="$finished_at" ;;
    failed) last_failure_at="$finished_at" ;;
  esac
  tmp="$STATUS_FILE.$$.tmp"
  "$JSON_NODE" -e '
    const [status, code, runId, startedAt, finishedAt, step, lastSuccess, lastFailure, duration, reason, pid] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({
      status, run_id: runId, started_at: startedAt, finished_at: finishedAt, current_step: step,
      last_success_at: lastSuccess || null, last_failure_at: lastFailure || null,
      duration_seconds: Number(duration), exit_code: Number(code), failure_reason: reason || null, pid: Number(pid),
    }) + "\n");
  ' "$status" "$code" "$RUN_ID" "$STARTED_AT" "$finished_at" "$step" "$last_success_at" "$last_failure_at" "$((SECONDS - START_SECONDS))" "$reason" "$$" >"$tmp"
  mv "$tmp" "$STATUS_FILE"
}

log_event() {
  printf 'supplier_catalog_sync run_id=%s timestamp=%s step=%s status=%s duration_seconds=%s exit_code=%s\n' \
    "$RUN_ID" "$(date -u +%FT%TZ)" "$step" "$1" "$((SECONDS - START_SECONDS))" "$2" >&2
}

finish() {
  local status=$1 code=$2 result_step=$3 reason=${4:-}
  [ "$finalized" -eq 0 ] || return
  finalized=1
  step=$result_step
  write_status "$status" "$code" "$reason"
  log_event "$status" "$code"
  emit_result "$status" "$code" "$result_step" "$reason"
}

start_step() {
  step=$1
  write_status running 0
  log_event running 0
}

run_with_timeout() {
  local limit=$1
  shift
  setsid timeout --signal=TERM --kill-after=30s "$limit" "$@" &
  managed_pid=$!
  if wait "$managed_pid"; then
    managed_pid=
    return 0
  else
    local code=$?
  fi
  managed_pid=
  if [ "$code" -eq 124 ]; then failure_reason=timeout; else failure_reason=command_failed; fi
  return "$code"
}

terminate_managed_stage() {
  local deadline
  [ -n "$managed_pid" ] || return
  kill -TERM -- "-$managed_pid" 2>/dev/null || true
  deadline=$((SECONDS + SIGNAL_GRACE_SECONDS))
  while kill -0 -- "-$managed_pid" 2>/dev/null && [ "$SECONDS" -lt "$deadline" ]; do
    sleep 1
  done
  if kill -0 -- "-$managed_pid" 2>/dev/null; then
    kill -KILL -- "-$managed_pid" 2>/dev/null || true
  fi
  wait "$managed_pid" 2>/dev/null || true
  managed_pid=
}

notify_telegram() {
  local message=$1
  timeout --signal=TERM --kill-after=30s "$NETWORK_TIMEOUT" docker exec \
    -e WHOLESALEHUB_TELEGRAM_MESSAGE="$message" \
    avocadoss-wp \
    wp --allow-root --path=/var/www/html eval \
    "if (!function_exists('avocadoss_send_telegram_message') || !avocadoss_send_telegram_message(getenv('WHOLESALEHUB_TELEGRAM_MESSAGE'))) { exit(1); }" \
    >/dev/null 2>&1
}

handle_error() {
  local code=$1 reason=${failure_reason:-command_failed}
  notify_telegram "도매Hub 공급사 카탈로그 동기화 실패: 단계=$step 코드=$code" || true
  finish failed "$code" "$step" "$reason"
  exit "$code"
}

handle_signal() { terminate_managed_stage; finish failed 143 "$step" terminated; exit 143; }
handle_exit() { local code=$1; [ "$finalized" -ne 0 ] || finish failed "$code" "$step" unexpected_exit; }

verify_reusable_dailyfood_snapshot() {
  node -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    const expectedDate = process.argv[2];
    const snapshot = JSON.parse(fs.readFileSync(path, "utf8"));
    const generated = new Date(snapshot.generatedAt);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(generated).reduce((out, part) => {
      if (part.type !== "literal") out[part.type] = part.value;
      return out;
    }, {});
    const generatedDate = `${parts.year}-${parts.month}-${parts.day}`;
    if (snapshot.complete !== true || generatedDate !== expectedDate || parts.hour !== "11") {
      throw new Error(`dailyfood snapshot is not a complete same-day 11 KST snapshot: ${generatedDate}`);
    }
  ' "$REPORT_DIR/dailyfood-catalog-snapshot.json" "$RUN_DATE"
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  step=lock
  log_event skipped_locked 75
  emit_result skipped_locked 75 lock another_sync_is_running
  exit 75
fi
read_previous_timestamps
trap 'handle_error "$?"' ERR
trap handle_signal TERM INT
trap 'handle_exit "$?"' EXIT
start_step lock

if [ "$RUN_HOUR" != "11" ] && [ "$RUN_HOUR" != "15" ] && [ "$RUN_HOUR" != "18" ] && [ "$RUN_HOUR" != "21" ] && [ "$SECONDARY_ONLY" != "1" ]; then
  start_step schedule
  finish completed 0 completed schedule_not_due
  exit 0
fi

cd "$PROJECT_DIR"

start_step preflight
node --check scripts/supplier-catalog/collect-dailyfood-catalog.mjs
node --check scripts/supplier-catalog/collect-walldob2b-catalog.mjs
node --check scripts/supplier-catalog/build-catalog-plan.mjs
node --check scripts/supplier-catalog/generate-daily-shipping-audit.mjs
if [ "$RUN_HOUR" = "11" ] && [ "$SECONDARY_ONLY" != "1" ]; then
  if ! mkdir "$ADMINPLUS_RUN_DIR/$RUN_DATE" 2>/dev/null; then
    start_step lock
    finish skipped_locked 75 lock duplicate_adminplus_run
    exit 75
  fi
  start_step dailyfood_collect
  run_with_timeout "$CRAWLER_TIMEOUT" node scripts/supplier-catalog/collect-dailyfood-catalog.mjs
else
  start_step dailyfood_same_day_snapshot
  verify_reusable_dailyfood_snapshot
  start_step dailyfood_image_retry
  run_with_timeout "$CRAWLER_TIMEOUT" node scripts/supplier-catalog/revalidate-catalog-images.mjs \
    "$REPORT_DIR/dailyfood-catalog-snapshot.json"
fi
start_step walldob2b_collect
run_with_timeout "$CRAWLER_TIMEOUT" node scripts/supplier-catalog/collect-walldob2b-catalog.mjs
start_step grouping
node scripts/supplier-catalog/build-catalog-plan.mjs

start_step woocommerce_sync
run_with_timeout "$NETWORK_TIMEOUT" docker cp "$REPORT_DIR/catalog-rebuild-plan.json" \
  avocadoss-wp:/tmp/catalog-sync-plan.json >/dev/null
run_with_timeout "$NETWORK_TIMEOUT" docker cp "$PROJECT_DIR/scripts/supplier-catalog/sync-woocommerce-catalog.php" \
  avocadoss-wp:/tmp/sync-woocommerce-catalog.php >/dev/null
run_with_timeout "$NETWORK_TIMEOUT" docker exec \
  -e WHOLESALEHUB_SYNC_PLAN=/tmp/catalog-sync-plan.json \
  -e WHOLESALEHUB_SYNC_RESULT=/tmp/catalog-sync-result.json \
  avocadoss-wp \
  wp --allow-root --path=/var/www/html eval-file /tmp/sync-woocommerce-catalog.php
run_with_timeout "$NETWORK_TIMEOUT" docker cp avocadoss-wp:/tmp/catalog-sync-result.json \
  "$REPORT_DIR/catalog-sync-result.json" >/dev/null

publish_snapshot_to_container() {
  local source=$1
  local name=$2
  local supplier=$3
  local valid
  valid=$(node -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    const expected = process.argv[2];
    let s;
    try { s = JSON.parse(fs.readFileSync(path, "utf8")); } catch { process.stdout.write("invalid_json"); process.exit(0); }
    const products = Array.isArray(s) ? s : (s.products || []);
    if (!Array.isArray(products) || products.length === 0) { process.stdout.write("empty"); process.exit(0); }
    if ((s.supplier || "") !== expected) { process.stdout.write("supplier_mismatch"); process.exit(0); }
    if (s.complete !== true) { process.stdout.write("incomplete"); process.exit(0); }
    const counts = s.counts || {};
    if ((counts.duplicateProductIds || 0) > 0 || (counts.duplicateOptionIds || 0) > 0) {
      process.stdout.write("duplicate_ids");
      process.exit(0);
    }
    for (const p of products) {
      if (!p.sourceProductId || !p.productName) { process.stdout.write("missing_identity"); process.exit(0); }
    }
    process.stdout.write(JSON.stringify({ ok: true, generated_at: s.generatedAt || "", count: products.length }));
  ' "$source" "$supplier")
  case "$valid" in
    invalid_json|empty|supplier_mismatch|incomplete|duplicate_ids|missing_identity)
      echo "snapshot_publish $name FAILED reason=$valid" >&2
      failure_reason="snapshot_publish_$valid"
      return 1 ;;
  esac
  run_with_timeout "$NETWORK_TIMEOUT" docker cp "$source" "avocadoss-wp:/tmp/wh-snap-$name" >/dev/null
  run_with_timeout "$NETWORK_TIMEOUT" docker exec avocadoss-wp sh -c "mv -f /tmp/wh-snap-$name /var/www/html/wp-content/uploads/wholesalehub/$name"
  echo "snapshot_publish $name OK $valid" >&2
}

start_step snapshot_publish
publish_snapshot_to_container "$REPORT_DIR/dailyfood-catalog-snapshot.json" dailyfood-catalog-snapshot.json dailyfood
publish_snapshot_to_container "$REPORT_DIR/walldob2b-catalog-snapshot.json" walldob2b-catalog-snapshot.json walldob2b

start_step shipping_audit
node scripts/supplier-catalog/generate-daily-shipping-audit.mjs "$REPORT_DIR"

step=completed
sync_mode=11시
if [ "$RUN_HOUR" = "18" ] || [ "$SECONDARY_ONLY" = "1" ]; then
  sync_mode=18시/즉시
fi
telegram_message=$(node -e '
  const result = require(process.argv[1]);
  const syncMode = process.argv[2];
  const audit = require(process.argv[3]);
  const counts = result.counts ?? {};
  const reviewRequired = (result.reviews ?? [])
    .filter((row) => !["image_failed", "sync_group_failed"].includes(row.reason))
    .slice(0, 20)
    .map((row) => `[${row.parent_id ?? "?"}] ${row.product_name ?? row.group_key ?? "이름 없음"}`)
    .join(", ");
  const failed = (result.reviews ?? [])
    .filter((row) => ["image_failed", "sync_group_failed"].includes(row.reason))
    .slice(0, 20)
    .map((row) => `[${row.parent_id ?? "?"}] ${row.product_name ?? row.group_key ?? "이름 없음"}`)
    .join(", ");
  const lines = [
    "Supplier Catalog Sync 완료",
    `모드 ${syncMode}`,
    `수집 상품 ${counts.collected_products ?? 0}`,
    `신규 상품 ${counts.product_created ?? 0}`,
    `가격 ${counts.price_updated ?? 0}`,
    `재고 ${counts.stock_updated ?? 0}`,
    `이미지 발견 ${counts.images_found ?? 0}`,
    `Walldo 이미지 수집 ${counts.walldo_images_collected ?? 0}`,
    `Daily 이미지 수집 ${counts.daily_images_collected ?? 0}`,
    `Walldo 이미지 적용 ${counts.walldo_image_applied ?? 0}`,
    `Daily 이미지 적용 ${counts.daily_image_applied ?? 0}`,
    `기존 이미지 유지 ${counts.existing_image_kept ?? 0}`,
    `무료 이미지 적용 0`,
    `AI 이미지 적용 0`,
    `이미지 재시도 필요 ${counts.image_retry_needed ?? 0}`,
    `공급사 이미지 없음 ${counts.source_image_unavailable ?? 0}`,
    `이미지 실패 ${counts.image_failed ?? 0}`,
    `가성비 제외 ${counts.terminal_excluded ?? 0}`,
    `천도 계열 제외 ${counts.nectarine_excluded ?? 0}`,
    `품절 ${counts.missing_marked_out_of_stock ?? 0}`,
    `신규 상품 승인대기 ${counts.approval_pending_products ?? 0}`,
    `신규 옵션 승인대기 ${counts.approval_pending_options ?? 0}`,
    `배송비 정책: 무료 ${counts.shipping_free_count ?? 0} / 고정 ${counts.shipping_fixed_count ?? 0} / 수량별 ${counts.shipping_tiered_count ?? 0} / 기타 조건부 ${audit.counts?.other_conditional?.options ?? 0} / 확인필요 ${counts.shipping_unknown_count ?? 0}`,
    `배송비 정책 변경 ${counts.shipping_policy_updated ?? 0}`,
    `상품·옵션 수집 실패 ${audit.counts?.collection_failures ?? 0}`,
    `이미지 원본 없음 ${counts.source_image_unavailable ?? 0}`,
    `review_required ${(counts.image_review_required ?? 0) + (counts.review_needed ?? 0)}`,
    `실패 ${counts.failed ?? 0}`,
  ];
  if (reviewRequired) lines.push(`review_required 상품 ${reviewRequired}`);
  if (failed) lines.push(`실패 상품 ${failed}`);
  process.stdout.write(lines.join("\n"));
' "$REPORT_DIR/catalog-sync-result.json" "$sync_mode" "$REPORT_DIR/daily-shipping-audit.json")
start_step telegram
notify_telegram "$telegram_message"
printf 'sent %s\n' "$(date -u +%FT%TZ)" >"$REPORT_DIR/telegram-report.status"
step=completed
finish completed 0 completed
