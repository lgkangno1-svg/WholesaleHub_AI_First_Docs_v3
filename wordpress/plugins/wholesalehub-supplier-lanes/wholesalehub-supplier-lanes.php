<?php
/**
 * Plugin Name: WholesaleHub Supplier Lanes
 * Description: Independent privacy-safe A/B supplier lane checkout and Option A spec mapping for approved Woo variations.
 * Version: 1.4.0
 * Requires Plugins: woocommerce
 * Text Domain: wholesalehub-supplier-lanes
 */

defined('ABSPATH') || exit;

require_once __DIR__ . '/includes/class-wholesalehub-supplier-lane-approval.php';

final class WholesaleHub_Supplier_Lanes
{
    private const SCHEMA_VERSION = '1.4.0';
    private const ASSET_VERSION = '1.4.0';
    private const SCHEMA_OPTION = 'wh_supplier_lane_schema_version';
    private const MODE_META = '_wh_supplier_lane_mode';
    private const OFFER_KEY_FIELD = 'wh_public_offer_key';
    private const DISPATCH_NOTICE = '주문 후 1~2일 이내 출고 예정';
    private const SPLIT_NOTICE = '선택한 옵션에 따라 상품이 나누어 배송될 수 있습니다.';
    private const INTERNAL_META = [
        '_wh_internal_supplier_id',
        '_wh_source_product_id',
        '_wh_source_option_id',
        '_wh_lane_offer_id',
        '_wh_cost_at_order',
        '_wh_sale_price_at_order',
        '_wh_snapshot_hash',
        '_wh_pipeline_run_id',
        '_wh_shipping_snapshot',
    ];

    public static function boot(): void
    {
        add_action('plugins_loaded', [self::class, 'maybe_upgrade_schema'], 5);
        add_action('before_woocommerce_init', [self::class, 'declare_hpos_compatibility']);
        add_action('woocommerce_blocks_loaded', [self::class, 'register_store_api_data']);
        add_action('wp_enqueue_scripts', [self::class, 'enqueue_assets']);
        add_action('admin_enqueue_scripts', [self::class, 'enqueue_admin_assets']);
        add_action('admin_menu', [self::class, 'register_admin_menu']);
        add_action('admin_init', [self::class, 'handle_admin_actions']);
        add_action('woocommerce_variable_add_to_cart', [self::class, 'maybe_render_lane_forms'], 1);
        add_action('wp_loaded', [self::class, 'handle_add_to_cart'], 20);
        add_action('woocommerce_cart_calculate_fees', [self::class, 'calculate_supplier_shipping_fees'], 20);
        add_filter('woocommerce_add_cart_item_data', [self::class, 'preserve_cart_identity'], 10, 3);
        add_filter('woocommerce_get_item_data', [self::class, 'public_cart_item_data'], 10, 2);
        add_action(
            'woocommerce_checkout_create_order_line_item',
            [self::class, 'create_order_line_metadata'],
            10,
            4
        );
        add_filter('woocommerce_hidden_order_itemmeta', [self::class, 'hide_internal_order_metadata']);
        add_action('woocommerce_after_order_itemmeta', [self::class, 'render_admin_order_details'], 10, 3);
        add_filter('woocommerce_structured_data_product_offer', [self::class, 'filter_structured_offer'], 10, 2);
        add_action(
            'woocommerce_store_api_validate_add_to_cart',
            [self::class, 'store_api_validate_add_to_cart'],
            10,
            2
        );
        add_filter('woocommerce_store_api_add_to_cart_data', [self::class, 'store_api_cart_data'], 10, 2);
        add_filter('woocommerce_rest_prepare_shop_order_object', [self::class, 'filter_customer_order_response'], 10, 3);
        add_filter('woocommerce_email_order_meta_fields', [self::class, 'filter_email_order_meta_fields'], 10, 3);
        add_filter('woocommerce_order_item_get_formatted_meta_data', [self::class, 'filter_formatted_order_meta'], 10, 2);
        add_filter('woocommerce_get_price_html', [self::class, 'filter_archive_price_html'], 20, 2);
        add_filter('woocommerce_get_children', [self::class, 'filter_visible_children'], 20, 3);
    }

    public static function maybe_upgrade_schema(): void
    {
        if ((string) get_option(self::SCHEMA_OPTION, '') !== self::SCHEMA_VERSION) {
            self::install_schema();
        }
    }

    public static function install_schema(): void
    {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();
        $parent_links = $wpdb->prefix . 'supplier_lane_parent_links';
        $offers = $wpdb->prefix . 'supplier_lane_offers';
        $audit = $wpdb->prefix . 'supplier_lane_audit_history';
        $spec_mappings = $wpdb->prefix . 'supplier_lane_spec_mappings';

        dbDelta(
            "CREATE TABLE {$parent_links} (
              id bigint unsigned NOT NULL AUTO_INCREMENT,
              woo_parent_id bigint unsigned NOT NULL,
              supplier_id varchar(64) NOT NULL,
              lane_code varchar(1) NOT NULL,
              source_product_id varchar(191) NOT NULL,
              status varchar(32) NOT NULL DEFAULT 'pending',
              approved_by varchar(191) NULL,
              approved_at datetime NULL,
              created_at datetime NOT NULL,
              updated_at datetime NOT NULL,
              PRIMARY KEY  (id),
              UNIQUE KEY woo_parent_lane (woo_parent_id,lane_code),
              UNIQUE KEY source_identity (supplier_id,source_product_id),
              KEY approved_source (supplier_id,source_product_id,status)
            ) {$charset};"
        );
        dbDelta(
            "CREATE TABLE {$offers} (
              id bigint unsigned NOT NULL AUTO_INCREMENT,
              parent_link_id bigint unsigned NOT NULL,
              supplier_id varchar(64) NOT NULL,
              lane_code varchar(1) NOT NULL,
              source_product_id varchar(191) NOT NULL,
              source_option_id varchar(191) NOT NULL,
              atomic_supplier_sku_id varchar(191) NOT NULL,
              woo_parent_id bigint unsigned NOT NULL,
              woo_variation_id bigint unsigned NULL,
              public_offer_key varchar(191) NOT NULL,
              public_option_label varchar(191) NOT NULL,
              option_label_raw varchar(191) NOT NULL,
              hard_spec_fingerprint varchar(191) NOT NULL,
              source_cost decimal(18,2) NOT NULL,
              source_shipping_cost decimal(18,2) NOT NULL,
              landed_cost decimal(18,2) NOT NULL,
              sale_price decimal(18,2) NOT NULL,
              stock_status varchar(32) NOT NULL,
              approval_status varchar(32) NOT NULL DEFAULT 'pending',
              lifecycle_status varchar(32) NOT NULL DEFAULT 'active',
              last_snapshot_hash varchar(64) NOT NULL,
              last_complete_run_id varchar(191) NOT NULL,
              last_seen_at datetime NOT NULL,
              missing_complete_count int unsigned NOT NULL DEFAULT 0,
              shipping_policy_json longtext NULL,
              created_at datetime NOT NULL,
              updated_at datetime NOT NULL,
              PRIMARY KEY  (id),
              UNIQUE KEY source_option (supplier_id,source_product_id,source_option_id),
              UNIQUE KEY public_offer_key (public_offer_key),
              UNIQUE KEY woo_variation_id (woo_variation_id),
              KEY parent_projection (woo_parent_id,lane_code,approval_status,lifecycle_status)
            ) {$charset};"
        );
        dbDelta(
            "CREATE TABLE {$audit} (
              id bigint unsigned NOT NULL AUTO_INCREMENT,
              entity_type varchar(32) NOT NULL,
              entity_id bigint unsigned NOT NULL,
              action varchar(64) NOT NULL,
              actor varchar(191) NOT NULL,
              detail_json longtext NOT NULL,
              created_at datetime NOT NULL,
              PRIMARY KEY  (id),
              KEY audit_entity (entity_type,entity_id,created_at)
            ) {$charset};"
        );
        dbDelta(
            "CREATE TABLE {$spec_mappings} (
              id bigint unsigned NOT NULL AUTO_INCREMENT,
              woo_variation_id bigint unsigned NOT NULL,
              woo_parent_id bigint unsigned NOT NULL,
              public_offer_key varchar(191) NOT NULL,
              option_label_raw varchar(191) NOT NULL,
              option_raw_hash varchar(64) NOT NULL,
              auto_analysis_json longtext NOT NULL,
              final_spec_json longtext NOT NULL,
              weight_val decimal(18,3) NULL,
              weight_unit varchar(16) NULL,
              count_val int unsigned NULL,
              count_unit varchar(16) NULL,
              grade_size varchar(64) NULL,
              packaging varchar(64) NULL,
              variety varchar(64) NULL,
              origin varchar(64) NULL,
              storage_type varchar(32) NULL,
              comparison_group varchar(128) NULL,
              confidence decimal(5,2) NOT NULL DEFAULT 0.00,
              status varchar(32) NOT NULL DEFAULT 'review_required',
              last_analyzed_at datetime NOT NULL,
              created_at datetime NOT NULL,
              updated_at datetime NOT NULL,
              PRIMARY KEY  (id),
              UNIQUE KEY woo_variation_id (woo_variation_id),
              KEY woo_parent_status (woo_parent_id,status),
              KEY public_offer_key (public_offer_key),
              KEY status (status)
            ) {$charset};"
        );
        WholesaleHub_Supplier_Lane_Approval::install_schema();
        update_option(self::SCHEMA_OPTION, self::SCHEMA_VERSION);
    }

    public static function declare_hpos_compatibility(): void
    {
        if (class_exists(\Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
            \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
                'custom_order_tables',
                __FILE__,
                true
            );
            \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
                'cart_checkout_blocks',
                __FILE__,
                true
            );
        }
    }

    public static function register_store_api_data(): void
    {
        if (!function_exists('woocommerce_store_api_register_endpoint_data')) {
            return;
        }
        woocommerce_store_api_register_endpoint_data([
            'endpoint' => \Automattic\WooCommerce\StoreApi\Schemas\V1\CartItemSchema::IDENTIFIER,
            'namespace' => 'wholesalehub_supplier_lanes',
            'schema_callback' => static fn(): array => [
                'lane_label' => [
                    'description' => 'Public supplier lane label.',
                    'type' => ['string', 'null'],
                    'readonly' => true,
                ],
                'option_label' => [
                    'description' => 'Public option label.',
                    'type' => ['string', 'null'],
                    'readonly' => true,
                ],
            ],
            'data_callback' => static function (array $cart_item): array {
                $public = self::public_projection($cart_item);
                return $public === null
                    ? ['lane_label' => null, 'option_label' => null]
                    : $public;
            },
            'schema_type' => ARRAY_A,
        ]);
    }

    public static function enqueue_assets(): void
    {
        if (!is_product()) {
            return;
        }
        wp_enqueue_style(
            'wholesalehub-supplier-lanes',
            plugins_url('assets/supplier-lanes.css', __FILE__),
            [],
            self::ASSET_VERSION
        );
        wp_enqueue_script(
            'wholesalehub-supplier-lanes',
            plugins_url('assets/supplier-lanes.js', __FILE__),
            [],
            self::ASSET_VERSION,
            true
        );
    }

    public static function enqueue_admin_assets(string $hook): void
    {
        if (!str_contains($hook, 'wh-spec-mapping')) {
            return;
        }
        wp_enqueue_style(
            'wholesalehub-supplier-lanes-admin',
            plugins_url('assets/supplier-lanes.css', __FILE__),
            [],
            self::SCHEMA_VERSION
        );
    }

    public static function register_admin_menu(): void
    {
        add_submenu_page(
            'woocommerce',
            '상품 규격 매핑',
            '상품 규격 매핑',
            'manage_woocommerce',
            'wh-spec-mapping',
            [self::class, 'render_admin_spec_mapping_page']
        );
    }

    public static function parse_spec_label(string $label): array
    {
        $raw_label = trim($label);
        $weight_val = null;
        $weight_unit = null;
        $count_val = null;
        $count_unit = null;
        $grade_size = null;
        $packaging = null;
        $variety = null;
        $origin = null;
        $storage_type = null;

        if (preg_match('/([\d\.]+)\s*(kg|킬로|키로|g|그램)/iu', $raw_label, $m)) {
            $val = (float) $m[1];
            $unit_raw = strtolower($m[2]);
            if ($unit_raw === 'g' || $unit_raw === '그램') {
                $weight_val = $val;
                $weight_unit = 'g';
            } else {
                $weight_val = $val;
                $weight_unit = 'kg';
            }
        }

        if (preg_match(
            '/([\d\.]+)(?:\s*[~\-–]\s*[\d\.]+)?\s*(개입|개|입|과수?|송이|수)(?:\s*(?:내외|전후|이상|이하))?/u',
            $raw_label,
            $m
        )) {
            $count_val = (int) $m[1];
            $unit_raw = $m[2];
            if ($unit_raw === '개입' || $unit_raw === '입') {
                $count_unit = '개';
            } elseif ($unit_raw === '과수') {
                $count_unit = '과';
            } else {
                $count_unit = $unit_raw;
            }
        }

        if (preg_match(
            '/(왕특과|왕특품|왕특|특대과|특대|특A품|특A|특품|특과|꼬마과|꼬마|중대과|중대|중소과|중소|소과|소품|중과|중품|대과|대품|선물용|정품|못난이|프리미엄)/u',
            $raw_label,
            $m
        )) {
            $g = $m[1];
            if (in_array($g, ['왕특과', '왕특품', '왕특', '특대과', '특대'], true)) {
                $grade_size = '왕특';
            } elseif (in_array($g, ['특품', '특과', '특A품', '특A'], true)) {
                $grade_size = '특';
            } elseif (in_array($g, ['꼬마과', '꼬마'], true)) {
                $grade_size = '꼬마';
            } elseif (in_array($g, ['중대과', '중대'], true)) {
                $grade_size = '중대';
            } elseif (in_array($g, ['중소과', '중소'], true)) {
                $grade_size = '중소';
            } elseif (in_array($g, ['대과', '대품'], true)) {
                $grade_size = '대';
            } elseif (in_array($g, ['중과', '중품'], true)) {
                $grade_size = '중';
            } elseif (in_array($g, ['소과', '소품'], true)) {
                $grade_size = '소';
            } else {
                $grade_size = $g;
            }
        } elseif (preg_match('/(?:^|[\s\(\)\[\]\,])(특|대|중|소)(?:$|[\s\(\)\[\]\,])/u', $raw_label, $m)) {
            $g = $m[1];
            if ($g === '특') $grade_size = '특';
            elseif ($g === '대') $grade_size = '대';
            elseif ($g === '중') $grade_size = '중';
            elseif ($g === '소') $grade_size = '소';
        }

        if (preg_match('/(팩|봉|박스|망)/u', $raw_label, $m)) {
            $packaging = $m[1];
        }

        if (preg_match('/(국내산|국산|제주산|성주산|미국산|중국산|수입산)/u', $raw_label, $m)) {
            $origin = ($m[1] === '국산') ? '국내산' : $m[1];
        }

        if (preg_match('/(냉장|냉동|상온)/u', $raw_label, $m)) {
            $storage_type = $m[1];
        }

        if (preg_match('/(신비복숭아|성주참외|홍감자|찰옥수수|망고스틴|무지개망고)/u', $raw_label, $m)) {
            $variety = $m[1];
        }

        $key_parts = [];
        if ($grade_size) $key_parts[] = $grade_size;
        if ($weight_val !== null) {
            $formatted = (floor($weight_val) == $weight_val) ? (int) $weight_val : $weight_val;
            $key_parts[] = $formatted . ($weight_unit ?? 'kg');
        }
        if ($count_val !== null) {
            $key_parts[] = $count_val . ($count_unit ?? '개');
        }
        if ($packaging) $key_parts[] = $packaging;
        if ($variety) $key_parts[] = $variety;

        $comparison_group = !empty($key_parts) ? implode(' ', $key_parts) : $raw_label;
        $confidence = ($grade_size !== null || $weight_val !== null || $count_val !== null) ? 0.95 : 0.50;
        $status = ($confidence >= 0.85) ? 'auto_approved' : 'review_required';

        return [
            'weight_val' => $weight_val,
            'weight_unit' => $weight_unit,
            'count_val' => $count_val,
            'count_unit' => $count_unit,
            'grade_size' => $grade_size,
            'packaging' => $packaging,
            'variety' => $variety,
            'origin' => $origin,
            'storage_type' => $storage_type,
            'comparison_group' => $comparison_group,
            'confidence' => $confidence,
            'status' => $status,
        ];
    }

    public static function ensure_spec_mappings_for_parent(int $parent_id): array
    {
        global $wpdb;
        $spec_table = $wpdb->prefix . 'supplier_lane_spec_mappings';
        $offers_table = $wpdb->prefix . 'supplier_lane_offers';

        $offers = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT woo_variation_id, public_offer_key, public_option_label, option_label_raw
                 FROM {$offers_table}
                 WHERE woo_parent_id = %d
                   AND approval_status = 'approved'
                   AND lifecycle_status = 'active'
                   AND woo_variation_id IS NOT NULL",
                $parent_id
            ),
            ARRAY_A
        );

        if (!is_array($offers)) {
            return [];
        }

        $now = current_time('mysql');
        $approved_specs = [];

        foreach ($offers as $offer) {
            $var_id = (int) $offer['woo_variation_id'];
            $existing = $wpdb->get_row(
                $wpdb->prepare("SELECT * FROM {$spec_table} WHERE woo_variation_id = %d", $var_id),
                ARRAY_A
            );

            if ($existing && $existing['status'] === 'manual_approved') {
                $approved_specs[$var_id] = $existing;
                continue;
            }

            $label = trim((string) ($offer['option_label_raw'] ?: $offer['public_option_label']));
            $parsed = self::parse_spec_label($label);
            $hash = hash('sha256', $label);
            $auto_json = wp_json_encode($parsed);
            $final_json = $auto_json;

            if ($existing) {
                $wpdb->update(
                    $spec_table,
                    [
                        'woo_parent_id' => $parent_id,
                        'public_offer_key' => $offer['public_offer_key'],
                        'option_label_raw' => $label,
                        'option_raw_hash' => $hash,
                        'auto_analysis_json' => $auto_json,
                        'final_spec_json' => $final_json,
                        'weight_val' => $parsed['weight_val'],
                        'weight_unit' => $parsed['weight_unit'],
                        'count_val' => $parsed['count_val'],
                        'count_unit' => $parsed['count_unit'],
                        'grade_size' => $parsed['grade_size'],
                        'packaging' => $parsed['packaging'],
                        'variety' => $parsed['variety'],
                        'origin' => $parsed['origin'],
                        'storage_type' => $parsed['storage_type'],
                        'comparison_group' => $parsed['comparison_group'],
                        'confidence' => $parsed['confidence'],
                        'status' => $parsed['status'],
                        'last_analyzed_at' => $now,
                        'updated_at' => $now,
                    ],
                    ['woo_variation_id' => $var_id]
                );
            } else {
                $wpdb->insert(
                    $spec_table,
                    [
                        'woo_variation_id' => $var_id,
                        'woo_parent_id' => $parent_id,
                        'public_offer_key' => $offer['public_offer_key'],
                        'option_label_raw' => $label,
                        'option_raw_hash' => $hash,
                        'auto_analysis_json' => $auto_json,
                        'final_spec_json' => $final_json,
                        'weight_val' => $parsed['weight_val'],
                        'weight_unit' => $parsed['weight_unit'],
                        'count_val' => $parsed['count_val'],
                        'count_unit' => $parsed['count_unit'],
                        'grade_size' => $parsed['grade_size'],
                        'packaging' => $parsed['packaging'],
                        'variety' => $parsed['variety'],
                        'origin' => $parsed['origin'],
                        'storage_type' => $parsed['storage_type'],
                        'comparison_group' => $parsed['comparison_group'],
                        'confidence' => $parsed['confidence'],
                        'status' => $parsed['status'],
                        'last_analyzed_at' => $now,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]
                );
            }

            $current = $wpdb->get_row(
                $wpdb->prepare("SELECT * FROM {$spec_table} WHERE woo_variation_id = %d", $var_id),
                ARRAY_A
            );

            if ($current && in_array($current['status'], ['auto_approved', 'manual_approved'], true)) {
                $approved_specs[$var_id] = $current;
            }
        }

        return $approved_specs;
    }

    public static function handle_admin_actions(): void
    {
        if (
            ($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST'
            || !isset($_POST['wh_spec_action'])
            || !current_user_can('manage_woocommerce')
        ) {
            return;
        }

        check_admin_referer('wh_spec_mapping_action', 'wh_spec_nonce');
        global $wpdb;
        $spec_table = $wpdb->prefix . 'supplier_lane_spec_mappings';
        $action = sanitize_key($_POST['wh_spec_action']);
        $now = current_time('mysql');

        if ($action === 'save_single' && isset($_POST['variation_id'])) {
            $var_id = absint($_POST['variation_id']);
            $weight_val = isset($_POST['weight_val']) && $_POST['weight_val'] !== '' ? (float) $_POST['weight_val'] : null;
            $weight_unit = sanitize_text_field(wp_unslash($_POST['weight_unit'] ?? ''));
            $count_val = isset($_POST['count_val']) && $_POST['count_val'] !== '' ? absint($_POST['count_val']) : null;
            $count_unit = sanitize_text_field(wp_unslash($_POST['count_unit'] ?? ''));
            $grade_size = sanitize_text_field(wp_unslash($_POST['grade_size'] ?? ''));
            $packaging = sanitize_text_field(wp_unslash($_POST['packaging'] ?? ''));
            $variety = sanitize_text_field(wp_unslash($_POST['variety'] ?? ''));
            $origin = sanitize_text_field(wp_unslash($_POST['origin'] ?? ''));
            $storage_type = sanitize_text_field(wp_unslash($_POST['storage_type'] ?? ''));
            $comparison_group = sanitize_text_field(wp_unslash($_POST['comparison_group'] ?? ''));
            $status = sanitize_text_field(wp_unslash($_POST['status'] ?? 'manual_approved'));

            $final_data = [
                'weight_val' => $weight_val,
                'weight_unit' => $weight_unit ?: null,
                'count_val' => $count_val,
                'count_unit' => $count_unit ?: null,
                'grade_size' => $grade_size ?: null,
                'packaging' => $packaging ?: null,
                'variety' => $variety ?: null,
                'origin' => $origin ?: null,
                'storage_type' => $storage_type ?: null,
                'comparison_group' => $comparison_group ?: null,
            ];

            $wpdb->update(
                $spec_table,
                array_merge($final_data, [
                    'final_spec_json' => wp_json_encode($final_data),
                    'status' => $status,
                    'updated_at' => $now,
                ]),
                ['woo_variation_id' => $var_id]
            );
        } elseif (in_array($action, ['bulk_approve', 'bulk_group', 'bulk_split', 'bulk_reanalyze'], true) && isset($_POST['var_ids']) && is_array($_POST['var_ids'])) {
            $var_ids = array_map('absint', $_POST['var_ids']);
            if ($action === 'bulk_approve') {
                foreach ($var_ids as $vid) {
                    $wpdb->update($spec_table, ['status' => 'manual_approved', 'updated_at' => $now], ['woo_variation_id' => $vid]);
                }
            } elseif ($action === 'bulk_group' && !empty($var_ids)) {
                $target_group = sanitize_text_field(wp_unslash($_POST['group_name'] ?? ''));
                if ($target_group === '') {
                    $first = $wpdb->get_row($wpdb->prepare("SELECT comparison_group FROM {$spec_table} WHERE woo_variation_id = %d", $var_ids[0]), ARRAY_A);
                    $target_group = $first['comparison_group'] ?? '그룹 1';
                }
                foreach ($var_ids as $vid) {
                    $wpdb->update($spec_table, ['comparison_group' => $target_group, 'status' => 'manual_approved', 'updated_at' => $now], ['woo_variation_id' => $vid]);
                }
            } elseif ($action === 'bulk_split') {
                foreach ($var_ids as $vid) {
                    $row = $wpdb->get_row($wpdb->prepare("SELECT option_label_raw FROM {$spec_table} WHERE woo_variation_id = %d", $vid), ARRAY_A);
                    $new_group = ($row['option_label_raw'] ?? '규격') . '-' . $vid;
                    $wpdb->update($spec_table, ['comparison_group' => $new_group, 'status' => 'manual_approved', 'updated_at' => $now], ['woo_variation_id' => $vid]);
                }
            } elseif ($action === 'bulk_reanalyze') {
                foreach ($var_ids as $vid) {
                    $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$spec_table} WHERE woo_variation_id = %d", $vid), ARRAY_A);
                    if ($row && $row['status'] !== 'manual_approved') {
                        $parsed = self::parse_spec_label($row['option_label_raw']);
                        $wpdb->update($spec_table, array_merge($parsed, [
                            'auto_analysis_json' => wp_json_encode($parsed),
                            'final_spec_json' => wp_json_encode($parsed),
                            'last_analyzed_at' => $now,
                            'updated_at' => $now,
                        ]), ['woo_variation_id' => $vid]);
                    }
                }
            }
        }

        wp_safe_redirect(admin_url('admin.php?page=wh-spec-mapping&updated=1'));
        exit;
    }

    public static function render_admin_spec_mapping_page(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            return;
        }

        global $wpdb;
        $spec_table = $wpdb->prefix . 'supplier_lane_spec_mappings';
        $offers_table = $wpdb->prefix . 'supplier_lane_offers';

        $status_filter = isset($_GET['status_filter']) ? sanitize_key($_GET['status_filter']) : 'all';
        $search = isset($_GET['s']) ? sanitize_text_field(wp_unslash($_GET['s'])) : '';

        $where = ['1=1'];
        $params = [];

        if ($status_filter !== 'all') {
            $where[] = 's.status = %s';
            $params[] = $status_filter;
        }

        if ($search !== '') {
            $where[] = '(s.option_label_raw LIKE %s OR s.woo_parent_id = %d OR p.post_title LIKE %s)';
            $params[] = '%' . $wpdb->esc_like($search) . '%';
            $params[] = (int) $search;
            $params[] = '%' . $wpdb->esc_like($search) . '%';
        }

        $where_sql = implode(' AND ', $where);
        $posts_table = $wpdb->posts;

        $sql = "SELECT s.*, o.lane_code, p.post_title AS parent_title
                FROM {$spec_table} s
                LEFT JOIN {$offers_table} o ON o.woo_variation_id = s.woo_variation_id
                LEFT JOIN {$posts_table} p ON p.ID = s.woo_parent_id
                WHERE {$where_sql}
                ORDER BY s.woo_parent_id DESC, s.id ASC";

        $rows = !empty($params) ? $wpdb->get_results($wpdb->prepare($sql, $params), ARRAY_A) : $wpdb->get_results($sql, ARRAY_A);

        echo '<div class="wrap"><h1>상품 규격 매핑 (WholesaleHub Option A)</h1>';
        if (isset($_GET['updated'])) {
            echo '<div class="updated notice is-dismissible"><p>설정이 저장되었습니다.</p></div>';
        }

        echo '<ul class="subsubsub">';
        $statuses = [
            'all' => '전체',
            'auto_approved' => '자동 승인',
            'review_required' => '검토 필요',
            'manual_approved' => '수동 확정',
            'excluded' => '비교 제외',
        ];
        foreach ($statuses as $key => $label) {
            $class = ($status_filter === $key) ? 'current' : '';
            $url = admin_url('admin.php?page=wh-spec-mapping' . ($key !== 'all' ? '&status_filter=' . $key : ''));
            echo '<li><a href="' . esc_url($url) . '" class="' . esc_attr($class) . '">' . esc_html($label) . '</a> | </li>';
        }
        echo '</ul>';

        echo '<form method="get" style="margin-block: 1rem;">';
        echo '<input type="hidden" name="page" value="wh-spec-mapping">';
        if ($status_filter !== 'all') echo '<input type="hidden" name="status_filter" value="' . esc_attr($status_filter) . '">';
        echo '<input type="search" name="s" value="' . esc_attr($search) . '" placeholder="상품명 또는 parent ID 검색">';
        echo ' <button type="submit" class="button">검색</button></form>';

        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('wh_spec_mapping_action', 'wh_spec_nonce');

        echo '<div class="tablenav top"><div class="alignleft actions bulkactions">';
        echo '<select name="wh_spec_action" id="bulk-action-selector-top">';
        echo '<option value="-1">일괄 작업 선택</option>';
        echo '<option value="bulk_approve">선택 항목 일괄 승인</option>';
        echo '<option value="bulk_group">선택 항목 같은 규격으로 묶기</option>';
        echo '<option value="bulk_split">선택 항목 다른 규격으로 분리</option>';
        echo '<option value="bulk_reanalyze">AI/규칙 재분석</option>';
        echo '</select>';
        echo ' <input type="text" name="group_name" placeholder="그룹명 (묶기 선택시)" style="width: 150px;">';
        echo ' <button type="submit" class="button action">적용</button>';
        echo '</div></div>';

        echo '<table class="wp-list-table widefat fixed striped">';
        echo '<thead><tr>';
        echo '<td class="manage-column column-cb check-column"><input type="checkbox" id="cb-select-all-1"></td>';
        echo '<th>Parent ID / 상품명</th><th>판매조건</th><th>Var ID</th><th>원본 옵션명</th><th>자동 분석</th><th>최종 확정 규격</th><th>Confidence</th><th>상태</th><th>수정 / 승인</th>';
        echo '</tr></thead><tbody>';

        if (empty($rows)) {
            echo '<tr><td colspan="10">매핑 데이터가 없습니다.</td></tr>';
        } else {
            foreach ($rows as $row) {
                $vid = (int) $row['woo_variation_id'];
                echo '<tr>';
                echo '<th scope="row" class="check-column"><input type="checkbox" name="var_ids[]" value="' . $vid . '"></th>';
                echo '<td><strong>' . (int) $row['woo_parent_id'] . '</strong><br>' . esc_html($row['parent_title'] ?? '') . '</td>';
                echo '<td>판매조건 ' . esc_html($row['lane_code'] ?? '-') . '</td>';
                echo '<td>' . $vid . '</td>';
                echo '<td>' . esc_html($row['option_label_raw']) . '</td>';
                echo '<td><small>' . esc_html($row['comparison_group'] ?? '-') . '</small></td>';
                echo '<td>';
                echo '<input type="text" name="comparison_group_' . $vid . '" value="' . esc_attr($row['comparison_group'] ?? '') . '" style="width:100%;"><br>';
                echo '<small>중량: <input type="text" name="weight_val_' . $vid . '" value="' . esc_attr($row['weight_val'] ?? '') . '" style="width:40px;">';
                echo '<input type="text" name="weight_unit_' . $vid . '" value="' . esc_attr($row['weight_unit'] ?? '') . '" style="width:30px;"></small> ';
                echo '<small>개수: <input type="text" name="count_val_' . $vid . '" value="' . esc_attr($row['count_val'] ?? '') . '" style="width:40px;"></small>';
                echo '</td>';
                echo '<td>' . esc_html((string) $row['confidence']) . '</td>';
                echo '<td><span class="wh-status-badge status-' . esc_attr($row['status']) . '">' . esc_html($row['status']) . '</span></td>';
                echo '<td>';
                echo '<button type="submit" name="save_single_btn" value="' . $vid . '" class="button button-small button-primary">저장</button>';
                echo '</td>';
                echo '</tr>';
            }
        }

        echo '</tbody></table></form></div>';
    }

    public static function maybe_render_lane_forms(): void
    {
        global $product;
        if (!($product instanceof WC_Product_Variable) || $product->get_meta(self::MODE_META) !== '1') {
            return;
        }
        remove_action('woocommerce_variable_add_to_cart', 'woocommerce_variable_add_to_cart', 30);

        $parent_id = (int) $product->get_id();
        $offers = self::public_offers($parent_id);
        if (empty($offers)) {
            echo '<p class="stock out-of-stock">' . esc_html__('품절', 'wholesalehub-supplier-lanes') . '</p>';
            return;
        }

        $approved_specs = self::ensure_spec_mappings_for_parent($parent_id);
        if (empty($approved_specs)) {
            self::render_fallback_lane_forms($product, $offers);
        } else {
            self::render_option_a_ui($product, $offers, $approved_specs);
        }
    }

    private static function render_fallback_lane_forms(WC_Product_Variable $product, array $offers): void
    {
        $lanes = [
            'A' => array_values(array_filter($offers, static fn(array $offer): bool => $offer['lane'] === 'A')),
            'B' => array_values(array_filter($offers, static fn(array $offer): bool => $offer['lane'] === 'B')),
        ];
        $description_id = 'wh-lane-notices-' . (int) $product->get_id();
        echo '<section class="wh-supplier-lanes" aria-labelledby="wh-lane-title-' . (int) $product->get_id() . '">';
        echo '<h2 class="screen-reader-text" id="wh-lane-title-' . (int) $product->get_id() . '">';
        echo esc_html__('구매 옵션', 'wholesalehub-supplier-lanes') . '</h2>';
        echo '<p class="wh-lane-dispatch" id="' . esc_attr($description_id) . '">';
        echo esc_html(self::DISPATCH_NOTICE) . '</p>';
        echo '<div class="wh-lane-grid">';
        foreach (['A', 'B'] as $lane) {
            if ($lanes[$lane] !== []) {
                self::render_lane_card($lane, $lanes[$lane], (int) $product->get_id(), $description_id);
            }
        }
        echo '</div><p class="wh-lane-split-notice">' . esc_html(self::SPLIT_NOTICE) . '</p></section>';
    }

    private static function render_option_a_ui(WC_Product_Variable $product, array $offers, array $spec_mappings): void
    {
        $parent_id = (int) $product->get_id();
        $description_id = 'wh-option-a-notice-' . $parent_id;

        $spec_offers = [];

        foreach ($offers as $offer) {
            $vid = (int) $offer['variation_id'];
            $spec = $spec_mappings[$vid] ?? null;
            if (!$spec || !in_array($spec['status'], ['auto_approved', 'manual_approved'], true)) {
                continue;
            }
            $price = (float) $offer['price'];
            $source_label = sanitize_text_field(
                (string) ($offer['source_label'] ?: $offer['label'])
            );
            $weight_val = $spec['weight_val'] !== null ? (float) $spec['weight_val'] : null;
            $weight_unit = (string) ($spec['weight_unit'] ?? 'kg');
            $weight_g = null;
            if ($weight_val !== null) {
                $weight_g = $weight_unit === 'g' ? $weight_val : $weight_val * 1000;
            }
            $count_val = $spec['count_val'] !== null ? (int) $spec['count_val'] : null;
            $normalized = [
                'grade' => sanitize_text_field((string) ($spec['grade_size'] ?? '')),
                'weight' => $weight_g !== null ? self::format_spec_number($weight_g) : '',
                'count' => $count_val !== null ? (string) $count_val : '',
                'package' => sanitize_text_field((string) ($spec['packaging'] ?? '')),
            ];
            $display = [
                'grade' => $normalized['grade'],
                'weight' => $weight_val !== null
                    ? self::format_spec_number($weight_val) . $weight_unit
                    : '',
                'count' => $count_val !== null
                    ? $count_val . (string) ($spec['count_unit'] ?? '개')
                    : '',
                'package' => $normalized['package'],
            ];
            if (preg_match(
                '/[\d\.]+(?:\s*[~\-–]\s*[\d\.]+)?\s*(?:개입|개|입|과수?|송이|수)(?:\s*(?:내외|전후|이상|이하))?/u',
                $source_label,
                $count_match
            )) {
                $display['count'] = $count_match[0];
            }
            if (preg_match(
                '/(왕특과|왕특품|왕특|특대과|특대|특품|특과|꼬마과|꼬마|중대과|중소과|소과|소품|중과|중품|대과|대품)/u',
                $source_label,
                $grade_match
            )) {
                $display['grade'] = $grade_match[1];
            }

            $unit_price_str = null;
            if ($weight_g !== null && $weight_g > 0) {
                $unit_kg_price = $price / ($weight_g / 1000);
                $unit_price_str = '1kg당 ' . wp_strip_all_tags(wc_price($unit_kg_price));
            } elseif ($count_val !== null && $count_val > 0) {
                $unit_item_price = $price / $count_val;
                $unit_price_str = '1개당 ' . wp_strip_all_tags(wc_price($unit_item_price));
            }

            $spec_offers[] = array_merge($offer, [
                'normalized' => $normalized,
                'display' => $display,
                'spec_label' => $source_label,
                'unit_price_str' => $unit_price_str,
            ]);
        }

        if (empty($spec_offers)) {
            self::render_fallback_lane_forms($product, $offers);
            return;
        }

        usort($spec_offers, [self::class, 'sort_normalized_spec_offers']);
        $lanes = array_values(array_unique(array_column($spec_offers, 'lane')));
        $mode = count($spec_offers) === 1
            ? 'single-offer'
            : (count($lanes) === 1 ? 'single-supplier' : 'multi-supplier');
        $dimensions = self::varying_spec_dimensions($spec_offers);

        echo '<section class="wh-supplier-lanes wh-option-a-ui" id="wh-option-a-sec-' . $parent_id . '" ';
        echo 'data-ui-mode="' . esc_attr($mode) . '" data-dimensions="';
        echo esc_attr(wp_json_encode($dimensions)) . '">';
        if ($mode !== 'single-offer') {
            echo '<div class="wh-spec-heading">';
        }
        if ($mode === 'single-supplier') {
            echo '<h2>규격 선택</h2>';
        } elseif ($mode === 'multi-supplier') {
            echo '<h2>원하는 규격을 선택하세요</h2>';
        } else {
            echo '<h2 class="screen-reader-text">구매 옵션</h2>';
        }
        if ($mode !== 'single-offer') {
            echo '<button type="button" class="wh-selection-reset">선택 초기화</button></div>';
        }
        echo '<p class="wh-lane-dispatch" id="' . esc_attr($description_id) . '">' . esc_html(self::DISPATCH_NOTICE) . '</p>';

        if ($mode === 'single-supplier') {
            $select_id = 'wh-spec-dropdown-' . $parent_id;
            echo '<div class="wh-spec-dropdown-wrap">';
            if (count($spec_offers) >= 15) {
                $listbox_id = $select_id . '-listbox';
                echo '<span class="wh-spec-picker-label">규격 선택</span>';
                echo '<button type="button" class="wh-spec-listbox-toggle" aria-haspopup="listbox" ';
                echo 'aria-expanded="false" aria-controls="' . esc_attr($listbox_id) . '">';
                echo '<span>규격을 선택하세요</span></button>';
                echo '<ul class="wh-spec-listbox" id="' . esc_attr($listbox_id) . '" role="listbox" hidden>';
                foreach ($spec_offers as $offer) {
                    $plain_price = wp_strip_all_tags(wc_price((float) $offer['price']));
                    $option_text = $offer['spec_label'] . ' — ' . $plain_price;
                    echo '<li role="option" tabindex="-1" aria-selected="false" ';
                    echo 'data-offer-key="' . esc_attr($offer['key']) . '" ';
                    echo 'data-variation-id="' . (int) $offer['variation_id'] . '" ';
                    echo 'data-label="' . esc_attr($option_text) . '">';
                    echo esc_html($option_text) . '</li>';
                }
                echo '</ul>';
            } else {
                echo '<label for="' . esc_attr($select_id) . '">규격 선택</label>';
                echo '<select class="wh-spec-dropdown" id="' . esc_attr($select_id) . '">';
                echo '<option value="">규격을 선택하세요</option>';
                foreach ($spec_offers as $offer) {
                    $plain_price = wp_strip_all_tags(wc_price((float) $offer['price']));
                    echo '<option value="' . esc_attr($offer['key']) . '" ';
                    echo 'data-variation-id="' . (int) $offer['variation_id'] . '" ';
                    echo 'data-public-offer-key="' . esc_attr($offer['key']) . '">';
                    echo esc_html($offer['spec_label'] . ' — ' . $plain_price) . '</option>';
                }
                echo '</select>';
            }
            echo '</div>';
        } elseif ($mode === 'multi-supplier' && $dimensions !== []) {
            $dimension_labels = [
                'grade' => '크기/등급',
                'weight' => '중량',
                'count' => '개수',
                'package' => '포장',
            ];
            echo '<div class="wh-spec-filters">';
            foreach ($dimensions as $dimension) {
                echo '<fieldset class="wh-spec-filter-group" data-dimension="' . esc_attr($dimension) . '" hidden>';
                echo '<legend>' . esc_html($dimension_labels[$dimension]) . '</legend><div class="wh-pills">';
                foreach (self::dimension_options($spec_offers, $dimension) as $value => $label) {
                    echo '<button type="button" class="wh-spec-pill" data-dim="' . esc_attr($dimension) . '" ';
                    echo 'data-val="' . esc_attr($value) . '" aria-pressed="false">' . esc_html($label) . '</button>';
                }
                echo '</div></fieldset>';
            }
            echo '</div>';
        }

        $status_text = $mode === 'single-offer'
            ? ''
            : '원하는 규격을 선택하면 구매 가능한 판매조건을 보여드립니다.';
        echo '<p class="wh-selection-status" aria-live="polite">' . esc_html($status_text) . '</p>';
        echo '<div class="wh-offer-results" aria-live="polite">';
        foreach ($spec_offers as $offer) {
            self::render_spec_offer_card($offer, $parent_id, $description_id, $mode === 'single-offer');
        }
        echo '</div>';
        if (array_filter($spec_offers, static fn(array $offer): bool => $offer['normalized']['grade'] !== '')) {
            echo '<p class="wh-grade-substitution-notice">※ 선택하신 규격이 품절될 경우, 동일 중량 기준 상위 규격(더 큰 사이즈) 상품으로 변경되어 발송될 수 있습니다.</p>';
        }
        echo '<p class="wh-lane-split-notice">' . esc_html(self::SPLIT_NOTICE) . '</p>';
        echo '</section>';
    }

    private static function render_spec_offer_card(
        array $offer,
        int $parent_id,
        string $description_id,
        bool $visible
    ): void {
        $classes = 'wh-condition-card';
        if ($visible) {
            $classes .= ' wh-compact-purchase';
        }

        $policy = $offer['shipping_policy'] ?? null;
        $sp_type = (string) ($policy['shipping_policy_type'] ?? 'unknown');
        $base_fee = (float) ($policy['shipping_base_fee'] ?? 0);
        $jeju_extra = (float) ($policy['shipping_jeju_extra_fee'] ?? 0);
        $remote_extra = (float) ($policy['shipping_remote_extra_fee'] ?? 0);
        $tiers = is_array($policy['shipping_tiers'] ?? null) ? $policy['shipping_tiers'] : [];

        $sp_display = '무료배송';
        if ($sp_type === 'free') {
            $sp_display = '무료배송';
        } elseif ($sp_type === 'fixed') {
            $sp_display = number_format($base_fee) . '원';
        } elseif ($sp_type === 'quantity_tiered') {
            if (!empty($tiers)) {
                $t = $tiers[0];
                $sp_display = '수량별 배송비 (' . $t['min_qty'] . '~' . ($t['max_qty_exclusive'] - 1) . '개 ' . number_format($t['fee']) . '원)';
            } else {
                $sp_display = '수량별 배송비 (' . number_format($base_fee) . '원)';
            }
        } else {
            $sp_display = '배송비 확인 필요';
        }

        $surcharge_str = '';
        if ($jeju_extra > 0 || $remote_extra > 0) {
            $surcharge_str = '제주 +' . number_format($jeju_extra) . '원 · 도서산간 +' . number_format($remote_extra) . '원';
        }

        $base_total = $offer['price'] + ($sp_type === 'free' ? 0 : $base_fee);

        echo '<article class="' . esc_attr($classes) . '" ';
        echo 'data-lane="' . esc_attr($offer['lane']) . '" ';
        echo 'data-price="' . esc_attr((string) $offer['price']) . '" ';
        echo 'data-variation-id="' . (int) $offer['variation_id'] . '" ';
        echo 'data-public-offer-key="' . esc_attr($offer['key']) . '" ';
        echo 'data-shipping-type="' . esc_attr($sp_type) . '" ';
        echo 'data-shipping-base-fee="' . esc_attr((string) $base_fee) . '" ';
        echo 'data-shipping-tiers="' . esc_attr(wp_json_encode($tiers)) . '" ';
        foreach ($offer['normalized'] as $dimension => $value) {
            echo 'data-' . esc_attr($dimension) . '="' . esc_attr($value) . '" ';
        }
        if (!$visible) {
            echo 'hidden ';
        }
        echo '>';
        echo '<div class="wh-card-header">';
        echo '<span class="wh-lane-badge">판매조건 ' . esc_html($offer['lane']) . '</span>';
        echo '<span class="wh-badge-lowest" hidden>최저가 (배송비 포함)</span>';
        echo '</div>';
        echo '<div class="wh-card-title">' . esc_html($offer['spec_label']) . '</div>';
        echo '<div class="wh-card-price-row"><span class="wh-price">' . wc_price($offer['price']) . '</span>';
        if (!empty($offer['unit_price_str'])) {
            echo '<span class="wh-unit-price">(' . esc_html($offer['unit_price_str']) . ')</span>';
        }
        echo '</div>';

        echo '<div class="wh-card-shipping-info">';
        echo '<div class="wh-shipping-row"><span class="wh-shipping-label">배송비:</span> <span class="wh-shipping-value">' . esc_html($sp_display) . '</span></div>';
        if ($surcharge_str !== '') {
            echo '<div class="wh-shipping-surcharge">' . esc_html($surcharge_str) . '</div>';
        }
        echo '</div>';

        echo '<div class="wh-card-total-row">';
        echo '<span class="wh-total-label">기본 예상합계:</span> ';
        echo '<span class="wh-total-amount">' . wc_price($base_total) . '</span>';
        echo '</div>';

        echo '<p class="wh-stock">재고 있음</p>';
        echo '<form method="post" action="' . esc_url(home_url('/')) . '" class="wh-condition-form" ';
        echo 'aria-describedby="' . esc_attr($description_id) . '">';
        echo '<label for="qty-' . esc_attr($offer['key']) . '">수량</label>';
        echo '<input type="number" id="qty-' . esc_attr($offer['key']) . '" name="quantity" min="1" step="1" value="1" required>';
        echo '<input type="hidden" name="action" value="wh_supplier_lane_add_to_cart">';
        echo '<input type="hidden" name="product_id" value="' . $parent_id . '">';
        echo '<input type="hidden" name="wh_lane" value="' . esc_attr($offer['lane']) . '">';
        echo '<input type="hidden" name="' . esc_attr(self::OFFER_KEY_FIELD) . '" value="' . esc_attr($offer['key']) . '">';
        wp_nonce_field('wh_supplier_lane_add', 'wh_lane_nonce');
        echo '<button type="submit" class="button alt wh-add-btn">장바구니 담기</button>';
        echo '</form></article>';
    }

    private static function varying_spec_dimensions(array $offers): array
    {
        $dimensions = ['grade', 'weight', 'count', 'package'];
        return array_values(array_filter($dimensions, static function (string $dimension) use ($offers): bool {
            $values = array_unique(array_filter(array_map(
                static fn(array $offer): string => (string) ($offer['normalized'][$dimension] ?? ''),
                $offers
            ), static fn(string $value): bool => $value !== ''));
            return count($values) > 1;
        }));
    }

    private static function dimension_options(array $offers, string $dimension): array
    {
        $options = [];
        foreach ($offers as $offer) {
            $value = (string) ($offer['normalized'][$dimension] ?? '');
            if (array_key_exists($value, $options)) {
                continue;
            }
            if ($value === '') {
                continue;
            } elseif (!empty($offer['display'][$dimension])) {
                $options[$value] = (string) $offer['display'][$dimension];
            } elseif ($dimension === 'weight') {
                $grams = (float) $value;
                $options[$value] = $grams >= 1000
                    ? self::format_spec_number($grams / 1000) . 'kg'
                    : self::format_spec_number($grams) . 'g';
            } elseif ($dimension === 'count') {
                $options[$value] = $value . '개';
            } else {
                $options[$value] = $value;
            }
        }
        return $options;
    }

    private static function format_spec_number(float $value): string
    {
        return fmod($value, 1.0) === 0.0
            ? (string) (int) $value
            : rtrim(rtrim(number_format($value, 3, '.', ''), '0'), '.');
    }

    public static function sort_normalized_spec_offers(array $a, array $b): int
    {
        $grade_order = [
            '꼬마' => 5,
            '소' => 10,
            '중소' => 15,
            '중' => 20,
            '중대' => 25,
            '대' => 30,
            '특' => 40,
            '특품' => 40,
            '왕특' => 50,
        ];
        $grade_a = (string) ($a['normalized']['grade'] ?? '');
        $grade_b = (string) ($b['normalized']['grade'] ?? '');
        $rank_a = $grade_order[$grade_a] ?? 999;
        $rank_b = $grade_order[$grade_b] ?? 999;
        if ($rank_a !== $rank_b) {
            return $rank_a <=> $rank_b;
        }
        foreach (['weight', 'count'] as $numeric_dimension) {
            $value_a = ($a['normalized'][$numeric_dimension] ?? '') === ''
                ? PHP_FLOAT_MAX
                : (float) $a['normalized'][$numeric_dimension];
            $value_b = ($b['normalized'][$numeric_dimension] ?? '') === ''
                ? PHP_FLOAT_MAX
                : (float) $b['normalized'][$numeric_dimension];
            if ($value_a !== $value_b) {
                return $value_a <=> $value_b;
            }
        }
        foreach (['package', 'spec_label'] as $text_dimension) {
            $value_a = $text_dimension === 'spec_label'
                ? (string) ($a['spec_label'] ?? '')
                : (string) ($a['normalized'][$text_dimension] ?? '');
            $value_b = $text_dimension === 'spec_label'
                ? (string) ($b['spec_label'] ?? '')
                : (string) ($b['normalized'][$text_dimension] ?? '');
            $comparison = strnatcmp($value_a, $value_b);
            if ($comparison !== 0) {
                return $comparison;
            }
        }
        $price_comparison = ((float) $a['price']) <=> ((float) $b['price']);
        return $price_comparison !== 0
            ? $price_comparison
            : strcmp((string) $a['lane'], (string) $b['lane']);
    }

    public static function handle_add_to_cart(): void
    {
        if (
            ($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST'
            || !isset($_POST['action'])
            || sanitize_key(wp_unslash($_POST['action'])) !== 'wh_supplier_lane_add_to_cart'
        ) {
            return;
        }
        $redirect = wp_get_referer()
            ?: (function_exists('wc_get_cart_url') ? wc_get_cart_url() : home_url('/'));
        try {
            if (WC()->session === null) {
                WC()->initialize_session();
            }
            if (WC()->cart === null) {
                WC()->initialize_cart();
            }
            if (
                !isset($_POST['wh_lane_nonce'])
                || !wp_verify_nonce(
                    sanitize_text_field(wp_unslash($_POST['wh_lane_nonce'])),
                    'wh_supplier_lane_add'
                )
            ) {
                throw new RuntimeException('요청을 확인할 수 없습니다.');
            }
            $parent_id = isset($_POST['product_id']) ? absint($_POST['product_id']) : 0;
            $key = isset($_POST[self::OFFER_KEY_FIELD])
                ? sanitize_text_field(wp_unslash($_POST[self::OFFER_KEY_FIELD]))
                : '';
            $lane = isset($_POST['wh_lane'])
                ? strtoupper(sanitize_key(wp_unslash($_POST['wh_lane'])))
                : '';
            $quantity = isset($_POST['quantity']) ? wc_stock_amount(wp_unslash($_POST['quantity'])) : 1;
            if ($parent_id <= 0 || !in_array($lane, ['A', 'B'], true) || $quantity <= 0 || $key === '') {
                throw new RuntimeException('구매 옵션을 다시 선택해 주세요.');
            }
            $offer = self::internal_offer($key);
            if ($offer === null || (int) $offer['woo_parent_id'] !== $parent_id || $offer['lane_code'] !== $lane) {
                throw new RuntimeException('구매할 수 없는 옵션입니다.');
            }
            $variation = wc_get_product((int) $offer['woo_variation_id']);
            if (
                !($variation instanceof WC_Product_Variation)
                || (int) $variation->get_parent_id() !== $parent_id
                || !$variation->is_purchasable()
                || !$variation->is_in_stock()
            ) {
                throw new RuntimeException('현재 주문할 수 없는 옵션입니다.');
            }
            $cart_data = self::cart_data_from_offer($offer, $variation);
            if (!WC()->cart->add_to_cart(
                $parent_id,
                $quantity,
                $variation->get_id(),
                $variation->get_variation_attributes(),
                $cart_data
            )) {
                throw new RuntimeException('장바구니에 담지 못했습니다.');
            }
            WC()->cart->calculate_totals();
            WC()->cart->set_session();
            if (WC()->session !== null && method_exists(WC()->session, 'set_customer_session_cookie')) {
                WC()->session->set_customer_session_cookie(true);
            }
            if (WC()->session !== null && method_exists(WC()->session, 'save_data')) {
                WC()->session->save_data();
            }
            wc_add_to_cart_message([$variation->get_id() => $quantity], true);
            wp_safe_redirect(wc_get_cart_url());
            exit;
        } catch (RuntimeException $error) {
            if (function_exists('wc_add_notice')) {
                wc_add_notice($error->getMessage(), 'error');
            } else {
                $redirect = add_query_arg('wh_lane_error', '1', $redirect);
            }
            wp_safe_redirect($redirect);
            exit;
        }
    }

    public static function preserve_cart_identity(array $cart_item_data, int $product_id, int $variation_id): array
    {
        if (!isset($cart_item_data['wh_lane_offer_key'])) {
            return $cart_item_data;
        }
        $cart_item_data['wh_lane_identity'] = hash(
            'sha256',
            $variation_id . '|' . $cart_item_data['wh_lane_offer_key']
        );
        return $cart_item_data;
    }

    public static function public_cart_item_data(array $item_data, array $cart_item): array
    {
        $public = self::public_projection($cart_item);
        if ($public === null) {
            return $item_data;
        }
        $item_data[] = ['key' => '출고구분', 'value' => $public['lane_label']];
        $item_data[] = ['key' => '구매옵션', 'value' => $public['option_label']];
        return $item_data;
    }

    public static function create_order_line_metadata(
        WC_Order_Item_Product $item,
        string $cart_item_key,
        array $values,
        WC_Order $order
    ): void {
        unset($cart_item_key, $order);
        $public = self::public_projection($values);
        if ($public === null) {
            return;
        }
        $item->add_meta_data('출고구분', $public['lane_label'], true);
        $item->add_meta_data('구매옵션', $public['option_label'], true);

        $target_id = (int) ($values['variation_id'] ?? $values['product_id'] ?? 0);
        if ($target_id > 0) {
            $meta = self::get_variation_shipping_meta($target_id);
            if (!empty($meta['policy'])) {
                $item->add_meta_data('_wh_shipping_snapshot', wp_json_encode($meta['policy']), true);
            }
        }

        foreach (self::INTERNAL_META as $key) {
            $cart_key = substr($key, 1);
            if (array_key_exists($cart_key, $values)) {
                $item->add_meta_data($key, $values[$cart_key], true);
            }
        }
    }

    public static function calculate_supplier_shipping_fees(): void
    {
        if (is_admin() && !defined('DOING_AJAX')) {
            return;
        }
        if (function_exists('remove_action')) {
            remove_action('woocommerce_cart_calculate_fees', 'avocadoss_add_jeju_island_shipping_fee', 20);
        }
        if (!function_exists('WC') || WC()->cart === null || WC()->cart->is_empty()) {
            return;
        }

        $customer = WC()->customer;
        $postcode = $customer ? (string) $customer->get_shipping_postcode() : '';
        if ($postcode === '' && $customer) {
            $postcode = (string) $customer->get_billing_postcode();
        }
        $addr1 = $customer ? (string) $customer->get_shipping_address_1() : '';
        $addr2 = $customer ? (string) $customer->get_shipping_address_2() : '';
        if ($addr1 === '' && $customer) {
            $addr1 = (string) $customer->get_billing_address_1();
            $addr2 = (string) $customer->get_billing_address_2();
        }
        $full_address = trim($addr1 . ' ' . $addr2);
        $state = $customer ? (string) $customer->get_shipping_state() : '';

        $is_jeju = self::is_jeju_address($postcode, $state, $full_address);
        $is_remote = self::is_remote_address($postcode, $full_address);

        $groups = [];
        foreach (WC()->cart->get_cart() as $cart_item_key => $cart_item) {
            $variation_id = (int) ($cart_item['variation_id'] ?? 0);
            $product_id = (int) ($cart_item['product_id'] ?? 0);
            $quantity = (int) ($cart_item['quantity'] ?? 1);
            $target_id = $variation_id > 0 ? $variation_id : $product_id;

            $meta = self::get_variation_shipping_meta($target_id);
            $supplier_id = !empty($meta['supplier_id']) ? $meta['supplier_id'] : 'dailyfood';
            $source_product_id = !empty($meta['source_product_id']) ? $meta['source_product_id'] : (string) $target_id;
            $policy = $meta['policy'] ?? null;

            $group_key = $supplier_id . '|' . $source_product_id;
            if (!isset($groups[$group_key])) {
                $groups[$group_key] = [
                    'supplier_id' => $supplier_id,
                    'source_product_id' => $source_product_id,
                    'policy' => $policy,
                    'total_qty' => 0,
                ];
            }
            $groups[$group_key]['total_qty'] += $quantity;
        }

        $total_base_shipping = 0.0;
        $total_surcharge = 0.0;

        foreach ($groups as $group) {
            $policy = $group['policy'];
            $qty = $group['total_qty'];
            if (!is_array($policy)) {
                continue;
            }

            $type = (string) ($policy['shipping_policy_type'] ?? 'unknown');
            $base_fee = (float) ($policy['shipping_base_fee'] ?? 0);
            $jeju_fee = (float) ($policy['shipping_jeju_extra_fee'] ?? 0);
            $remote_fee = (float) ($policy['shipping_remote_extra_fee'] ?? 0);
            $tiers = is_array($policy['shipping_tiers'] ?? null) ? $policy['shipping_tiers'] : [];

            $group_shipping = 0.0;
            if ($type === 'free') {
                $group_shipping = 0.0;
            } elseif ($type === 'fixed') {
                $group_shipping = $base_fee;
            } elseif ($type === 'quantity_tiered') {
                $matched_fee = null;
                $step_size = null;
                foreach ($tiers as $tier) {
                    $min = (int) ($tier['min_qty'] ?? 0);
                    $max_excl = (int) ($tier['max_qty_exclusive'] ?? 0);
                    $fee = (float) ($tier['fee'] ?? $base_fee);
                    if ($max_excl > 0 && $qty >= $min && $qty < $max_excl) {
                        $matched_fee = $fee;
                        break;
                    }
                    if ($max_excl > 0 && $step_size === null) {
                        $step_size = $max_excl;
                    }
                }
                if ($matched_fee !== null) {
                    $group_shipping = $matched_fee;
                } elseif ($step_size !== null && $step_size > 0) {
                    $boxes = (int) ceil($qty / $step_size);
                    $group_shipping = $boxes * $base_fee;
                } else {
                    $group_shipping = $base_fee;
                }
            } else {
                $group_shipping = $base_fee > 0 ? $base_fee : 3000.0;
            }

            $total_base_shipping += $group_shipping;

            if ($is_jeju && $jeju_fee > 0) {
                $total_surcharge += $jeju_fee;
            } elseif ($is_remote && $remote_fee > 0) {
                $total_surcharge += $remote_fee;
            }
        }

        if ($total_base_shipping > 0) {
            WC()->cart->add_fee(__('배송비', 'wholesalehub-supplier-lanes'), $total_base_shipping, false);
        }
        if ($total_surcharge > 0) {
            $label = $is_jeju ? __('제주 추가 배송비', 'wholesalehub-supplier-lanes') : __('도서산간 추가 배송비', 'wholesalehub-supplier-lanes');
            WC()->cart->add_fee($label, $total_surcharge, false);
        }
    }

    public static function is_jeju_address(string $postcode, string $state, string $address): bool
    {
        if (str_contains($state, '제주') || mb_strpos($address, '제주') !== false) {
            return true;
        }
        $digits = (int) preg_replace('/[^0-9]/', '', $postcode);
        if ($digits >= 63000 && $digits <= 63699) {
            return true;
        }
        if ($digits >= 690000 && $digits <= 699999) {
            return true;
        }
        return false;
    }

    public static function is_remote_address(string $postcode, string $address): bool
    {
        $digits = (int) preg_replace('/[^0-9]/', '', $postcode);
        if (
            ($digits >= 23100 && $digits <= 23136)
            || ($digits >= 40200 && $digits <= 40240)
            || ($digits >= 58800 && $digits <= 58866)
            || ($digits >= 58900 && $digits <= 58958)
            || ($digits >= 59100 && $digits <= 59166)
        ) {
            return true;
        }
        return (bool) preg_match('/(울릉|독도|백령도|연평도|거문도|흑산도|추자도)/u', $address);
    }

    public static function get_variation_shipping_meta(int $variation_id): array
    {
        $json = (string) get_post_meta($variation_id, '_wh_shipping_policy', true);
        $policy = !empty($json) ? json_decode($json, true) : null;

        $supplier_id = (string) get_post_meta($variation_id, '_wh_internal_supplier_id', true);
        $source_product_id = (string) get_post_meta($variation_id, '_wh_source_product_id', true);

        if (!$policy || empty($supplier_id)) {
            global $wpdb;
            $offers = $wpdb->prefix . 'supplier_lane_offers';
            $row = $wpdb->get_row(
                $wpdb->prepare(
                    "SELECT supplier_id, source_product_id, shipping_policy_json FROM {$offers} WHERE woo_variation_id = %d LIMIT 1",
                    $variation_id
                ),
                ARRAY_A
            );
            if (is_array($row)) {
                if (empty($supplier_id)) {
                    $supplier_id = (string) ($row['supplier_id'] ?? '');
                }
                if (empty($source_product_id)) {
                    $source_product_id = (string) ($row['source_product_id'] ?? '');
                }
                if (!$policy && !empty($row['shipping_policy_json'])) {
                    $policy = json_decode($row['shipping_policy_json'], true);
                }
            }
        }

        return [
            'supplier_id' => $supplier_id,
            'source_product_id' => $source_product_id,
            'policy' => $policy,
        ];
    }

    public static function hide_internal_order_metadata(array $hidden): array
    {
        return array_values(array_unique(array_merge($hidden, self::INTERNAL_META)));
    }

    public static function render_admin_order_details(int $item_id, WC_Order_Item $item, $product): void
    {
        unset($item_id, $product);
        if (!current_user_can('manage_woocommerce')) {
            return;
        }
        $supplier = $item->get_meta('_wh_internal_supplier_id', true);
        if ($supplier === '') {
            return;
        }
        echo '<div class="wh-lane-admin-details"><strong>Supplier lane internal</strong><br>';
        echo esc_html((string) $supplier) . ' · ';
        echo esc_html((string) $item->get_meta('_wh_source_product_id', true)) . ' · ';
        echo esc_html((string) $item->get_meta('_wh_source_option_id', true)) . '</div>';
    }

    public static function filter_structured_offer(array $offer, WC_Product $product): array
    {
        unset($product);
        foreach (array_keys($offer) as $key) {
            if (str_starts_with((string) $key, '_wh_')) {
                unset($offer[$key]);
            }
        }
        return $offer;
    }

    public static function store_api_validate_add_to_cart(WC_Product $product, $request): void
    {
        $offer = self::internal_offer_by_variation((int) $product->get_id());
        if ($offer === null) {
            return;
        }
        $key = self::store_api_offer_key($request);
        if ($key === '' || !hash_equals((string) $offer['public_offer_key'], $key)) {
            throw new \Automattic\WooCommerce\StoreApi\Exceptions\RouteException(
                'wholesalehub_invalid_offer',
                '구매할 수 없는 옵션입니다.',
                400
            );
        }
        if (!$product->is_purchasable() || !$product->is_in_stock()) {
            throw new \Automattic\WooCommerce\StoreApi\Exceptions\RouteException(
                'wholesalehub_offer_unavailable',
                '현재 주문할 수 없는 옵션입니다.',
                400
            );
        }
    }

    public static function store_api_cart_data(array $add_to_cart_data, $request): array
    {
        $variation_id = isset($add_to_cart_data['id']) ? (int) $add_to_cart_data['id'] : 0;
        $offer = self::internal_offer_by_variation($variation_id);
        if ($offer === null) {
            return $add_to_cart_data;
        }
        $key = self::store_api_offer_key($request);
        if ($key === '' || !hash_equals((string) $offer['public_offer_key'], $key)) {
            throw new \Automattic\WooCommerce\StoreApi\Exceptions\RouteException(
                'wholesalehub_invalid_offer',
                '구매할 수 없는 옵션입니다.',
                400
            );
        }
        $variation = wc_get_product($variation_id);
        if (!($variation instanceof WC_Product_Variation)) {
            throw new \Automattic\WooCommerce\StoreApi\Exceptions\RouteException(
                'wholesalehub_offer_unavailable',
                '현재 주문할 수 없는 옵션입니다.',
                400
            );
        }
        $add_to_cart_data['cart_item_data'] = self::cart_data_from_offer($offer, $variation);
        return $add_to_cart_data;
    }

    public static function filter_customer_order_response($response, $order, $request)
    {
        unset($order, $request);
        if (current_user_can('manage_woocommerce') || !($response instanceof WP_REST_Response)) {
            return $response;
        }
        $response->set_data(self::strip_internal_payload((array) $response->get_data()));
        return $response;
    }

    public static function filter_email_order_meta_fields(array $fields, bool $sent_to_admin, $order): array
    {
        unset($order);
        if ($sent_to_admin) {
            return $fields;
        }
        foreach (array_keys($fields) as $key) {
            if (self::is_internal_key((string) $key)) {
                unset($fields[$key]);
            }
        }
        return $fields;
    }

    public static function filter_formatted_order_meta(array $formatted_meta, WC_Order_Item $item): array
    {
        unset($item);
        return array_values(array_filter($formatted_meta, static function ($meta): bool {
            if (is_object($meta) && method_exists($meta, 'get_data')) {
                $data = $meta->get_data();
                return !self::is_internal_key((string) ($data['key'] ?? ''));
            }
            if (is_object($meta) && isset($meta->key)) {
                return !self::is_internal_key((string) $meta->key);
            }
            if (is_array($meta)) {
                return !self::is_internal_key((string) ($meta['key'] ?? ''));
            }
            return true;
        }));
    }

    public static function filter_archive_price_html(string $price_html, WC_Product $product): string
    {
        if (!($product instanceof WC_Product_Variable) || $product->get_meta(self::MODE_META) !== '1') {
            return $price_html;
        }
        $summary = self::archive_summary(self::public_offers((int) $product->get_id()));
        if ($summary === null) {
            return $price_html;
        }
        $prices = $summary['minimum'] === $summary['maximum']
            ? wc_price($summary['minimum']) . esc_html__('부터', 'wholesalehub-supplier-lanes')
            : wc_price($summary['minimum']) . ' ~ ' . wc_price($summary['maximum']);
        return wp_kses_post($prices);
    }

    public static function filter_visible_children(array $children, WC_Product $product, bool $visible): array
    {
        if (
            !$visible
            || !($product instanceof WC_Product_Variable)
            || $product->get_meta(self::MODE_META) !== '1'
        ) {
            return $children;
        }
        $allowed = array_map(
            static fn(array $offer): int => (int) $offer['variation_id'],
            self::public_offers((int) $product->get_id())
        );
        return array_values(array_intersect(array_map('intval', $children), $allowed));
    }

    public static function archive_summary(array $offers): ?array
    {
        if ($offers === []) {
            return null;
        }
        $prices = array_map(static fn(array $offer): float => (float) $offer['price'], $offers);
        return [
            'minimum' => min($prices),
            'maximum' => max($prices),
            'lane_a_count' => count(array_filter($offers, static fn(array $offer): bool => $offer['lane'] === 'A')),
            'lane_b_count' => count(array_filter($offers, static fn(array $offer): bool => $offer['lane'] === 'B')),
        ];
    }

    public static function strip_internal_payload(array $payload): array
    {
        $public = [];
        foreach ($payload as $key => $value) {
            if (is_string($key) && self::is_internal_key($key)) {
                continue;
            }
            if ($key === 'meta_data' && is_array($value)) {
                $value = array_values(array_filter($value, static function ($meta): bool {
                    return !is_array($meta)
                        || !self::is_internal_key((string) ($meta['key'] ?? ''));
                }));
            }
            $public[$key] = is_array($value) ? self::strip_internal_payload($value) : $value;
        }
        return $public;
    }

    public static function public_projection(array $data): ?array
    {
        $lane = isset($data['wh_lane']) ? (string) $data['wh_lane'] : '';
        $label = isset($data['wh_public_option_label']) ? (string) $data['wh_public_option_label'] : '';
        if (!in_array($lane, ['A', 'B'], true) || $label === '') {
            return null;
        }
        return [
            'lane_label' => $lane === 'A' ? 'A사' : 'B사',
            'option_label' => sanitize_text_field($label),
        ];
    }

    private static function render_lane_card(
        string $lane,
        array $offers,
        int $parent_id,
        string $description_id
    ): void {
        $select_id = 'wh-lane-' . strtolower($lane) . '-' . $parent_id;
        echo '<form class="wh-lane-card" method="post" action="' . esc_url(home_url('/')) . '">';
        echo '<h3>' . esc_html($lane === 'A' ? 'A사' : 'B사') . '</h3>';
        echo '<label for="' . esc_attr($select_id) . '">' . esc_html__('옵션을 선택하세요', 'wholesalehub-supplier-lanes') . '</label>';
        echo '<select id="' . esc_attr($select_id) . '" name="' . esc_attr(self::OFFER_KEY_FIELD) . '" ';
        echo 'required aria-describedby="' . esc_attr($description_id) . '">';
        echo '<option value="">' . esc_html__('옵션을 선택하세요', 'wholesalehub-supplier-lanes') . '</option>';
        foreach ($offers as $offer) {
            echo '<option value="' . esc_attr($offer['key']) . '">';
            $plain_price = wp_strip_all_tags(wc_price((float) $offer['price']));
            echo esc_html($offer['label'] . ' — ' . $plain_price) . '</option>';
        }
        echo '</select><label class="wh-lane-quantity-label" for="' . esc_attr($select_id . '-qty') . '">';
        echo esc_html__('수량', 'wholesalehub-supplier-lanes') . '</label>';
        echo '<input id="' . esc_attr($select_id . '-qty') . '" type="number" name="quantity" min="1" step="1" value="1" required>';
        echo '<input type="hidden" name="action" value="wh_supplier_lane_add_to_cart">';
        echo '<input type="hidden" name="product_id" value="' . (int) $parent_id . '">';
        echo '<input type="hidden" name="wh_lane" value="' . esc_attr($lane) . '">';
        wp_nonce_field('wh_supplier_lane_add', 'wh_lane_nonce');
        echo '<button type="submit" class="button alt">' . esc_html__('장바구니 담기', 'wholesalehub-supplier-lanes') . '</button>';
        echo '</form>';
    }

    private static function public_offers(int $parent_id): array
    {
        global $wpdb;
        $offers = $wpdb->prefix . 'supplier_lane_offers';
        $parent_links = $wpdb->prefix . 'supplier_lane_parent_links';
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT o.lane_code, o.woo_variation_id, o.public_offer_key,
                        o.public_option_label, o.option_label_raw,
                        o.source_product_id, o.source_option_id, o.shipping_policy_json
                 FROM {$offers} o
                 INNER JOIN {$parent_links} p
                   ON p.id = o.parent_link_id
                  AND p.woo_parent_id = o.woo_parent_id
                  AND p.supplier_id = o.supplier_id
                  AND p.lane_code = o.lane_code
                  AND p.source_product_id = o.source_product_id
                 WHERE o.woo_parent_id = %d
                   AND p.status = 'approved'
                   AND o.approval_status = 'approved'
                   AND o.lifecycle_status = 'active'
                   AND o.woo_variation_id IS NOT NULL
                 ORDER BY o.lane_code, o.public_option_label, o.woo_variation_id",
                $parent_id
            ),
            ARRAY_A
        );
        $list = array_values(array_filter(array_map(static function (array $row): ?array {
            $variation = wc_get_product((int) $row['woo_variation_id']);
            if (!($variation instanceof WC_Product_Variation) || !$variation->is_purchasable() || !$variation->is_in_stock()) {
                return null;
            }
            $sp_meta = (string) $variation->get_meta('_wh_shipping_policy');
            $policy = !empty($sp_meta) ? json_decode($sp_meta, true) : null;
            if (!$policy && !empty($row['shipping_policy_json'])) {
                $policy = json_decode((string) $row['shipping_policy_json'], true);
            }
            return [
                'lane' => (string) $row['lane_code'],
                'variation_id' => (int) $row['woo_variation_id'],
                'key' => (string) $row['public_offer_key'],
                'label' => sanitize_text_field((string) $row['public_option_label']),
                'source_label' => sanitize_text_field(
                    (string) ($row['option_label_raw'] ?: $row['public_option_label'])
                ),
                'source_product_id' => (string) $row['source_product_id'],
                'source_option_id' => (string) $row['source_option_id'],
                'price' => (float) $variation->get_price(),
                'shipping_policy' => $policy,
            ];
        }, is_array($rows) ? $rows : [])));

        usort($list, [self::class, 'sort_offers_by_size_weight']);
        return $list;
    }

    public static function sort_offers_by_size_weight(array $a, array $b): int
    {
        if (isset($a['lane'], $b['lane']) && $a['lane'] !== $b['lane']) {
            return strcmp($a['lane'], $b['lane']);
        }
        $label_a = $a['label'] ?? ($a['public_option_label'] ?? '');
        $label_b = $b['label'] ?? ($b['public_option_label'] ?? '');

        // 1. 크기·등급 (소/중/대/특/왕특 등)
        $rank_a = self::extract_size_rank($label_a);
        $rank_b = self::extract_size_rank($label_b);
        if ($rank_a !== $rank_b) {
            return $rank_a <=> $rank_b;
        }

        // 2. 중량 숫자 오름차순 (g)
        $weight_a = self::extract_weight_val_grams($label_a);
        $weight_b = self::extract_weight_val_grams($label_b);
        if ($weight_a !== $weight_b) {
            return $weight_a <=> $weight_b;
        }

        // 3. 개수·입수 숫자 오름차순
        $count_a = self::extract_count_val($label_a);
        $count_b = self::extract_count_val($label_b);
        if ($count_a !== $count_b) {
            return $count_a <=> $count_b;
        }

        // 4. 포장 수량
        $pack_a = self::extract_pack_val($label_a);
        $pack_b = self::extract_pack_val($label_b);
        if ($pack_a !== $pack_b) {
            return $pack_a <=> $pack_b;
        }

        // 5. 원본 옵션명 자연 정렬
        return strnatcmp($label_a, $label_b);
    }

    public static function extract_size_rank(string $label): int
    {
        $l = trim($label);
        // 왕특 계열 (Check FIRST so '왕특' is not matched by '특')
        if (preg_match('/(왕특과|왕특품|왕특|특대과|특대|특A품|특A)/u', $l)) {
            return 50;
        }
        // 특 계열
        if (preg_match('/(특품|특과|특A|\b특\b|특)/u', $l)) {
            if (!preg_match('/(왕특)/u', $l)) {
                return 40;
            }
        }
        if (preg_match('/(중대과|중대)/u', $l)) {
            return 25;
        }
        // 대 계열
        if (preg_match('/(대과|대품|대)/u', $l)) {
            return 30;
        }
        if (preg_match('/(중소과|중소)/u', $l)) {
            return 15;
        }
        // 중 계열
        if (preg_match('/(중과|중품|중)/u', $l)) {
            return 20;
        }
        if (preg_match('/(꼬마과|꼬마)/u', $l)) {
            return 5;
        }
        // 소 계열
        if (preg_match('/(소과|소품|소)/u', $l)) {
            return 10;
        }
        return 999;
    }

    public static function extract_weight_val_grams(string $label): float
    {
        if (preg_match('/([\d\.]+)\s*(kg|킬로|키로)/iu', $label, $m)) {
            return ((float) $m[1]) * 1000.0;
        }
        if (preg_match('/([\d\.]+)\s*(g|그램)/iu', $label, $m)) {
            return (float) $m[1];
        }
        return 999999.0;
    }

    public static function extract_count_val(string $label): float
    {
        if (preg_match('/([\d\.]+)(?:\s*[~\-–]\s*[\d\.]+)?\s*(개입|개|입|과수?|송이|수)/u', $label, $m)) {
            return (float) $m[1];
        }
        return 999999.0;
    }

    public static function extract_pack_val(string $label): float
    {
        if (preg_match('/([\d\.]+)\s*(박스|망|상자|팩|봉)/u', $label, $m)) {
            return (float) $m[1];
        }
        return 999999.0;
    }

    private static function internal_offer(string $key): ?array
    {
        global $wpdb;
        $offers = $wpdb->prefix . 'supplier_lane_offers';
        $parent_links = $wpdb->prefix . 'supplier_lane_parent_links';
        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT o.* FROM {$offers} o
                 INNER JOIN {$parent_links} p
                   ON p.id = o.parent_link_id
                  AND p.woo_parent_id = o.woo_parent_id
                  AND p.supplier_id = o.supplier_id
                  AND p.lane_code = o.lane_code
                  AND p.source_product_id = o.source_product_id
                 WHERE o.public_offer_key = %s
                   AND p.status = 'approved'
                   AND o.approval_status = 'approved'
                   AND o.lifecycle_status = 'active'
                 LIMIT 1",
                $key
            ),
            ARRAY_A
        );
        return is_array($row) ? $row : null;
    }

    private static function internal_offer_by_variation(int $variation_id): ?array
    {
        if ($variation_id <= 0) {
            return null;
        }
        global $wpdb;
        $offers = $wpdb->prefix . 'supplier_lane_offers';
        $parent_links = $wpdb->prefix . 'supplier_lane_parent_links';
        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT o.* FROM {$offers} o
                 INNER JOIN {$parent_links} p
                   ON p.id = o.parent_link_id
                  AND p.woo_parent_id = o.woo_parent_id
                  AND p.supplier_id = o.supplier_id
                  AND p.lane_code = o.lane_code
                  AND p.source_product_id = o.source_product_id
                 WHERE o.woo_variation_id = %d
                   AND p.status = 'approved'
                   AND o.approval_status = 'approved'
                   AND o.lifecycle_status = 'active'
                 LIMIT 1",
                $variation_id
            ),
            ARRAY_A
        );
        return is_array($row) ? $row : null;
    }

    private static function store_api_offer_key($request): string
    {
        $extensions = [];
        if ($request instanceof WP_REST_Request) {
            $extensions = $request->get_param('extensions');
        } elseif (is_array($request)) {
            $cart_item_data = $request['cart_item_data'] ?? [];
            if (is_array($cart_item_data) && isset($cart_item_data['wh_lane_offer_key'])) {
                return sanitize_text_field((string) $cart_item_data['wh_lane_offer_key']);
            }
            $extensions = $request['extensions'] ?? [];
        }
        if (!is_array($extensions)) {
            return '';
        }
        $namespace = $extensions['wholesalehub_supplier_lanes'] ?? [];
        if (!is_array($namespace)) {
            return '';
        }
        return isset($namespace['public_offer_key'])
            ? sanitize_text_field((string) $namespace['public_offer_key'])
            : '';
    }

    private static function cart_data_from_offer(array $offer, WC_Product_Variation $variation): array
    {
        return [
            'wh_lane_offer_key' => (string) $offer['public_offer_key'],
            'wh_lane' => (string) $offer['lane_code'],
            'wh_public_option_label' => (string) $offer['public_option_label'],
            'wh_internal_supplier_id' => (string) $offer['supplier_id'],
            'wh_source_product_id' => (string) $offer['source_product_id'],
            'wh_source_option_id' => (string) $offer['source_option_id'],
            'wh_lane_offer_id' => (int) $offer['id'],
            'wh_cost_at_order' => (float) $offer['landed_cost'],
            'wh_sale_price_at_order' => (float) $variation->get_price(),
            'wh_snapshot_hash' => (string) $offer['last_snapshot_hash'],
            'wh_pipeline_run_id' => (string) $offer['last_complete_run_id'],
        ];
    }

    private static function is_internal_key(string $key): bool
    {
        $normalized = ltrim($key, '_');
        return in_array($normalized, [
            'wh_internal_supplier_id',
            'wh_source_product_id',
            'wh_source_option_id',
            'wh_lane_offer_id',
            'wh_cost_at_order',
            'wh_sale_price_at_order',
            'wh_snapshot_hash',
            'wh_pipeline_run_id',
            'wh_lane_offer_key',
            'wh_lane_identity',
        ], true);
    }
}

if (function_exists('register_activation_hook')) {
    register_activation_hook(__FILE__, [WholesaleHub_Supplier_Lanes::class, 'install_schema']);
}
WholesaleHub_Supplier_Lanes::boot();
WholesaleHub_Supplier_Lane_Approval::boot();
