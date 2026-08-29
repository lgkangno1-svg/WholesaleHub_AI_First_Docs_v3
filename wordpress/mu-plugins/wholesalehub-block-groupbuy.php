<?php
/**
 * Plugin Name: WholesaleHub Group-buy Blocker
 * Description: Permanently rejects the retired Fafane/group-buy catalog lane.
 */

defined( 'ABSPATH' ) || exit;

function wholesalehub_block_retired_groupbuy_category( $term, $taxonomy ) {
    $normalized = strtolower( trim( (string) $term ) );
    if ( 'product_cat' === $taxonomy && ( 'groupbuy' === $normalized || false !== strpos( $normalized, '공동구매' ) ) ) {
        return new WP_Error( 'wholesalehub_groupbuy_category_retired', '공동구매 카테고리는 폐기되어 만들 수 없습니다.' );
    }
    return $term;
}
add_filter( 'pre_insert_term', 'wholesalehub_block_retired_groupbuy_category', 10, 2 );

function wholesalehub_is_retired_groupbuy_product( $product ) {
    if ( ! $product instanceof WC_Product ) {
        return false;
    }

    $sku    = strtoupper( trim( (string) $product->get_sku() ) );
    $source = strtolower( trim( (string) $product->get_meta( '_b2b_source', true ) ) );

    return 0 === strpos( $sku, 'FAF-' ) || false !== strpos( $source, 'fafa' );
}

function wholesalehub_reject_retired_groupbuy_rest_product( $product, $request, $creating ) {
    unset( $request );
    if ( $creating && wholesalehub_is_retired_groupbuy_product( $product ) ) {
        return new WP_Error(
            'wholesalehub_groupbuy_retired',
            '공동구매/Fafane 상품 수집은 종료되어 등록할 수 없습니다.',
            array( 'status' => 403 )
        );
    }
    return $product;
}
add_filter( 'woocommerce_rest_pre_insert_product_object', 'wholesalehub_reject_retired_groupbuy_rest_product', 5, 3 );

function wholesalehub_remove_retired_groupbuy_after_rest_insert( $product, $request, $creating ) {
    unset( $request );
    if ( ! $creating || ! wholesalehub_is_retired_groupbuy_product( $product ) ) {
        return;
    }

    wp_delete_post( $product->get_id(), true );
    error_log( 'WholesaleHub blocked retired group-buy product ' . $product->get_id() );
}
add_action( 'woocommerce_rest_insert_product_object', 'wholesalehub_remove_retired_groupbuy_after_rest_insert', 1, 3 );
