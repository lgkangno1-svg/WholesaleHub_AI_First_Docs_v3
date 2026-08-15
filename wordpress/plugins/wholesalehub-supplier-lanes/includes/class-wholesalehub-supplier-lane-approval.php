<?php

defined('ABSPATH') || exit;

final class WholesaleHub_Supplier_Lane_Approval
{
    private const CALLBACK_PREFIX = 'slm';
    private const PENDING_STATUSES = ['pending_mapping', 'pending_option'];
    private static bool $schema_ready = false;
    private static float $last_notification_time = 0.0;

    public static function boot(): void
    {
        add_filter(
            'avocadoss_process_telegram_callback',
            [self::class, 'handle_telegram_callback'],
            10,
            2
        );
    }

    public static function install_schema(): void
    {
        if (self::$schema_ready) {
            return;
        }
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $table = self::table();
        $charset = $wpdb->get_charset_collate();
        dbDelta(
            "CREATE TABLE {$table} (
              id bigint unsigned NOT NULL AUTO_INCREMENT,
              action_token varchar(20) NOT NULL,
              request_kind varchar(16) NOT NULL,
              supplier_id varchar(64) NOT NULL,
              lane_code varchar(1) NOT NULL,
              source_product_id varchar(191) NOT NULL,
              source_option_id varchar(191) NOT NULL DEFAULT '',
              original_product_name varchar(255) NOT NULL,
              option_summary text NOT NULL,
              hard_spec_fingerprint varchar(64) NOT NULL,
              payload_json longtext NOT NULL,
              status varchar(32) NOT NULL DEFAULT 'pending_mapping',
              selected_woo_parent_id bigint unsigned NULL,
              telegram_message_id bigint unsigned NULL,
              telegram_sent_at datetime NULL,
              processed_by varchar(191) NULL,
              processed_at datetime NULL,
              last_error text NULL,
              created_at datetime NOT NULL,
              updated_at datetime NOT NULL,
              PRIMARY KEY  (id),
              UNIQUE KEY action_token (action_token),
              UNIQUE KEY source_identity (request_kind,supplier_id,source_product_id,source_option_id),
              KEY approval_status (status,request_kind,updated_at)
            ) {$charset};"
        );
        self::$schema_ready = true;
    }

    public static function stage_product(array $group, string $lane_code, array $lane): string
    {
        $supplier_id = sanitize_key((string) ($lane['supplierId'] ?? ''));
        $source_product_id = sanitize_text_field((string) ($lane['sourceProductId'] ?? ''));
        if (
            $supplier_id === ''
            || $source_product_id === ''
            || !in_array($lane_code, ['A', 'B'], true)
        ) {
            return 'invalid';
        }
        $options = array_values(is_array($lane['options'] ?? null) ? $lane['options'] : []);
        $categories = array_values(array_filter(array_map(
            'sanitize_text_field',
            is_array($group['approvalCategories'] ?? null)
                ? $group['approvalCategories']
                : []
        )));
        $suggested_category_id = 0;
        if (isset($categories[0])) {
            $term = get_term_by('name', $categories[0], 'product_cat');
            if ($term && !is_wp_error($term)) {
                $suggested_category_id = (int) $term->term_id;
            }
        }
        $payload = [
            'group' => [
                'displayName' => sanitize_text_field((string) ($group['displayName'] ?? '')),
                'source_image_url' => esc_url_raw((string) ($group['source_image_url'] ?? '')),
                'categories' => $categories,
                'suggestedCategoryId' => $suggested_category_id,
                'testMode' => !empty($group['_approvalTestMode']),
            ],
            'lane' => [
                'supplierId' => $supplier_id,
                'sourceProductId' => $source_product_id,
                'laneCode' => $lane_code,
                'sourceDescription' => sanitize_textarea_field((string) ($lane['sourceDescription'] ?? '')),
                'options' => $options,
            ],
        ];
        return self::stage([
            'request_kind' => 'product',
            'supplier_id' => $supplier_id,
            'lane_code' => $lane_code,
            'source_product_id' => $source_product_id,
            'source_option_id' => '',
            'original_product_name' => sanitize_text_field(
                (string) ($group['displayName'] ?? '')
            ),
            'option_summary' => self::option_summary($options),
            'hard_spec_fingerprint' => self::fingerprint($options),
            'payload_json' => wp_json_encode(
                $payload,
                JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
            ),
            'status' => 'pending_mapping',
        ]);
    }

    public static function stage_option(
        int $parent_id,
        string $lane_code,
        array $lane,
        array $option
    ): string {
        $supplier_id = sanitize_key((string) ($lane['supplierId'] ?? ''));
        $source_product_id = sanitize_text_field((string) ($lane['sourceProductId'] ?? ''));
        $source_option_id = sanitize_text_field((string) ($option['sourceOptionId'] ?? ''));
        if (
            $parent_id <= 0
            || $supplier_id === ''
            || $source_product_id === ''
            || $source_option_id === ''
            || !in_array($lane_code, ['A', 'B'], true)
        ) {
            return 'invalid';
        }
        $payload = [
            'group' => [
                'testMode' => !empty($lane['_approvalTestMode']),
            ],
            'parentId' => $parent_id,
            'lane' => [
                'supplierId' => $supplier_id,
                'sourceProductId' => $source_product_id,
                'laneCode' => $lane_code,
                'options' => [$option],
            ],
        ];
        return self::stage([
            'request_kind' => 'option',
            'supplier_id' => $supplier_id,
            'lane_code' => $lane_code,
            'source_product_id' => $source_product_id,
            'source_option_id' => $source_option_id,
            'original_product_name' => get_the_title($parent_id),
            'option_summary' => self::option_label($option),
            'hard_spec_fingerprint' => sanitize_text_field(
                (string) ($option['hardSpecFingerprint'] ?? '')
            ),
            'payload_json' => wp_json_encode(
                $payload,
                JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
            ),
            'status' => 'pending_option',
            'selected_woo_parent_id' => $parent_id,
        ]);
    }

    public static function pending_counts(): array
    {
        global $wpdb;
        self::install_schema();
        $rows = $wpdb->get_results(
            "SELECT request_kind, COUNT(*) AS count
             FROM " . self::table() . "
             WHERE status IN ('pending_mapping','pending_option','on_hold')
             GROUP BY request_kind",
            ARRAY_A
        );
        $counts = ['products' => 0, 'options' => 0];
        foreach ($rows as $row) {
            $key = (string) $row['request_kind'] === 'option' ? 'options' : 'products';
            $counts[$key] = (int) $row['count'];
        }
        return $counts;
    }

    public static function parse_callback_data(string $data): ?array
    {
        $parts = explode(':', $data);
        if (
            count($parts) < 3
            || $parts[0] !== self::CALLBACK_PREFIX
            || preg_match('/^[A-Za-z0-9]{10}$/', $parts[1]) !== 1
        ) {
            return null;
        }
        $action = (string) $parts[2];
        $arg = $parts[3] ?? null;
        if ($action === 'cat') {
            if ($arg === null || preg_match('/^[1-9][0-9]*$/', $arg) !== 1) {
                return null;
            }
        } elseif ($action === 'tax') {
            if (!in_array($arg, ['n', 't'], true)) {
                return null;
            }
        } elseif (
            !in_array(
                $action,
                ['link', 'new', 'newok', 'add', 'addok', 'hold', 'exclude', 'back', 'confirm'],
                true
            )
            && preg_match('/^(?:page|pick)[1-9][0-9]*$/', $action) !== 1
        ) {
            return null;
        }
        return ['token' => $parts[1], 'action' => $action, 'arg' => $arg];
    }

    public static function initial_buttons(array $request): array
    {
        $token = (string) $request['action_token'];
        if ((string) $request['request_kind'] === 'option') {
            return [
                [[
                    'text' => '✅ 이 상품에 옵션 추가',
                    'callback_data' => self::callback($token, 'add'),
                ]],
                [[
                    'text' => '✏️ 다른 상품에 연결',
                    'callback_data' => self::callback($token, 'link'),
                ]],
                [
                    ['text' => '⏸ 보류', 'callback_data' => self::callback($token, 'hold')],
                    [
                        'text' => '🚫 이 옵션 제외',
                        'callback_data' => self::callback($token, 'exclude'),
                    ],
                ],
            ];
        }
        return self::approval_buttons($request);
    }

    public static function handle_telegram_callback($result, array $callback)
    {
        if (is_array($result)) {
            return $result;
        }
        $parsed = self::parse_callback_data((string) ($callback['data'] ?? ''));
        if ($parsed === null) {
            return $result;
        }
        $request = self::request_by_token($parsed['token']);
        if ($request === null) {
            return self::response(false, '승인 요청을 찾을 수 없습니다.');
        }
        $action = $parsed['action'];
        if (in_array((string) $request['status'], ['approved', 'terminal_excluded'], true)) {
            return self::processed_response($request, 'ALREADY_PROCESSED');
        }
        $actor = sanitize_text_field((string) ($callback['admin'] ?? 'telegram'));

        if ($action === 'back') {
            return self::response(
                true,
                '처리 방법을 다시 선택하세요.',
                self::message_text($request),
                self::initial_buttons($request)
            );
        }
        if ($action === 'cat') {
            return self::select_category_callback($request, (int) $parsed['arg'], $actor);
        }
        if ($action === 'tax') {
            return self::select_tax_callback($request, (string) $parsed['arg'], $actor);
        }
        if ($action === 'link' || str_starts_with($action, 'page')) {
            $page = $action === 'link' ? 0 : max(0, ((int) substr($action, 4)) - 1);
            return self::candidate_response($request, $page);
        }
        if (str_starts_with($action, 'pick')) {
            $parent_id = (int) substr($action, 4);
            if (!self::candidate_allowed($request, $parent_id)) {
                return self::response(false, '선택할 수 없는 상품입니다.');
            }
            self::select_parent((int) $request['id'], $parent_id);
            $request['selected_woo_parent_id'] = $parent_id;
            return self::response(
                true,
                '연결할 상품을 확인하세요.',
                "연결 확정\n\n원본: {$request['original_product_name']}\n"
                    . 'Hub: ' . get_the_title($parent_id) . " #{$parent_id}",
                [
                    [[
                        'text' => '✅ 확정',
                        'callback_data' => self::callback($request['action_token'], 'confirm'),
                    ]],
                    [[
                        'text' => '↩️ 다시 선택',
                        'callback_data' => self::callback($request['action_token'], 'link'),
                    ]],
                ]
            );
        }
        if ($action === 'new') {
            if ((string) $request['request_kind'] !== 'product') {
                return self::response(false, '잘못된 요청입니다.');
            }
            $selection = self::selection($request);
            if (empty($selection['selected_category_id'])) {
                return self::response(false, '카테고리를 먼저 선택해주세요.');
            }
            if (empty($selection['final_tax_status'])) {
                return self::response(false, '과세/면세를 먼저 확정해주세요.');
            }
            $category_label = self::category_label((int) $selection['selected_category_id']);
            $tax_label = self::tax_label((string) $selection['final_tax_status']);
            return self::response(
                true,
                '새 상품 생성을 확인하세요.',
                "새 상품으로 생성하시겠습니까?\n\n{$request['original_product_name']}\n"
                    . "{$request['option_summary']}\n"
                    . "카테고리: {$category_label}\n세금: {$tax_label}\n"
                    . self::supplier_name($request['supplier_id']),
                [
                    [[
                        'text' => '✅ 생성',
                        'callback_data' => self::callback($request['action_token'], 'newok'),
                    ]],
                    [[
                        'text' => '❌ 취소',
                        'callback_data' => self::callback($request['action_token'], 'back'),
                    ]],
                ]
            );
        }
        if ($action === 'add') {
            return self::response(
                true,
                '옵션 추가를 확인하세요.',
                "옵션을 추가하시겠습니까?\n\nHub: {$request['original_product_name']}\n"
                    . "신규 옵션: {$request['option_summary']}",
                [
                    [[
                        'text' => '✅ 추가',
                        'callback_data' => self::callback($request['action_token'], 'addok'),
                    ]],
                    [[
                        'text' => '❌ 취소',
                        'callback_data' => self::callback($request['action_token'], 'back'),
                    ]],
                ]
            );
        }
        if ($action === 'hold') {
            return self::transition_without_write($request, 'on_hold', '⏸ 보류 처리', $actor);
        }
        if ($action === 'exclude') {
            return self::transition_without_write(
                $request,
                'terminal_excluded',
                '🚫 영구 제외 완료',
                $actor
            );
        }
        if ($action === 'confirm') {
            return self::apply_request($request, 'map', $actor);
        }
        if ($action === 'newok') {
            return self::apply_request($request, 'new', $actor);
        }
        if ($action === 'addok') {
            return self::apply_request($request, 'add', $actor);
        }
        return self::response(false, '잘못된 요청입니다.');
    }

    public static function cleanup_test_request(int $request_id): array
    {
        global $wpdb;
        $request = self::request_by_id($request_id);
        if ($request === null) {
            return ['removed' => false, 'reason' => 'not_found'];
        }
        $payload = json_decode((string) $request['payload_json'], true);
        if (empty($payload['group']['testMode'])) {
            return ['removed' => false, 'reason' => 'not_test_request'];
        }
        $offers = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT id,woo_variation_id,woo_parent_id FROM {$wpdb->prefix}supplier_lane_offers
                 WHERE supplier_id=%s AND source_product_id=%s",
                $request['supplier_id'],
                $request['source_product_id']
            ),
            ARRAY_A
        );
        $parent_ids = [];
        foreach ($offers as $offer) {
            $parent_ids[(int) $offer['woo_parent_id']] = true;
            wp_delete_post((int) $offer['woo_variation_id'], true);
            $wpdb->delete($wpdb->prefix . 'supplier_lane_offers', ['id' => (int) $offer['id']]);
        }
        $wpdb->delete(
            $wpdb->prefix . 'supplier_lane_parent_links',
            [
                'supplier_id' => $request['supplier_id'],
                'source_product_id' => $request['source_product_id'],
            ]
        );
        foreach (array_keys($parent_ids) as $parent_id) {
            if (get_post_meta($parent_id, '_wh_approval_test_mode', true) === '1') {
                wp_delete_post($parent_id, true);
            }
        }
        return ['removed' => true, 'variations' => count($offers)];
    }

    private static function stage(array $data): string
    {
        global $wpdb;
        self::install_schema();
        $table = self::table();
        $existing = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT * FROM {$table}
                 WHERE request_kind=%s AND supplier_id=%s
                   AND source_product_id=%s AND source_option_id=%s LIMIT 1",
                $data['request_kind'],
                $data['supplier_id'],
                $data['source_product_id'],
                $data['source_option_id']
            ),
            ARRAY_A
        );
        if (is_array($existing)) {
            if ((string) $existing['status'] === 'terminal_excluded') {
                return 'terminal_excluded';
            }
            if ((string) $existing['status'] === 'approved') {
                return 'approved';
            }
            $existing_payload = json_decode((string) $existing['payload_json'], true);
            $existing_selection = is_array($existing_payload['approval_selection'] ?? null)
                ? $existing_payload['approval_selection']
                : null;
            $new_payload = json_decode((string) $data['payload_json'], true);
            if (!is_array($new_payload)) {
                $new_payload = [];
            }
            if (is_array($existing_selection)) {
                $new_payload['approval_selection'] = $existing_selection;
            }
            $wpdb->update(
                $table,
                [
                    'original_product_name' => $data['original_product_name'],
                    'option_summary' => $data['option_summary'],
                    'hard_spec_fingerprint' => $data['hard_spec_fingerprint'],
                    'payload_json' => wp_json_encode(
                        $new_payload,
                        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
                    ),
                    'updated_at' => current_time('mysql', true),
                ],
                ['id' => (int) $existing['id']]
            );
            self::maybe_notify((int) $existing['id']);
            return (string) $existing['status'];
        }
        $now = current_time('mysql', true);
        for ($attempt = 0; $attempt < 3; $attempt++) {
            $inserted = $wpdb->insert($table, array_merge($data, [
                'action_token' => wp_generate_password(10, false, false),
                'selected_woo_parent_id' => $data['selected_woo_parent_id'] ?? null,
                'created_at' => $now,
                'updated_at' => $now,
            ]));
            if ($inserted === 1) {
                self::audit((int) $wpdb->insert_id, 'detected', 'catalog_sync', null, $data['status']);
                self::maybe_notify((int) $wpdb->insert_id);
                return $data['status'];
            }
        }
        return 'failed';
    }

    public static function send_pending_telegram_approval(int $request_id): bool
    {
        return self::maybe_notify($request_id, true);
    }

    private static function maybe_notify(int $request_id, bool $force = false): bool
    {
        global $wpdb;
        $request = self::request_by_id($request_id);
        if (
            (!$force && (!defined('WHOLESALEHUB_TELEGRAM_APPROVAL_AUTO_SEND')
                || !WHOLESALEHUB_TELEGRAM_APPROVAL_AUTO_SEND))
            ||
            $request === null
            || !in_array((string) $request['status'], self::PENDING_STATUSES, true)
            || (int) $request['telegram_message_id'] > 0
            || !function_exists('avocadoss_send_telegram_approval_message')
        ) {
            return false;
        }
        $now = current_time('mysql', true);
        $stale_before = gmdate('Y-m-d H:i:s', time() - (10 * MINUTE_IN_SECONDS));
        $claimed = $wpdb->query($wpdb->prepare(
            "UPDATE " . self::table() . "
             SET telegram_sent_at=%s,updated_at=%s
             WHERE id=%d AND status IN ('pending_mapping','pending_option')
               AND telegram_message_id IS NULL
               AND (telegram_sent_at IS NULL OR telegram_sent_at < %s)",
            $now,
            $now,
            $request_id,
            $stale_before
        ));
        if ($claimed !== 1) {
            return false;
        }
        $elapsed = microtime(true) - self::$last_notification_time;
        if (self::$last_notification_time > 0 && $elapsed < 1.1) {
            usleep((int) ((1.1 - $elapsed) * 1000000));
        }
        $message_id = (int) avocadoss_send_telegram_approval_message(
            self::message_text($request),
            self::initial_buttons($request)
        );
        self::$last_notification_time = microtime(true);
        if ($message_id <= 0) {
            $wpdb->update(
                self::table(),
                ['telegram_sent_at' => null, 'updated_at' => current_time('mysql', true)],
                ['id' => $request_id, 'telegram_message_id' => null]
            );
            return false;
        }
        $wpdb->update(
            self::table(),
            [
                'telegram_message_id' => $message_id,
                'telegram_sent_at' => $now,
                'updated_at' => current_time('mysql', true),
            ],
            ['id' => $request_id]
        );
        return true;
    }

    private static function message_text(array $request): string
    {
        $supplier = self::supplier_name((string) $request['supplier_id']);
        if ((string) $request['request_kind'] === 'option') {
            return "🆕 신규 옵션 감지\n\nHub 상품: {$request['original_product_name']}"
                . " #{$request['selected_woo_parent_id']}\n공급사: {$supplier}\n"
                . "신규 원본 옵션: {$request['option_summary']}\n\n처리 방법을 선택하세요.";
        }
        $candidates = self::rank_candidates($request, 3);
        $candidate_lines = [];
        foreach ($candidates as $index => $candidate) {
            $candidate_lines[] = ($index + 1) . '. ' . $candidate['name']
                . ' — Woo #' . $candidate['id'];
        }
        $payload = json_decode((string) $request['payload_json'], true);
        $selection = self::selection($request);
        $suggested_category_id = (int) ($payload['group']['suggestedCategoryId'] ?? 0);
        $suggested_category_name = $suggested_category_id > 0
            ? self::category_label($suggested_category_id)
            : '없음';
        $selected_category_id = (int) ($selection['selected_category_id'] ?? 0);
        $selected_category_name = $selected_category_id > 0
            ? self::category_label($selected_category_id)
            : '';
        $final_tax = (string) ($selection['final_tax_status'] ?? '');
        $suggested_tax = self::suggest_tax_status($request);
        $category_warn = (
            $suggested_category_id > 0
            && $selected_category_id > 0
            && $suggested_category_id !== $selected_category_id
        ) ? ' ⚠️' : '';
        $lines = [
            '🆕 신규 상품 감지',
            '공급사: ' . $supplier,
            '원본 상품명: ' . $request['original_product_name'],
            'Source Product ID: ' . $request['source_product_id'],
            '',
            '현재 자동추정 카테고리: ' . $suggested_category_name . $category_warn,
            '선택된 카테고리: ' . ($selected_category_name !== ''
                ? $selected_category_name . ' ✅'
                : '미선택'),
            '세금 자동제안: ' . self::tax_label($suggested_tax),
            '최종 세금: ' . ($final_tax !== ''
                ? self::tax_label($final_tax) . ' ✅'
                : '미선택'),
            '',
            '대표 규격:',
            $request['option_summary'] ?: '- 없음',
            '공급가 범위:',
            self::price_range($request),
            '유사 Hub 상품:',
            $candidate_lines === [] ? '- 후보 없음' : implode("\n", $candidate_lines),
        ];
        if ($selected_category_id <= 0) {
            $lines[] = '';
            $lines[] = '아래에서 카테고리를 먼저 선택하세요.';
        } elseif ($final_tax === '') {
            $lines[] = '';
            $lines[] = '카테고리 선택 완료. 과세/면세를 확정하세요.';
        }
        $lines[] = '';
        $lines[] = '처리 방법을 선택하세요.';
        return implode("\n", $lines);
    }

    private static function candidate_response(array $request, int $page): array
    {
        $candidates = self::rank_candidates($request, 25);
        $pages = max(1, (int) ceil(count($candidates) / 5));
        $page = min($page, $pages - 1);
        $slice = array_slice($candidates, $page * 5, 5);
        $buttons = [];
        foreach ($slice as $candidate) {
            $buttons[] = [[
                'text' => $candidate['name'] . ' #' . $candidate['id'],
                'callback_data' => self::callback(
                    $request['action_token'],
                    'pick' . $candidate['id']
                ),
            ]];
        }
        if ($page + 1 < $pages) {
            $buttons[] = [[
                'text' => '🔎 다른 상품 검색',
                'callback_data' => self::callback(
                    $request['action_token'],
                    'page' . ($page + 2)
                ),
            ]];
        }
        $buttons[] = [[
            'text' => '↩️ 돌아가기',
            'callback_data' => self::callback($request['action_token'], 'back'),
        ]];
        return self::response(
            true,
            '연결할 Hub 상품을 선택하세요.',
            '연결할 Hub 상품을 선택하세요. (' . ($page + 1) . '/' . $pages . ')',
            $buttons
        );
    }

    private static function rank_candidates(array $request, int $limit): array
    {
        global $wpdb;
        $ids = get_posts([
            'post_type' => 'product',
            'post_status' => ['publish', 'private'],
            'posts_per_page' => -1,
            'fields' => 'ids',
            'orderby' => 'ID',
            'order' => 'DESC',
        ]);
        $source_tokens = self::tokens((string) $request['original_product_name']);
        $source_family = self::product_family((string) $request['original_product_name']);
        $payload = json_decode((string) $request['payload_json'], true);
        $test_request = !empty($payload['group']['testMode']);
        $rows = [];
        foreach ($ids as $id) {
            $product = wc_get_product((int) $id);
            if (
                !$product instanceof WC_Product_Variable
                || (
                    get_post_meta((int) $id, '_wh_approval_test_mode', true) === '1'
                    && !$test_request
                )
            ) {
                continue;
            }
            $occupied = $wpdb->get_var($wpdb->prepare(
                "SELECT source_product_id FROM {$wpdb->prefix}supplier_lane_parent_links
                 WHERE woo_parent_id=%d AND lane_code=%s LIMIT 1",
                (int) $id,
                (string) $request['lane_code']
            ));
            if ($occupied !== null && (string) $occupied !== (string) $request['source_product_id']) {
                continue;
            }
            $name = get_the_title((int) $id);
            $target_family = self::product_family($name);
            if (
                (string) $request['request_kind'] === 'product'
                && $source_family !== 'unknown'
                && $target_family !== $source_family
            ) {
                continue;
            }
            $target_tokens = self::tokens($name);
            $intersection = count(array_intersect($source_tokens, $target_tokens));
            $union = count(array_unique(array_merge($source_tokens, $target_tokens)));
            $score = $union > 0 ? $intersection / $union : 0;
            if (
                $name !== ''
                && mb_strpos(self::normalized($name), self::normalized(
                    (string) $request['original_product_name']
                )) !== false
            ) {
                $score += 0.5;
            }
            $same_supplier = (int) $wpdb->get_var($wpdb->prepare(
                "SELECT COUNT(*) FROM {$wpdb->prefix}supplier_lane_parent_links
                 WHERE woo_parent_id=%d AND supplier_id=%s AND status='approved'",
                (int) $id,
                (string) $request['supplier_id']
            ));
            if ($same_supplier > 0) {
                $score += 0.1;
            }
            $rows[] = ['id' => (int) $id, 'name' => $name, 'score' => $score];
        }
        usort($rows, static fn(array $a, array $b): int =>
            ($b['score'] <=> $a['score']) ?: ($b['id'] <=> $a['id'])
        );
        return array_slice($rows, 0, $limit);
    }

    private static function candidate_allowed(array $request, int $parent_id): bool
    {
        foreach (self::rank_candidates($request, 25) as $candidate) {
            if ((int) $candidate['id'] === $parent_id) {
                return true;
            }
        }
        return false;
    }

    private static function transition_without_write(
        array $request,
        string $status,
        string $label,
        string $actor
    ): array {
        global $wpdb;
        $updated = $wpdb->query($wpdb->prepare(
            "UPDATE " . self::table() . "
             SET status=%s,processed_by=%s,processed_at=%s,updated_at=%s
             WHERE id=%d AND status IN ('pending_mapping','pending_option')",
            $status,
            $actor,
            current_time('mysql', true),
            current_time('mysql', true),
            (int) $request['id']
        ));
        if ($updated !== 1) {
            return self::processed_response(
                self::request_by_id((int) $request['id']) ?? $request,
                'ALREADY_PROCESSED'
            );
        }
        self::audit(
            (int) $request['id'],
            $status,
            $actor,
            (string) $request['status'],
            $status
        );
        return self::response(
            true,
            '처리했습니다.',
            $label . "\n\n원본: " . self::supplier_name($request['supplier_id'])
                . ' / ' . $request['original_product_name']
                . ($status === 'terminal_excluded' ? "\n향후 재등록하지 않음" : "\npending 유지")
        );
    }

    private static function apply_request(array $request, string $mode, string $actor): array
    {
        global $wpdb;
        $updated = $wpdb->query($wpdb->prepare(
            "UPDATE " . self::table() . "
             SET status='processing',processed_by=%s,updated_at=%s
             WHERE id=%d AND status IN ('pending_mapping','pending_option')",
            $actor,
            current_time('mysql', true),
            (int) $request['id']
        ));
        if ($updated !== 1) {
            return self::processed_response(
                self::request_by_id((int) $request['id']) ?? $request,
                'ALREADY_PROCESSED'
            );
        }
        try {
            $result = self::provision($request, $mode, $actor);
            $now = current_time('mysql', true);
            $wpdb->update(
                self::table(),
                [
                    'status' => 'approved',
                    'selected_woo_parent_id' => $result['parent_id'],
                    'processed_by' => $actor,
                    'processed_at' => $now,
                    'last_error' => null,
                    'updated_at' => $now,
                ],
                ['id' => (int) $request['id']]
            );
            self::audit(
                (int) $request['id'],
                $mode,
                $actor,
                (string) $request['status'],
                'approved',
                ['parent_id' => $result['parent_id'], 'variations' => $result['variations']]
            );
            $title = $mode === 'new' ? '✅ 신규 상품 생성 완료' : '✅ 매핑 완료';
            return self::response(
                true,
                '처리했습니다.',
                "{$title}\nWoo ID: #{$result['parent_id']}\n"
                    . "추가 variation: {$result['variations']}개\n상태: "
                    . ($result['published'] ? 'published' : 'private test')
            );
        } catch (Throwable $error) {
            $wpdb->update(
                self::table(),
                [
                    'status' => (string) $request['status'],
                    'last_error' => $error->getMessage(),
                    'updated_at' => current_time('mysql', true),
                ],
                ['id' => (int) $request['id']]
            );
            self::audit(
                (int) $request['id'],
                'failed',
                $actor,
                'processing',
                (string) $request['status'],
                ['error' => $error->getMessage()]
            );
            return self::response(false, '처리에 실패했습니다: ' . $error->getMessage());
        }
    }

    private static function provision(array $request, string $mode, string $actor): array
    {
        global $wpdb;
        $payload = json_decode((string) $request['payload_json'], true);
        if (!is_array($payload) || !is_array($payload['lane'] ?? null)) {
            throw new RuntimeException('approval_payload_invalid');
        }
        $lane = $payload['lane'];
        $test_mode = !empty($payload['group']['testMode']);
        $parent_id = 0;
        $created_link = false;
        $created = [];
        try {
            if ($mode === 'new') {
                if ((string) $request['request_kind'] !== 'product') {
                    throw new RuntimeException('new_requires_product_request');
                }
                $parent_id = self::create_parent($request, $payload, $test_mode);
            } elseif ($mode === 'add') {
                $parent_id = (int) ($payload['parentId'] ?? 0);
            } else {
                $parent_id = (int) $request['selected_woo_parent_id'];
            }
            $parent = wc_get_product($parent_id);
            if (!$parent instanceof WC_Product_Variable) {
                throw new RuntimeException('selected_parent_not_variable');
            }

            $existing_link = $wpdb->get_row($wpdb->prepare(
                "SELECT * FROM {$wpdb->prefix}supplier_lane_parent_links
                 WHERE supplier_id=%s AND source_product_id=%s LIMIT 1",
                (string) $request['supplier_id'],
                (string) $request['source_product_id']
            ), ARRAY_A);
            if (
                is_array($existing_link)
                && (int) $existing_link['woo_parent_id'] !== $parent_id
            ) {
                throw new RuntimeException('manual_mapping_conflict');
            }
            if (is_array($existing_link)) {
                $parent_link_id = (int) $existing_link['id'];
            } else {
                $now = current_time('mysql', true);
                $inserted = $wpdb->insert(
                    $wpdb->prefix . 'supplier_lane_parent_links',
                    [
                        'woo_parent_id' => $parent_id,
                        'supplier_id' => $request['supplier_id'],
                        'lane_code' => $request['lane_code'],
                        'source_product_id' => $request['source_product_id'],
                        'status' => 'pending',
                        'approved_by' => null,
                        'approved_at' => null,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]
                );
                if ($inserted !== 1) {
                    throw new RuntimeException('parent_link_create_failed');
                }
                $parent_link_id = (int) $wpdb->insert_id;
                $created_link = true;
            }

            foreach ((array) ($lane['options'] ?? []) as $option) {
                $variation_id = self::create_offer(
                    $parent_id,
                    $parent_link_id,
                    (string) $request['lane_code'],
                    (string) $request['supplier_id'],
                    (string) $request['source_product_id'],
                    $option,
                    self::final_tax_from_payload($request)
                );
                if ($variation_id > 0) {
                    $created[] = $variation_id;
                }
            }
            $now = current_time('mysql', true);
            foreach ($created as $variation_id) {
                $variation = wc_get_product($variation_id);
                if (!$variation instanceof WC_Product_Variation) {
                    throw new RuntimeException('variation_readback_failed');
                }
                $variation->set_status('publish');
                $variation->save();
                $wpdb->update(
                    $wpdb->prefix . 'supplier_lane_offers',
                    ['approval_status' => 'approved', 'lifecycle_status' => 'active', 'updated_at' => $now],
                    ['woo_variation_id' => $variation_id]
                );
            }
            $wpdb->update(
                $wpdb->prefix . 'supplier_lane_parent_links',
                [
                    'status' => 'approved',
                    'approved_by' => 'telegram:' . $actor,
                    'approved_at' => $now,
                    'updated_at' => $now,
                ],
                ['id' => $parent_link_id]
            );
            self::refresh_parent_attributes($parent_id);
            WholesaleHub_Supplier_Lanes::ensure_spec_mappings_for_parent($parent_id);
            WC_Product_Variable::sync($parent_id);
            $parent = wc_get_product($parent_id);
            if ($mode === 'new' && $parent instanceof WC_Product_Variable) {
                $ai_thumbnail_id = 0;
                if (function_exists('avocadoss_generate_ai_thumbnail')) {
                    $ai_thumbnail_id = (int) avocadoss_generate_ai_thumbnail($parent_id);
                }
                if ($ai_thumbnail_id <= 0 && !$test_mode && function_exists('avocadoss_ensure_product_thumbnail')) {
                    if (!avocadoss_ensure_product_thumbnail($parent_id)) {
                        throw new RuntimeException('source_image_required');
                    }
                }
                $parent->set_catalog_visibility($test_mode ? 'hidden' : 'visible');
                $parent->set_status($test_mode ? 'private' : 'publish');
                $parent->save();
            }
            return [
                'parent_id' => $parent_id,
                'variations' => count($created),
                'published' => !$test_mode,
            ];
        } catch (Throwable $error) {
            foreach ($created as $variation_id) {
                $wpdb->delete(
                    $wpdb->prefix . 'supplier_lane_offers',
                    ['woo_variation_id' => $variation_id]
                );
                wp_delete_post($variation_id, true);
            }
            if ($created_link) {
                $wpdb->delete(
                    $wpdb->prefix . 'supplier_lane_parent_links',
                    ['id' => $parent_link_id]
                );
            }
            if ($mode === 'new' && $parent_id > 0) {
                wp_delete_post($parent_id, true);
            }
            throw $error;
        }
    }

    private static function create_parent(array $request, array $payload, bool $test_mode): int
    {
        $selection = is_array($payload['approval_selection'] ?? null)
            ? $payload['approval_selection']
            : [];
        $final_tax = (string) ($selection['final_tax_status'] ?? '');
        $product = new WC_Product_Variable();
        $product->set_name((string) $request['original_product_name']);
        $product->set_status('private');
        $product->set_catalog_visibility('hidden');
        $product->set_description(
            '<p>선택한 옵션과 수량에 따라 주문할 수 있습니다. 옵션별로 나누어 배송될 수 있습니다.</p>'
        );
        $product->set_short_description('<p>신선 상품 옵션을 선택해 주문하세요.</p>');
        if (in_array($final_tax, ['none', 'taxable'], true)) {
            $product->set_tax_status($final_tax);
        }
        $product->update_meta_data('_wh_supplier_lane_mode', '1');
        if ($test_mode) {
            $product->update_meta_data('_wh_approval_test_mode', '1');
        }
        $image_url = esc_url_raw((string) ($payload['group']['source_image_url'] ?? ''));
        if ($image_url !== '') {
            $product->update_meta_data('_wholesalehub_source_image_url', $image_url);
        }
        $parent_id = $product->save();
        if ($parent_id <= 0) {
            throw new RuntimeException('new_parent_create_failed');
        }
        $categories = array_values(array_filter(array_map(
            'sanitize_text_field',
            (array) ($payload['group']['categories'] ?? [])
        )));
        $selected_category_id = (int) ($selection['selected_category_id'] ?? 0);
        if ($selected_category_id > 0) {
            $categories = [(int) $selected_category_id];
        }
        if ($categories !== []) {
            wp_set_object_terms($parent_id, $categories, 'product_cat', false);
        }
        $source_description = sanitize_textarea_field((string) ($payload['lane']['sourceDescription'] ?? ''));
        if ($source_description !== '') {
            update_post_meta($parent_id, '_wh_source_description', $source_description);
        }
        return $parent_id;
    }

    private static function create_offer(
        int $parent_id,
        int $parent_link_id,
        string $lane_code,
        string $supplier_id,
        string $source_product_id,
        array $option,
        string $tax_status = ''
    ): int {
        global $wpdb;
        $source_option_id = sanitize_text_field((string) ($option['sourceOptionId'] ?? ''));
        if ($source_option_id === '') {
            throw new RuntimeException('source_option_id_required');
        }
        $existing = $wpdb->get_var($wpdb->prepare(
            "SELECT woo_variation_id FROM {$wpdb->prefix}supplier_lane_offers
             WHERE supplier_id=%s AND source_product_id=%s AND source_option_id=%s LIMIT 1",
            $supplier_id,
            $source_product_id,
            $source_option_id
        ));
        if ($existing !== null) {
            return 0;
        }
        $public_label = sanitize_text_field((string) ($option['publicOptionLabel'] ?? ''));
        $sale_price = (float) ($option['salePrice'] ?? 0);
        if ($public_label === '' || $sale_price <= 0) {
            throw new RuntimeException('option_contract_invalid');
        }
        $stock_status = ($option['stockStatus'] ?? '') === 'out_of_stock'
            ? 'outofstock'
            : 'instock';
        $variation = new WC_Product_Variation();
        $variation->set_parent_id($parent_id);
        $variation->set_status('private');
        $variation->set_regular_price(wc_format_decimal($sale_price, 2));
        $variation->set_price(wc_format_decimal($sale_price, 2));
        $variation->set_manage_stock(false);
        $variation->set_stock_status($stock_status);
        if (in_array($tax_status, ['none', 'taxable'], true)) {
            $variation->set_tax_status($tax_status);
        }
        $variation->set_attributes([
            sanitize_title('출고구분') => $lane_code === 'A' ? 'A사' : 'B사',
            sanitize_title('구매옵션') => $public_label,
        ]);
        $variation->set_sku('WH-' . strtoupper(substr(hash(
            'sha256',
            $supplier_id . '|' . $source_product_id . '|' . $source_option_id
        ), 0, 20)));
        $meta = [
            '_wh_internal_supplier_id' => $supplier_id,
            '_wh_source_product_id' => $source_product_id,
            '_wh_source_option_id' => $source_option_id,
            '_wh_source_id_type' => (string) ($option['sourceIdType'] ?? 'authoritative'),
            '_wh_snapshot_hash' => (string) ($option['snapshotHash'] ?? ''),
            '_wh_hard_spec_fingerprint' => (string) ($option['hardSpecFingerprint'] ?? ''),
            '_wh_source_option_label' => (string) ($option['sourceOptionLabel'] ?? $public_label),
            '_wh_source_option_name' => (string) ($option['sourceOptionName'] ?? ''),
            '_wh_source_spec_note' => (string) ($option['sourceSpecNote'] ?? ''),
            '_wh_source_size_label' => (string) ($option['sourceSizeLabel'] ?? ''),
            '_wh_source_weight_label' => (string) ($option['sourceWeightLabel'] ?? ''),
            '_wh_source_count_label' => (string) ($option['sourceCountLabel'] ?? ''),
            '_wh_source_package_label' => (string) ($option['sourcePackageLabel'] ?? ''),
        ];
        foreach ($meta as $key => $value) {
            $variation->update_meta_data($key, sanitize_text_field($value));
        }
        $variation_id = $variation->save();
        if ($variation_id <= 0) {
            throw new RuntimeException('variation_create_failed');
        }
        $public_offer_key = hash('sha256', implode('|', [
            'wholesalehub',
            $supplier_id,
            $source_product_id,
            $source_option_id,
            $variation_id,
        ]));
        $now = current_time('mysql', true);
        $inserted = $wpdb->insert(
            $wpdb->prefix . 'supplier_lane_offers',
            [
                'parent_link_id' => $parent_link_id,
                'supplier_id' => $supplier_id,
                'lane_code' => $lane_code,
                'source_product_id' => $source_product_id,
                'source_option_id' => $source_option_id,
                'atomic_supplier_sku_id' => hash(
                    'sha256',
                    $supplier_id . '|' . $source_product_id . '|' . $source_option_id
                ),
                'woo_parent_id' => $parent_id,
                'woo_variation_id' => $variation_id,
                'public_offer_key' => $public_offer_key,
                'public_option_label' => $public_label,
                'option_label_raw' => sanitize_text_field(
                    (string) ($option['sourceOptionLabel'] ?? $public_label)
                ),
                'hard_spec_fingerprint' => sanitize_text_field(
                    (string) ($option['hardSpecFingerprint'] ?? '')
                ),
                'source_cost' => (float) ($option['sourceCost'] ?? 0),
                'source_shipping_cost' => (float) ($option['shippingFee'] ?? 0),
                'landed_cost' => (float) ($option['landedCost'] ?? 0),
                'sale_price' => $sale_price,
                'stock_status' => $stock_status === 'instock' ? 'in_stock' : 'out_of_stock',
                'approval_status' => 'pending',
                'lifecycle_status' => 'inactive',
                'last_snapshot_hash' => sanitize_text_field(
                    (string) ($option['snapshotHash'] ?? '')
                ),
                'last_complete_run_id' => 'telegram-mapping-approval',
                'last_seen_at' => $now,
                'missing_complete_count' => 0,
                'created_at' => $now,
                'updated_at' => $now,
            ]
        );
        if ($inserted !== 1) {
            wp_delete_post($variation_id, true);
            throw new RuntimeException('offer_create_failed');
        }
        update_post_meta($variation_id, '_wh_lane_offer_id', (string) $wpdb->insert_id);
        return $variation_id;
    }

    private static function refresh_parent_attributes(int $parent_id): void
    {
        global $wpdb;
        $offers = $wpdb->get_results($wpdb->prepare(
            "SELECT lane_code,public_option_label FROM {$wpdb->prefix}supplier_lane_offers
             WHERE woo_parent_id=%d AND approval_status='approved'
               AND lifecycle_status='active' ORDER BY id",
            $parent_id
        ), ARRAY_A);
        $lanes = [];
        $labels = [];
        foreach ($offers as $offer) {
            $lanes[] = (string) $offer['lane_code'] === 'A' ? 'A사' : 'B사';
            $labels[] = (string) $offer['public_option_label'];
        }
        $parent = wc_get_product($parent_id);
        if (!$parent instanceof WC_Product_Variable) {
            throw new RuntimeException('parent_readback_failed');
        }
        $attributes = [];
        foreach ([
            '출고구분' => array_values(array_unique($lanes)),
            '구매옵션' => array_values(array_unique($labels)),
        ] as $name => $options) {
            $attribute = new WC_Product_Attribute();
            $attribute->set_name($name);
            $attribute->set_options($options);
            $attribute->set_visible(false);
            $attribute->set_variation(true);
            $attributes[] = $attribute;
        }
        $parent->set_attributes($attributes);
        $parent->save();
    }

    private static function processed_response(array $request, string $message): array
    {
        return self::response(
            true,
            $message,
            "Supplier Lane 요청 #{$request['id']}\n상태: {$request['status']}"
        );
    }

    private static function response(
        bool $ok,
        string $message,
        string $text = '',
        array $buttons = []
    ): array {
        $result = ['ok' => $ok, 'message' => $message];
        if ($text !== '') {
            $result['text'] = $text;
            $result['buttons'] = $buttons;
        }
        return $result;
    }

    private static function callback(string $token, string $action): string
    {
        return self::CALLBACK_PREFIX . ':' . $token . ':' . $action;
    }

    private static function select_parent(int $request_id, int $parent_id): void
    {
        global $wpdb;
        $wpdb->update(
            self::table(),
            ['selected_woo_parent_id' => $parent_id, 'updated_at' => current_time('mysql', true)],
            ['id' => $request_id]
        );
    }

    private static function request_by_token(string $token): ?array
    {
        global $wpdb;
        self::install_schema();
        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM " . self::table() . " WHERE action_token=%s", $token),
            ARRAY_A
        );
        return is_array($row) ? $row : null;
    }

    private static function request_by_id(int $id): ?array
    {
        global $wpdb;
        self::install_schema();
        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM " . self::table() . " WHERE id=%d", $id),
            ARRAY_A
        );
        return is_array($row) ? $row : null;
    }

    private static function audit(
        int $request_id,
        string $action,
        string $actor,
        ?string $previous,
        string $next,
        array $detail = []
    ): void {
        global $wpdb;
        $wpdb->insert($wpdb->prefix . 'supplier_lane_audit_history', [
            'entity_type' => 'approval_request',
            'entity_id' => $request_id,
            'action' => $action,
            'actor' => $actor,
            'detail_json' => wp_json_encode(array_merge(
                ['previous_status' => $previous, 'next_status' => $next],
                $detail
            ), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'created_at' => current_time('mysql', true),
        ]);
    }

    private static function option_summary(array $options): string
    {
        $labels = array_map([self::class, 'option_label'], array_slice($options, 0, 3));
        $suffix = count($options) > 3 ? "\n- 외 " . (count($options) - 3) . '개' : '';
        return $labels === [] ? '' : '- ' . implode("\n- ", $labels) . $suffix;
    }

    private static function option_label(array $option): string
    {
        $label = sanitize_text_field((string) (
            $option['sourceOptionLabel']
            ?? $option['publicOptionLabel']
            ?? ''
        ));
        $policy = $option['shipping_policy'] ?? $option['shippingPolicy'] ?? null;
        if (!is_array($policy)) {
            return $label;
        }
        $type = (string) ($policy['shipping_policy_type'] ?? 'unknown');
        $base = number_format((float) ($policy['shipping_base_fee'] ?? 0));
        $shipping = $type === 'free' ? '무료' : ($type === 'fixed' ? "고정 {$base}원" : ($type === 'quantity_tiered' ? '수량별' : '확인 필요'));
        $jeju = (float) ($policy['shipping_jeju_extra_fee'] ?? 0);
        $remote = (float) ($policy['shipping_remote_extra_fee'] ?? 0);
        $suffix = "배송비 {$shipping}";
        if ($jeju > 0 || $remote > 0) {
            $suffix .= ' · 제주 +' . number_format($jeju) . '원 · 도서산간 +' . number_format($remote) . '원';
        }
        $tiers = is_array($policy['shipping_tiers'] ?? null) ? $policy['shipping_tiers'] : [];
        if ($tiers !== []) {
            $tier = $tiers[0];
            $suffix .= ' · ' . (int) ($tier['min_qty'] ?? 0) . '~' . ((int) ($tier['max_qty_exclusive'] ?? 0) - 1) . '개 ' . number_format((float) ($tier['fee'] ?? 0)) . '원';
        }
        return $label . ' · ' . $suffix;
    }

    private static function price_range(array $request): string
    {
        $payload = json_decode((string) $request['payload_json'], true);
        $prices = [];
        foreach ((array) ($payload['lane']['options'] ?? []) as $option) {
            $price = (float) ($option['sourceCost'] ?? 0);
            if ($price > 0) {
                $prices[] = $price;
            }
        }
        if ($prices === []) {
            return '- 확인 필요';
        }
        $minimum = min($prices);
        $maximum = max($prices);
        $formatted = static fn(float $price): string => '₩' . number_format($price);
        return $minimum === $maximum
            ? $formatted($minimum)
            : $formatted($minimum) . ' ~ ' . $formatted($maximum);
    }

    private static function fingerprint(array $options): string
    {
        $parts = [];
        foreach ($options as $option) {
            $parts[] = (string) ($option['sourceOptionId'] ?? '') . '|'
                . (string) ($option['hardSpecFingerprint'] ?? '');
        }
        sort($parts);
        return hash('sha256', implode("\n", $parts));
    }

    private static function supplier_name(string $supplier_id): string
    {
        return $supplier_id === 'dailyfood' ? 'Daily' : (
            $supplier_id === 'walldob2b' ? 'Walldo' : $supplier_id
        );
    }

    private static function approval_categories(): array
    {
        $names = ['농산물', '가공식품', '수산물', '축산물', '공동구매'];
        $terms = get_terms([
            'taxonomy' => 'product_cat',
            'hide_empty' => false,
            'parent' => 0,
            'name' => $names,
        ]);
        if (is_wp_error($terms)) {
            return [];
        }
        $by_name = [];
        foreach ($terms as $term) {
            $by_name[(string) $term->name] = $term;
        }
        $ordered = [];
        foreach ($names as $name) {
            if (isset($by_name[$name])) {
                $ordered[] = $by_name[$name];
            }
        }
        return $ordered;
    }

    private static function selection(array $request): array
    {
        $payload = json_decode((string) $request['payload_json'], true);
        return is_array($payload['approval_selection'] ?? null)
            ? $payload['approval_selection']
            : [];
    }

    private static function save_selection(int $request_id, array $selection): void
    {
        global $wpdb;
        $request = self::request_by_id($request_id);
        if ($request === null) {
            return;
        }
        $payload = json_decode((string) $request['payload_json'], true);
        if (!is_array($payload)) {
            $payload = [];
        }
        $payload['approval_selection'] = array_merge(
            self::selection($request),
            $selection
        );
        $wpdb->update(
            self::table(),
            [
                'payload_json' => wp_json_encode(
                    $payload,
                    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
                ),
                'updated_at' => current_time('mysql', true),
            ],
            ['id' => $request_id]
        );
    }

    private static function final_tax_from_payload(array $request): string
    {
        $selection = self::selection($request);
        $final = (string) ($selection['final_tax_status'] ?? '');
        return in_array($final, ['none', 'taxable'], true) ? $final : '';
    }

    private static function category_label(int $term_id): string
    {
        $term = get_term($term_id, 'product_cat');
        return ($term && !is_wp_error($term)) ? (string) $term->name : '';
    }

    private static function tax_label(?string $status): string
    {
        if ($status === 'none') {
            return '면세';
        }
        if ($status === 'taxable') {
            return '과세';
        }
        return '확인필요';
    }

    private static function suggest_tax_status(array $request): string
    {
        $payload = json_decode((string) $request['payload_json'], true);
        $selection = self::selection($request);
        $category_name = '';
        $selected_id = (int) ($selection['selected_category_id'] ?? 0);
        if ($selected_id > 0) {
            $category_name = self::category_label($selected_id);
        }
        if ($category_name === '') {
            $names = (array) ($payload['group']['categories'] ?? []);
            $category_name = (string) ($names[0] ?? '');
        }
        $name = (string) ($request['original_product_name'] ?? '');
        $combined = $category_name . ' ' . $name;
        $review_signals = [
            '김치', '겉절이', '젓갈', '무침', '식해', '두부', '된장', '고추장', '간장', '쌈장',
            '식초', '염장', '절임', '건조', '건식', '냉동', '데침', '조리', '가공', '훈제',
            '양념', '소스', '즙', '통조림', '밀키트', '찌개', '만두', '과자', '잼', '엑기스',
            '말랭이', '조림', '볶음', '튀김', '반찬', '국수', '라면', '스프', '햄', '소시지',
            '치즈', '버터', '식용유', '참기름', '들기름', '액젓', '어묵', '맛살', '피클',
            '장아찌', '소금', '즉석', '레토르트', '분말', '캔',
        ];
        foreach ($review_signals as $signal) {
            if ($signal !== '' && mb_strpos($combined, $signal) !== false) {
                return 'review';
            }
        }
        if (
            mb_strpos($category_name, '농산물') !== false
            || mb_strpos($category_name, '수산물') !== false
            || mb_strpos($category_name, '축산물') !== false
        ) {
            return 'none';
        }
        return 'review';
    }

    private static function approval_buttons(array $request): array
    {
        $token = (string) $request['action_token'];
        $selection = self::selection($request);
        $selected_id = (int) ($selection['selected_category_id'] ?? 0);
        $final_tax = (string) ($selection['final_tax_status'] ?? '');
        $rows = [];

        $category_row = [];
        foreach (self::approval_categories() as $category) {
            $category_row[] = [
                'text' => ($selected_id === (int) $category->term_id ? '✅ ' : '') . $category->name,
                'callback_data' => self::callback($token, 'cat:' . (int) $category->term_id),
            ];
            if (count($category_row) === 2) {
                $rows[] = $category_row;
                $category_row = [];
            }
        }
        if ($category_row !== []) {
            $rows[] = $category_row;
        }

        if ($selected_id > 0) {
            $rows[] = [
                [
                    'text' => ($final_tax === 'none' ? '✅ ' : '') . '면세 확정',
                    'callback_data' => self::callback($token, 'tax:n'),
                ],
                [
                    'text' => ($final_tax === 'taxable' ? '✅ ' : '') . '과세 확정',
                    'callback_data' => self::callback($token, 'tax:t'),
                ],
            ];
        }

        $rows[] = [[
            'text' => '🔗 기존 상품 연결',
            'callback_data' => self::callback($token, 'link'),
        ]];
        $rows[] = [[
            'text' => '➕ 새 상품 등록',
            'callback_data' => self::callback($token, 'new'),
        ]];
        $rows[] = [
            ['text' => '⏸ 보류', 'callback_data' => self::callback($token, 'hold')],
            ['text' => '🚫 영구 제외', 'callback_data' => self::callback($token, 'exclude')],
        ];
        return $rows;
    }

    private static function select_category_callback(array $request, int $term_id, string $actor): array
    {
        $term = get_term($term_id, 'product_cat');
        if (!$term || is_wp_error($term)) {
            return self::response(false, '선택할 수 없는 카테고리입니다.');
        }
        self::save_selection((int) $request['id'], ['selected_category_id' => (int) $term_id]);
        $request = self::request_by_id((int) $request['id']) ?? $request;
        self::audit(
            (int) $request['id'],
            'select_category',
            $actor,
            null,
            'pending_mapping',
            ['term_id' => (int) $term_id]
        );
        return self::response(
            true,
            '카테고리를 선택했습니다.',
            self::message_text($request),
            self::approval_buttons($request)
        );
    }

    private static function select_tax_callback(array $request, string $code, string $actor): array
    {
        $status = $code === 'n' ? 'none' : 'taxable';
        self::save_selection((int) $request['id'], ['final_tax_status' => $status]);
        $request = self::request_by_id((int) $request['id']) ?? $request;
        self::audit(
            (int) $request['id'],
            'select_tax',
            $actor,
            null,
            'pending_mapping',
            ['tax_status' => $status]
        );
        return self::response(
            true,
            '세금을 확정했습니다.',
            self::message_text($request),
            self::approval_buttons($request)
        );
    }

    private static function normalized(string $value): string
    {
        return mb_strtolower(preg_replace('/[^\p{L}\p{N}]+/u', '', $value) ?? '');
    }

    private static function product_family(string $value): string
    {
        $compact = preg_replace('/\s+/u', '', $value) ?? '';
        foreach ([
            '자몽' => '/레드루비|자몽/u', '옥수수' => '/옥수수/u', '참외' => '/참외/u',
            '사과' => '/사과/u', '감자' => '/감자/u', '당근' => '/당근/u',
            '수박' => '/애플수박|흑수박|씨들리스수박|참박수박|수박/u',
            '복숭아' => '/천도복숭아|망고복숭아|신비복숭아|대극천복숭아|복숭아|백도|황도|천반도|거반도/u',
            '자두' => '/피자두|대석자두|자두/u', '감귤' => '/감귤|하우스귤|귤/u',
            '방울토마토' => '/방울토마토/u', '토마토' => '/토마토/u',
            '포도' => '/샤인머스켓|거봉|캠벨포도|포도/u',
            '멜론' => '/머스크메론|세지메론|백자멜론|파파야메론|멜론|메론/u',
            '키위' => '/키위/u', '아보카도' => '/아보카도/u', '망고스틴' => '/망고스틴/u',
            '망고' => '/망고/u', '용과' => '/용과/u', '체리' => '/체리/u', '살구' => '/살구/u',
            '호박' => '/호박/u', '고구마' => '/고구마/u', '양파' => '/양파/u', '오이' => '/오이/u',
            '마늘' => '/마늘/u', '양배추' => '/양배추/u', '배추' => '/배추/u', '깻잎' => '/깻잎/u',
            '콩' => '/강낭콩|호랑이콩|콩물|콩/u', '마카다미아' => '/마카다미아/u', '석가' => '/석가/u',
        ] as $family => $pattern) {
            if (preg_match($pattern, $compact)) {
                return $family;
            }
        }
        return 'unknown';
    }

    private static function tokens(string $value): array
    {
        $parts = preg_split('/[^\p{L}\p{N}]+/u', mb_strtolower($value)) ?: [];
        return array_values(array_unique(array_filter($parts, static fn(string $part): bool =>
            $part !== ''
        )));
    }

    private static function table(): string
    {
        global $wpdb;
        return $wpdb->prefix . 'supplier_lane_approval_requests';
    }
}
