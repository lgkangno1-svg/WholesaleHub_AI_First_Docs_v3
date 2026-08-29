#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${WHOLESALEHUB_ROOT:-/home/tnfwod/projects/wholesalehub}"
WP_ROOT="${WHOLESALEHUB_WP_ROOT:-/home/tnfwod/avocadoss-wordpress/wp_data}"
WP_CONTAINER="${WHOLESALEHUB_WP_CONTAINER:-avocadoss-wp}"
SNAP_DIR="$WP_ROOT/wp-content/uploads/wholesalehub"
RUNTIME_STATUS="$ROOT/reports/runtime/supplier-catalog-sync-status.json"

section() { printf '\n===== %s =====\n' "$1"; }

printf 'WHOLESALEHUB_OPERATIONS_HEALTH=START\n'
printf 'UTC=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'KST=%s\n' "$(TZ=Asia/Seoul date +%Y-%m-%dT%H:%M:%S%z)"
printf 'HOST=%s\n' "$(hostname 2>/dev/null || echo unknown)"

section '1. DEPLOYED SOURCE'
if [[ -r "$ROOT/reports/runtime/deployed-github-head.txt" ]]; then
  printf 'DEPLOYED_GITHUB_HEAD=%s\n' "$(tr -d '\r\n' < "$ROOT/reports/runtime/deployed-github-head.txt")"
else
  echo 'DEPLOYED_GITHUB_HEAD=UNKNOWN'
fi
if [[ -d "$ROOT/.git" ]]; then
  printf 'MINIPC_SOURCE_HEAD=%s\n' "$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo UNKNOWN)"
else
  echo 'MINIPC_SOURCE_HEAD=NO_GIT_METADATA'
fi

section '2. SUPPLIER SNAPSHOT HEALTH'
python3 - "$SNAP_DIR/dailyfood-catalog-snapshot.json" "$SNAP_DIR/walldob2b-catalog-snapshot.json" <<'PY'
import json, os, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

kst = timezone(timedelta(hours=9))
now = datetime.now(kst)

def parse_time(v):
    if not isinstance(v, str) or not v.strip():
        return None
    try:
        return datetime.fromisoformat(v.replace('Z', '+00:00')).astimezone(kst)
    except Exception:
        return None

def safe_snapshot(label, path_text):
    path = Path(path_text)
    print(f'{label}_SNAPSHOT_PATH={path}')
    if not path.is_file():
        print(f'{label}_SNAPSHOT_EXISTS=NO')
        return None
    print(f'{label}_SNAPSHOT_EXISTS=YES')
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        print(f'{label}_SNAPSHOT_JSON=INVALID')
        return None
    generated = parse_time(data.get('generatedAt'))
    print(f'{label}_COMPLETE={str(data.get("complete") is True).upper()}')
    print(f'{label}_GENERATED_AT={data.get("generatedAt", "UNKNOWN")}')
    if generated:
        age_minutes = max(0, int((now - generated).total_seconds() // 60))
        print(f'{label}_AGE_MINUTES={age_minutes}')
    counts = data.get('counts') if isinstance(data.get('counts'), dict) else {}
    products = counts.get('products')
    options = counts.get('options')
    if products is None and isinstance(data.get('products'), list):
        products = len(data['products'])
    if options is None and isinstance(data.get('products'), list):
        options = sum(len(p.get('options', [])) for p in data['products'] if isinstance(p, dict) and isinstance(p.get('options'), list))
    print(f'{label}_PRODUCTS={products if products is not None else "UNKNOWN"}')
    print(f'{label}_OPTIONS={options if options is not None else "UNKNOWN"}')
    return generated

daily = safe_snapshot('DAILYFOOD', sys.argv[1])
walldo = safe_snapshot('WALLDO', sys.argv[2])

# DailyFood: authoritative crawl around 11 KST, same-day required after 13 KST.
if daily is None:
    print('DAILYFOOD_SCHEDULE_STATUS=UNKNOWN_OR_MISSING')
elif now.hour >= 13 and daily.date() != now.date():
    print('DAILYFOOD_SCHEDULE_STATUS=STALE_AFTER_13')
elif (now - daily).total_seconds() > 30 * 3600:
    print('DAILYFOOD_SCHEDULE_STATUS=STALE_OVER_30H')
else:
    print('DAILYFOOD_SCHEDULE_STATUS=FRESH')

# Walldo: current policy is 11:00 and 18:00 KST, each with a 2h grace period.
if now.hour >= 20:
    expected = now.replace(hour=18, minute=0, second=0, microsecond=0)
    reason = 'EXPECTED_18_SNAPSHOT_AFTER_20'
elif now.hour >= 13:
    expected = now.replace(hour=11, minute=0, second=0, microsecond=0)
    reason = 'EXPECTED_11_SNAPSHOT_AFTER_13'
else:
    prev = now - timedelta(days=1)
    expected = prev.replace(hour=18, minute=0, second=0, microsecond=0)
    reason = 'EXPECTED_PREVIOUS_18_SNAPSHOT_BEFORE_13'
print(f'WALLDO_EXPECTED_NOT_BEFORE={expected.isoformat()}')
if walldo is None:
    print('WALLDO_SCHEDULE_STATUS=UNKNOWN_OR_MISSING')
elif walldo < expected:
    print(f'WALLDO_SCHEDULE_STATUS=STALE:{reason}')
else:
    print('WALLDO_SCHEDULE_STATUS=FRESH')
PY

section '3. CATALOG RUNTIME STATUS'
if [[ -r "$RUNTIME_STATUS" ]]; then
  python3 - "$RUNTIME_STATUS" <<'PY'
import json, sys
try:
    data=json.load(open(sys.argv[1], encoding='utf-8'))
except Exception:
    print('CATALOG_RUNTIME_JSON=INVALID')
    raise SystemExit(0)
print('CATALOG_RUNTIME_JSON=VALID')
for key in ('status','current_step','last_success_at','last_failure_at','started_at','finished_at','exit_code','failure_reason','duration_seconds'):
    value=data.get(key)
    if isinstance(value, (str,int,float,bool)) or value is None:
        print(f'CATALOG_RUNTIME_{key.upper()}={value}')
PY
else
  echo 'CATALOG_RUNTIME_STATUS=MISSING'
fi

section '4. WORDPRESS / SCHEDULER READ-ONLY HEALTH'
if command -v docker >/dev/null 2>&1 && docker inspect "$WP_CONTAINER" >/dev/null 2>&1; then
  printf 'WP_CONTAINER_RUNNING='
  docker inspect -f '{{.State.Running}}' "$WP_CONTAINER" 2>/dev/null || true
  set +e
  docker exec "$WP_CONTAINER" wp --allow-root --path=/var/www/html core is-installed >/dev/null 2>&1
  wp_ok=$?
  set -e
  printf 'WORDPRESS_BOOTSTRAP_EXIT=%s\n' "$wp_ok"
  echo 'RELEVANT_WP_CRON_EVENTS:'
  docker exec "$WP_CONTAINER" wp --allow-root --path=/var/www/html cron event list --fields=hook,next_run_gmt,next_run_relative --format=csv 2>/dev/null \
    | grep -Ei 'wholesalehub|avocadoss|supplier|catalog' \
    | head -n 30 || true
else
  echo 'WP_CONTAINER_RUNNING=UNKNOWN_OR_NOT_FOUND'
fi

section '5. ORDER EXPORT SCREENING (READ ONLY)'
if command -v docker >/dev/null 2>&1 && docker inspect "$WP_CONTAINER" >/dev/null 2>&1; then
  docker exec "$WP_CONTAINER" wp --allow-root --path=/var/www/html eval '
$tz = new DateTimeZone("Asia/Seoul");
$now = new DateTimeImmutable("now", $tz);
$since = $now->modify("-1 day")->setTime(7, 0, 0);
$orders = wc_get_orders([
  "limit" => -1,
  "status" => ["processing", "completed"],
  "date_created" => ">=" . $since->getTimestamp(),
  "return" => "objects",
]);
$summary = ["orders"=>0,"eligible_lines"=>0,"already_sent_lines"=>0,"unsent_mapped_lines"=>0,"unsent_unmapped_lines"=>0,"eligible_qty"=>0];
foreach ($orders as $order) {
  $hasEligible = false;
  foreach ($order->get_items("line_item") as $item) {
    $qty = max(0, (int)$item->get_quantity() - abs((int)$order->get_qty_refunded_for_item($item->get_id())));
    if ($qty <= 0) { continue; }
    $hasEligible = true;
    $summary["eligible_lines"]++;
    $summary["eligible_qty"] += $qty;
    $sent = trim((string)$item->get_meta("_wholesalehub_supplier_sent_at", true)) !== "";
    if ($sent) { $summary["already_sent_lines"]++; continue; }
    $mapped = false;
    foreach (["_wholesalehub_supplier_id_snapshot","_wholesalehub_offer_id_snapshot","_wholesalehub_supplier_id","_supplier_id"] as $key) {
      if (trim((string)$item->get_meta($key, true)) !== "") { $mapped = true; break; }
    }
    if ($mapped) { $summary["unsent_mapped_lines"]++; } else { $summary["unsent_unmapped_lines"]++; }
  }
  if ($hasEligible) { $summary["orders"]++; }
}
echo "ORDER_SCREEN_WINDOW_START=" . $since->format(DATE_ATOM) . "\n";
echo "ORDER_SCREEN_WINDOW_END=" . $now->format(DATE_ATOM) . "\n";
foreach ($summary as $key=>$value) { echo "ORDER_SCREEN_" . strtoupper($key) . "=" . $value . "\n"; }
' 2>/dev/null || echo 'ORDER_SCREEN=FAILED_TO_QUERY'
else
  echo 'ORDER_SCREEN=SKIPPED_NO_WP_CONTAINER'
fi

echo 'ORDER_SCREEN_NOTE=Read-only screening only; it does not export, mark, pay, refund, order from suppliers, or modify WooCommerce data.'

section '6. SAFE INTERPRETATION'
echo 'CATALOG_NOTE=A Walldo warning is a catalog freshness signal, not proof of Telegram outage or order corruption.'
echo 'TELEGRAM_NOTE=Receiving the scheduled report/warning proves the outbound Telegram notification path was working at those send times.'
echo 'ORDER_NOTE=An all-zero 07:00 report is normal when there are no eligible unsent mapped processing/completed line items; compare with ORDER_SCREEN_* if orders were expected.'
echo 'NO_MUTATION=YES'
echo 'WHOLESALEHUB_OPERATIONS_HEALTH=DONE'
