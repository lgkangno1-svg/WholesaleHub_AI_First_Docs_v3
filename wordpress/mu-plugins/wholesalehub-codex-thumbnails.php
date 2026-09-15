<?php
/** Plugin Name: WholesaleHub subscription thumbnail bridge */
defined('ABSPATH') || exit;

function whct_scope(array $r): bool {
    $baseline = get_option('whct_start_after_id', false);
    return $baseline !== false && (int) $r['id'] > (int) $baseline
        && ($r['request_kind'] ?? '') === 'product'
        && in_array($r['supplier_id'] ?? '', ['dailyfood', 'walldob2b'], true);
}
function whct_digest(array $r): string {
    return hash('sha256', wp_json_encode([
        'v1', (int) $r['id'], (string) $r['original_product_name'],
        (string) $r['option_summary'], (string) $r['hard_spec_fingerprint'],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}
function whct_asset(array $r): int {
    $a = get_option('whct_asset_' . (int) $r['id'], []);
    return is_array($a) && ($a['digest'] ?? '') === whct_digest($r)
        && wp_attachment_is_image((int) ($a['attachment'] ?? 0)) ? (int) $a['attachment'] : 0;
}
add_filter('wholesalehub_approval_thumbnail_ready', static function ($ready, $r) {
    return whct_scope($r) ? whct_asset($r) > 0 : $ready;
}, 10, 2);
add_filter('wholesalehub_approval_preview_text', static function ($text, $r) {
    $id = whct_scope($r) ? whct_asset($r) : 0;
    if (!$id) { return $text; }
    return '🖼 <a href="' . esc_url(wp_get_attachment_url($id)) . '">Codex 생성 썸네일 확인</a>'
        . "\nAI 연출 이미지입니다. 품종·형태·생물/냉동 상태를 확인한 뒤 승인해 주세요.\n\n" . $text;
}, 10, 2);
add_filter('wholesalehub_approval_thumbnail_error', static function ($error, $r, $mode) {
    return $mode === 'new' && whct_scope($r) && !whct_asset($r)
        ? '썸네일 생성 대기 중이거나 상품 정보가 변경되었습니다. 새 이미지 확인 후 승인해 주세요.' : $error;
}, 10, 3);
add_filter('wholesalehub_approved_thumbnail', static function ($id, $r, $parent) {
    if (!whct_scope($r)) { return $id; }
    $attachment = whct_asset($r);
    if (!$attachment) { throw new RuntimeException('codex_thumbnail_not_ready'); }
    set_post_thumbnail($parent, $attachment);
    update_post_meta($parent, '_wh_ai_thumbnail_attachment', $attachment);
    update_post_meta($parent, '_wh_ai_thumbnail_model', 'codex-subscription-built-in');
    update_post_meta($parent, '_whct_ai_illustration', '1');
    return $attachment;
}, 10, 3);
add_action('woocommerce_single_product_summary', static function () {
    if (get_post_meta(get_the_ID(), '_whct_ai_illustration', true) === '1') {
        echo '<p class="whct-image-disclosure">대표 이미지는 AI 연출 이미지이며 실제 상품과 차이가 있을 수 있습니다. 상품 규격과 옵션을 확인해 주세요.</p>';
    }
}, 6);

// No public API, bearer token, or remote-image fetching. Only trusted local WP-CLI.
if (defined('WP_CLI') && WP_CLI) {
    WP_CLI::add_command('whct alert', static function () {
        $day = gmdate('Y-m-d', time() + 9 * HOUR_IN_SECONDS);
        if (get_option('whct_alert_day', '') === $day) { return; }
        if (function_exists('avocadoss_send_telegram_approval_message')) {
            $sent = avocadoss_send_telegram_approval_message('⚠️ Codex 썸네일 생성 대기: 사용량 한도 또는 생성 실패로 신규 상품 일부가 보류되어 있습니다. 기존 상품은 유지되며 유료 API로 전환하지 않습니다. 관리자 점검이 필요합니다.', []);
            if ($sent > 0) { update_option('whct_alert_day', $day, false); }
        }
    });
    WP_CLI::add_command('whct list', static function () {
        global $wpdb;
        $table = $wpdb->prefix . 'supplier_lane_approval_requests';
        $baseline = get_option('whct_start_after_id', false);
        if ($baseline === false) { WP_CLI::line('[]'); return; }
        $rows = $wpdb->get_results($wpdb->prepare("SELECT * FROM $table WHERE id > %d AND request_kind='product' AND status='pending_mapping' ORDER BY id LIMIT 200", (int) $baseline), ARRAY_A);
        $out = [];
        foreach ($rows as $r) {
            if (!whct_scope($r)) { continue; }
            if (whct_asset($r)) {
                // Delivery retries reuse an existing image; never regenerate after Telegram failure.
                if (empty($r['telegram_message_id'])) { WholesaleHub_Supplier_Lane_Approval::send_pending_telegram_approval((int) $r['id']); }
                continue;
            }
            $out[] = ['id' => (int) $r['id'], 'digest' => whct_digest($r),
                'title' => (string) $r['original_product_name'], 'options' => (string) $r['option_summary']];
        }
        WP_CLI::line(wp_json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    });
    WP_CLI::add_command('whct import', static function ($args) {
        global $wpdb;
        [$request_id, $digest, $input] = $args + [null, null, null];
        $r = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . $wpdb->prefix . 'supplier_lane_approval_requests WHERE id=%d', (int) $request_id), ARRAY_A);
        if (!$r || !whct_scope($r) || $r['status'] !== 'pending_mapping' || !hash_equals(whct_digest($r), (string) $digest)) {
            WP_CLI::error('stale_or_out_of_scope');
        }
        $existing = whct_asset($r);
        if (!$existing) {
            $path = realpath((string) $input);
            if (!$path || dirname($path) !== '/tmp/whct-inbox' || is_link($input) || filesize($path) > 15 * MB_IN_BYTES) { WP_CLI::error('invalid_image_path'); }
            $info = wp_getimagesize($path);
            if (!$info || $info[2] !== IMAGETYPE_PNG || $info[0] < 512 || $info[0] !== $info[1] || $info[0] > 4096) { WP_CLI::error('invalid_square_png'); }
            require_once ABSPATH . 'wp-admin/includes/file.php';
            require_once ABSPATH . 'wp-admin/includes/media.php';
            require_once ABSPATH . 'wp-admin/includes/image.php';
            $existing = media_handle_sideload(['name' => 'codex-' . (int) $request_id . '-' . substr($digest, 0, 12) . '.png', 'tmp_name' => $path], 0, 'AI 연출 이미지');
            if (is_wp_error($existing)) { WP_CLI::error('image_import_failed'); }
            update_post_meta($existing, '_wp_attachment_image_alt', sanitize_text_field($r['original_product_name']) . ' — AI 연출 이미지');
            update_option('whct_asset_' . (int) $request_id, ['digest' => $digest, 'attachment' => (int) $existing], false);
            // Changed product facts need a new preview and invalidate the old Telegram buttons.
            if (!empty($r['telegram_message_id'])) {
                $wpdb->update($wpdb->prefix . 'supplier_lane_approval_requests', [
                    'action_token' => wp_generate_password(10, false, false),
                    'telegram_message_id' => null, 'telegram_sent_at' => null,
                ], ['id' => (int) $request_id, 'status' => 'pending_mapping']);
            }
        }
        WholesaleHub_Supplier_Lane_Approval::send_pending_telegram_approval((int) $request_id);
        WP_CLI::line('READY');
    });
}
