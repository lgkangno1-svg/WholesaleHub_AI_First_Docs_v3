#!/usr/bin/env bash
set -Eeuo pipefail

CONTAINER="${WHOLESALEHUB_WP_CONTAINER:-avocadoss-wp}"
WP_PATH="${WHOLESALEHUB_WP_PATH:-/var/www/html}"
TMP_HOST="$(mktemp /tmp/wholesalehub-purchase-funnel.XXXXXX.php)"
TMP_CONTAINER="/tmp/wholesalehub-purchase-funnel.php"
trap 'rm -f "$TMP_HOST" >/dev/null 2>&1 || true; docker exec "$CONTAINER" rm -f "$TMP_CONTAINER" >/dev/null 2>&1 || true' EXIT

cat > "$TMP_HOST" <<'PHP'
<?php
if (!function_exists('wc_get_orders') || !function_exists('wc_get_products')) {
    fwrite(STDERR, "WOO_BOOTSTRAP=FAILED\n");
    exit(20);
}

$tz = wp_timezone();
$now = new DateTimeImmutable('now', $tz);
$sevenDaysAgo = $now->modify('-7 days');
$thirtyDaysAgo = $now->modify('-30 days');

function wh_status(int $userId): string {
    $status = (string) get_user_meta($userId, 'avocadoss_membership_status', true);
    if ($status === '') $status = (string) get_user_meta($userId, '_avo_approval_status', true);
    return $status !== '' ? $status : 'none';
}
function wh_orders_since(DateTimeImmutable $since): array {
    return wc_get_orders([
        'limit' => -1,
        'return' => 'objects',
        'orderby' => 'date',
        'order' => 'DESC',
        'date_created' => '>=' . $since->getTimestamp(),
        'type' => 'shop_order',
    ]);
}

$users = get_users(['fields' => ['ID', 'user_registered']]);
$memberCounts = ['pending' => 0, 'approved' => 0, 'rejected' => 0, 'none' => 0];
$signups7 = 0;
$signups30 = 0;
$pendingNoticeSent = 0;
$pendingNoticeMissing = 0;
$approvedZeroOrders = 0;
$approvedZeroBalance = 0;
foreach ($users as $user) {
    $uid = (int) $user->ID;
    $status = wh_status($uid);
    if (!isset($memberCounts[$status])) $memberCounts[$status] = 0;
    $memberCounts[$status]++;
    $registered = new DateTimeImmutable($user->user_registered, $tz);
    if ($registered >= $sevenDaysAgo) $signups7++;
    if ($registered >= $thirtyDaysAgo) $signups30++;
    if ($status === 'pending') {
        if ((string) get_user_meta($uid, '_avocadoss_ua_notified', true) !== '') $pendingNoticeSent++;
        else $pendingNoticeMissing++;
    }
    if ($status === 'approved') {
        if ((int) wc_get_customer_order_count($uid) === 0) $approvedZeroOrders++;
        if ((int) get_user_meta($uid, '_avocadoss_points', true) <= 0) $approvedZeroBalance++;
    }
}

$orders7 = wh_orders_since($sevenDaysAgo);
$orders30 = wh_orders_since($thirtyDaysAgo);
$orderStatus = [];
$paid30 = 0;
$chargePending30 = 0;
foreach ($orders30 as $order) {
    $status = (string) $order->get_status();
    $orderStatus[$status] = ($orderStatus[$status] ?? 0) + 1;
    if ($order->is_paid() || in_array($status, ['processing', 'completed'], true)) $paid30++;
    if ((string) $order->get_meta('_needs_charge_payment', true) === 'yes') $chargePending30++;
}
ksort($orderStatus);

$gateways = WC()->payment_gateways()->payment_gateways();
$enabledGateways = [];
foreach ($gateways as $id => $gateway) {
    if (isset($gateway->enabled) && $gateway->enabled === 'yes') $enabledGateways[] = (string) $id;
}

$cartId = (int) wc_get_page_id('cart');
$checkoutId = (int) wc_get_page_id('checkout');
$accountId = (int) wc_get_page_id('myaccount');
$products = wc_get_products(['limit' => 100, 'status' => 'publish', 'return' => 'objects']);
$inStock = 0;
$positivePrice = 0;
foreach ($products as $product) {
    if ($product->is_in_stock()) $inStock++;
    if ((float) $product->get_price() > 0) $positivePrice++;
}

echo "WHOLESALEHUB_PURCHASE_FUNNEL=START\n";
echo 'KST_NOW=' . $now->format('Y-m-d H:i:sP') . "\n";
echo "===== MEMBERSHIP =====\n";
foreach ($memberCounts as $status => $count) echo 'MEMBER_' . strtoupper($status) . '=' . $count . "\n";
echo 'SIGNUPS_7D=' . $signups7 . "\n";
echo 'SIGNUPS_30D=' . $signups30 . "\n";
echo 'PENDING_APPROVAL_NOTICE_SENT=' . $pendingNoticeSent . "\n";
echo 'PENDING_APPROVAL_NOTICE_MISSING=' . $pendingNoticeMissing . "\n";
echo 'APPROVED_ZERO_ORDER_USERS=' . $approvedZeroOrders . "\n";
echo 'APPROVED_ZERO_BALANCE_USERS=' . $approvedZeroBalance . "\n";
echo "===== ORDERS =====\n";
echo 'ORDERS_7D=' . count($orders7) . "\n";
echo 'ORDERS_30D=' . count($orders30) . "\n";
echo 'PAID_OR_PROCESSING_30D=' . $paid30 . "\n";
echo 'CHARGE_PAYMENT_PENDING_30D=' . $chargePending30 . "\n";
foreach ($orderStatus as $status => $count) echo 'ORDER_30D_' . strtoupper(str_replace('-', '_', $status)) . '=' . $count . "\n";
echo "===== CHECKOUT =====\n";
echo 'CART_PAGE=' . $cartId . ':' . ($cartId > 0 ? get_post_status($cartId) : 'missing') . "\n";
echo 'CHECKOUT_PAGE=' . $checkoutId . ':' . ($checkoutId > 0 ? get_post_status($checkoutId) : 'missing') . "\n";
echo 'MYACCOUNT_PAGE=' . $accountId . ':' . ($accountId > 0 ? get_post_status($accountId) : 'missing') . "\n";
echo 'ENABLED_GATEWAYS=' . implode(',', $enabledGateways) . "\n";
echo 'POINTS_GATEWAY_PRESENT=' . (isset($gateways['avocadoss_points']) ? 'YES' : 'NO') . "\n";
echo 'POINTS_GATEWAY_ENABLED=' . (isset($gateways['avocadoss_points']) && $gateways['avocadoss_points']->enabled === 'yes' ? 'YES' : 'NO') . "\n";
echo "===== CATALOG =====\n";
echo 'PUBLISHED_PRODUCT_SAMPLE=' . count($products) . "\n";
echo 'IN_STOCK_PRODUCT_SAMPLE=' . $inStock . "\n";
echo 'POSITIVE_PRICE_PRODUCT_SAMPLE=' . $positivePrice . "\n";
echo "===== INTERPRETATION =====\n";
echo "PENDING_USERS_CANNOT_PURCHASE=YES\n";
echo "IF_PENDING_NOTICE_MISSING_GT_0=membership approval notification path needs repair\n";
echo "IF_APPROVED_ZERO_ORDER_HIGH=inspect cart/checkout/payment UX and runtime next\n";
echo "IF_CHARGE_PAYMENT_PENDING_GT_0=checkout is creating orders but users are stopping before transfer/top-up completion\n";
echo "PII_INCLUDED=NO\n";
echo "NO_MUTATION=YES\n";
echo "WHOLESALEHUB_PURCHASE_FUNNEL=DONE\n";
PHP

docker inspect "$CONTAINER" >/dev/null 2>&1 || { echo "WP_CONTAINER_NOT_FOUND=$CONTAINER" >&2; exit 10; }
docker cp "$TMP_HOST" "$CONTAINER:$TMP_CONTAINER" >/dev/null
docker exec "$CONTAINER" wp --allow-root --path="$WP_PATH" eval-file "$TMP_CONTAINER"
