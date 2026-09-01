<?php

defined('ABSPATH') || exit;

$job_path = getenv('WHOLESALEHUB_AI_JOB');
$output_dir = getenv('WHOLESALEHUB_AI_OUTPUT_DIR');
$result_path = getenv('WHOLESALEHUB_AI_RESULT');
if (!is_string($job_path) || !is_readable($job_path) || !is_string($output_dir) || !is_dir($output_dir) || !is_string($result_path) || $result_path === '') {
    WP_CLI::error('AI merchandising job/output/result paths are required');
}

$job = json_decode((string) file_get_contents($job_path), true, 512, JSON_THROW_ON_ERROR);
$product_id = (int) ($job['product_id'] ?? 0);
$job_id = sanitize_text_field((string) ($job['job_id'] ?? ''));
$source_hash = sanitize_text_field((string) ($job['source_hash'] ?? ''));
$product = wc_get_product($product_id);
if (!($product instanceof WC_Product) || $job_id === '' || !preg_match('/^[a-f0-9]{64}$/', $source_hash)) {
    WP_CLI::error('AI merchandising job identity is invalid');
}
if ((string) get_post_meta($product_id, '_wh_ai_merchandising_job_id', true) !== $job_id) {
    WP_CLI::error('AI merchandising job is stale or superseded');
}

$result = [
    'job_id' => $job_id,
    'product_id' => $product_id,
    'detail' => 'fallback',
    'thumbnail' => 'fallback',
    'detail_image_count' => 0,
    'errors' => [],
];

$copy_path = rtrim($output_dir, '/') . '/copy.json';
$copy = null;
if (is_readable($copy_path)) {
    try {
        $copy = json_decode((string) file_get_contents($copy_path), true, 128, JSON_THROW_ON_ERROR);
        wh_ai_merchandising_validate_copy($copy);
    } catch (Throwable $error) {
        $result['errors'][] = 'copy:' . sanitize_text_field($error->getMessage());
        $copy = null;
    }
} else {
    $result['errors'][] = 'copy:missing';
}

$detail_attachment_ids = [];
if (is_array($copy)) {
    foreach (glob(rtrim($output_dir, '/') . '/detail-*.{png,jpg,jpeg,webp}', GLOB_BRACE) ?: [] as $detail_file) {
        if (count($detail_attachment_ids) >= 4) {
            break;
        }
        try {
            $detail_attachment_ids[] = wh_ai_merchandising_attach_local_image($detail_file, $product_id, 'AI 상세 이미지');
        } catch (Throwable $error) {
            $result['errors'][] = 'detail_image:' . sanitize_text_field($error->getMessage());
        }
    }

    try {
        $detail_html = wh_ai_merchandising_render_copy($copy, $detail_attachment_ids);
        $existing = (string) get_post_field('post_content', $product_id, 'raw');
        $merged = wh_ai_merchandising_merge_detail_block($existing, $detail_html);
        $GLOBALS['wh_ai_merchandising_applying'] = true;
        try {
            $updated = wp_update_post([
                'ID' => $product_id,
                'post_content' => $merged,
            ], true);
        } finally {
            unset($GLOBALS['wh_ai_merchandising_applying']);
        }
        if (is_wp_error($updated) || (int) $updated !== $product_id) {
            throw new RuntimeException(is_wp_error($updated) ? $updated->get_error_message() : 'post update failed');
        }
        $verified = (string) get_post_field('post_content', $product_id, 'raw');
        if (wh_ai_merchandising_extract_detail_block($verified) === '') {
            throw new RuntimeException('detail block read-back verification failed');
        }
        update_post_meta($product_id, '_wh_ai_detail_status', 'success');
        update_post_meta($product_id, '_wh_ai_detail_generated_at', gmdate('c'));
        $result['detail'] = 'success';
        $result['detail_image_count'] = count($detail_attachment_ids);
    } catch (Throwable $error) {
        update_post_meta($product_id, '_wh_ai_detail_status', 'failed');
        $result['errors'][] = 'detail_apply:' . sanitize_text_field($error->getMessage());
    }
} else {
    update_post_meta($product_id, '_wh_ai_detail_status', 'failed');
}

$thumbnail_file = '';
foreach (['thumbnail.png', 'thumbnail.jpg', 'thumbnail.jpeg', 'thumbnail.webp'] as $candidate) {
    $path = rtrim($output_dir, '/') . '/' . $candidate;
    if (is_readable($path)) {
        $thumbnail_file = $path;
        break;
    }
}
if ($thumbnail_file !== '') {
    $previous_id = (int) get_post_thumbnail_id($product_id);
    try {
        $attachment_id = wh_ai_merchandising_attach_local_image($thumbnail_file, $product_id, 'AI 대표이미지', 700, 700);
        if (!set_post_thumbnail($product_id, $attachment_id)) {
            throw new RuntimeException('set_post_thumbnail failed');
        }
        if ((int) get_post_thumbnail_id($product_id) !== $attachment_id) {
            if ($previous_id > 0) {
                set_post_thumbnail($product_id, $previous_id);
            }
            throw new RuntimeException('thumbnail read-back verification failed');
        }
        update_post_meta($attachment_id, '_wholesalehub_image_source_type', 'codex_ai_generated');
        update_post_meta($product_id, '_wh_ai_thumbnail_status', 'success');
        update_post_meta($product_id, '_wh_ai_thumbnail_attachment_id', $attachment_id);
        update_post_meta($product_id, '_wh_ai_thumbnail_generated_at', gmdate('c'));
        $result['thumbnail'] = 'success';
    } catch (Throwable $error) {
        update_post_meta($product_id, '_wh_ai_thumbnail_status', 'fallback');
        $result['errors'][] = 'thumbnail:' . sanitize_text_field($error->getMessage());
    }
} else {
    // Intentional fallback: the supplier/source thumbnail is never removed on Codex/image failure.
    update_post_meta($product_id, '_wh_ai_thumbnail_status', 'fallback');
    $result['errors'][] = 'thumbnail:missing';
}

if ($result['detail'] === 'success' || $result['thumbnail'] === 'success') {
    update_post_meta($product_id, '_wh_ai_merchandising_source_hash', $source_hash);
    update_post_meta($product_id, '_wh_ai_merchandising_version', WH_AI_MERCH_VERSION);
}
update_post_meta($product_id, '_wh_ai_merchandising_queue_status', 'complete');
update_post_meta($product_id, '_wh_ai_merchandising_completed_at', gmdate('c'));
clean_post_cache($product_id);
wc_delete_product_transients($product_id);

file_put_contents($result_path, wp_json_encode($result, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . PHP_EOL);
WP_CLI::log(wp_json_encode($result, JSON_UNESCAPED_UNICODE));

function wh_ai_merchandising_validate_copy(array $copy): void
{
    $title = trim((string) ($copy['title'] ?? ''));
    $intro = trim((string) ($copy['intro'] ?? ''));
    $sections = $copy['sections'] ?? null;
    $cta = trim((string) ($copy['cta'] ?? ''));
    if ($title === '' || $intro === '' || !is_array($sections) || count($sections) < 3 || count($sections) > 8 || $cta === '') {
        throw new RuntimeException('copy schema is incomplete');
    }
    $visible = $title . ' ' . $intro . ' ' . $cta . ' ' . wp_json_encode($sections, JSON_UNESCAPED_UNICODE);
    if (mb_strlen($visible) > 9000) {
        throw new RuntimeException('copy is too long');
    }
    $forbidden = [
        'supplier_id', 'source_product_id', 'source_option_id', 'supplier offer',
        'dailyfood', 'walldob2b', 'yourlove.co.kr', 'adminplus',
        '[정보 확인 필요]', '[확인 필요]', '정보 확인 필요', 'TODO', 'PLACEHOLDER',
    ];
    $lower = mb_strtolower($visible);
    foreach ($forbidden as $term) {
        if (mb_strpos($lower, mb_strtolower($term)) !== false) {
            throw new RuntimeException('copy contains forbidden/internal text');
        }
    }
    foreach ($sections as $section) {
        if (!is_array($section) || trim((string) ($section['heading'] ?? '')) === '' || trim((string) ($section['body'] ?? '')) === '') {
            throw new RuntimeException('section schema is invalid');
        }
        if (isset($section['bullets']) && (!is_array($section['bullets']) || count($section['bullets']) > 5)) {
            throw new RuntimeException('section bullets are invalid');
        }
    }
}

function wh_ai_merchandising_render_copy(array $copy, array $detail_attachment_ids): string
{
    $html = '<section class="wh-ai-detail" aria-label="상품 상세정보">';
    $html .= '<div class="wh-ai-detail__hero"><h2>' . esc_html((string) $copy['title']) . '</h2><p>' . esc_html((string) $copy['intro']) . '</p></div>';
    $image_index = 0;
    foreach ($copy['sections'] as $section) {
        $html .= '<section class="wh-ai-detail__section"><h3>' . esc_html((string) $section['heading']) . '</h3><p>' . esc_html((string) $section['body']) . '</p>';
        $bullets = is_array($section['bullets'] ?? null) ? $section['bullets'] : [];
        if ($bullets !== []) {
            $html .= '<ul>';
            foreach (array_slice($bullets, 0, 5) as $bullet) {
                $html .= '<li>' . esc_html((string) $bullet) . '</li>';
            }
            $html .= '</ul>';
        }
        if (isset($detail_attachment_ids[$image_index])) {
            $img = wp_get_attachment_image((int) $detail_attachment_ids[$image_index], 'large', false, ['loading' => 'lazy', 'decoding' => 'async']);
            if (is_string($img)) {
                $html .= '<figure class="wh-ai-detail__visual">' . $img . '</figure>';
            }
            $image_index++;
        }
        $html .= '</section>';
    }
    $html .= '<div class="wh-ai-detail__cta"><strong>' . esc_html((string) $copy['cta']) . '</strong></div></section>';
    return wp_kses_post($html);
}

function wh_ai_merchandising_attach_local_image(string $source, int $product_id, string $title, int $min_width = 480, int $min_height = 480): int
{
    $real = realpath($source);
    if ($real === false || !is_file($real) || filesize($real) <= 0 || filesize($real) > 15 * 1024 * 1024) {
        throw new RuntimeException('image file is missing or outside size limits');
    }
    $image = @getimagesize($real);
    if (!is_array($image) || (int) $image[0] < $min_width || (int) $image[1] < $min_height) {
        throw new RuntimeException('image dimensions are invalid');
    }
    $allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (!in_array((string) ($image['mime'] ?? ''), $allowed, true)) {
        throw new RuntimeException('image MIME is invalid');
    }

    $uploads = wp_upload_dir();
    if (!empty($uploads['error'])) {
        throw new RuntimeException('WordPress upload directory is unavailable');
    }
    $ext = match ((string) $image['mime']) {
        'image/png' => 'png',
        'image/webp' => 'webp',
        default => 'jpg',
    };
    $name = wp_unique_filename($uploads['path'], sanitize_file_name($title . '-' . $product_id . '-' . wp_generate_password(8, false, false) . '.' . $ext));
    $dest = trailingslashit($uploads['path']) . $name;
    if (!copy($real, $dest)) {
        throw new RuntimeException('image copy failed');
    }
    $attachment_id = wp_insert_attachment([
        'post_mime_type' => (string) $image['mime'],
        'post_title' => sanitize_text_field($title),
        'post_status' => 'inherit',
    ], $dest, $product_id, true);
    if (is_wp_error($attachment_id)) {
        @unlink($dest);
        throw new RuntimeException($attachment_id->get_error_message());
    }
    require_once ABSPATH . 'wp-admin/includes/image.php';
    $metadata = wp_generate_attachment_metadata((int) $attachment_id, $dest);
    if (is_array($metadata)) {
        wp_update_attachment_metadata((int) $attachment_id, $metadata);
    }
    return (int) $attachment_id;
}
