<?php
/**
 * Plugin Name: WholesaleHub AI Merchandising
 * Description: Queues non-blocking Codex merchandising for newly published products and preserves successful AI assets across supplier syncs.
 */

defined('ABSPATH') || exit;

const WH_AI_MERCH_VERSION = 'codex-merch-v1';
const WH_AI_DETAIL_START = '<!-- wholesalehub-ai-detail:v1:start -->';
const WH_AI_DETAIL_END = '<!-- wholesalehub-ai-detail:v1:end -->';

/**
 * Extract only the managed AI block from post content.
 */
function wh_ai_merchandising_extract_detail_block(string $content): string
{
    $start = strpos($content, WH_AI_DETAIL_START);
    if ($start === false) {
        return '';
    }
    $end = strpos($content, WH_AI_DETAIL_END, $start);
    if ($end === false) {
        return '';
    }
    $end += strlen(WH_AI_DETAIL_END);
    return substr($content, $start, $end - $start);
}

/**
 * Replace any previous managed block while preserving the supplier/base description.
 */
function wh_ai_merchandising_merge_detail_block(string $base_content, string $detail_html): string
{
    $existing = wh_ai_merchandising_extract_detail_block($base_content);
    if ($existing !== '') {
        $base_content = str_replace($existing, '', $base_content);
    }
    $base_content = rtrim($base_content);
    $block = WH_AI_DETAIL_START . "\n" . trim($detail_html) . "\n" . WH_AI_DETAIL_END;
    return $base_content === '' ? $block : $base_content . "\n\n" . $block;
}

/**
 * True only while the product is still using the exact AI thumbnail that was verified on apply.
 */
function wh_ai_merchandising_has_valid_thumbnail(int $product_id): bool
{
    if ($product_id <= 0 || get_post_meta($product_id, '_wh_ai_thumbnail_status', true) !== 'success') {
        return false;
    }
    $marked_id = (int) get_post_meta($product_id, '_wh_ai_thumbnail_attachment_id', true);
    $current_id = (int) get_post_thumbnail_id($product_id);
    return $marked_id > 0 && $marked_id === $current_id && wp_attachment_is_image($marked_id);
}

/**
 * Supplier/private metadata must never enter a Codex prompt. Build only a public-safe fact packet.
 */
function wh_ai_merchandising_public_facts(WC_Product $product): array
{
    $description = (string) $product->get_description('edit');
    $description = preg_replace('/<!--\s*wholesalehub-ai-detail:v1:start\s*-->.*?<!--\s*wholesalehub-ai-detail:v1:end\s*-->/su', '', $description) ?? $description;
    $description = wp_strip_all_tags($description, true);
    $description = trim(preg_replace('/\s+/u', ' ', $description) ?? $description);
    if (mb_strlen($description) > 3500) {
        $description = mb_substr($description, 0, 3500);
    }

    $categories = wp_get_post_terms($product->get_id(), 'product_cat', ['fields' => 'names']);
    if (is_wp_error($categories)) {
        $categories = [];
    }

    return [
        'schema_version' => 1,
        'merchandising_version' => WH_AI_MERCH_VERSION,
        'product_id' => (int) $product->get_id(),
        'product_name' => sanitize_text_field((string) $product->get_name()),
        'public_description' => $description,
        'categories' => array_values(array_map('sanitize_text_field', (array) $categories)),
    ];
}

function wh_ai_merchandising_source_hash(WC_Product $product): string
{
    $facts = wh_ai_merchandising_public_facts($product);
    $thumb_id = (int) get_post_thumbnail_id($product->get_id());
    $thumb_file = $thumb_id > 0 ? get_attached_file($thumb_id) : '';
    $thumb_hash = is_string($thumb_file) && is_file($thumb_file) ? hash_file('sha256', $thumb_file) : '';
    return hash('sha256', wp_json_encode([$facts, $thumb_hash], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

/**
 * Create an immutable queue file. Publishing must never wait for Codex.
 */
function wh_ai_merchandising_enqueue_product(int $product_id): bool
{
    $product = wc_get_product($product_id);
    if (!($product instanceof WC_Product)) {
        return false;
    }

    $source_hash = wh_ai_merchandising_source_hash($product);
    if (
        get_post_meta($product_id, '_wh_ai_merchandising_source_hash', true) === $source_hash
        && get_post_meta($product_id, '_wh_ai_detail_status', true) === 'success'
        && wh_ai_merchandising_has_valid_thumbnail($product_id)
    ) {
        return true;
    }

    $uploads = wp_upload_dir();
    if (!empty($uploads['error']) || empty($uploads['basedir'])) {
        update_post_meta($product_id, '_wh_ai_merchandising_queue_status', 'failed');
        return false;
    }
    $root = trailingslashit($uploads['basedir']) . 'wholesalehub/ai-merchandising';
    $queue = $root . '/queue';
    if (!wp_mkdir_p($queue)) {
        update_post_meta($product_id, '_wh_ai_merchandising_queue_status', 'failed');
        return false;
    }

    $thumb_id = (int) get_post_thumbnail_id($product_id);
    $thumb_relative = '';
    if ($thumb_id > 0) {
        $file = get_attached_file($thumb_id);
        $base = wp_normalize_path((string) $uploads['basedir']);
        $normalized = wp_normalize_path((string) $file);
        if ($normalized !== '' && str_starts_with($normalized, $base . '/')) {
            $thumb_relative = ltrim(substr($normalized, strlen($base)), '/');
        }
    }

    $job_id = sprintf('%d-%s', $product_id, substr($source_hash, 0, 16));
    $payload = wh_ai_merchandising_public_facts($product);
    $payload['job_id'] = $job_id;
    $payload['source_hash'] = $source_hash;
    $payload['source_thumbnail_upload_relative'] = $thumb_relative;
    $payload['queued_at'] = gmdate('c');

    $tmp = $queue . '/.' . $job_id . '.tmp-' . wp_generate_password(8, false, false);
    $final = $queue . '/' . $job_id . '.json';
    $json = wp_json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    if (!is_string($json) || file_put_contents($tmp, $json . PHP_EOL, LOCK_EX) === false || !rename($tmp, $final)) {
        @unlink($tmp);
        update_post_meta($product_id, '_wh_ai_merchandising_queue_status', 'failed');
        return false;
    }

    update_post_meta($product_id, '_wh_ai_merchandising_queue_status', 'queued');
    update_post_meta($product_id, '_wh_ai_merchandising_job_id', $job_id);
    update_post_meta($product_id, '_wh_ai_merchandising_queued_at', gmdate('c'));
    return true;
}

function wh_ai_merchandising_on_publish(string $new_status, string $old_status, WP_Post $post): void
{
    if ($post->post_type !== 'product' || $new_status !== 'publish' || !in_array($old_status, ['draft', 'pending'], true)) {
        return;
    }
    // Never block publication. Supplier image/base description are the built-in fallback.
    wh_ai_merchandising_enqueue_product((int) $post->ID);
}
add_action('transition_post_status', 'wh_ai_merchandising_on_publish', 20, 3);

/**
 * Prevent later catalog/price/stock updates from accidentally deleting the managed AI detail block.
 */
function wh_ai_merchandising_preserve_detail_on_update(array $data, array $postarr): array
{
    if (!empty($GLOBALS['wh_ai_merchandising_applying'])) {
        return $data;
    }
    $post_id = isset($postarr['ID']) ? (int) $postarr['ID'] : 0;
    if ($post_id <= 0 || get_post_type($post_id) !== 'product') {
        return $data;
    }
    $current = (string) get_post_field('post_content', $post_id, 'raw');
    $block = wh_ai_merchandising_extract_detail_block($current);
    if ($block === '') {
        return $data;
    }
    $incoming = (string) ($data['post_content'] ?? '');
    if (wh_ai_merchandising_extract_detail_block($incoming) === '') {
        $incoming = rtrim($incoming);
        $data['post_content'] = $incoming === '' ? $block : $incoming . "\n\n" . $block;
    }
    return $data;
}
add_filter('wp_insert_post_data', 'wh_ai_merchandising_preserve_detail_on_update', 50, 2);
