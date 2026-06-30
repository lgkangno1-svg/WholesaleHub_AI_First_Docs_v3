<?php
/**
 * Admin-only supplier visibility and order snapshots for WholesaleHub.
 *
 * Customer-facing templates, emails, checkout, my account, and order confirmation
 * pages must not receive supplier/source/cost details from this file.
 */
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

function avocadoss_hub_supplier_id_from_value( $value ) {
    $supplier = strtolower( trim( (string) $value ) );
    if ( '' === $supplier ) {
        return 'unknown';
    }
    if ( false !== strpos( $supplier, 'dailyfood' ) || false !== strpos( $supplier, 'daily' ) ) {
        return 'dailyfood';
    }
    if ( false !== strpos( $supplier, 'walldob2b' ) || false !== strpos( $supplier, 'walldo' ) || false !== strpos( $supplier, 'wall' ) ) {
        return 'walldob2b';
    }
    return 'unknown';
}

function avocadoss_hub_supplier_label( $supplier_id ) {
    $supplier = avocadoss_hub_supplier_id_from_value( $supplier_id );
    if ( 'dailyfood' === $supplier ) {
        return '데일리';
    }
    if ( 'walldob2b' === $supplier ) {
        return '월억';
    }
    return '미확인';
}

function avocadoss_hub_first_meta_value( $post_id, $keys ) {
    foreach ( $keys as $key ) {
        $value = get_post_meta( $post_id, $key, true );
        if ( '' !== $value && null !== $value ) {
            return is_scalar( $value ) ? (string) $value : wp_json_encode( $value, JSON_UNESCAPED_UNICODE );
        }
    }
    return '';
}

function avocadoss_hub_supplier_meta( $variation_id, $product_id = 0 ) {
    $ids = array_filter( array( absint( $variation_id ), absint( $product_id ) ) );
    $read = static function( $keys ) use ( $ids ) {
        foreach ( $ids as $id ) {
            $value = avocadoss_hub_first_meta_value( $id, $keys );
            if ( '' !== $value ) {
                return $value;
            }
        }
        return '';
    };

    $supplier_id = avocadoss_hub_supplier_id_from_value(
        $read(
            array(
                '_selected_supplier_id',
                '_wholesalehub_selected_supplier_id',
                '_supplier_id',
                '_wholesalehub_supplier_id',
                '_b2b_source',
            )
        )
    );

    return array(
        'supplier_id'           => $supplier_id,
        'supplier_label'        => avocadoss_hub_supplier_label( $supplier_id ),
        'source_product_id'     => $read( array( '_source_product_id', '_wholesalehub_source_product_id' ) ),
        'source_option_id'      => $read( array( '_source_option_id', '_wholesalehub_source_option_id' ) ),
        'original_product_name' => $read( array( '_original_product_name', '_wholesalehub_original_product_name' ) ),
        'original_option_name'  => $read( array( '_original_option_name', '_wholesalehub_original_option_name' ) ),
        'product_group_key'     => $read( array( '_product_group_key', '_wholesalehub_product_group_key' ) ),
        'normalized_option_key' => $read( array( '_normalized_option_key', '_wholesalehub_normalized_option_key' ) ),
        'last_synced_at'        => $read( array( '_last_synced_at', '_wholesalehub_last_synced_at', '_wholesalehub_synced_at' ) ),
    );
}


function avocadoss_hub_normalized_review_key( $value ) {
    $normalized = function_exists( 'mb_strtolower' ) ? mb_strtolower( wp_strip_all_tags( (string) $value ), 'UTF-8' ) : strtolower( wp_strip_all_tags( (string) $value ) );
    return preg_replace( '/[^가-힣a-z0-9.]+/u', '', $normalized );
}

function avocadoss_hub_variation_option_name( $variation ) {
    if ( ! $variation || ! is_callable( array( $variation, 'get_attributes' ) ) ) {
        return '';
    }
    $values = array();
    foreach ( $variation->get_attributes() as $value ) {
        if ( '' !== (string) $value ) {
            $values[] = (string) $value;
        }
    }
    return implode( ' / ', $values );
}

function avocadoss_hub_review_option_key( $value ) {
    $normalized = function_exists( 'mb_strtolower' ) ? mb_strtolower( (string) $value, 'UTF-8' ) : strtolower( (string) $value );
    preg_match_all( '/\d+(?:\.\d+)?\s*(?:kg|g|개입|개|팩|봉|박스|망|과|r|센치|cm)/iu', $normalized, $matches );
    if ( ! empty( $matches[0] ) ) {
        return implode( '|', array_map( 'avocadoss_hub_normalized_review_key', $matches[0] ) );
    }
    return avocadoss_hub_normalized_review_key( $normalized );
}

function avocadoss_hub_product_review_option_keys( $product ) {
    if ( ! $product ) {
        return array();
    }
    $keys = array();
    if ( $product->is_type( 'variable' ) ) {
        foreach ( $product->get_children() as $variation_id ) {
            $variation = function_exists( 'wc_get_product' ) ? wc_get_product( $variation_id ) : null;
            $option    = avocadoss_hub_variation_option_name( $variation );
            if ( '' !== $option ) {
                $keys[] = avocadoss_hub_review_option_key( $option );
            }
        }
    }
    return array_values( array_unique( array_filter( $keys ) ) );
}

function avocadoss_hub_published_review_summaries() {
    static $summaries = null;
    if ( null !== $summaries ) {
        return $summaries;
    }
    $summaries = array();
    if ( ! function_exists( 'wc_get_products' ) ) {
        return $summaries;
    }
    $products = wc_get_products(
        array(
            'status' => 'publish',
            'limit'  => -1,
            'return' => 'objects',
        )
    );
    foreach ( $products as $product ) {
        $summaries[] = array(
            'id'      => $product->get_id(),
            'name'    => $product->get_name(),
            'key'     => avocadoss_hub_normalized_review_key( $product->get_name() ),
            'options' => avocadoss_hub_product_review_option_keys( $product ),
        );
    }
    return $summaries;
}

function avocadoss_hub_draft_review_info( $post_id ) {
    static $cache = array();
    if ( isset( $cache[ $post_id ] ) ) {
        return $cache[ $post_id ];
    }
    $product = function_exists( 'wc_get_product' ) ? wc_get_product( $post_id ) : null;
    $status  = get_post_status( $post_id );
    $info    = array(
        'review_status'  => in_array( $status, array( 'draft', 'private' ), true ) ? '검수대기' : '해당없음',
        'recommendation' => '확인필요',
        'detail'         => '',
    );
    if ( ! $product || ! in_array( $status, array( 'draft', 'private' ), true ) ) {
        $cache[ $post_id ] = $info;
        return $info;
    }

    $draft_key    = avocadoss_hub_normalized_review_key( $product->get_name() );
    $draft_options = avocadoss_hub_product_review_option_keys( $product );
    if ( empty( $draft_options ) ) {
        $info['recommendation'] = '확인필요';
        $info['detail']         = '옵션 확인 필요';
        $cache[ $post_id ]      = $info;
        return $info;
    }

    $best = null;
    foreach ( avocadoss_hub_published_review_summaries() as $published ) {
        $same_group = $draft_key === $published['key'] || ( '' !== $draft_key && '' !== $published['key'] && ( false !== strpos( $draft_key, $published['key'] ) || false !== strpos( $published['key'], $draft_key ) ) );
        if ( ! $same_group ) {
            continue;
        }
        $published_options = array_flip( $published['options'] );
        $duplicate_count   = 0;
        foreach ( $draft_options as $option_key ) {
            if ( isset( $published_options[ $option_key ] ) ) {
                $duplicate_count++;
            }
        }
        $candidate = array(
            'id'              => $published['id'],
            'duplicate_count' => $duplicate_count,
            'missing_count'   => max( 0, count( $draft_options ) - $duplicate_count ),
        );
        if ( null === $best || $candidate['duplicate_count'] > $best['duplicate_count'] ) {
            $best = $candidate;
        }
    }

    if ( null === $best ) {
        $info['recommendation'] = '신규후보';
        $info['detail']         = '발행 상품군 매칭 없음';
    } elseif ( $best['duplicate_count'] === count( $draft_options ) ) {
        $info['recommendation'] = '중복의심';
        $info['detail']         = '발행 상품 옵션과 모두 겹침';
    } elseif ( $best['missing_count'] > 0 ) {
        $info['recommendation'] = '옵션보강후보';
        $info['detail']         = sprintf( '발행 상품 #%d에 없는 옵션 %d개', $best['id'], $best['missing_count'] );
    }
    $cache[ $post_id ] = $info;
    return $info;
}

add_filter( 'manage_edit-product_columns', 'avocadoss_hub_add_supplier_product_column', 30 );
function avocadoss_hub_add_supplier_product_column( $columns ) {
    $next = array();
    foreach ( $columns as $key => $label ) {
        $next[ $key ] = $label;
        if ( 'name' === $key ) {
            $next['avocadoss_supplier']              = '공급처';
            $next['avocadoss_review_status']         = '검수상태';
            $next['avocadoss_review_recommendation'] = '추천처리';
        }
    }
    if ( ! isset( $next['avocadoss_supplier'] ) ) {
        $next['avocadoss_supplier']              = '공급처';
        $next['avocadoss_review_status']         = '검수상태';
        $next['avocadoss_review_recommendation'] = '추천처리';
    }
    return $next;
}

add_action( 'manage_product_posts_custom_column', 'avocadoss_hub_render_supplier_product_column', 30, 2 );
function avocadoss_hub_render_supplier_product_column( $column, $post_id ) {
    if ( in_array( $column, array( 'avocadoss_review_status', 'avocadoss_review_recommendation' ), true ) ) {
        $info = avocadoss_hub_draft_review_info( $post_id );
        if ( 'avocadoss_review_status' === $column ) {
            echo esc_html( $info['review_status'] );
            return;
        }
        echo '<strong>' . esc_html( $info['recommendation'] ) . '</strong>';
        if ( '' !== $info['detail'] ) {
            echo '<br><small>' . esc_html( $info['detail'] ) . '</small>';
        }
        return;
    }
    if ( 'avocadoss_supplier' !== $column ) {
        return;
    }
    $product = function_exists( 'wc_get_product' ) ? wc_get_product( $post_id ) : null;
    if ( ! $product ) {
        echo esc_html( avocadoss_hub_supplier_label( 'unknown' ) );
        return;
    }

    $counts = array( 'dailyfood' => 0, 'walldob2b' => 0, 'unknown' => 0 );
    $variation_ids = $product->is_type( 'variable' ) ? $product->get_children() : array( $post_id );
    foreach ( $variation_ids as $variation_id ) {
        $meta = avocadoss_hub_supplier_meta( $variation_id, $post_id );
        $counts[ $meta['supplier_id'] ] = ( $counts[ $meta['supplier_id'] ] ?? 0 ) + 1;
    }

    $known_total = $counts['dailyfood'] + $counts['walldob2b'];
    if ( 0 === $known_total ) {
        echo '<span class="avocadoss-supplier-badge avocadoss-supplier-unknown">' . esc_html( avocadoss_hub_supplier_label( 'unknown' ) ) . '</span>';
        return;
    }
    if ( $counts['dailyfood'] > 0 && 0 === $counts['walldob2b'] ) {
        echo '<span class="avocadoss-supplier-badge">' . esc_html( avocadoss_hub_supplier_label( 'dailyfood' ) ) . '</span>';
    } elseif ( $counts['walldob2b'] > 0 && 0 === $counts['dailyfood'] ) {
        echo '<span class="avocadoss-supplier-badge">' . esc_html( avocadoss_hub_supplier_label( 'walldob2b' ) ) . '</span>';
    } else {
        echo '<span class="avocadoss-supplier-badge">혼합</span>';
    }
    echo '<br><small>' . esc_html( sprintf( '데일리 %d / 월억 %d', $counts['dailyfood'], $counts['walldob2b'] ) ) . '</small>';
}

add_action( 'admin_head-edit.php', 'avocadoss_hub_supplier_admin_css' );
add_action( 'admin_head-post.php', 'avocadoss_hub_supplier_admin_css' );
function avocadoss_hub_supplier_admin_css() {
    if ( ! is_admin() ) {
        return;
    }
    echo '<style>.column-avocadoss_supplier{width:120px}.column-avocadoss_review_status{width:90px}.column-avocadoss_review_recommendation{width:150px}.avocadoss-supplier-box{clear:both;margin:10px 12px 12px;padding:10px;border:1px solid #dcdcde;background:#f6f7f7}.avocadoss-supplier-box p{margin:2px 0}.avocadoss-supplier-badge{font-weight:700}.avocadoss-admin-order-supplier{margin:8px 0 0;padding:8px 10px;background:#f6f7f7;border-left:3px solid #2271b1}.avocadoss-admin-order-supplier p{margin:2px 0}.avocadoss-option-supplier-table th,.avocadoss-option-supplier-table td{font-size:12px;vertical-align:middle}</style>';
}

add_action( 'woocommerce_product_after_variable_attributes', 'avocadoss_hub_render_variation_supplier_box', 30, 3 );
function avocadoss_hub_render_variation_supplier_box( $loop, $variation_data, $variation ) {
    if ( ! is_admin() || ! $variation || empty( $variation->ID ) ) {
        return;
    }
    $product_id = wp_get_post_parent_id( $variation->ID );
    $meta       = avocadoss_hub_supplier_meta( $variation->ID, $product_id );
    echo '<div class="avocadoss-supplier-box form-row form-row-full">';
    echo '<p><strong>공급처:</strong> ' . esc_html( $meta['supplier_label'] ) . '</p>';
    echo '<p><strong>공급처 상품ID:</strong> ' . esc_html( $meta['source_product_id'] ?: '미확인' ) . '</p>';
    echo '<p><strong>공급처 옵션ID:</strong> ' . esc_html( $meta['source_option_id'] ?: '미확인' ) . '</p>';
    echo '<p><strong>공급처 원본 상품명:</strong> ' . esc_html( $meta['original_product_name'] ?: '미확인' ) . '</p>';
    echo '<p><strong>공급처 원본 옵션명:</strong> ' . esc_html( $meta['original_option_name'] ?: '미확인' ) . '</p>';
    if ( '' !== $meta['last_synced_at'] ) {
        echo '<p><strong>마지막 동기화:</strong> ' . esc_html( $meta['last_synced_at'] ) . '</p>';
    }
    echo '</div>';
}


add_action( 'add_meta_boxes_product', 'avocadoss_hub_add_option_supplier_metabox' );
function avocadoss_hub_add_option_supplier_metabox( $post ) {
    if ( ! is_admin() || ! $post || 'product' !== $post->post_type ) {
        return;
    }
    $product = function_exists( 'wc_get_product' ) ? wc_get_product( $post->ID ) : null;
    if ( ! $product || ! $product->is_type( 'variable' ) ) {
        return;
    }
    add_meta_box(
        'avocadoss-option-supplier-table',
        '옵션별 공급처',
        'avocadoss_hub_render_option_supplier_metabox',
        'product',
        'normal',
        'default'
    );
}

function avocadoss_hub_render_option_supplier_metabox( $post ) {
    $product = function_exists( 'wc_get_product' ) ? wc_get_product( $post->ID ) : null;
    if ( ! $product || ! $product->is_type( 'variable' ) ) {
        echo '<p>' . esc_html__( '표시할 옵션이 없습니다.', 'avocadoss' ) . '</p>';
        return;
    }
    $variation_ids = $product->get_children();
    if ( empty( $variation_ids ) ) {
        echo '<p>' . esc_html__( '표시할 옵션이 없습니다.', 'avocadoss' ) . '</p>';
        return;
    }
    echo '<table class="widefat striped avocadoss-option-supplier-table">';
    echo '<thead><tr>';
    foreach ( array( '옵션명', '현재 가격', '재고상태', '공급처', '공급처 상품ID', '공급처 옵션ID', '공급처 원본 옵션명' ) as $heading ) {
        echo '<th>' . esc_html( $heading ) . '</th>';
    }
    echo '</tr></thead><tbody>';
    foreach ( $variation_ids as $variation_id ) {
        $variation = function_exists( 'wc_get_product' ) ? wc_get_product( $variation_id ) : null;
        if ( ! $variation ) {
            continue;
        }
        $meta         = avocadoss_hub_supplier_meta( $variation_id, $post->ID );
        $option_name  = avocadoss_hub_variation_option_name( $variation );
        $price        = is_callable( array( $variation, 'get_price' ) ) ? (string) $variation->get_price() : '';
        $stock_status = is_callable( array( $variation, 'get_stock_status' ) ) ? (string) $variation->get_stock_status() : '';
        echo '<tr>';
        echo '<td>' . esc_html( $option_name ?: '미확인' ) . '</td>';
        echo '<td>' . esc_html( '' !== $price ? wp_strip_all_tags( wc_price( $price ) ) : '미확인' ) . '</td>';
        echo '<td>' . esc_html( avocadoss_hub_stock_status_label( $stock_status ) ) . '</td>';
        echo '<td><strong>' . esc_html( $meta['supplier_label'] ) . '</strong></td>';
        echo '<td>' . esc_html( $meta['source_product_id'] ?: '미확인' ) . '</td>';
        echo '<td>' . esc_html( $meta['source_option_id'] ?: '미확인' ) . '</td>';
        echo '<td>' . esc_html( $meta['original_option_name'] ?: '미확인' ) . '</td>';
        echo '</tr>';
    }
    echo '</tbody></table>';
}

function avocadoss_hub_stock_status_label( $stock_status ) {
    if ( 'instock' === $stock_status ) {
        return '판매중';
    }
    if ( 'outofstock' === $stock_status ) {
        return '품절';
    }
    if ( 'onbackorder' === $stock_status ) {
        return '예약주문';
    }
    return '미확인';
}

add_action( 'woocommerce_checkout_create_order_line_item', 'avocadoss_hub_snapshot_supplier_to_order_item', 30, 4 );
function avocadoss_hub_snapshot_supplier_to_order_item( $item, $cart_item_key, $values, $order ) {
    $variation_id = absint( $values['variation_id'] ?? 0 );
    $product_id   = absint( $values['product_id'] ?? 0 );
    $product      = ! empty( $values['data'] ) && is_object( $values['data'] ) ? $values['data'] : wc_get_product( $variation_id ?: $product_id );
    $meta         = avocadoss_hub_supplier_meta( $variation_id ?: $product_id, $product_id );
    $price        = $product && is_callable( array( $product, 'get_price' ) ) ? (string) $product->get_price() : '';

    $item->add_meta_data( '_hub_supplier_id', $meta['supplier_id'], true );
    $item->add_meta_data( '_hub_supplier_label', $meta['supplier_label'], true );
    $item->add_meta_data( '_hub_source_product_id', $meta['source_product_id'], true );
    $item->add_meta_data( '_hub_source_option_id', $meta['source_option_id'], true );
    $item->add_meta_data( '_hub_original_product_name', $meta['original_product_name'], true );
    $item->add_meta_data( '_hub_original_option_name', $meta['original_option_name'], true );
    $item->add_meta_data( '_hub_selected_price', $price, true );
    $item->add_meta_data( '_hub_supplier_snapshot_at', current_time( 'mysql' ), true );
}

add_filter( 'woocommerce_hidden_order_itemmeta', 'avocadoss_hub_hide_supplier_order_item_meta' );
function avocadoss_hub_hide_supplier_order_item_meta( $hidden ) {
    return array_unique(
        array_merge(
            $hidden,
            array(
                '_hub_supplier_id',
                '_hub_supplier_label',
                '_hub_source_product_id',
                '_hub_source_option_id',
                '_hub_original_product_name',
                '_hub_original_option_name',
                '_hub_selected_price',
                '_hub_supplier_snapshot_at',
            )
        )
    );
}

add_action( 'woocommerce_after_order_itemmeta', 'avocadoss_hub_render_admin_order_supplier_meta', 30, 3 );
function avocadoss_hub_render_admin_order_supplier_meta( $item_id, $item, $product ) {
    if ( ! is_admin() || ! $item || ! is_callable( array( $item, 'get_meta' ) ) ) {
        return;
    }
    $supplier_id = $item->get_meta( '_hub_supplier_id', true );
    $label       = $item->get_meta( '_hub_supplier_label', true );
    $source_pid  = $item->get_meta( '_hub_source_product_id', true );
    $source_oid  = $item->get_meta( '_hub_source_option_id', true );
    $origin_p    = $item->get_meta( '_hub_original_product_name', true );
    $origin_o    = $item->get_meta( '_hub_original_option_name', true );

    if ( '' === $supplier_id && $product && is_callable( array( $product, 'get_id' ) ) ) {
        $meta        = avocadoss_hub_supplier_meta( $product->get_id(), is_callable( array( $product, 'get_parent_id' ) ) ? $product->get_parent_id() : 0 );
        $supplier_id = $meta['supplier_id'];
        $label       = $meta['supplier_label'];
        $source_pid  = $meta['source_product_id'];
        $source_oid  = $meta['source_option_id'];
        $origin_p    = $meta['original_product_name'];
        $origin_o    = $meta['original_option_name'];
    }

    echo '<div class="avocadoss-admin-order-supplier">';
    echo '<p><strong>공급처:</strong> ' . esc_html( $label ?: avocadoss_hub_supplier_label( $supplier_id ) ) . '</p>';
    echo '<p><strong>공급처 상품명:</strong> ' . esc_html( $origin_p ?: '미확인' ) . '</p>';
    echo '<p><strong>공급처 옵션명:</strong> ' . esc_html( $origin_o ?: '미확인' ) . '</p>';
    echo '<p><strong>공급처 상품ID:</strong> ' . esc_html( $source_pid ?: '미확인' ) . '</p>';
    echo '<p><strong>공급처 옵션ID:</strong> ' . esc_html( $source_oid ?: '미확인' ) . '</p>';
    echo '</div>';
}
