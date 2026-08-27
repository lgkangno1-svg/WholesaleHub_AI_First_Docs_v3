<?php
declare(strict_types=1);

define('ABSPATH', '/tmp/');

function add_action(...$args): void {}
function add_filter(...$args): void {}
function remove_action(...$args): void {}
function remove_filter(...$args): void {}

require __DIR__ . '/../wordpress/mu-plugins/wholesalehub-frontend-regressions.php';

function check(bool $condition, string $name): void
{
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$name}\n");
        exit(1);
    }
    echo "PASS: {$name}\n";
}

check(
    wholesalehub_is_product_search_context(true, 'product') === true,
    'product search is detected'
);
check(
    wholesalehub_is_product_search_context(true, ['post', 'product']) === true,
    'product search array is detected'
);
check(
    wholesalehub_is_product_search_context(true, 'post') === false,
    'normal search is not treated as product search'
);
check(
    wholesalehub_is_product_search_context(false, 'product') === false,
    'shop archive is not treated as search'
);

check(
    wholesalehub_normalize_escaped_display_linebreaks('a\\r\\nb\\nc\\rd') === 'a<br>b<br>c<br>d',
    'escaped CRLF/LF/CR become visible breaks'
);
check(
    wholesalehub_normalize_escaped_display_linebreaks("a\nb") === "a\nb",
    'real LF remains untouched'
);

final class WhTestFee
{
    public function __construct(private string $name, private float $total) {}
    public function get_name(): string { return $this->name; }
    public function get_total(): float { return $this->total; }
}

final class WhTestOrder
{
    public function __construct(private float $shippingTotal, private array $fees) {}
    public function get_shipping_total(): float { return $this->shippingTotal; }
    public function get_items(string $type): array { return $type === 'fee' ? $this->fees : []; }
}

$rows = [
    'cart_subtotal' => ['label' => '소계:', 'value' => '₩8,500'],
    'shipping' => ['label' => '배송:', 'value' => '무료 배송'],
    'fee_1' => ['label' => '배송비:', 'value' => '₩4,000'],
    'order_total' => ['label' => '총계:', 'value' => '₩12,500'],
];

$positiveSupplierFeeOrder = new WhTestOrder(0.0, [new WhTestFee('배송비', 4000.0)]);
$filtered = wholesalehub_filter_order_item_totals($rows, $positiveSupplierFeeOrder);
check(!isset($filtered['shipping']), 'zero Woo shipping row hidden when supplier fee is positive');
check(isset($filtered['fee_1']), 'supplier shipping fee remains visible');
check(isset($filtered['order_total']), 'order total remains visible');

$realWooShippingOrder = new WhTestOrder(3000.0, [new WhTestFee('배송비', 4000.0)]);
$filtered = wholesalehub_filter_order_item_totals($rows, $realWooShippingOrder);
check(isset($filtered['shipping']), 'real non-zero Woo shipping row is preserved');

$unrelatedFeeOrder = new WhTestOrder(0.0, [new WhTestFee('포장비', 4000.0)]);
$filtered = wholesalehub_filter_order_item_totals($rows, $unrelatedFeeOrder);
check(isset($filtered['shipping']), 'unrelated positive fee does not hide Woo shipping');

echo "PASS: WholesaleHub frontend regression guards\n";
