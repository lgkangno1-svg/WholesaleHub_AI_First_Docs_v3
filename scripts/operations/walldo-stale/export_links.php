<?php
// Read-only bridge: export supplier lane links and product status for reconciliation.
global $wpdb;
$links = $wpdb->prefix . 'supplier_lane_parent_links';
$posts = $wpdb->posts;
$rows = $wpdb->get_results(
    "SELECT l.woo_parent_id, l.supplier_id, l.source_product_id, l.status AS lane_status,
            p.post_status, p.post_title
     FROM {$links} l JOIN {$posts} p ON p.ID = l.woo_parent_id
     WHERE p.post_type = 'product'",
    ARRAY_A
);
if (!is_array($rows)) { WP_CLI::error('Failed to read supplier lane links'); }
echo wp_json_encode($rows, JSON_UNESCAPED_UNICODE) . "\n";
