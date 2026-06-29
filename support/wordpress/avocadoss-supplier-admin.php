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
        return '???';
    }
    if ( 'walldob2b' === $supplier ) {
        return '??';
    }
    return '???';
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

add_filter( 'manage_edit-product_columns', 'avocadoss_hub_add_supplier_product_column', 30 );
function avocadoss_hub_add_supplier_product_column( $columns ) {
    $next = array();
    foreach ( $columns as $key => $label ) {
        $next[ $key ] = $label;
        if ( 'name' === $key ) {
            $next['avocadoss_supplier'] = '???';
        }
    }
    if ( ! isset( $next['avocadoss_supplier'] ) ) {
        $next['avocadoss_supplier'] = '???';
    }
    return $next;
}

add_action( 'manage_product_posts_custom_column', 'avocadoss_hub_render_supplier_product_column', 30, 2 );
function avocadoss_hub_render_supplier_product_column( $column, $post_id ) {
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
        echo '<span class="avocadoss-supplier-badge">??</span>';
    }
    echo '<br><small>' . esc_html( sprintf( '??? %d / ?? %d', $counts['dailyfood'], $counts['walldob2b'] ) ) . '</small>';
}

add_action( 'admin_head-edit.php', 'avocadoss_hub_supplier_admin_css' );
add_action( 'admin_head-post.php', 'avocadoss_hub_supplier_admin_css' );
function avocadoss_hub_supplier_admin_css() {
    if ( ! is_admin() ) {
        return;
    }
    echo '<style>.column-avocadoss_supplier{width:120px}.avocadoss-supplier-box{clear:both;margin:10px 12px 12px;padding:10px;border:1px solid #dcdcde;background:#f6f7f7}.avocadoss-supplier-box p{margin:2px 0}.avocadoss-supplier-badge{font-weight:700}.avocadoss-admin-order-supplier{margin:8px 0 0;padding:8px 10px;background:#f6f7f7;border-left:3px solid #2271b1}.avocadoss-admin-order-supplier p{margin:2px 0}</style>';
}

add_action( 'woocommerce_product_after_variable_attributes', 'avocadoss_hub_render_variation_supplier_box', 30, 3 );
function avocadoss_hub_render_variation_supplier_box( $loop, $variation_data, $variation ) {
    if ( ! is_admin() || ! $variation || empty( $variation->ID ) ) {
        return;
    }
    $product_id = wp_get_post_parent_id( $variation->ID );
    $meta       = avocadoss_hub_supplier_meta( $variation->ID, $product_id );
    echo '<div class="avocadoss-supplier-box form-row form-row-full">';
    echo '<p><strong>???:</strong> ' . esc_html( $meta['supplier_label'] ) . '</p>';
    echo '<p><strong>??? ??ID:</strong> ' . esc_html( $meta['source_product_id'] ?: '???' ) . '</p>';
    echo '<p><strong>??? ??ID:</strong> ' . esc_html( $meta['source_option_id'] ?: '???' ) . '</p>';
    echo '<p><strong>??? ?? ???:</strong> ' . esc_html( $meta['original_product_name'] ?: '???' ) . '</p>';
    echo '<p><strong>??? ?? ???:</strong> ' . esc_html( $meta['original_option_name'] ?: '???' ) . '</p>';
    if ( '' !== $meta['last_synced_at'] ) {
        echo '<p><strong>??? ???:</strong> ' . esc_html( $meta['last_synced_at'] ) . '</p>';
    }
    echo '</div>';
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
    echo '<p><strong>???:</strong> ' . esc_html( $label ?: avocadoss_hub_supplier_label( $supplier_id ) ) . '</p>';
    echo '<p><strong>??? ???:</strong> ' . esc_html( $origin_p ?: '???' ) . '</p>';
    echo '<p><strong>??? ???:</strong> ' . esc_html( $origin_o ?: '???' ) . '</p>';
    echo '<p><strong>??? ??ID:</strong> ' . esc_html( $source_pid ?: '???' ) . '</p>';
    echo '<p><strong>??? ??ID:</strong> ' . esc_html( $source_oid ?: '???' ) . '</p>';
    echo '</div>';
}
