<?php

defined('ABSPATH') || exit;

@set_time_limit(0);
ini_set('memory_limit', '1024M');

$manifest_path = getenv('WHOLESALEHUB_IMAGE_MANIFEST');
if (!is_string($manifest_path) || $manifest_path === '' || !is_readable($manifest_path)) {
    WP_CLI::error('image repair manifest is missing');
}

$manifest = json_decode(
    (string) file_get_contents($manifest_path),
    true,
    512,
    JSON_THROW_ON_ERROR
);
$products = is_array($manifest['products'] ?? null) ? $manifest['products'] : [];
$placeholder_id = (int) ($manifest['placeholder_attachment_id'] ?? 0);
$checkpoint_option = (string) ($manifest['checkpoint_option'] ?? '');
$result_option = (string) ($manifest['result_option'] ?? '');
if (
    ($manifest['target_site'] ?? '') !== 'https://hub.avocadoss.co.kr'
    || count($products) !== 141
    || $placeholder_id !== 2905
    || $checkpoint_option === ''
    || $result_option === ''
) {
    WP_CLI::error('image repair manifest scope is invalid');
}

$checkpoint = get_option($checkpoint_option);
if (!is_array($checkpoint) || (int) ($checkpoint['target_count'] ?? 0) !== 141) {
    WP_CLI::error('image repair checkpoint is missing or invalid');
}

require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';
require_once ABSPATH . 'wp-admin/includes/image.php';

global $wpdb;
$links_table = $wpdb->prefix . 'supplier_lane_parent_links';
$entries = [];

foreach ($products as $row) {
    $product_id = (int) ($row['product_id'] ?? 0);
    $status = (string) ($row['status'] ?? '');
    if ($product_id <= 0) {
        continue;
    }
    if ($status !== 'prepared') {
        $entries[] = [
            'product_id' => $product_id,
            'status' => 'failed',
            'issue' => (string) ($row['issue'] ?? 'image source unavailable'),
            'previous_image_id' => (int) get_post_thumbnail_id($product_id),
            'attachment_id' => 0,
        ];
        continue;
    }

    $featured_url = esc_url_raw((string) ($row['featured_url'] ?? ''));
    $featured_hash = sanitize_text_field((string) ($row['featured_sha256'] ?? ''));
    $source_supplier_id = sanitize_key((string) ($row['source_supplier_id'] ?? ''));
    $source_product_id = sanitize_text_field((string) ($row['source_product_id'] ?? ''));
    $expected_previous_id = (int) ($row['expected_previous_thumbnail_id'] ?? 0);
    $current_image_id = (int) get_post_thumbnail_id($product_id);
    $product = wc_get_product($product_id);

    try {
        if (!$product || $product->get_status() !== 'publish') {
            throw new RuntimeException('target product is missing or not published');
        }
        if ($current_image_id !== $expected_previous_id || $current_image_id !== $placeholder_id) {
            throw new RuntimeException('target product image changed after checkpoint');
        }
        $link_count = (int) $wpdb->get_var(
            $wpdb->prepare(
                "SELECT COUNT(*) FROM {$links_table}
                 WHERE woo_parent_id=%d AND supplier_id=%s AND source_product_id=%s",
                $product_id,
                $source_supplier_id,
                $source_product_id
            )
        );
        if ($link_count !== 1) {
            throw new RuntimeException('exact source link verification failed');
        }
        if (
            !preg_match('#^https://(?:cdn\.yourlove\.co\.kr|walldob2b\.com)/#i', $featured_url)
            || !preg_match('/^[a-f0-9]{64}$/', $featured_hash)
        ) {
            throw new RuntimeException('featured image URL or fingerprint is invalid');
        }

        $attachment_id = media_sideload_image(
            $featured_url,
            $product_id,
            $product->get_name(),
            'id'
        );
        if (is_wp_error($attachment_id)) {
            throw new RuntimeException('featured media import failed: ' . $attachment_id->get_error_message());
        }
        $attachment_id = (int) $attachment_id;
        if ($attachment_id <= 0 || !wp_attachment_is_image($attachment_id)) {
            throw new RuntimeException('featured media import returned a non-image');
        }
        $metadata = wp_get_attachment_metadata($attachment_id);
        if (
            !is_array($metadata)
            || (int) ($metadata['width'] ?? 0) <= 0
            || (int) ($metadata['height'] ?? 0) <= 0
        ) {
            throw new RuntimeException('featured attachment metadata is incomplete');
        }

        update_post_meta($attachment_id, '_wholesalehub_image_source_kind', sanitize_key((string) ($row['source_kind'] ?? '')));
        update_post_meta($attachment_id, '_wholesalehub_source_product_id', $source_product_id);
        update_post_meta($attachment_id, '_wholesalehub_thumbnail_sha256', $featured_hash);
        if (!set_post_thumbnail($product_id, $attachment_id)) {
            throw new RuntimeException('set_post_thumbnail failed');
        }

        $gallery_ids = [];
        foreach (array_slice((array) ($row['gallery_urls'] ?? []), 0, 2) as $gallery_url_raw) {
            $gallery_url = esc_url_raw((string) $gallery_url_raw);
            if (!preg_match('#^https://(?:cdn\.yourlove\.co\.kr|walldob2b\.com)/#i', $gallery_url)) {
                continue;
            }
            $gallery_id = media_sideload_image(
                $gallery_url,
                $product_id,
                $product->get_name(),
                'id'
            );
            if (!is_wp_error($gallery_id) && wp_attachment_is_image((int) $gallery_id)) {
                $gallery_ids[] = (int) $gallery_id;
            }
        }
        if ($gallery_ids !== []) {
            update_post_meta($product_id, '_product_image_gallery', implode(',', $gallery_ids));
        }

        update_post_meta($product_id, '_wholesalehub_source_image_url', $featured_url);
        update_post_meta($product_id, '_wholesalehub_thumbnail_sha256', $featured_hash);
        update_post_meta($product_id, '_wholesalehub_thumbnail_synced_at', gmdate('c'));
        clean_post_cache($product_id);
        wc_delete_product_transients($product_id);

        $verified_id = (int) get_post_thumbnail_id($product_id);
        if ($verified_id !== $attachment_id) {
            throw new RuntimeException('featured image read-back verification failed');
        }
        $entries[] = [
            'product_id' => $product_id,
            'status' => 'updated',
            'issue' => '',
            'previous_image_id' => $current_image_id,
            'attachment_id' => $attachment_id,
            'gallery_attachment_ids' => $gallery_ids,
            'width' => (int) ($metadata['width'] ?? 0),
            'height' => (int) ($metadata['height'] ?? 0),
        ];
    } catch (Throwable $error) {
        $entries[] = [
            'product_id' => $product_id,
            'status' => 'failed',
            'issue' => preg_replace('/\s+/', ' ', $error->getMessage()),
            'previous_image_id' => $current_image_id,
            'attachment_id' => 0,
        ];
    }
}

$result = [
    'generated_at' => gmdate('c'),
    'target_count' => count($products),
    'updated' => count(array_filter($entries, static fn($row) => $row['status'] === 'updated')),
    'failed' => count(array_filter($entries, static fn($row) => $row['status'] === 'failed')),
    'entries' => $entries,
];
update_option($result_option, $result, false);

WP_CLI::log(
    wp_json_encode([
        'target_count' => $result['target_count'],
        'updated' => $result['updated'],
        'failed' => $result['failed'],
    ])
);
