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
import json, sys
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

if daily is None:
    print('DAILYFOOD_SCHEDULE_STATUS=UNKNOWN_OR_MISSING')
elif now.hour >= 13 and daily.date() != now.date():
    print('DAILYFOOD_SCHEDULE_STATUS=STALE_AFTER_13')
elif (now - daily).total_seconds() > 30 * 3600:
    print('DAILYFOOD_SCHEDULE_STATUS=STALE_OVER_30H')
else:
    print('DAILYFOOD_SCHEDULE_STATUS=FRESH')

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

section '5. ORDER EXPORT SCREENING (READ ONLY, EXPORTER-ALIGNED)'
if command -v docker >/dev/null 2>&1 && docker inspect "$WP_CONTAINER" >/dev/null 2>&1; then
  docker exec "$WP_CONTAINER" wp --allow-root --path=/var/www/html eval '
$path = WP_CONTENT_DIR . "/uploads/wholesalehub/wholesalehub.sqlite";
if (defined("WHOLESALEHUB_SQLITE_PATH") && WHOLESALEHUB_SQLITE_PATH) { $path = WHOLESALEHUB_SQLITE_PATH; }
if (!file_exists($path)) { echo "ORDER_SCREEN_DB=MISSING\n"; return; }
try {
  $db = new PDO("sqlite:" . $path);
  $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  $db->exec("PRAGMA query_only = ON");
  $db->exec("PRAGMA busy_timeout = 3000");
} catch (Throwable $e) {
  echo "ORDER_SCREEN_DB=OPEN_FAILED\n";
  return;
}
function whdiag_table_exists($db, $name) {
  $s = $db->prepare("SELECT 1 FROM sqlite_master WHERE type = \"table\" AND name = :name LIMIT 1");
  $s->execute([":name" => $name]);
  return (bool)$s->fetchColumn();
}
function whdiag_columns($db, $table) {
  $out = [];
  foreach ($db->query("PRAGMA table_info(" . $table . ")")->fetchAll(PDO::FETCH_ASSOC) as $row) { $out[(string)$row["name"]] = true; }
  return $out;
}
function whdiag_is_sent($db, $itemId, $supplier) {
  $s = $db->prepare("SELECT 1 FROM supplier_order_export_items i JOIN supplier_order_export_batches b ON b.id = i.batch_id WHERE i.woo_order_item_id = :item AND lower(i.supplier_id) = lower(:supplier) AND b.status = \"sent\" LIMIT 1");
  $s->execute([":item" => $itemId, ":supplier" => $supplier]);
  return false !== $s->fetchColumn();
}
function whdiag_before_cutoff($value, $cutoff) {
  if (!$value) { return false; }
  try { return (new DateTimeImmutable((string)$value))->getTimestamp() <= $cutoff->getTimestamp(); }
  catch (Throwable $e) { return false; }
}
$required = ["woo_order_item_source_snapshots", "supplier_order_export_items", "supplier_order_export_batches", "woo_order_item_source_unmapped"];
foreach ($required as $table) {
  if (!whdiag_table_exists($db, $table)) { echo "ORDER_SCREEN_TABLES=MISSING:" . $table . "\n"; return; }
}
echo "ORDER_SCREEN_DB=READ_ONLY_OK\n";
$tz = new DateTimeZone("Asia/Seoul");
$now = new DateTimeImmutable("now", $tz);
$cutoff = $now->setTime(7, 0, 0);
if ($now < $cutoff) { $cutoff = $cutoff->modify("-1 day"); }
echo "ORDER_SCREEN_0700_CUTOFF=" . $cutoff->format(DATE_ATOM) . "\n";
$snapshotCols = whdiag_columns($db, "woo_order_item_source_snapshots");
$createdExpr = isset($snapshotCols["created_at"]) ? "s.created_at" : "NULL";
$suppliers = ["dailyfood", "walldob2b"];
$totalRows = 0;
$totalOrders = [];
$totalPre0700 = 0;
foreach ($suppliers as $supplier) {
  $sql = "SELECT s.woo_order_id, s.woo_order_item_id, s.supplier_id, " . $createdExpr . " AS created_at FROM woo_order_item_source_snapshots s WHERE s.snapshot_status = \"mapped\" AND lower(s.supplier_id) = :supplier AND NOT EXISTS (SELECT 1 FROM supplier_order_export_items i JOIN supplier_order_export_batches b ON b.id = i.batch_id WHERE i.woo_order_item_id = s.woo_order_item_id AND lower(i.supplier_id) = lower(s.supplier_id) AND b.status = \"sent\") ORDER BY s.woo_order_id, s.woo_order_item_id";
  $q = $db->prepare($sql);
  $q->execute([":supplier" => $supplier]);
  $seen = [];
  $rows = 0;
  $orders = [];
  $pre0700 = 0;
  foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $snapshot) {
    $order = wc_get_order((int)$snapshot["woo_order_id"]);
    if (!$order || !in_array($order->get_status(), ["processing", "completed"], true)) { continue; }
    $item = $order->get_item((int)$snapshot["woo_order_item_id"]);
    if (!$item instanceof WC_Order_Item_Product) { continue; }
    $key = (int)$snapshot["woo_order_item_id"] . "|" . strtolower((string)$snapshot["supplier_id"]);
    $seen[$key] = true;
    $rows++;
    $orders[(int)$snapshot["woo_order_id"]] = true;
    if (whdiag_before_cutoff($snapshot["created_at"], $cutoff)) { $pre0700++; }
  }
  foreach (wc_get_orders(["status" => ["processing", "completed"], "limit" => -1, "type" => "shop_order", "return" => "ids"]) as $orderId) {
    $order = wc_get_order((int)$orderId);
    if (!$order) { continue; }
    foreach ($order->get_items() as $itemId => $item) {
      if (!$item instanceof WC_Order_Item_Product) { continue; }
      $metaSupplier = strtolower(trim((string)$item->get_meta("_wh_source_supplier_id", true)));
      if ($metaSupplier === "" || $metaSupplier !== strtolower($supplier)) { continue; }
      $key = (int)$itemId . "|" . $metaSupplier;
      if (isset($seen[$key]) || whdiag_is_sent($db, (int)$itemId, $supplier)) { continue; }
      $seen[$key] = true;
      $rows++;
      $orders[(int)$orderId] = true;
      $created = $order->get_date_created();
      if ($created && $created->getTimestamp() <= $cutoff->getTimestamp()) { $pre0700++; }
    }
  }
  $label = strtoupper($supplier);
  echo "ORDER_SCREEN_" . $label . "_PENDING_ROWS=" . $rows . "\n";
  echo "ORDER_SCREEN_" . $label . "_PENDING_ORDERS=" . count($orders) . "\n";
  echo "ORDER_SCREEN_" . $label . "_PENDING_PRE_0700_ROWS=" . $pre0700 . "\n";
  $totalRows += $rows;
  $totalPre0700 += $pre0700;
  foreach ($orders as $orderId => $_) { $totalOrders[$orderId] = true; }
}
echo "ORDER_SCREEN_TOTAL_PENDING_ROWS=" . $totalRows . "\n";
echo "ORDER_SCREEN_TOTAL_PENDING_ORDERS=" . count($totalOrders) . "\n";
echo "ORDER_SCREEN_TOTAL_PENDING_PRE_0700_ROWS=" . $totalPre0700 . "\n";
$unmapped = 0;
foreach ($db->query("SELECT DISTINCT woo_order_id FROM woo_order_item_source_unmapped")->fetchAll(PDO::FETCH_COLUMN) as $orderId) {
  $order = wc_get_order((int)$orderId);
  if ($order && in_array($order->get_status(), ["processing", "completed"], true)) { $unmapped++; }
}
echo "ORDER_SCREEN_CURRENT_SOURCE_UNMAPPED_ORDERS=" . $unmapped . "\n";
$batchCounts = ["sent" => 0, "failed" => 0, "started" => 0];
foreach ($db->query("SELECT status, COUNT(*) AS n FROM supplier_order_export_batches GROUP BY status")->fetchAll(PDO::FETCH_ASSOC) as $row) { $batchCounts[(string)$row["status"]] = (int)$row["n"]; }
foreach (["sent", "failed", "started"] as $status) { echo "ORDER_SCREEN_BATCH_" . strtoupper($status) . "=" . ($batchCounts[$status] ?? 0) . "\n"; }
$lastSent = $db->query("SELECT MAX(sent_at) FROM supplier_order_export_batches WHERE status = \"sent\"")->fetchColumn();
$lastStarted = $db->query("SELECT MAX(started_at) FROM supplier_order_export_batches")->fetchColumn();
echo "ORDER_SCREEN_LAST_SENT_AT=" . ($lastSent ?: "NONE") . "\n";
echo "ORDER_SCREEN_LAST_BATCH_STARTED_AT=" . ($lastStarted ?: "NONE") . "\n";
' 2>/dev/null || echo 'ORDER_SCREEN=FAILED_TO_QUERY'
else
  echo 'ORDER_SCREEN=SKIPPED_NO_WP_CONTAINER'
fi

echo 'ORDER_SCREEN_NOTE=Read-only screening mirrors the real exporter candidate rules: mapped unsent SQLite snapshots first, then eligible Woo line-item source-meta fallback, with sent-batch dedupe. It does not export or mark anything.'

section '6. SAFE INTERPRETATION'
echo 'CATALOG_NOTE=A Walldo warning is a catalog freshness signal, not proof of Telegram outage or order corruption.'
echo 'TELEGRAM_NOTE=Receiving the scheduled report/warning proves the outbound Telegram notification path was working at those send times.'
echo 'ORDER_NOTE=If TOTAL_PENDING_PRE_0700_ROWS is above zero after the 07:00 report said zero, investigate the exporter/scheduler. TOTAL_PENDING_ROWS can also include orders that became eligible after 07:00.'
echo 'NO_MUTATION=YES'
echo 'WHOLESALEHUB_OPERATIONS_HEALTH=DONE'
