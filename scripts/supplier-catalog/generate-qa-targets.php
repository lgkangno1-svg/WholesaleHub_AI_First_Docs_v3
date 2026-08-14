<?php

defined('ABSPATH') || exit;

$result_path = getenv('WHOLESALEHUB_QA_TARGETS');
if (!is_string($result_path) || $result_path === '') {
    WP_CLI::error('QA target result path is required');
}

global $wpdb;
$parent_table = $wpdb->prefix . 'supplier_lane_parent_links';
$offer_table = $wpdb->prefix . 'supplier_lane_offers';

$catalog_rows = $wpdb->get_results(
    "SELECT p.ID,
            MAX(CASE WHEN l.lane_code = 'A' THEN 1 ELSE 0 END) AS has_a,
            MAX(CASE WHEN l.lane_code = 'B' THEN 1 ELSE 0 END) AS has_b,
            COUNT(DISTINCT o.id) AS option_count
     FROM {$wpdb->posts} p
     JOIN {$parent_table} l
       ON l.woo_parent_id = p.ID AND l.status = 'approved'
     JOIN {$offer_table} o
       ON o.woo_parent_id = p.ID
      AND o.approval_status = 'approved'
      AND o.lifecycle_status = 'active'
      AND o.stock_status = 'in_stock'
     WHERE p.post_type = 'product' AND p.post_status = 'publish'
     GROUP BY p.ID
     ORDER BY p.ID",
    ARRAY_A
);

$targets = [
    'aOnly' => null,
    'bOnly' => null,
    'ab' => null,
    'fiveOptions' => null,
];
foreach ($catalog_rows as $row) {
    $target = [
        'productId' => (int) $row['ID'],
        'url' => get_permalink((int) $row['ID']),
        'optionCount' => (int) $row['option_count'],
    ];
    if ((int) $row['has_a'] === 1 && (int) $row['has_b'] === 0 && $targets['aOnly'] === null) {
        $targets['aOnly'] = $target;
    }
    if ((int) $row['has_a'] === 0 && (int) $row['has_b'] === 1 && $targets['bOnly'] === null) {
        $targets['bOnly'] = $target;
    }
    if ((int) $row['has_a'] === 1 && (int) $row['has_b'] === 1 && $targets['ab'] === null) {
        $targets['ab'] = $target;
    }
    if ((int) $row['option_count'] >= 5 && $targets['fiveOptions'] === null) {
        $targets['fiveOptions'] = $target;
    }
}

foreach ($targets as $name => $target) {
    if (!is_array($target) || !is_string($target['url']) || $target['url'] === '') {
        WP_CLI::error('missing QA target: ' . $name);
    }
}

$store_offer = $wpdb->get_row(
    $wpdb->prepare(
        "SELECT o.woo_variation_id, o.public_offer_key, o.sale_price
         FROM {$offer_table} o
         WHERE o.woo_parent_id = %d
           AND o.lane_code = 'A'
           AND o.approval_status = 'approved'
           AND o.lifecycle_status = 'active'
           AND o.stock_status = 'in_stock'
         ORDER BY o.id LIMIT 1",
        $targets['ab']['productId']
    ),
    ARRAY_A
);
$wrong_lane_offer = $wpdb->get_row(
    $wpdb->prepare(
        "SELECT woo_variation_id, public_offer_key
         FROM {$offer_table}
         WHERE woo_parent_id = %d
           AND lane_code = 'B'
           AND approval_status = 'approved'
           AND lifecycle_status = 'active'
           AND stock_status = 'in_stock'
         ORDER BY id LIMIT 1",
        $targets['ab']['productId']
    ),
    ARRAY_A
);
if (!is_array($store_offer) || !is_array($wrong_lane_offer)) {
    WP_CLI::error('missing Store API QA offers');
}

$targets['classicCart'] = [
    'laneAVariationId' => (int) $store_offer['woo_variation_id'],
    'laneBVariationId' => (int) $wrong_lane_offer['woo_variation_id'],
    'laneAPublicOfferKey' => (string) $store_offer['public_offer_key'],
    'laneBPublicOfferKey' => (string) $wrong_lane_offer['public_offer_key'],
];
$targets['storeApi'] = [
    'variationId' => (int) $store_offer['woo_variation_id'],
    'publicOfferKey' => (string) $store_offer['public_offer_key'],
    'wrongLaneOfferKey' => (string) $wrong_lane_offer['public_offer_key'],
    'salePrice' => (float) $store_offer['sale_price'],
];
file_put_contents(
    $result_path,
    wp_json_encode($targets, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . PHP_EOL
);
WP_CLI::log(wp_json_encode($targets));
