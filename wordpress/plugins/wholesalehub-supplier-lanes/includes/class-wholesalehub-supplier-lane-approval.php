<?php

defined('ABSPATH') || exit;

final class WholesaleHub_Supplier_Lane_Approval
{
    private const CALLBACK_PREFIX = 'slm';
    private const PENDING_STATUSES = ['pending_mapping', 'pending_option'];
    private static bool $schema_ready = false;

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
              UNIQUE KEY source_identity
                (request_kind,supplier_id,source_product_id,source_option_id),
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
        $payload = [
            'group' => [
                'displayName' => sanitize_text_field((string) ($group['displayName'] ?? '')),
                'source_image_url' => esc_url_raw((string) ($group['source_image_url'] ?? '')),
                'categories' => array_values(array_filter(array_map(
                    'sanitize_text_field',
                    is_array($group['approvalCategories'] ?? null)
                        ? $group['approvalCategories']
                        : []
                ))),
                'testMode' => !empty($group['_approvalTestMode']),
            ],
            'lane' => [
                'supplierId' => $supplier_id,
                'sourceProductId' => $source_product_id,
                'laneCode' => $lane_code,
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
        if (
            !in_array(
                $action,
                ['link', 'new', 'newok', 'add', 'addok', 'hold', 'exclude', 'back', 'confirm'],
                true
            )
            && preg_match('/^(?:page|pick)[1-9][0-9]*$/', $action) !== 1
        ) {
            return null;
        }
        return ['token' => $parts[1], 'action' => $action];
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
        return [
            [[
                'text' => '🔗 기존 상품 연결',
                'callback_data' => self::callback($token, 'link'),
            ]],
            [[
                'text' => '➕ 새 상품 등록',
                'callback_data' => self::callback($token, 'new'),
            ]],
            [
                ['text' => '⏸ 보류', 'callback_data' => self::callback($token, 'hold')],
                ['text' => '🚫 영구 제외', 'callback_data' => self::callback($token, 'exclude')],
            ],
        ];
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
            return self::response(
                true,
                '새 상품 생성을 확인하세요.',
                "새 상품으로 생성하시겠습니까?\n\n{$request['original_product_name']}\n"
                    . "{$request['option_summary']}\n" . self::supplier_name($request['supplier_id']),
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
            $wpdb->update(
                $table,
                [
                    'original_product_name' => $data['original_product_name'],
                    'option_summary' => $data['option_summary'],
                    'hard_spec_fingerprint' => $data['hard_spec_fingerprint'],
                    'payload_json' => $data['payload_json'],
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

    private static function maybe_notify(int $request_id): void
    {
        global $wpdb;
        $request = self::request_by_id($request_id);
        if (
            $request === null
            || !in_array((string) $request['status'], self::PENDING_STATUSES, true)
            || (int) $request['telegram_message_id'] > 0
            || !function_exists('avocadoss_send_telegram_approval_message')
        ) {
            return;
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
            return;
        }
        $message_id = (int) avocadoss_send_telegram_approval_message(
            self::message_text($request),
            self::initial_buttons($request)
        );
        if ($message_id <= 0) {
            $wpdb->update(
                self::table(),
                ['telegram_sent_at' => null, 'updated_at' => current_time('mysql', true)],
                ['id' => $request_id, 'telegram_message_id' => null]
            );
            return;
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
        return "🆕 신규 상품 감지\n\n공급사: {$supplier}\n"
            . "원본 상품명: {$request['original_product_name']}\n"
            . "Source Product ID: {$request['source_product_id']}\n\n대표 규격:\n"
            . ($request['option_summary'] ?: '- 없음')
            . "\n\n공급가 범위:\n" . self::price_range($request)
            . "\n\n유사 Hub 상품:\n"
            . ($candidate_lines === [] ? '- 후보 없음' : implode("\n", $candidate_lines))
            . "\n\n처리 방법을 선택하세요.";
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
                    $option
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
                if (!$test_mode && function_exists('avocadoss_ensure_product_thumbnail')) {
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
        $product = new WC_Product_Variable();
        $product->set_name((string) $request['original_product_name']);
        $product->set_status('private');
        $product->set_catalog_visibility('hidden');
        $product->set_description(
            '<p>선택한 옵션과 수량에 따라 주문할 수 있습니다. 옵션별로 나누어 배송될 수 있습니다.</p>'
        );
        $product->set_short_description('<p>신선 상품 옵션을 선택해 주문하세요.</p>');
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
        if ($categories !== []) {
            wp_set_object_terms($parent_id, $categories, 'product_cat', false);
        }
        return $parent_id;
    }

    private static function create_offer(
        int $parent_id,
        int $parent_link_id,
        string $lane_code,
        string $supplier_id,
        string $source_product_id,
        array $option
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
        return sanitize_text_field((string) (
            $option['sourceOptionLabel']
            ?? $option['publicOptionLabel']
            ?? ''
        ));
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

    private static function normalized(string $value): string
    {
        return mb_strtolower(preg_replace('/[^\p{L}\p{N}]+/u', '', $value) ?? '');
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
