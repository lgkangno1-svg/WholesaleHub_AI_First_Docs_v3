<?php

defined('ABSPATH') || exit;

$manifest_path = getenv('WHOLESALEHUB_THUMBNAIL_MANIFEST');
$result_path = getenv('WHOLESALEHUB_THUMBNAIL_RESULT');
if (
    !is_string($manifest_path)
    || $manifest_path === ''
    || !is_string($result_path)
    || $result_path === ''
) {
    WP_CLI::error('thumbnail manifest/result environment is required');
}
$manifest = json_decode(
    (string) file_get_contents($manifest_path),
    true,
    512,
    JSON_THROW_ON_ERROR
);
$products = is_array($manifest['products'] ?? null) ? $manifest['products'] : [];
if ($products === []) {
    WP_CLI::error('thumbnail manifest is empty');
}

require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';
require_once ABSPATH . 'wp-admin/includes/image.php';

global $wpdb;
$parent_table = $wpdb->prefix . 'supplier_lane_parent_links';
$results = [];
foreach ($products as $row) {
    $product_id = (int) ($row['product_id'] ?? 0);
    $supplier_id = sanitize_key((string) ($row['supplier_id'] ?? ''));
    $source_product_id = sanitize_text_field((string) ($row['source_product_id'] ?? ''));
    $expected_previous_id = (int) ($row['expected_previous_thumbnail_id'] ?? 0);
    $existing_attachment_id = (int) ($row['existing_attachment_id'] ?? 0);
    $match_mode = sanitize_key((string) ($row['match_mode'] ?? 'source_url'));
    $image_url = wh_catalog_repair_image_url((string) ($row['image_url'] ?? ''));
    $current_id = (int) get_post_thumbnail_id($product_id);
    $entry = [
        'product_id' => $product_id,
        'before_thumbnail_id' => $current_id,
        'after_thumbnail_id' => $current_id,
        'status' => 'failed',
        'issue' => '',
    ];
    try {
        if ($product_id <= 0 || get_post_type($product_id) !== 'product') {
            throw new RuntimeException('product identity is invalid');
        }
        if (
            function_exists('wh_ai_merchandising_has_valid_thumbnail')
            && wh_ai_merchandising_has_valid_thumbnail($product_id)
        ) {
            $entry['status'] = 'preserved_ai';
            $results[] = $entry;
            continue;
        }
        if ($image_url === '' && $existing_attachment_id <= 0) {
            throw new RuntimeException('source image URL is invalid');
        }
        $link_count = (int) $wpdb->get_var(
            $wpdb->prepare(
                "SELECT COUNT(*) FROM {$parent_table}
                 WHERE woo_parent_id = %d AND supplier_id = %s AND source_product_id = %s
                   AND status = 'approved'",
                $product_id,
                $supplier_id,
                $source_product_id
            )
        );
        if ($link_count !== 1) {
            throw new RuntimeException('exact supplier product link was not found');
        }
        if ($current_id !== $expected_previous_id) {
            throw new RuntimeException('thumbnail changed after checkpoint');
        }
        if ($existing_attachment_id > 0) {
            if ($match_mode !== 'exact_unique_title_attachment') {
                throw new RuntimeException('existing attachment match mode is invalid');
            }
            $product_title = get_the_title($product_id);
            $attachment_title = get_the_title($existing_attachment_id);
            $exact_title_count = (int) $wpdb->get_var(
                $wpdb->prepare(
                    "SELECT COUNT(*) FROM {$wpdb->posts}
                     WHERE post_type = 'attachment' AND post_title = %s",
                    $product_title
                )
            );
            if (
                $product_title === ''
                || $attachment_title !== $product_title
                || $exact_title_count !== 1
            ) {
                throw new RuntimeException('existing attachment title is not an exact unique match');
            }
            $attachment_id = $existing_attachment_id;
        } else {
            $attachment_id = media_sideload_image(
                $image_url,
                $product_id,
                get_the_title($product_id),
                'id'
            );
            if (is_wp_error($attachment_id)) {
                throw new RuntimeException(
                    'media import failed: ' . $attachment_id->get_error_message()
                );
            }
            $attachment_id = (int) $attachment_id;
        }
        if ($attachment_id <= 0 || !wp_attachment_is_image($attachment_id)) {
            if ($attachment_id > 0 && $existing_attachment_id <= 0) {
                wp_delete_attachment($attachment_id, true);
            }
            throw new RuntimeException('media import returned a non-image');
        }
        if (!set_post_thumbnail($product_id, $attachment_id)) {
            if ($existing_attachment_id <= 0) {
                wp_delete_attachment($attachment_id, true);
            }
            throw new RuntimeException('set_post_thumbnail failed');
        }
        if ($image_url !== '') {
            update_post_meta($product_id, '_wholesalehub_source_image_url', $image_url);
        }
        update_post_meta($product_id, '_wholesalehub_thumbnail_synced_at', gmdate('c'));
        $verified_id = (int) get_post_thumbnail_id($product_id);
        if ($verified_id !== $attachment_id) {
            throw new RuntimeException('thumbnail read-back verification failed');
        }
        $entry['after_thumbnail_id'] = $verified_id;
        $entry['status'] = 'repaired';
    } catch (Throwable $error) {
        $entry['after_thumbnail_id'] = (int) get_post_thumbnail_id($product_id);
        $entry['issue'] = sanitize_text_field($error->getMessage());
    }
    $results[] = $entry;
}
wc_delete_product_transients();
wp_cache_flush();
$output = [
    'completed_at' => gmdate('c'),
    'counts' => [
        'targets' => count($results),
        'repaired' => count(array_filter(
            $results,
            static fn(array $row): bool => $row['status'] === 'repaired'
        )),
        'preserved_ai' => count(array_filter(
            $results,
            static fn(array $row): bool => $row['status'] === 'preserved_ai'
        )),
        'failed' => count(array_filter(
            $results,
            static fn(array $row): bool => $row['status'] === 'failed'
        )),
    ],
    'products' => $results,
];
file_put_contents(
    $result_path,
    wp_json_encode($output, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . PHP_EOL
);
WP_CLI::log(wp_json_encode($output['counts']));
if ($output['counts']['failed'] > 0) {
    WP_CLI::error('one or more thumbnail repairs failed');
}

function wh_catalog_repair_image_url(string $candidate): string
{
    $url = esc_url_raw(trim($candidate), ['https']);
    $host = strtolower((string) wp_parse_url($url, PHP_URL_HOST));
    $path = strtolower((string) wp_parse_url($url, PHP_URL_PATH));
    if (
        $url === ''
        || !in_array($host, ['cdn.yourlove.co.kr', 'walldob2b.com'], true)
        || preg_match('/\.(?:jpe?g|png|webp)$/i', $path) !== 1
    ) {
        return '';
    }
    return $url;
}
