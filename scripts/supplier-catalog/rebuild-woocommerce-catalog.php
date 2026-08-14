<?php

defined('ABSPATH') || exit;

@set_time_limit(0);
ini_set('memory_limit', '1024M');

$plan_path = getenv('WHOLESALEHUB_REBUILD_PLAN');
$result_path = getenv('WHOLESALEHUB_REBUILD_RESULT');
if (!is_string($plan_path) || $plan_path === '' || !is_string($result_path) || $result_path === '') {
    WP_CLI::error('rebuild plan/result environment is required');
}
$plan = json_decode((string) file_get_contents($plan_path), true, 512, JSON_THROW_ON_ERROR);
$groups = is_array($plan['groups'] ?? null) ? $plan['groups'] : [];
$expected_groups = (int) ($plan['counts']['productGroups'] ?? 0);
$expected_variations = (int) ($plan['counts']['variations'] ?? 0);
if ($expected_groups <= 0 || $expected_variations <= 0 || count($groups) !== $expected_groups) {
    WP_CLI::error('invalid or empty catalog rebuild plan');
}

if (class_exists('WholesaleHub_Supplier_Lanes')) {
    WholesaleHub_Supplier_Lanes::install_schema();
}

global $wpdb;
$parent_table = $wpdb->prefix . 'supplier_lane_parent_links';
$offer_table = $wpdb->prefix . 'supplier_lane_offers';
$audit_table = $wpdb->prefix . 'supplier_lane_audit_history';
$started_at = gmdate('c');
$created_parent_ids = [];
$created_variation_ids = [];
$entries = [];
$failure_count = 0;
$review_records = [];

try {
    $old_product_ids = array_map(
        'intval',
        $wpdb->get_col(
            "SELECT ID FROM {$wpdb->posts} WHERE post_type = 'product' ORDER BY ID"
        )
    );
    $old_variation_ids = array_map(
        'intval',
        $wpdb->get_col(
            "SELECT ID FROM {$wpdb->posts} WHERE post_type = 'product_variation' ORDER BY ID"
        )
    );
    $old_variation_count = count($old_variation_ids);
    foreach ($old_product_ids as $old_product_id) {
        $comment_ids = $wpdb->get_col(
            $wpdb->prepare(
                "SELECT comment_ID FROM {$wpdb->comments} WHERE comment_post_ID = %d",
                $old_product_id
            )
        );
        if ($comment_ids !== []) {
            $review_records[] = [
                'old_product_id' => (int) $old_product_id,
                'old_product_name' => (string) get_the_title($old_product_id),
                'comment_ids' => array_map('intval', $comment_ids),
            ];
            $wpdb->query(
                $wpdb->prepare(
                    "UPDATE {$wpdb->comments} SET comment_post_ID = 0 WHERE comment_post_ID = %d",
                    $old_product_id
                )
            );
        }
    }

    $wpdb->query("DELETE FROM {$audit_table}");
    $wpdb->query("DELETE FROM {$offer_table}");
    $wpdb->query("DELETE FROM {$parent_table}");

    foreach ($old_variation_ids as $old_variation_id) {
        if (!wp_delete_post($old_variation_id, true)) {
            throw new RuntimeException('variation delete failed: ' . $old_variation_id);
        }
    }
    foreach ($old_product_ids as $old_product_id) {
        if (!wp_delete_post((int) $old_product_id, true)) {
            throw new RuntimeException('product delete failed: ' . (int) $old_product_id);
        }
    }
    $remaining_products = (int) $wpdb->get_var(
        "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type IN ('product','product_variation')"
    );
    if ($remaining_products !== 0) {
        throw new RuntimeException('catalog delete incomplete: ' . $remaining_products);
    }

    foreach ($groups as $group_index => $group) {
        try {
            $lanes = is_array($group['lanes'] ?? null) ? $group['lanes'] : [];
            $lane_labels = [];
            $option_labels = [];
            foreach ($lanes as $lane_code => $lane) {
                $lane_labels[] = $lane_code === 'A' ? 'A사' : 'B사';
                foreach (($lane['options'] ?? []) as $option) {
                    $label = sanitize_text_field((string) ($option['publicOptionLabel'] ?? ''));
                    if ($label !== '') {
                        $option_labels[] = $label;
                    }
                }
            }
            $lane_labels = array_values(array_unique($lane_labels));
            $option_labels = array_values(array_unique($option_labels));
            if ($lane_labels === [] || $option_labels === []) {
                throw new RuntimeException('group has no valid lane options');
            }

            $product = new WC_Product_Variable();
            $product->set_name(sanitize_text_field((string) $group['displayName']));
            $product->set_status('private');
            $product->set_catalog_visibility('visible');
            $product->set_description(
                '<p>선택한 옵션과 수량에 따라 주문할 수 있습니다. 옵션별로 나누어 배송될 수 있습니다.</p>'
            );
            $product->set_short_description('<p>신선 상품 옵션을 선택해 주문하세요.</p>');
            $product->update_meta_data('_wh_supplier_lane_mode', '1');
            $product->update_meta_data(
                '_wholesalehub_product_group_key',
                sanitize_text_field((string) $group['groupKey'])
            );
            $product->update_meta_data('_wholesalehub_catalog_rebuild', '20260726');
            $lane_attribute = new WC_Product_Attribute();
            $lane_attribute->set_id(0);
            $lane_attribute->set_name('출고구분');
            $lane_attribute->set_options($lane_labels);
            $lane_attribute->set_position(0);
            $lane_attribute->set_visible(true);
            $lane_attribute->set_variation(true);
            $option_attribute = new WC_Product_Attribute();
            $option_attribute->set_id(0);
            $option_attribute->set_name('구매옵션');
            $option_attribute->set_options($option_labels);
            $option_attribute->set_position(1);
            $option_attribute->set_visible(true);
            $option_attribute->set_variation(true);
            $product->set_attributes([$lane_attribute, $option_attribute]);
            $parent_id = $product->save();
            if ($parent_id <= 0) {
                throw new RuntimeException('parent create failed');
            }
            $created_parent_ids[] = $parent_id;

            foreach ($lanes as $lane_code => $lane) {
                $supplier_id = sanitize_key((string) $lane['supplierId']);
                $source_product_id = sanitize_text_field((string) $lane['sourceProductId']);
                $now = current_time('mysql', true);
                $inserted = $wpdb->insert($parent_table, [
                    'woo_parent_id' => $parent_id,
                    'supplier_id' => $supplier_id,
                    'lane_code' => $lane_code,
                    'source_product_id' => $source_product_id,
                    'status' => 'approved',
                    'approved_by' => 'catalog_rebuild_20260726',
                    'approved_at' => $now,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
                if ($inserted !== 1) {
                    throw new RuntimeException('parent link insert failed: ' . $wpdb->last_error);
                }
                $parent_link_id = (int) $wpdb->insert_id;

                foreach (($lane['options'] ?? []) as $option) {
                    try {
                        $source_option_id = sanitize_text_field(
                            (string) $option['sourceOptionId']
                        );
                        $public_label = sanitize_text_field(
                            (string) $option['publicOptionLabel']
                        );
                        $sale_price = (float) $option['salePrice'];
                        $stock_status = ($option['stockStatus'] ?? '') === 'out_of_stock'
                            ? 'outofstock'
                            : 'instock';
                        if ($source_option_id === '' || $public_label === '' || $sale_price <= 0) {
                            throw new RuntimeException('invalid variation input');
                        }
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
                        $variation->set_sku(
                            'WH-' . strtoupper(substr(hash('sha256', implode('|', [
                                $supplier_id,
                                $source_product_id,
                                $source_option_id,
                            ])), 0, 20))
                        );
                        $variation->update_meta_data('_wh_internal_supplier_id', $supplier_id);
                        $variation->update_meta_data('_wh_source_product_id', $source_product_id);
                        $variation->update_meta_data('_wh_source_option_id', $source_option_id);
                        $variation->update_meta_data(
                            '_wh_source_id_type',
                            sanitize_text_field((string) ($option['sourceIdType'] ?? 'authoritative'))
                        );
                        $variation->update_meta_data(
                            '_wh_snapshot_hash',
                            sanitize_text_field((string) $option['snapshotHash'])
                        );
                        $variation->update_meta_data(
                            '_wh_hard_spec_fingerprint',
                            sanitize_text_field((string) $option['hardSpecFingerprint'])
                        );
                        $variation_id = $variation->save();
                        if ($variation_id <= 0) {
                            throw new RuntimeException('variation create failed');
                        }
                        $public_offer_key = hash(
                            'sha256',
                            implode('|', [
                                'wholesalehub',
                                $supplier_id,
                                $source_product_id,
                                $source_option_id,
                                $variation_id,
                            ])
                        );
                        $inserted = $wpdb->insert($offer_table, [
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
                            'option_label_raw' => $public_label,
                            'hard_spec_fingerprint' => (string) $option['hardSpecFingerprint'],
                            'source_cost' => (float) $option['sourceCost'],
                            'source_shipping_cost' => (float) $option['shippingFee'],
                            'landed_cost' => (float) $option['landedCost'],
                            'sale_price' => $sale_price,
                            'stock_status' => $stock_status === 'instock' ? 'in_stock' : 'out_of_stock',
                            'approval_status' => 'approved',
                            'lifecycle_status' => 'active',
                            'last_snapshot_hash' => (string) $option['snapshotHash'],
                            'last_complete_run_id' => 'catalog-rebuild-20260726',
                            'last_seen_at' => $now,
                            'missing_complete_count' => 0,
                            'created_at' => $now,
                            'updated_at' => $now,
                        ]);
                        if ($inserted !== 1) {
                            wp_delete_post($variation_id, true);
                            throw new RuntimeException(
                                'offer insert failed: ' . $wpdb->last_error
                            );
                        }
                        $offer_id = (int) $wpdb->insert_id;
                        update_post_meta($variation_id, '_wh_lane_offer_id', (string) $offer_id);
                        $read_back = wc_get_product($variation_id);
                        if (
                            !($read_back instanceof WC_Product_Variation)
                            || (int) $read_back->get_parent_id() !== $parent_id
                            || (string) $read_back->get_meta('_wh_source_option_id') !== $source_option_id
                            || (float) $read_back->get_regular_price() !== $sale_price
                        ) {
                            throw new RuntimeException('variation read-back mismatch');
                        }
                        $created_variation_ids[] = $variation_id;
                        $entries[] = [
                            'status' => 'created',
                            'parent_id' => $parent_id,
                            'variation_id' => $variation_id,
                            'lane' => $lane_code,
                        ];
                    } catch (Throwable $variation_error) {
                        $failure_count++;
                        $entries[] = [
                            'status' => 'excluded',
                            'parent_id' => $parent_id,
                            'lane' => $lane_code,
                            'reason' => $variation_error->getMessage(),
                        ];
                    }
                }
            }
        } catch (Throwable $group_error) {
            $failure_count++;
            $entries[] = [
                'status' => 'failed_group',
                'group_index' => $group_index,
                'reason' => $group_error->getMessage(),
            ];
        }
    }

    $created_count = count($created_variation_ids);
    if (
        count($created_parent_ids) < max(1, (int) floor($expected_groups * 0.90))
        || $created_count < max(1, (int) floor($expected_variations * 0.90))
    ) {
        throw new RuntimeException(
            sprintf(
                'mass creation threshold failed: parents=%d/%d variations=%d/%d',
                count($created_parent_ids),
                $expected_groups,
                $created_count,
                $expected_variations
            )
        );
    }

    foreach ($created_variation_ids as $variation_id) {
        $variation = wc_get_product($variation_id);
        if ($variation instanceof WC_Product_Variation) {
            $variation->set_status('publish');
            $variation->save();
        }
    }
    foreach ($created_parent_ids as $parent_id) {
        $product = wc_get_product($parent_id);
        if ($product instanceof WC_Product_Variable) {
            $image_id = (int) get_post_thumbnail_id($parent_id);
            $product->set_status($image_id > 0 && $image_id !== 2905 ? 'publish' : 'private');
            $product->save();
            WC_Product_Variable::sync($parent_id);
        }
    }

    $new_name_map = [];
    foreach ($created_parent_ids as $parent_id) {
        $new_name_map[wh_rebuild_name_key((string) get_the_title($parent_id))] = $parent_id;
    }
    $reviews_preserved = 0;
    $reviews_reattached = 0;
    foreach ($review_records as $review_record) {
        foreach ($review_record['comment_ids'] as $comment_id) {
            $reviews_preserved++;
            $key = wh_rebuild_name_key($review_record['old_product_name']);
            if ($key !== '' && isset($new_name_map[$key])) {
                $wpdb->update(
                    $wpdb->comments,
                    ['comment_post_ID' => $new_name_map[$key]],
                    ['comment_ID' => $comment_id],
                    ['%d'],
                    ['%d']
                );
                $reviews_reattached++;
            }
        }
    }
    wc_delete_product_transients();
    wp_cache_flush();
    $result = [
        'status' => 'rebuilt',
        'started_at' => $started_at,
        'completed_at' => gmdate('c'),
        'deleted_products' => count($old_product_ids),
        'deleted_variations' => $old_variation_count,
        'created_products' => count($created_parent_ids),
        'created_variations' => count($created_variation_ids),
        'failed_or_excluded' => $failure_count,
        'reviews_preserved' => $reviews_preserved,
        'reviews_reattached' => $reviews_reattached,
        'entries' => $entries,
    ];
    file_put_contents(
        $result_path,
        wp_json_encode($result, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . PHP_EOL
    );
    WP_CLI::log(wp_json_encode(array_diff_key($result, ['entries' => true])));
} catch (Throwable $error) {
    $result = [
        'status' => 'failed',
        'started_at' => $started_at,
        'completed_at' => gmdate('c'),
        'error' => $error->getMessage(),
        'created_products' => count($created_parent_ids),
        'created_variations' => count($created_variation_ids),
        'failed_or_excluded' => $failure_count,
        'entries' => $entries,
    ];
    file_put_contents(
        $result_path,
        wp_json_encode($result, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . PHP_EOL
    );
    WP_CLI::error($error->getMessage());
}

function wh_rebuild_name_key(string $value): string
{
    $value = mb_strtolower(
        wh_rebuild_normalize_whitespace(wp_strip_all_tags($value)),
        'UTF-8'
    );
    return preg_replace('/[^가-힣a-z0-9]/u', '', $value) ?: '';
}

function wh_rebuild_normalize_whitespace(string $value): string
{
    return trim((string) preg_replace('/\s+/u', ' ', $value));
}
