<?php
defined('ABSPATH') || exit;

/**
 * Coupang / Naver SmartStore Excel bulk order import layer.
 *
 * This is a parser + persistent-mapping adapter that converts marketplace
 * exports into the standard rows consumed by WholesaleHub_Bulk_Order. It does
 * NOT reimplement the order/checkout engine.
 */
final class WholesaleHub_Marketplace_Bulk {
    private const SCHEMA_VERSION = '1.0.0';
    private const SCHEMA_OPTION = 'wh_marketplace_bulk_schema_version';
    private const NONCE = 'wh_marketplace_bulk';

    public static function boot(): void {
        add_action('admin_post_wh_mp_save_mapping', [self::class, 'save_mapping']);
    }

    public static function install_schema(): void {
        if ((string) get_option(self::SCHEMA_OPTION, '') === self::SCHEMA_VERSION) {
            return;
        }
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $c = $wpdb->get_charset_collate();
        dbDelta("CREATE TABLE {$wpdb->prefix}wholesalehub_marketplace_mappings (
            id bigint unsigned NOT NULL AUTO_INCREMENT,
            marketplace varchar(32) NOT NULL,
            external_product_id varchar(191) NOT NULL,
            external_option_key varchar(191) NOT NULL,
            external_option_id varchar(191) NULL,
            external_seller_code varchar(191) NULL,
            last_product_name text NULL,
            last_option_name text NULL,
            woo_product_id bigint unsigned NULL,
            woo_variation_id bigint unsigned NULL,
            quantity_multiplier int unsigned NOT NULL DEFAULT 1,
            is_active tinyint(1) NOT NULL DEFAULT 1,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY mp_identity (marketplace, external_product_id, external_option_key),
            KEY woo_variation (woo_variation_id)
        ) {$c};");
        dbDelta("CREATE TABLE {$wpdb->prefix}wholesalehub_marketplace_orders (
            id bigint unsigned NOT NULL AUTO_INCREMENT,
            marketplace varchar(32) NOT NULL,
            source_order_key varchar(191) NOT NULL,
            source_line_key varchar(191) NOT NULL,
            batch_id bigint unsigned NULL,
            status varchar(24) NOT NULL DEFAULT 'PREVIEWED',
            created_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY mp_source_identity (marketplace, source_order_key, source_line_key),
            KEY status (status)
        ) {$c};");
        update_option(self::SCHEMA_OPTION, self::SCHEMA_VERSION);
    }

    /**
     * Parse Coupang DeliveryList export rows (already decoded by xlsx parser).
     * Returns normalized marketplace rows.
     */
    public static function parse_coupang(array $rows): array {
        $headers = array_map('trim', array_map('strval', array_shift($rows)));
        $h = self::header_index($headers);
        $need = ['묶음배송번호', '주문번호', '노출상품ID', '옵션ID', '구매수(수량)', '수취인이름', '우편번호', '수취인 주소'];
        foreach ($need as $k) {
            if (!isset($h[$k])) {
                return ['error' => 'coupang_missing_header:' . $k];
            }
        }
        $out = [];
        foreach ($rows as $row) {
            $g = static fn($k) => trim(wp_strip_all_tags((string) ($row[$h[$k] ?? -1] ?? '')));
            $product_id = $g('노출상품ID');
            $option_id = $g('옵션ID');
            $seller_code = isset($h['업체상품코드']) ? $g('업체상품코드') : '';
            $option_name = isset($h['등록옵션명']) ? $g('등록옵션명') : (isset($h['노출상품명(옵션명)']) ? $g('노출상품명(옵션명)') : '');
            if ($product_id === '' || $option_id === '') {
                continue;
            }
            $order_key = $g('주문번호');
            $line_key = $product_id . '|' . $option_id;
            $out[] = [
                'marketplace' => 'coupang',
                'external_product_id' => $product_id,
                'external_option_key' => $option_id,
                'external_option_id' => $option_id,
                'external_seller_code' => $seller_code,
                'external_product_name' => isset($h['등록상품명']) ? $g('등록상품명') : '',
                'external_option_name' => $option_name,
                'quantity' => self::int_or_zero($g('구매수(수량)')),
                'recipient' => $g('수취인이름'),
                'phone' => isset($h['수취인전화번호']) ? $g('수취인전화번호') : '',
                'postcode' => $g('우편번호'),
                'address1' => $g('수취인 주소'),
                'address2' => '',
                'message' => isset($h['배송메세지']) ? $g('배송메세지') : '',
                'pccc' => isset($h['개인통관번호(PCCC)']) ? $g('개인통관번호(PCCC)') : '',
                'bundle_key' => $g('묶음배송번호'),
                'source_order_key' => $order_key !== '' ? $order_key : $line_key,
                'source_line_key' => $line_key,
            ];
        }
        return $out;
    }

    /**
     * Parse Naver SmartStore export rows.
     */
    public static function parse_naver(array $rows): array {
        $headers = array_map('trim', array_map('strval', array_shift($rows)));
        $h = self::header_index($headers);
        $need = ['상품주문번호', '상품번호', '수량', '수취인명', '우편번호', '기본배송지'];
        foreach ($need as $k) {
            if (!isset($h[$k])) {
                return ['error' => 'naver_missing_header:' . $k];
            }
        }
        $out = [];
        foreach ($rows as $row) {
            $g = static fn($k) => trim(wp_strip_all_tags((string) ($row[$h[$k] ?? -1] ?? '')));
            $product_id = $g('상품번호');
            $option_code = isset($h['옵션관리코드']) ? $g('옵션관리코드') : '';
            $option_name = isset($h['옵션정보']) ? $g('옵션정보') : '';
            $option_key = $option_code !== '' ? $option_code : self::option_hash($option_name);
            if ($product_id === '' || $option_key === '') {
                continue;
            }
            $line_key = $product_id . '|' . $option_key;
            $order_key = $g('상품주문번호');
            $out[] = [
                'marketplace' => 'naver',
                'external_product_id' => $product_id,
                'external_option_key' => $option_key,
                'external_option_id' => $option_code,
                'external_seller_code' => isset($h['판매자 상품코드']) ? $g('판매자 상품코드') : '',
                'external_product_name' => '',
                'external_option_name' => $option_name,
                'quantity' => self::int_or_zero($g('수량')),
                'recipient' => $g('수취인명'),
                'phone' => isset($h['수취인연락처']) ? $g('수취인연락처') : '',
                'postcode' => $g('우편번호'),
                'address1' => $g('기본배송지'),
                'address2' => isset($h['상세배송지']) ? $g('상세배송지') : '',
                'message' => isset($h['배송메세지']) ? $g('배송메세지') : '',
                'pccc' => isset($h['개인통관고유부호']) ? $g('개인통관고유부호') : '',
                'bundle_key' => isset($h['배송비 묶음번호']) ? $g('배송비 묶음번호') : '',
                'source_order_key' => $order_key !== '' ? $order_key : $line_key,
                'source_line_key' => $line_key,
            ];
        }
        return $out;
    }

    /** Resolve a persistent mapping. Returns null if absent/invalid. */
    public static function resolve_mapping(string $marketplace, string $external_product_id, string $external_option_key): ?array {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$wpdb->prefix}wholesalehub_marketplace_mappings
             WHERE marketplace=%s AND external_product_id=%s AND external_option_key=%s AND is_active=1
             LIMIT 1",
            $marketplace,
            $external_product_id,
            $external_option_key
        ), ARRAY_A);
        if (!is_array($row)) {
            return null;
        }
        if (!self::validate_mapping_target((int) ($row['woo_product_id'] ?? 0), (int) ($row['woo_variation_id'] ?? 0))) {
            return ['stale' => true, 'mapping' => $row];
        }
        return ['stale' => false, 'mapping' => $row];
    }

    public static function validate_mapping_target(int $parent_id, int $variation_id): bool {
        if ($parent_id <= 0 || $variation_id <= 0) {
            return false;
        }
        $parent = wc_get_product($parent_id);
        $variation = wc_get_product($variation_id);
        if (!($parent instanceof WC_Product_Variable) || !($variation instanceof WC_Product_Variation)) {
            return false;
        }
        if ($variation->get_parent_id() !== $parent_id) {
            return false;
        }
        if ($parent->get_status() !== 'publish' || $variation->get_status() !== 'publish') {
            return false;
        }
        return $variation->is_purchasable() && $variation->is_in_stock();
    }

    public static function save_mapping(): void {
        if (!self::allowed() || !check_admin_referer(self::NONCE)) {
            wp_die('Forbidden', 403);
        }
        $marketplace = sanitize_key((string) ($_POST['marketplace'] ?? ''));
        $external_product_id = sanitize_text_field((string) ($_POST['external_product_id'] ?? ''));
        $external_option_key = sanitize_text_field((string) ($_POST['external_option_key'] ?? ''));
        $external_option_id = sanitize_text_field((string) ($_POST['external_option_id'] ?? ''));
        $external_seller_code = sanitize_text_field((string) ($_POST['external_seller_code'] ?? ''));
        $last_product_name = sanitize_textarea_field((string) ($_POST['last_product_name'] ?? ''));
        $last_option_name = sanitize_textarea_field((string) ($_POST['last_option_name'] ?? ''));
        $woo_variation_id = absint($_POST['woo_variation_id'] ?? 0);
        $woo_product_id = $woo_variation_id > 0 ? (int) wp_get_post_parent_id($woo_variation_id) : 0;
        $multiplier = max(1, absint($_POST['quantity_multiplier'] ?? 1));
        if (!in_array($marketplace, ['coupang', 'naver'], true) || $external_product_id === '' || $external_option_key === '' || $woo_variation_id <= 0) {
            wp_die('Invalid input', 400);
        }
        if (!self::validate_mapping_target($woo_product_id, $woo_variation_id)) {
            wp_die('Invalid Woo variation', 400);
        }
        global $wpdb;
        $now = current_time('mysql');
        $table = $wpdb->prefix . 'wholesalehub_marketplace_mappings';
        $existing = $wpdb->get_row($wpdb->prepare(
            "SELECT id FROM {$table} WHERE marketplace=%s AND external_product_id=%s AND external_option_key=%s LIMIT 1",
            $marketplace,
            $external_product_id,
            $external_option_key
        ), ARRAY_A);
        $data = [
            'marketplace' => $marketplace,
            'external_product_id' => $external_product_id,
            'external_option_key' => $external_option_key,
            'external_option_id' => $external_option_id,
            'external_seller_code' => $external_seller_code,
            'last_product_name' => $last_product_name,
            'last_option_name' => $last_option_name,
            'woo_product_id' => $woo_product_id,
            'woo_variation_id' => $woo_variation_id,
            'quantity_multiplier' => $multiplier,
            'is_active' => 1,
            'updated_at' => $now,
        ];
        if ($existing) {
            $wpdb->update($table, $data, ['id' => (int) $existing['id']]);
        } else {
            $data['created_at'] = $now;
            $wpdb->insert($table, $data);
        }
        wp_safe_redirect(wp_get_referer() ?: admin_url());
        exit;
    }

    /** Build standard bulk-engine rows from marketplace rows. */
    public static function to_standard_rows(array $marketplace_rows): array {
        $headers = ['주문코드', '수량', '수령인', '수령인연락처', '우편번호', '기본주소', '상세주소', '배송메시지', '고객주문번호'];
        $rows = [$headers];
        foreach ($marketplace_rows as $m) {
            $resolution = $m['resolution'] ?? null;
            if (!is_array($resolution) || $resolution['status'] !== 'AUTO_MATCHED') {
                continue;
            }
            $final_qty = (int) $m['quantity'] * (int) ($resolution['quantity_multiplier'] ?? 1);
            if ($final_qty < 1) {
                continue;
            }
            $rows[] = [
                'H' . (int) $resolution['woo_variation_id'],
                (string) $final_qty,
                (string) ($m['recipient'] ?? ''),
                (string) ($m['phone'] ?? ''),
                (string) ($m['postcode'] ?? ''),
                (string) ($m['address1'] ?? ''),
                (string) ($m['address2'] ?? ''),
                (string) ($m['message'] ?? ''),
                (string) ($m['source_order_key'] ?? ''),
            ];
        }
        return $rows;
    }

    public static function duplicate_source_orders(array $marketplace_rows): array {
        global $wpdb;
        $table = $wpdb->prefix . 'wholesalehub_marketplace_orders';
        $dupes = [];
        foreach ($marketplace_rows as $m) {
            $exists = $wpdb->get_var($wpdb->prepare(
                "SELECT COUNT(*) FROM {$table} WHERE marketplace=%s AND source_order_key=%s AND source_line_key=%s AND status IN ('SUBMITTED','COMPLETED')",
                $m['marketplace'],
                $m['source_order_key'],
                $m['source_line_key']
            ));
            if ((int) $exists > 0) {
                $dupes[] = $m;
            }
        }
        return $dupes;
    }

    public static function record_source_orders(array $marketplace_rows, int $batch_id): void {
        global $wpdb;
        $table = $wpdb->prefix . 'wholesalehub_marketplace_orders';
        $now = current_time('mysql');
        foreach ($marketplace_rows as $m) {
            $wpdb->query($wpdb->prepare(
                "INSERT IGNORE INTO {$table} (marketplace, source_order_key, source_line_key, batch_id, status, created_at)
                 VALUES (%s, %s, %s, %d, 'READY', %s)",
                $m['marketplace'],
                $m['source_order_key'],
                $m['source_line_key'],
                $batch_id,
                $now
            ));
        }
    }

    private static function header_index(array $headers): array {
        $map = [];
        foreach ($headers as $i => $h) {
            $map[$h] = $i;
        }
        return $map;
    }

    private static function int_or_zero(string $v): int {
        $digits = preg_replace('/[^0-9]/', '', $v);
        return $digits === '' ? 0 : (int) $digits;
    }

    private static function option_hash(string $option): string {
        return substr(hash('sha256', trim($option)), 0, 24);
    }

    private static function allowed(): bool {
        return is_user_logged_in() && ('approved' === get_user_meta(get_current_user_id(), '_avo_approval_status', true) || current_user_can('manage_woocommerce'));
    }
}
