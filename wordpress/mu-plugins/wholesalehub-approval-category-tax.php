<?php
/**
 * Plugin Name: WholesaleHub Approval Category Tax
 * Description: Confirms tax treatment when a Telegram product-review category is selected.
 */

defined( 'ABSPATH' ) || exit;

/** @return 'none'|'taxable'|null */
function wholesalehub_approval_tax_status_for_category( $term_id ) {
    $term = get_term( absint( $term_id ), 'product_cat' );
    if ( ! $term || is_wp_error( $term ) ) {
        return null;
    }

    if ( in_array( $term->name, array( '농산물', '축산물', '수산물' ), true ) ) {
        return 'none';
    }
    if ( '가공식품' === $term->name ) {
        return 'taxable';
    }
    return null;
}

function wholesalehub_apply_approval_category_tax( $meta_id, $product_id, $meta_key, $meta_value ) {
    unset( $meta_id );
    if ( '_avocadoss_pa_category_id' !== $meta_key || 'product' !== get_post_type( $product_id ) ) {
        return;
    }
    if ( 'draft' !== get_post_status( $product_id ) || 'draft_candidate' !== get_post_meta( $product_id, '_wholesalehub_mvp_created', true ) ) {
        return;
    }

    $tax_status = wholesalehub_approval_tax_status_for_category( $meta_value );
    $product    = wc_get_product( $product_id );
    if ( null === $tax_status || ! $product ) {
        return;
    }

    $product->set_tax_status( $tax_status );
    $product->set_tax_class( '' );
    $product->save();

    foreach ( $product->get_children() as $variation_id ) {
        $variation = wc_get_product( $variation_id );
        if ( ! $variation ) {
            continue;
        }
        $variation->set_tax_status( $tax_status );
        $variation->set_tax_class( '' );
        $variation->save();
    }

    update_post_meta( $product_id, '_wholesalehub_approval_tax_status', $tax_status );
}
add_action( 'added_post_meta', 'wholesalehub_apply_approval_category_tax', 10, 4 );
add_action( 'updated_post_meta', 'wholesalehub_apply_approval_category_tax', 10, 4 );
