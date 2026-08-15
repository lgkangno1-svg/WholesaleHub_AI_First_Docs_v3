<?php

defined('ABSPATH') || exit;

@set_time_limit(0);
ini_set('memory_limit', '1024M');

$plan_path = getenv('WHOLESALEHUB_SYNC_PLAN');
$result_path = getenv('WHOLESALEHUB_SYNC_RESULT');
if (!is_string($plan_path) || $plan_path === '' || !is_string($result_path) || $result_path === '') {
    WP_CLI::error('sync plan/result environment is required');
}
$plan = json_decode((string) file_get_contents($plan_path), true, 512, JSON_THROW_ON_ERROR);
$groups = is_array($plan['groups'] ?? null) ? $plan['groups'] : [];
if ($groups === []) {
    WP_CLI::error('empty supplier catalog sync plan');
}
if (class_exists('WholesaleHub_Supplier_Lanes')) {
    WholesaleHub_Supplier_Lanes::install_schema();
}

global $wpdb;
$parent_table = $wpdb->prefix . 'supplier_lane_parent_links';
$offer_table = $wpdb->prefix . 'supplier_lane_offers';
$counts = [
    'collected_products' => (int) (($plan['counts']['dailyProducts'] ?? 0) + ($plan['counts']['walldoProducts'] ?? 0)),
    'images_found' => (int) ($plan['counts']['imagesFound'] ?? 0),
    'walldo_images_collected' => (int) ($plan['counts']['walldoImages'] ?? 0),
    'daily_images_collected' => (int) ($plan['counts']['dailyImages'] ?? 0),
    'image_retry_needed' => 0,
    'image_retry_required' => 0,
    'source_image_unavailable' => 0,
    'price_updated' => 0,
    'stock_updated' => 0,
    'variation_created' => 0,
    'product_created' => 0,
    'image_applied' => 0,
    'walldo_image_applied' => 0,
    'daily_image_applied' => 0,
    'existing_image_kept' => 0,
    'temporary_fallback_applied' => 0,
    'image_review_required' => 0,
    'image_failed' => 0,
    'excluded' => 0,
    'terminal_excluded' => 0,
    'nectarine_excluded' => 0,
    'legacy_parent_reconciled' => 0,
    'missing_marked_out_of_stock' => 0,
    'review_needed' => 0,
    'approval_pending_products' => 0,
    'approval_pending_options' => 0,
    'shipping_free_count' => 0,
    'shipping_fixed_count' => 0,
    'shipping_tiered_count' => 0,
    'shipping_unknown_count' => 0,
    'shipping_policy_updated' => 0,
    'failed' => 0,
];
$seen = [];
$reviews = [];
$image_retry_required_products = [];
$source_image_unavailable_products = [];
$touched_parents = [];
$variation_price_changes = [];
$shipping_mappings = [];
$exclusion_result = wh_sync_reconcile_terminal_exclusions(
    is_array($plan['exclusions'] ?? null) ? $plan['exclusions'] : [],
    $parent_table,
    $offer_table
);
$counts['excluded'] = $exclusion_result['excluded'];
$counts['terminal_excluded'] = $exclusion_result['terminal_excluded'];
$counts['nectarine_excluded'] = $exclusion_result['nectarine_excluded'];

foreach ($groups as $group) {
    try {
        $candidate_parent_ids = [];
        $mapped_lane_parents = [];
        foreach (($group['lanes'] ?? []) as $lane_code => $lane) {
            $existing_parent = $wpdb->get_var(
                $wpdb->prepare(
                    "SELECT woo_parent_id FROM {$parent_table}
                     WHERE supplier_id = %s AND source_product_id = %s AND status = 'approved'
                     LIMIT 1",
                    sanitize_key((string) $lane['supplierId']),
                    sanitize_text_field((string) $lane['sourceProductId'])
                )
            );
            if ($existing_parent !== null) {
                $candidate_parent_ids[] = (int) $existing_parent;
                $mapped_lane_parents[$lane_code] = (int) $existing_parent;
            }
        }
        $candidate_parent_ids = array_values(array_unique($candidate_parent_ids));
        if ($candidate_parent_ids === []) {
            $approval_group = $group;
            $approval_group['approvalCategories'] = wh_sync_determine_categories(
                sanitize_text_field((string) ($group['displayName'] ?? ''))
            );
            foreach (($group['lanes'] ?? []) as $lane_code => $lane) {
                $status = WholesaleHub_Supplier_Lane_Approval::stage_product(
                    $approval_group,
                    (string) $lane_code,
                    $lane
                );
                if (in_array($status, ['pending_mapping', 'on_hold'], true)) {
                    $counts['approval_pending_products']++;
                }
            }
            continue;
        }
        if (count($candidate_parent_ids) > 1) {
            $counts['review_needed']++;
            $reviews[] = [
                'reason' => 'existing_group_merge_ambiguous',
                'group_key' => (string) $group['groupKey'],
                'parent_ids' => $candidate_parent_ids,
            ];
            continue;
        }
        $parent_id = $candidate_parent_ids[0];
        $touched_parents[$parent_id] = true;

        $source_description = '';
        foreach (['A', 'B'] as $desc_lane) {
            $desc_src = $group['lanes'][$desc_lane] ?? null;
            if (is_array($desc_src) && !empty($desc_src['sourceDescription'])) {
                $source_description = (string) $desc_src['sourceDescription'];
                break;
            }
        }
        if ($source_description !== '') {
            update_post_meta($parent_id, '_wh_source_description', sanitize_textarea_field($source_description));
        }

        foreach (($group['lanes'] ?? []) as $lane_code => $lane) {
            $supplier_id = sanitize_key((string) $lane['supplierId']);
            $source_product_id = sanitize_text_field((string) $lane['sourceProductId']);
            if (!isset($mapped_lane_parents[$lane_code])) {
                $approval_group = $group;
                $approval_group['approvalCategories'] = wh_sync_determine_categories(
                    sanitize_text_field((string) ($group['displayName'] ?? ''))
                );
                $status = WholesaleHub_Supplier_Lane_Approval::stage_product(
                    $approval_group,
                    (string) $lane_code,
                    $lane
                );
                if (in_array($status, ['pending_mapping', 'on_hold'], true)) {
                    $counts['approval_pending_products']++;
                }
                continue;
            }
            if ((int) $mapped_lane_parents[$lane_code] !== $parent_id) {
                $counts['review_needed']++;
                $reviews[] = [
                    'reason' => 'manual_mapping_parent_conflict',
                    'parent_id' => $parent_id,
                    'mapped_parent_id' => (int) $mapped_lane_parents[$lane_code],
                    'lane' => $lane_code,
                    'incoming_source_product_id' => $source_product_id,
                ];
                continue;
            }
            $conflict = $wpdb->get_row(
                $wpdb->prepare(
                    "SELECT id, supplier_id, source_product_id FROM {$parent_table}
                     WHERE woo_parent_id = %d AND lane_code = %s LIMIT 1",
                    $parent_id,
                    $lane_code
                ),
                ARRAY_A
            );
            if (
                is_array($conflict)
                && (
                    (string) $conflict['supplier_id'] !== $supplier_id
                    || (string) $conflict['source_product_id'] !== $source_product_id
                )
            ) {
                $counts['review_needed']++;
                $reviews[] = [
                    'reason' => 'parent_lane_conflict',
                    'parent_id' => $parent_id,
                    'lane' => $lane_code,
                    'incoming_source_product_id' => $source_product_id,
                ];
                continue;
            }
            if (!is_array($conflict)) {
                $counts['review_needed']++;
                $reviews[] = [
                    'reason' => 'approved_mapping_disappeared',
                    'parent_id' => $parent_id,
                    'lane' => $lane_code,
                    'incoming_source_product_id' => $source_product_id,
                ];
                continue;
            }
            $parent_link_id = (int) $conflict['id'];

            foreach (($lane['options'] ?? []) as $option) {
                $source_option_id = sanitize_text_field((string) $option['sourceOptionId']);
                $identity = $supplier_id . '|' . $source_product_id . '|' . $source_option_id;
                $seen[$identity] = true;
                $existing = $wpdb->get_row(
                    $wpdb->prepare(
                        "SELECT * FROM {$offer_table}
                         WHERE supplier_id = %s AND source_product_id = %s
                           AND source_option_id = %s LIMIT 1",
                        $supplier_id,
                        $source_product_id,
                        $source_option_id
                    ),
                    ARRAY_A
                );
                if (is_array($existing)) {
                    if ((string) $existing['approval_status'] !== 'approved') {
                        if ((string) $existing['lifecycle_status'] !== 'terminal') {
                            WholesaleHub_Supplier_Lane_Approval::stage_option(
                                $parent_id,
                                (string) $lane_code,
                                $lane,
                                $option
                            );
                        }
                        continue;
                    }
                    $variation = wc_get_product((int) $existing['woo_variation_id']);
                    if (!($variation instanceof WC_Product_Variation)) {
                        $counts['failed']++;
                        continue;
                    }
                    $new_price = (float) $option['salePrice'];
                    $before_regular_price = (string) $variation->get_regular_price();
                    $before_price = (string) $variation->get_price();
                    $new_stock = ($option['stockStatus'] ?? '') === 'out_of_stock'
                        ? 'outofstock'
                        : 'instock';
                    $price_changed = (
                        (float) $variation->get_regular_price() !== $new_price
                        || (float) $variation->get_price() !== $new_price
                    );
                    if ($price_changed) {
                        $variation->set_regular_price(wc_format_decimal($new_price, 2));
                        $variation->set_price(wc_format_decimal($new_price, 2));
                        $counts['price_updated']++;
                    }
                    if ($variation->get_stock_status() !== $new_stock) {
                        $variation->set_stock_status($new_stock);
                        $counts['stock_updated']++;
                    }
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
                    $sp_type = (string) ($option['shipping_policy']['shipping_policy_type'] ?? 'unknown');
                    $sp_status = (string) ($option['shipping_policy']['shipping_validation_status'] ?? 'review_required');
                    if ($sp_status !== 'valid') {
                        $previous_policy = json_decode((string) ($existing['shipping_policy_json'] ?? ''), true);
                        if (is_array($previous_policy) && ($previous_policy['shipping_validation_status'] ?? '') === 'valid') {
                            $option['shipping_policy'] = $previous_policy;
                            $previous_group_key = (string) $variation->get_meta('_wh_shipping_policy_group_key');
                            if ($previous_group_key !== '') {
                                $option['shipping_policy_group_key'] = $previous_group_key;
                            }
                            $sp_type = (string) ($previous_policy['shipping_policy_type'] ?? 'unknown');
                        } else {
                            $counts['shipping_unknown_count']++;
                            $reviews[] = [
                                'reason' => 'shipping_policy_review_required',
                                'supplier_id' => $supplier_id,
                                'source_product_id' => $source_product_id,
                                'source_option_id' => $source_option_id,
                            ];
                            continue;
                        }
                    }
                    if ($sp_type === 'free') {
                        $counts['shipping_free_count']++;
                    } elseif ($sp_type === 'fixed') {
                        $counts['shipping_fixed_count']++;
                    } elseif ($sp_type === 'quantity_tiered') {
                        $counts['shipping_tiered_count']++;
                    } else {
                        $counts['shipping_unknown_count']++;
                    }
                    $old_sp_json = (string) $variation->get_meta('_wh_shipping_policy');
                    $previous_woo_policy = $old_sp_json !== '' ? json_decode($old_sp_json, true) : null;
                    if (
                        is_array($previous_woo_policy)
                        && wh_shipping_policy_identity($previous_woo_policy) === wh_shipping_policy_identity($option['shipping_policy'])
                    ) {
                        $option['shipping_policy'] = $previous_woo_policy;
                    }
                    $new_sp_json = isset($option['shipping_policy']) ? (string) wp_json_encode($option['shipping_policy']) : '';
                    if ($old_sp_json !== $new_sp_json) {
                        $counts['shipping_policy_updated']++;
                    }
                    wh_sync_source_spec_meta($variation, $option);
                    $variation->set_status('publish');
                    $variation->save();
                    if ($price_changed) {
                        $verified_variation = wc_get_product($variation->get_id());
                        if (
                            !($verified_variation instanceof WC_Product_Variation)
                            || (float) $verified_variation->get_regular_price() !== $new_price
                            || (float) $verified_variation->get_price() !== $new_price
                        ) {
                            throw new RuntimeException(
                                'variation price read-back verification failed: '
                                . $variation->get_id()
                            );
                        }
                        $variation_price_changes[] = [
                            'variation_id' => (int) $variation->get_id(),
                            'parent_id' => $parent_id,
                            'before_regular_price' => $before_regular_price,
                            'before_price' => $before_price,
                            'after_regular_price' => (string) $verified_variation->get_regular_price(),
                            'after_price' => (string) $verified_variation->get_price(),
                            'verified' => true,
                        ];
                    }
                    $wpdb->update(
                        $offer_table,
                        [
                            'parent_link_id' => $parent_link_id,
                            'woo_parent_id' => $parent_id,
                            'public_option_label' => sanitize_text_field(
                                (string) $option['publicOptionLabel']
                            ),
                            'option_label_raw' => sanitize_text_field(
                                (string) ($option['sourceOptionLabel'] ?? $option['publicOptionLabel'])
                            ),
                            'source_cost' => (float) $option['sourceCost'],
                            'source_shipping_cost' => (float) $option['shippingFee'],
                            'landed_cost' => (float) $option['landedCost'],
                            'sale_price' => $new_price,
                            'stock_status' => $new_stock === 'instock'
                                ? 'in_stock'
                                : 'out_of_stock',
                            'shipping_policy_json' => isset($option['shipping_policy']) && is_array($option['shipping_policy'])
                                ? wp_json_encode($option['shipping_policy'])
                                : null,
                            'approval_status' => 'approved',
                            'lifecycle_status' => 'active',
                            'last_snapshot_hash' => (string) $option['snapshotHash'],
                            'last_complete_run_id' => 'catalog-incremental-sync',
                            'last_seen_at' => current_time('mysql', true),
                            'missing_complete_count' => 0,
                            'updated_at' => current_time('mysql', true),
                        ],
                        ['id' => (int) $existing['id']]
                    );
                    $shipping_mappings[] = [
                        'supplier_id' => $supplier_id,
                        'source_product_id' => $source_product_id,
                        'source_option_id' => $source_option_id,
                        'woo_parent_id' => $parent_id,
                        'woo_variation_id' => (int) $variation->get_id(),
                        'public_offer_key' => (string) ($existing['public_offer_key'] ?? ''),
                        'previous_shipping_policy' => $old_sp_json !== ''
                            ? json_decode($old_sp_json, true)
                            : null,
                        'shipping_policy' => $option['shipping_policy'],
                        'shipping_policy_changed' => $old_sp_json !== $new_sp_json,
                    ];
                } else {
                    $status = WholesaleHub_Supplier_Lane_Approval::stage_option(
                        $parent_id,
                        (string) $lane_code,
                        $lane,
                        $option
                    );
                    if (in_array($status, ['pending_option', 'on_hold'], true)) {
                        $counts['approval_pending_options']++;
                    } elseif ($status === 'failed' || $status === 'invalid') {
                        $counts['failed']++;
                    }
                }
            }
        }
        $image_result = wh_sync_ensure_parent_image($parent_id, $group);
        $image_status = (string) ($image_result['status'] ?? 'image_failed');
        if (array_key_exists($image_status, $counts)) {
            $counts[$image_status]++;
        } else {
            $counts['image_failed']++;
        }
        if ($image_status === 'image_applied') {
            $source_type = (string) ($image_result['image_source_type'] ?? '');
            if ($source_type === 'walldob2b_actual_product') {
                $counts['walldo_image_applied']++;
            } elseif ($source_type === 'dailyfood_actual_product') {
                $counts['daily_image_applied']++;
            }
        }
        if (in_array($image_status, ['image_review_required', 'image_failed'], true)) {
            $image_product = wh_sync_image_product_row($parent_id, $group, $image_result);
            $counts['image_retry_required']++;
            $image_retry_required_products[] = $image_product;
            $reviews[] = [
                'reason' => $image_status,
                'parent_id' => $parent_id,
                'product_name' => get_the_title($parent_id),
                'error' => (string) ($image_result['error'] ?? ''),
            ];
        } elseif (($image_result['source_image_status'] ?? '') === 'unavailable') {
            $counts['source_image_unavailable']++;
            $source_image_unavailable_products[] = wh_sync_image_product_row(
                $parent_id,
                $group,
                $image_result
            );
        }
    } catch (Throwable $error) {
        $counts['failed']++;
        $reviews[] = [
            'reason' => 'sync_group_failed',
            'group_key' => (string) ($group['groupKey'] ?? ''),
            'error' => $error->getMessage(),
        ];
    }
}

$active_offers = $wpdb->get_results(
    "SELECT id, supplier_id, source_product_id, source_option_id, woo_variation_id
     FROM {$offer_table} WHERE lifecycle_status = 'active'",
    ARRAY_A
);
foreach ($active_offers as $offer) {
    $identity = implode('|', [
        (string) $offer['supplier_id'],
        (string) $offer['source_product_id'],
        (string) $offer['source_option_id'],
    ]);
    if (isset($seen[$identity])) {
        continue;
    }
    $variation = wc_get_product((int) $offer['woo_variation_id']);
    if ($variation instanceof WC_Product_Variation) {
        $variation->set_stock_status('outofstock');
        $variation->save();
    }
    $wpdb->update(
        $offer_table,
        [
            'stock_status' => 'out_of_stock',
            'lifecycle_status' => 'inactive',
            'missing_complete_count' => ((int) ($offer['missing_complete_count'] ?? 0)) + 1,
            'updated_at' => current_time('mysql', true),
        ],
        ['id' => (int) $offer['id']]
    );
    $counts['missing_marked_out_of_stock']++;
}

foreach (array_keys($touched_parents) as $parent_id) {
    wh_sync_refresh_parent_attributes((int) $parent_id, $offer_table);
    WC_Product_Variable::sync((int) $parent_id);
}
wc_delete_product_transients();
wp_cache_flush();
$counts['image_retry_needed'] = $counts['image_retry_required'];
$approval_counts = WholesaleHub_Supplier_Lane_Approval::pending_counts();
$counts['approval_pending_products'] = (int) $approval_counts['products'];
$counts['approval_pending_options'] = (int) $approval_counts['options'];
$result = [
    'status' => 'completed',
    'completed_at' => gmdate('c'),
    'counts' => $counts,
    'reviews' => $reviews,
    'image_retry_required_products' => $image_retry_required_products,
    'source_image_unavailable_products' => $source_image_unavailable_products,
    'variation_price_changes' => $variation_price_changes,
    'shipping_mappings' => $shipping_mappings,
];
file_put_contents(
    $result_path,
    wp_json_encode($result, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . PHP_EOL
);
WP_CLI::log(wp_json_encode($result));

function wh_sync_should_exclude_title(string $title): bool
{
    $excluded = ['가성비', '부사 사과', '부사사과', '부사', '피자두', '예치금', '포인트 충전'];
    foreach ($excluded as $kw) {
        if (mb_strpos($title, $kw) !== false) {
            return true;
        }
    }
    return false;
}

function wh_sync_reconcile_terminal_exclusions(
    array $exclusions,
    string $parent_table,
    string $offer_table
): array {
    global $wpdb;
    $targets = [];
    foreach ($exclusions as $entry) {
        $reason = sanitize_key((string) ($entry['reason'] ?? ''));
        if (!in_array($reason, ['terminal_excluded', 'nectarine_family_excluded'], true)) {
            continue;
        }
        $supplier_id = sanitize_key((string) ($entry['supplier'] ?? ''));
        $source_product_id = sanitize_text_field((string) ($entry['sourceProductId'] ?? ''));
        if ($supplier_id === '' || $source_product_id === '') {
            continue;
        }
        $targets[$supplier_id . '|' . $source_product_id] = [
            'supplier_id' => $supplier_id,
            'source_product_id' => $source_product_id,
            'reason' => $reason,
        ];
    }
    $product_ids = get_posts([
        'post_type' => 'product',
        'post_status' => ['publish', 'private', 'draft', 'pending'],
        'numberposts' => -1,
        'fields' => 'ids',
        's' => '가성비',
        'meta_query' => [[
            'key' => '_wh_supplier_lane_mode',
            'value' => '1',
        ]],
    ]);
    foreach ($product_ids as $product_id) {
        if (mb_strpos((string) get_the_title($product_id), '가성비') !== false) {
            $targets['woo|' . (int) $product_id] = [
                'woo_parent_id' => (int) $product_id,
                'reason' => 'terminal_excluded',
            ];
        }
    }
    $counts = ['excluded' => 0, 'terminal_excluded' => 0, 'nectarine_excluded' => 0];
    $handled = [];
    foreach ($targets as $target) {
        $parent_ids = [];
        if (isset($target['woo_parent_id'])) {
            $parent_ids[] = (int) $target['woo_parent_id'];
        } else {
            $parent_ids = array_map(
                'intval',
                $wpdb->get_col(
                    $wpdb->prepare(
                        "SELECT woo_parent_id FROM {$parent_table}
                         WHERE supplier_id = %s AND source_product_id = %s",
                        $target['supplier_id'],
                        $target['source_product_id']
                    )
                )
            );
        }
        foreach (array_unique($parent_ids) as $parent_id) {
            if ($parent_id <= 0 || isset($handled[$parent_id])) {
                continue;
            }
            $handled[$parent_id] = true;
            $reason = (string) $target['reason'];
            $product = wc_get_product($parent_id);
            if ($product instanceof WC_Product) {
                $product->set_status('private');
                $product->set_catalog_visibility('hidden');
                $product->update_meta_data('_wh_terminal_excluded', '1');
                $product->update_meta_data('_wh_terminal_exclusion_reason', $reason);
                $product->save();
            }
            foreach (wc_get_products([
                'type' => 'variation',
                'parent' => $parent_id,
                'limit' => -1,
                'status' => ['publish', 'private'],
            ]) as $variation) {
                if (!($variation instanceof WC_Product_Variation)) {
                    continue;
                }
                $variation->set_status('private');
                $variation->set_stock_status('outofstock');
                $variation->save();
            }
            $wpdb->update(
                $parent_table,
                ['status' => 'terminal_excluded', 'updated_at' => current_time('mysql', true)],
                ['woo_parent_id' => $parent_id]
            );
            $wpdb->update(
                $offer_table,
                [
                    'approval_status' => 'rejected',
                    'lifecycle_status' => 'terminal',
                    'stock_status' => 'out_of_stock',
                    'updated_at' => current_time('mysql', true),
                ],
                ['woo_parent_id' => $parent_id]
            );
            $counts['excluded']++;
            if ($reason === 'terminal_excluded') {
                $counts['terminal_excluded']++;
            } else {
                $counts['nectarine_excluded']++;
            }
        }
    }
    return $counts;
}

function wh_sync_ensure_parent_image(int $parent_id, array $group): array
{
    global $wpdb;
    $current_id = (int) get_post_thumbnail_id($parent_id);
    $incoming_type = sanitize_key((string) ($group['image_source_type'] ?? ''));
    $incoming_hash = sanitize_text_field((string) ($group['image_content_hash'] ?? ''));
    $image_url = esc_url_raw((string) ($group['source_image_url'] ?? ''), ['https']);
    $incoming_valid = (
        $image_url !== ''
        && ($group['image_validation_status'] ?? '') === 'valid'
        && $incoming_hash !== ''
        && (int) ($group['image_width'] ?? 0) >= 300
        && (int) ($group['image_height'] ?? 0) >= 300
        && !wh_sync_forbidden_image_url($image_url)
    );
    $state = wh_sync_current_image_state(
        $parent_id,
        $current_id,
        $incoming_type,
        $incoming_hash,
        $incoming_valid
    );
    if ($state === 'keep') {
        if (!$incoming_valid) {
            $recheck_after = (string) get_post_meta(
                $parent_id,
                '_wholesalehub_source_image_recheck_after',
                true
            );
            if ($recheck_after === '') {
                $recheck_after = gmdate('c', time() + (7 * DAY_IN_SECONDS));
                update_post_meta(
                    $parent_id,
                    '_wholesalehub_source_image_recheck_after',
                    $recheck_after
                );
            }
            update_post_meta($parent_id, '_wholesalehub_source_image_status', 'unavailable');
            update_post_meta($parent_id, '_wholesalehub_image_validation_status', 'valid');
            return [
                'status' => 'existing_image_kept',
                'source_image_status' => 'unavailable',
                'recheck_after' => $recheck_after,
                'error' => 'validated supplier image unavailable; existing thumbnail kept',
            ];
        }
        update_post_meta($parent_id, '_wholesalehub_source_image_status', 'available');
        delete_post_meta($parent_id, '_wholesalehub_source_image_recheck_after');
        return ['status' => 'existing_image_kept', 'source_image_status' => 'available'];
    }
    if (!$incoming_valid) {
        if ($state === 'replace' && $current_id > 0) {
            delete_post_thumbnail($parent_id);
        }
        update_post_meta($parent_id, '_wholesalehub_source_image_status', 'unavailable');
        update_post_meta($parent_id, '_wholesalehub_image_validation_status', 'review_required');
        return [
            'status' => 'image_review_required',
            'source_image_status' => 'unavailable',
            'error' => 'validated supplier image missing',
        ];
    }
    $attachment_id = (int) $wpdb->get_var(
        $wpdb->prepare(
            "SELECT post_id FROM {$wpdb->postmeta}
             WHERE (meta_key = '_wholesalehub_image_content_hash' AND meta_value = %s)
                OR (meta_key = '_wholesalehub_source_image_url' AND meta_value = %s)
             ORDER BY post_id ASC LIMIT 1",
            $incoming_hash,
            $image_url
        )
    );
    $created = false;
    if ($attachment_id <= 0 || !wp_attachment_is_image($attachment_id)) {
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        require_once ABSPATH . 'wp-admin/includes/image.php';
        $imported = media_sideload_image(
            $image_url,
            $parent_id,
            get_the_title($parent_id),
            'id'
        );
        if (is_wp_error($imported)) {
            update_post_meta($parent_id, '_wholesalehub_image_validation_status', 'failed');
            return [
                'status' => 'image_failed',
                'error' => sanitize_text_field($imported->get_error_message()),
            ];
        }
        $attachment_id = (int) $imported;
        $created = true;
    }
    $file = get_attached_file($attachment_id);
    $metadata = wp_get_attachment_metadata($attachment_id);
    $actual_hash = is_string($file) && is_file($file) ? hash_file('sha256', $file) : '';
    if (
        !is_array($metadata)
        || (int) ($metadata['width'] ?? 0) < 300
        || (int) ($metadata['height'] ?? 0) < 300
        || !hash_equals($incoming_hash, (string) $actual_hash)
    ) {
        if ($created) {
            wp_delete_attachment($attachment_id, true);
        }
        update_post_meta($parent_id, '_wholesalehub_image_validation_status', 'failed');
        return ['status' => 'image_failed', 'error' => 'downloaded image verification failed'];
    }
    $previous_id = $current_id;
    if (!set_post_thumbnail($parent_id, $attachment_id)) {
        if ($created) {
            wp_delete_attachment($attachment_id, true);
        }
        return ['status' => 'image_failed', 'error' => 'set_post_thumbnail failed'];
    }
    update_post_meta($attachment_id, '_wholesalehub_source_image_url', $image_url);
    update_post_meta($attachment_id, '_wholesalehub_image_content_hash', $incoming_hash);
    update_post_meta($attachment_id, '_wholesalehub_image_source_type', $incoming_type);
    update_post_meta($attachment_id, '_wholesalehub_image_collected_at', (string) ($group['image_collected_at'] ?? gmdate('c')));
    update_post_meta($attachment_id, '_wholesalehub_image_source_product_name', get_the_title($parent_id));
    update_post_meta($parent_id, '_wholesalehub_source_image_url', $image_url);
    update_post_meta($parent_id, '_wholesalehub_image_content_hash', $incoming_hash);
    update_post_meta($parent_id, '_wholesalehub_image_source_type', $incoming_type);
    update_post_meta($parent_id, '_wholesalehub_image_collected_at', (string) ($group['image_collected_at'] ?? gmdate('c')));
    update_post_meta($parent_id, '_wholesalehub_image_validation_status', 'valid');
    update_post_meta($parent_id, '_wholesalehub_source_image_status', 'available');
    delete_post_meta($parent_id, '_wholesalehub_source_image_recheck_after');
    update_post_meta($parent_id, '_wholesalehub_temporary_fallback', '0');
    update_post_meta($parent_id, '_wholesalehub_thumbnail_synced_at', gmdate('c'));
    if ((int) get_post_thumbnail_id($parent_id) !== $attachment_id) {
        if ($previous_id > 0) {
            set_post_thumbnail($parent_id, $previous_id);
        } else {
            delete_post_thumbnail($parent_id);
        }
        if ($created) {
            wp_delete_attachment($attachment_id, true);
        }
        return ['status' => 'image_failed', 'error' => 'thumbnail read-back verification failed'];
    }
    return [
        'status' => 'image_applied',
        'attachment_id' => $attachment_id,
        'image_source_type' => $incoming_type,
    ];
}

function wh_sync_current_image_state(
    int $parent_id,
    int $attachment_id,
    string $incoming_type,
    string $incoming_hash,
    bool $incoming_valid
): string {
    if ($attachment_id <= 0 || $attachment_id === 2905 || !wp_attachment_is_image($attachment_id)) {
        return 'replace';
    }
    $url = (string) wp_get_attachment_url($attachment_id);
    if ($url === '' || wh_sync_forbidden_image_url($url)) {
        return 'replace';
    }
    if (
        get_post_meta($parent_id, '_wholesalehub_temporary_fallback', true) === '1'
        || get_post_meta($attachment_id, '_wholesalehub_temporary_fallback', true) === '1'
    ) {
        return 'replace';
    }
    $current_type = sanitize_key((string) get_post_meta(
        $attachment_id,
        '_wholesalehub_image_source_type',
        true
    ));
    $current_hash = sanitize_text_field((string) get_post_meta(
        $attachment_id,
        '_wholesalehub_image_content_hash',
        true
    ));
    if (
        $incoming_valid
        && get_post_meta($parent_id, '_wholesalehub_source_image_status', true) === 'unavailable'
    ) {
        return 'replace';
    }
    if ($current_type === '') {
        return 'keep';
    }
    if ($current_hash !== '' && $incoming_hash !== '' && hash_equals($current_hash, $incoming_hash)) {
        return 'keep';
    }
    if ($current_type === 'walldob2b_actual_product') {
        return 'keep';
    }
    if ($current_type === 'dailyfood_actual_product' && $incoming_type !== 'walldob2b_actual_product') {
        return 'keep';
    }
    return 'replace';
}

function wh_sync_image_product_row(int $parent_id, array $group, array $image_result): array
{
    $lanes = array_values(is_array($group['lanes'] ?? null) ? $group['lanes'] : []);
    $lane = is_array($lanes[0] ?? null) ? $lanes[0] : [];
    return [
        'parent_id' => $parent_id,
        'product_name' => get_the_title($parent_id),
        'supplier_id' => sanitize_key((string) ($lane['supplierId'] ?? '')),
        'source_product_id' => sanitize_text_field((string) ($lane['sourceProductId'] ?? '')),
        'thumbnail_id' => (int) get_post_thumbnail_id($parent_id),
        'thumbnail_status' => wh_sync_current_thumbnail_status($parent_id),
        'source_image_url' => esc_url_raw((string) ($group['source_image_url'] ?? ''), ['https']),
        'source_image_status' => (string) ($image_result['source_image_status'] ?? ''),
        'retry_reason' => (string) ($image_result['error'] ?? ''),
        'recheck_after' => (string) ($image_result['recheck_after'] ?? ''),
    ];
}

function wh_sync_current_thumbnail_status(int $parent_id): string
{
    $attachment_id = (int) get_post_thumbnail_id($parent_id);
    if ($attachment_id <= 0) {
        return 'missing';
    }
    if ($attachment_id === 2905 || !wp_attachment_is_image($attachment_id)) {
        return 'placeholder_or_broken';
    }
    $url = (string) wp_get_attachment_url($attachment_id);
    if ($url === '' || wh_sync_forbidden_image_url($url)) {
        return 'placeholder_or_broken';
    }
    if (
        get_post_meta($parent_id, '_wholesalehub_temporary_fallback', true) === '1'
        || get_post_meta($attachment_id, '_wholesalehub_temporary_fallback', true) === '1'
    ) {
        return 'temporary_fallback';
    }
    return 'normal';
}

function wh_sync_forbidden_image_url(string $url): bool
{
    $value = strtolower(rawurldecode($url));
    return preg_match(
        '/(?:adminplus[_-](?:600|common)|no[_-]?(?:image|img|photo)|placeholder|default[_-]?(?:image|img)|logo|banner|icon|common|basket|button)/i',
        $value
    ) === 1;
}

function wh_sync_determine_categories(string $title): array
{
    // Dual category targets (가공식품 + 공동구매)
    $both_targets = ['양념목살', '제육볶음', '콩물', '박포갈비', '소곱창', '국민과자', '리포'];
    foreach ($both_targets as $t) {
        if (mb_strpos($title, $t) !== false) {
            return ['가공식품', '공동구매'];
        }
    }

    // Processed food indicators (김치, 젓갈, 액젓, 무침, 식해, 만두 등) MUST be ONLY 가공식품
    $processed_overrides = ['김치', '겉절이', '양념', '젓갈', '낙지젓', '가리비젓', '갈치쌈젓', '멍게젓', '명란젓', '오징어젓', '창난젓', '청어알', '액젓', '멸치액젓', '무침', '가오리', '회무침', '식해', '밀키트', '납작만두', '과자'];
    foreach ($processed_overrides as $po) {
        if (mb_strpos($title, $po) !== false) {
            return ['가공식품'];
        }
    }

    static $cat_rules = [
        '농산물' => ['과일', '채소', '곡물', '버섯', '나물', '쌀', '감자', '고구마', '옥수수', '수박', '참외', '복숭아', '포도', '사과', '배', '감귤', '양파', '마늘', '배추', '무', '당근', '콩', '자두', '살구', '체리', '토마토', '대추', '참다래', '키위', '멜론', '메론', '단감', '곶감', '한라봉', '천혜향', '레드향', '황금향', '귤', '오렌지', '배추', '무우', '파', '상추', '깻잎', '시금치', '부추', '호박', '가지', '오이', '고추', '파프리카', '피망', '우엉', '연근', '더덕', '도라지', '생강', '취나물', '고사리', '곤드레', '느타리', '팽이', '새송이', '표고', '양송이', '현미', '찹쌀', '보리', '조', '수수', '팥', '녹두', '밤', '잣', '호두', '땅콩', '자몽', '아보카도', '샤인머스켓', '거봉', '용과', '새싹삼', '마카다미아'],
        '수산물' => ['생선', '해산물', '어패류', '건어물', '오징어', '문어', '새우', '전복', '조개', '굴', '고등어', '갈치', '멸치', '김', '미역', '다시마', '톳', '모자반', '낙지', '쭈꾸미', '주꾸미', '갑오징어', '한치', '게', '대게', '홍게', '킹크랩', '랍스터', '바지락', '홍합', '꼬막', '재첩', '가리비', '소라', '멍게', '해삼', '개불', '성게', '명태', '동태', '생태', '황태', '코다리', '노가리', '가자미', '삼치', '꽁치', '임연수', '조기', '굴비', '옥돔', '민어', '농어', '우럭', '광어', '참돔', '돌돔', '감성돔', '연어', '송어', '장어', '아구', '아구찜', '아게', '쥐포', '오징어채', '진미채', '대구', '대구탕', '명란'],
        '축산물' => ['소고기', '돼지고기', '닭고기', '계란', '한우', '육우', '돈육', '삼겹살', '목살', '갈비', '등심', '안심', '채끝', '양지', '사골', '우족', '도가니', '차돌박이', '우삼겹', '대패삼겹', '항정살', '가브리살', '갈매기살', '돼지갈비', '족발', '보쌈', '편육', '닭', '토종닭', '오리', '오리고기', '염소', '양고기', '양갈비', '달걀', '유정란', '메추리알', '뒷고기', '흑돼지', '구운란'],
        '가공식품' => ['반찬', '소스', '주스', '음료', '떡', '만두', '냉동', '조리', '가공', '절임', '포장', '장류', '고추장', '된장', '간장', '쌈장', '식초', '기름', '참기름', '들기름', '식용유', '카레', '짜장', '스프', '국', '탕', '찌개', '전골', '밀키트', '간편식', '육가공', '햄', '소시지', '베이컨', '돈까스', '치킨', '너겟', '어묵', '맛살', '면', '국수', '냉면', '쫄면', '우동', '라면', '당면', '통조림', '캔', '잼', '청', '엑기스', '즙', '차', '커피', '시럽', '빵', '쿠키', '스낵', '부각', '부침개', '전', '튀김', '두유', '요거트', '치즈', '버터', '마카다미아'],
        '공동구매' => ['공동구매', '공구']
    ];

    $matched = [];
    foreach ($cat_rules as $cat_name => $keywords) {
        foreach ($keywords as $kw) {
            if (mb_strpos($title, $kw) !== false) {
                $matched[] = $cat_name;
                break;
            }
        }
    }
    return !empty($matched) ? array_values(array_unique($matched)) : ['가공식품'];
}

function wh_sync_source_spec_meta(WC_Product_Variation $variation, array $option): void
{
    $fields = [
        '_wh_source_option_label' => 'sourceOptionLabel',
        '_wh_source_option_name' => 'sourceOptionName',
        '_wh_source_spec_note' => 'sourceSpecNote',
        '_wh_source_size_label' => 'sourceSizeLabel',
        '_wh_source_weight_label' => 'sourceWeightLabel',
        '_wh_source_count_label' => 'sourceCountLabel',
        '_wh_source_package_label' => 'sourcePackageLabel',
    ];
    foreach ($fields as $meta_key => $option_key) {
        $variation->update_meta_data(
            $meta_key,
            sanitize_text_field((string) ($option[$option_key] ?? ''))
        );
    }
    if (isset($option['shipping_policy']) && is_array($option['shipping_policy'])) {
        $variation->update_meta_data(
            '_wh_shipping_policy',
            wp_json_encode($option['shipping_policy'])
        );
    }
    $variation->update_meta_data(
        '_wh_shipping_policy_group_key',
        sanitize_text_field((string) ($option['shipping_policy_group_key'] ?? ''))
    );
}

function wh_shipping_policy_identity(array $policy): string
{
    unset($policy['shipping_collected_at']);
    return (string) wp_json_encode($policy);
}

function wh_sync_refresh_parent_attributes(int $parent_id, string $offer_table): void
{
    global $wpdb;
    $rows = $wpdb->get_results(
        $wpdb->prepare(
            "SELECT lane_code, public_option_label FROM {$offer_table}
             WHERE woo_parent_id = %d AND approval_status = 'approved'
               AND lifecycle_status = 'active' ORDER BY lane_code, public_option_label",
            $parent_id
        ),
        ARRAY_A
    );
    $lane_labels = [];
    $option_labels = [];
    foreach ($rows as $row) {
        $lane_labels[] = $row['lane_code'] === 'A' ? 'A사' : 'B사';
        $option_labels[] = sanitize_text_field((string) $row['public_option_label']);
    }
    $product = wc_get_product($parent_id);
    if (!($product instanceof WC_Product_Variable) || $option_labels === []) {
        return;
    }
    $lane_attribute = new WC_Product_Attribute();
    $lane_attribute->set_name('출고구분');
    $lane_attribute->set_options(array_values(array_unique($lane_labels)));
    $lane_attribute->set_position(0);
    $lane_attribute->set_visible(true);
    $lane_attribute->set_variation(true);
    $option_attribute = new WC_Product_Attribute();
    $option_attribute->set_name('구매옵션');
    $option_attribute->set_options(array_values(array_unique($option_labels)));
    $option_attribute->set_position(1);
    $option_attribute->set_visible(true);
    $option_attribute->set_variation(true);
    $product->set_attributes([$lane_attribute, $option_attribute]);
    $image_id = (int) get_post_thumbnail_id($parent_id);
    $product->set_status($image_id > 0 && $image_id !== 2905 ? 'publish' : 'private');
    $product->save();
}
