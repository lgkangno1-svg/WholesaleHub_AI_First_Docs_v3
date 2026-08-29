#!/usr/bin/env bash
set -Eeuo pipefail

CONTAINER="${WHOLESALEHUB_WP_CONTAINER:-avocadoss-wp}"
WP_PATH="${WHOLESALEHUB_WP_PATH:-/var/www/html}"
TMP_HOST="$(mktemp /tmp/wholesalehub-current-orders.XXXXXX.php)"
TMP_CONTAINER="/tmp/wholesalehub-current-orders.php"
trap 'rm -f "$TMP_HOST" >/dev/null 2>&1 || true; docker exec "$CONTAINER" rm -f "$TMP_CONTAINER" >/dev/null 2>&1 || true' EXIT

cat > "$TMP_HOST" <<'PHP'
<?php
if (!function_exists('wc_get_orders')) {
    fwrite(STDERR, "WOO_BOOTSTRAP=FAILED\n");
    exit(20);
}

$tz = wp_timezone();
$now = new DateTimeImmutable('now', $tz);
$todayStart = $now->setTime(0, 0, 0);
$twoHoursAgo = $now->modify('-2 hours');
$dayAgo = $now->modify('-24 hours');

function wh_get_orders_since(DateTimeImmutable $since): array {
    return wc_get_orders([
        'limit'        => -1,
        'return'       => 'objects',
        'orderby'      => 'date',
        'order'        => 'DESC',
        'date_created' => '>=' . $since->getTimestamp(),
        'type'         => 'shop_order',
    ]);
}

function wh_status_counts(array $orders): array {
    $counts = [];
    foreach ($orders as $order) {
        $status = (string) $order->get_status();
        if (!isset($counts[$status])) {
            $counts[$status] = 0;
        }
        $counts[$status]++;
    }
    ksort($counts);
    return $counts;
}

function wh_is_paid_like(WC_Order $order): bool {
    if ($order->is_paid()) {
        return true;
    }
    return in_array($order->get_status(), ['processing', 'completed'], true);
}

$today = wh_get_orders_since($todayStart);
$last2h = wh_get_orders_since($twoHoursAgo);
$last24h = wh_get_orders_since($dayAgo);

$todayPaidLike = array_values(array_filter($today, 'wh_is_paid_like'));
$last2hPaidLike = array_values(array_filter($last2h, 'wh_is_paid_like'));

echo "WHOLESALEHUB_CURRENT_ORDERS=START\n";
echo 'KST_NOW=' . $now->format('Y-m-d H:i:sP') . "\n";
echo 'TODAY_START=' . $todayStart->format('Y-m-d H:i:sP') . "\n";
echo 'TODAY_ORDER_COUNT=' . count($today) . "\n";
echo 'TODAY_PAID_OR_PROCESSING_COUNT=' . count($todayPaidLike) . "\n";
echo 'LAST_2H_ORDER_COUNT=' . count($last2h) . "\n";
echo 'LAST_2H_PAID_OR_PROCESSING_COUNT=' . count($last2hPaidLike) . "\n";
echo 'LAST_24H_ORDER_COUNT=' . count($last24h) . "\n";

foreach (wh_status_counts($today) as $status => $count) {
    echo 'TODAY_STATUS_' . strtoupper(str_replace('-', '_', $status)) . '=' . $count . "\n";
}

echo "RECENT_ORDERS_BEGIN\n";
$recent = array_slice($last24h, 0, 20);
foreach ($recent as $order) {
    /** @var WC_Order $order */
    $created = $order->get_date_created();
    $createdText = $created ? $created->setTimezone($tz)->format('Y-m-d H:i:sP') : 'UNKNOWN';
    $itemLines = count($order->get_items('line_item'));
    $currency = (string) $order->get_currency();
    $total = (string) $order->get_total();
    $paid = wh_is_paid_like($order) ? 'YES' : 'NO';
    printf(
        "ORDER id=%d created=%s status=%s paid_like=%s total=%s%s item_lines=%d\n",
        (int) $order->get_id(),
        $createdText,
        (string) $order->get_status(),
        $paid,
        $total,
        $currency,
        $itemLines
    );
}
echo "RECENT_ORDERS_END\n";
echo "PII_INCLUDED=NO\n";
echo "NO_MUTATION=YES\n";
echo "WHOLESALEHUB_CURRENT_ORDERS=DONE\n";
PHP

docker inspect "$CONTAINER" >/dev/null 2>&1 || { echo "WP_CONTAINER_NOT_FOUND=$CONTAINER" >&2; exit 10; }
docker cp "$TMP_HOST" "$CONTAINER:$TMP_CONTAINER" >/dev/null
docker exec "$CONTAINER" wp --allow-root --path="$WP_PATH" eval-file "$TMP_CONTAINER"
