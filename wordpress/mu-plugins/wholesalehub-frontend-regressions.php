<?php
/**
 * WholesaleHub frontend regression guards.
 *
 * Keeps product searches on the normal WooCommerce/theme search template,
 * removes misleading zero-cost "free shipping" rows when supplier shipping
 * is represented by a positive WholesaleHub fee, and cleans historical
 * escaped linebreaks in supplier-lane product descriptions at render time.
 */

defined('ABSPATH') || exit;

/**
 * Return true when the current query is a product search rather than the shop archive.
 *
 * @param bool              $is_search Whether WordPress considers the request a search.
 * @param string|string[]   $post_type Query post type.
 */
function wholesalehub_is_product_search_context(bool $is_search, $post_type): bool
{
    if (!$is_search) {
        return false;
    }

    if (is_array($post_type)) {
        return in_array('product', $post_type, true);
    }

    return $post_type === 'product';
}

/**
 * Prevent the custom shop/home template from hijacking product search requests.
 */
function wholesalehub_guard_product_search_template(): void
{
    $post_type = get_query_var('post_type');
    if (!wholesalehub_is_product_search_context(is_search(), $post_type)) {
        return;
    }

    if (class_exists('WholesaleHub_Homepage')) {
        remove_filter('template_include', ['WholesaleHub_Homepage', 'front_page_template'], 1000);
        remove_action('wp_enqueue_scripts', ['WholesaleHub_Homepage', 'enqueue_assets'], 30);
    }
}
add_action('wp', 'wholesalehub_guard_product_search_template', 1);

/**
 * Detect whether an order has a positive WholesaleHub supplier-shipping fee.
 *
 * Monetary totals are never changed here; this is display-only detection.
 */
function wholesalehub_order_has_positive_supplier_shipping_fee($order): bool
{
    if (!is_object($order) || !method_exists($order, 'get_items')) {
        return false;
    }

    foreach ((array) $order->get_items('fee') as $fee) {
        if (!is_object($fee) || !method_exists($fee, 'get_name') || !method_exists($fee, 'get_total')) {
            continue;
        }

        $name = trim((string) $fee->get_name());
        $total = (float) $fee->get_total();
        if ($name === '배송비' && $total > 0) {
            return true;
        }
    }

    return false;
}

/**
 * Remove the confusing zero-cost Woo shipping row when supplier shipping is already
 * shown as a positive WholesaleHub fee. Keep any real, non-zero Woo shipping total.
 */
function wholesalehub_filter_order_item_totals(array $total_rows, $order, $tax_display = ''): array
{
    unset($tax_display);

    if (!is_object($order) || !method_exists($order, 'get_shipping_total')) {
        return $total_rows;
    }

    $woo_shipping_total = (float) $order->get_shipping_total();
    if ($woo_shipping_total > 0 || !wholesalehub_order_has_positive_supplier_shipping_fee($order)) {
        return $total_rows;
    }

    unset($total_rows['shipping']);
    return $total_rows;
}
add_filter('woocommerce_get_order_item_totals', 'wholesalehub_filter_order_item_totals', 20, 3);

/**
 * Convert historical escaped CR/LF tokens to visible line breaks.
 *
 * This intentionally runs only on supplier-lane product descriptions. New source
 * descriptions are already normalized by WholesaleHub_Supplier_Lanes; this guard
 * handles older post content without mutating stored data.
 */
function wholesalehub_normalize_escaped_display_linebreaks(string $content): string
{
    return str_replace(
        ['\\r\\n', '\\n', '\\r'],
        ['<br>', '<br>', '<br>'],
        $content
    );
}

function wholesalehub_normalize_supplier_product_content(string $content): string
{
    if (!is_singular('product') || !is_main_query()) {
        return $content;
    }

    $product_id = (int) get_the_ID();
    if ($product_id < 1 || (string) get_post_meta($product_id, '_wh_supplier_lane_mode', true) !== '1') {
        return $content;
    }

    if (strpos($content, '\\n') === false && strpos($content, '\\r') === false) {
        return $content;
    }

    return wholesalehub_normalize_escaped_display_linebreaks($content);
}
add_filter('the_content', 'wholesalehub_normalize_supplier_product_content', 20);
