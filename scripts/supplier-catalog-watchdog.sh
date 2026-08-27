#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="${WHOLESALEHUB_PROJECT_DIR:-/home/tnfwod/projects/wholesalehub}"
RUNTIME_DIR="${WHOLESALEHUB_RUNTIME_DIR:-$PROJECT_DIR/reports/runtime}"
STATUS_FILE="${WHOLESALEHUB_CATALOG_STATUS_FILE:-$RUNTIME_DIR/supplier-catalog-sync-status.json}"
ALERT_STATE_FILE="${WHOLESALEHUB_CATALOG_WATCHDOG_STATE_FILE:-$RUNTIME_DIR/supplier-catalog-watchdog-last-alert.txt}"
NOW_EPOCH="${WHOLESALEHUB_WATCHDOG_NOW_EPOCH:-$(date +%s)}"
RUN_HOUR="${WHOLESALEHUB_RUN_HOUR:-$(TZ=Asia/Seoul date +%H)}"
NO_TELEGRAM="${WHOLESALEHUB_WATCHDOG_NO_TELEGRAM:-0}"

mkdir -p "$RUNTIME_DIR"

threshold_seconds() {
  case "$RUN_HOUR" in
    15|21) echo $((8 * 60 * 60)) ;;
    *) echo $((14 * 60 * 60)) ;;
  esac
}

notify_telegram() {
  local message=$1
  if [ "$NO_TELEGRAM" = "1" ]; then
    printf 'WATCHDOG_TELEGRAM_SKIPPED=%s\n' "$message"
    return 0
  fi
  timeout --signal=TERM --kill-after=15s 30s docker exec \
    -e WHOLESALEHUB_TELEGRAM_MESSAGE="$message" \
    avocadoss-wp \
    wp --allow-root --path=/var/www/html eval \
    "if (!function_exists('avocadoss_send_telegram_message') || !avocadoss_send_telegram_message(getenv('WHOLESALEHUB_TELEGRAM_MESSAGE'))) { exit(1); }" \
    >/dev/null 2>&1
}

emit_result() {
  local health=$1 reason=$2 age=${3:-null}
  printf 'WHOLESALEHUB_CATALOG_WATCHDOG={"health":"%s","reason":"%s","age_seconds":%s,"run_hour":"%s"}\n' \
    "$health" "$reason" "$age" "$RUN_HOUR"
}

if [ ! -s "$STATUS_FILE" ]; then
  reason="status_file_missing"
  key="$reason"
  previous="$(cat "$ALERT_STATE_FILE" 2>/dev/null || true)"
  if [ "$previous" != "$key" ]; then
    notify_telegram "⚠️ 도매Hub 공급사 카탈로그 감시: 상태 파일이 없습니다. 자동 크롤링/동기화 스케줄이 실행 중인지 확인이 필요합니다." || true
    printf '%s\n' "$key" >"$ALERT_STATE_FILE"
  fi
  emit_result warning "$reason" null
  exit 0
fi

parsed="$({ node - "$STATUS_FILE" "$NOW_EPOCH" "$(threshold_seconds)" <<'NODE'
const fs = require('node:fs');
const [path, nowRaw, thresholdRaw] = process.argv.slice(2);
let status;
try {
  status = JSON.parse(fs.readFileSync(path, 'utf8'));
} catch (error) {
  process.stdout.write(JSON.stringify({health:'warning',reason:'invalid_status_json',age:null,key:'invalid_status_json'}));
  process.exit(0);
}
const now = Number(nowRaw);
const threshold = Number(thresholdRaw);
const successRaw = typeof status.last_success_at === 'string' ? status.last_success_at : '';
const failureRaw = typeof status.last_failure_at === 'string' ? status.last_failure_at : '';
const currentStatus = typeof status.status === 'string' ? status.status : 'unknown';
const startedRaw = typeof status.started_at === 'string' ? status.started_at : '';
const successEpoch = successRaw ? Date.parse(successRaw) / 1000 : NaN;
const startedEpoch = startedRaw ? Date.parse(startedRaw) / 1000 : NaN;
let health = 'healthy';
let reason = 'recent_success';
let age = Number.isFinite(successEpoch) ? Math.max(0, Math.floor(now - successEpoch)) : null;
if (!Number.isFinite(successEpoch)) {
  health = 'warning';
  reason = 'no_success_recorded';
} else if (currentStatus === 'failed' && (!failureRaw || Date.parse(failureRaw) >= Date.parse(successRaw))) {
  health = 'warning';
  reason = 'latest_run_failed';
} else if (currentStatus === 'running' && Number.isFinite(startedEpoch) && now - startedEpoch > 45 * 60) {
  health = 'warning';
  reason = 'run_stuck_over_45m';
} else if (age > threshold) {
  health = 'warning';
  reason = 'last_success_stale';
}
const key = [reason, successRaw, failureRaw, currentStatus].join('|');
process.stdout.write(JSON.stringify({health,reason,age,key,currentStatus,lastSuccess:successRaw}));
NODE
} 2>/dev/null)"

health="$(node -e 'const o=JSON.parse(process.argv[1]);process.stdout.write(String(o.health||"warning"))' "$parsed")"
reason="$(node -e 'const o=JSON.parse(process.argv[1]);process.stdout.write(String(o.reason||"unknown"))' "$parsed")"
age="$(node -e 'const o=JSON.parse(process.argv[1]);process.stdout.write(o.age===null?"null":String(o.age))' "$parsed")"
key="$(node -e 'const o=JSON.parse(process.argv[1]);process.stdout.write(String(o.key||o.reason||"unknown"))' "$parsed")"

if [ "$health" = "healthy" ]; then
  rm -f "$ALERT_STATE_FILE"
  emit_result healthy "$reason" "$age"
  exit 0
fi

previous="$(cat "$ALERT_STATE_FILE" 2>/dev/null || true)"
if [ "$previous" != "$key" ]; then
  case "$reason" in
    latest_run_failed)
      message="🚨 도매Hub 공급사 카탈로그 감시: 최신 자동 동기화가 실패 상태입니다. n8n/로그 확인이 필요합니다." ;;
    run_stuck_over_45m)
      message="⚠️ 도매Hub 공급사 카탈로그 감시: 동기화가 45분 이상 실행 중 상태입니다. 크롤러/락 상태 확인이 필요합니다." ;;
    last_success_stale)
      message="⚠️ 도매Hub 공급사 카탈로그 감시: 최근 성공 기록이 허용 시간보다 오래되었습니다. 스케줄이 누락됐을 수 있습니다." ;;
    no_success_recorded)
      message="⚠️ 도매Hub 공급사 카탈로그 감시: 성공 기록을 찾을 수 없습니다. 자동 크롤링/동기화 상태 확인이 필요합니다." ;;
    invalid_status_json)
      message="⚠️ 도매Hub 공급사 카탈로그 감시: 상태 파일 JSON이 손상되었습니다." ;;
    *)
      message="⚠️ 도매Hub 공급사 카탈로그 감시: 비정상 상태가 감지되었습니다 ($reason)." ;;
  esac
  notify_telegram "$message" || true
  printf '%s\n' "$key" >"$ALERT_STATE_FILE"
fi

emit_result warning "$reason" "$age"
exit 0
