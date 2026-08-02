#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="${WHOLESALEHUB_PROJECT_DIR:-/home/tnfwod/projects/wholesalehub}"
REPORT_DIR="$PROJECT_DIR/reports/rebuild"
LOCK_FILE="$PROJECT_DIR/reports/supplier-catalog-sync.lock"
ADMINPLUS_RUN_DIR="$PROJECT_DIR/reports/adminplus-crawl-runs"
SECONDARY_ONLY="${WHOLESALEHUB_SECONDARY_ONLY:-0}"
RUN_HOUR="$(TZ=Asia/Seoul date +%H)"
RUN_DATE="$(TZ=Asia/Seoul date +%F)"
mkdir -p "$REPORT_DIR"
mkdir -p "$ADMINPLUS_RUN_DIR"

emit_result() {
  local status=$1
  local code=$2
  local step=$3
  node -e '
    const [status, code, step] = process.argv.slice(1);
    process.stdout.write("WHOLESALEHUB_RESULT_JSON=" + JSON.stringify({
      status,
      exit_code: Number(code),
      step,
      completed_at: new Date().toISOString(),
    }) + "\n");
  ' "$status" "$code" "$step"
}

notify_telegram() {
  local message=$1
  docker exec \
    -e WHOLESALEHUB_TELEGRAM_MESSAGE="$message" \
    avocadoss-wp \
    wp --allow-root --path=/var/www/html eval \
    "if (!function_exists('avocadoss_send_telegram_message') || !avocadoss_send_telegram_message(getenv('WHOLESALEHUB_TELEGRAM_MESSAGE'))) { exit(1); }" \
    >/dev/null 2>&1
}

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
  emit_result completed 0 completed
  exit 0
fi

if [ "$RUN_HOUR" != "11" ] && [ "$RUN_HOUR" != "18" ] && [ "$SECONDARY_ONLY" != "1" ]; then
  emit_result completed 0 completed
  exit 0
fi

step=dailyfood
trap 'code=$?; notify_telegram "도매Hub 공급사 카탈로그 동기화 실패: 단계=$step 코드=$code" || true; emit_result failed "$code" "$step"; exit "$code"' ERR
cd "$PROJECT_DIR"

step=build
npm run build
if [ "$RUN_HOUR" = "11" ] && [ "$SECONDARY_ONLY" != "1" ]; then
  if ! mkdir "$ADMINPLUS_RUN_DIR/$RUN_DATE" 2>/dev/null; then
    emit_result completed 0 completed
    exit 0
  fi
  step=dailyfood
  node scripts/supplier-catalog/collect-dailyfood-catalog.mjs
else
  step=dailyfood_same_day_snapshot
  verify_reusable_dailyfood_snapshot
  step=dailyfood_image_retry
  node scripts/supplier-catalog/revalidate-catalog-images.mjs \
    "$REPORT_DIR/dailyfood-catalog-snapshot.json"
fi
step=walldob2b
node scripts/supplier-catalog/collect-walldob2b-catalog.mjs
step=grouping
node scripts/supplier-catalog/build-catalog-plan.mjs

step=woocommerce_sync
docker cp "$REPORT_DIR/catalog-rebuild-plan.json" \
  avocadoss-wp:/tmp/catalog-sync-plan.json >/dev/null
docker cp "$PROJECT_DIR/scripts/supplier-catalog/sync-woocommerce-catalog.php" \
  avocadoss-wp:/tmp/sync-woocommerce-catalog.php >/dev/null
docker exec \
  -e WHOLESALEHUB_SYNC_PLAN=/tmp/catalog-sync-plan.json \
  -e WHOLESALEHUB_SYNC_RESULT=/tmp/catalog-sync-result.json \
  avocadoss-wp \
  wp --allow-root --path=/var/www/html eval-file /tmp/sync-woocommerce-catalog.php
docker cp avocadoss-wp:/tmp/catalog-sync-result.json \
  "$REPORT_DIR/catalog-sync-result.json" >/dev/null

step=completed
sync_mode=11시
if [ "$RUN_HOUR" = "18" ] || [ "$SECONDARY_ONLY" = "1" ]; then
  sync_mode=18시/즉시
fi
telegram_message=$(node -e '
  const result = require(process.argv[1]);
  const syncMode = process.argv[2];
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
    `배송비 정책: 무료 ${counts.shipping_free_count ?? 0} / 고정 ${counts.shipping_fixed_count ?? 0} / 수량별 ${counts.shipping_tiered_count ?? 0} / 확인필요 ${counts.shipping_unknown_count ?? 0}`,
    `배송비 정책 변경 ${counts.shipping_policy_updated ?? 0}`,
    `review_required ${(counts.image_review_required ?? 0) + (counts.review_needed ?? 0)}`,
    `실패 ${counts.failed ?? 0}`,
  ];
  if (reviewRequired) lines.push(`review_required 상품 ${reviewRequired}`);
  if (failed) lines.push(`실패 상품 ${failed}`);
  process.stdout.write(lines.join("\n"));
' "$REPORT_DIR/catalog-sync-result.json" "$sync_mode")
step=telegram
notify_telegram "$telegram_message"
printf 'sent %s\n' "$(date -u +%FT%TZ)" >"$REPORT_DIR/telegram-report.status"
step=completed
emit_result completed 0 completed
