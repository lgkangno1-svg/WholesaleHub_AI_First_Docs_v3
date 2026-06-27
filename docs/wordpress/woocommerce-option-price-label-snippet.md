# WooCommerce option price label snippet

Purpose: show final customer-facing variation price next to each option label for single-attribute variable products.

Source currently applied outside this repo:
`/home/tnfwod/avocadoss-wordpress/wp_data/wp-content/plugins/avocadoss-performance/avocadoss-performance.php`

Notes:
- Uses WooCommerce variation customer sale price only.
- Does not expose supplier, source, raw cost, wholesale cost, or internal meta.
- Skips multi-attribute variable products to avoid ambiguous option pricing.
- Adds `(??)` only from WooCommerce stock status, without showing stock quantity.

```php
add_filter( 'woocommerce_variation_option_name', 'avocadoss_append_variation_price_to_option_label', 10, 4 );
function avocadoss_append_variation_price_to_option_label( $option_name, $term = null, $attribute_name = '', $product = null ) {
    if ( ! $product instanceof WC_Product_Variable ) {
        return $option_name;
    }

    $variation_attributes = $product->get_variation_attributes();
    if ( count( $variation_attributes ) !== 1 ) {
        return $option_name;
    }

    $plain_label = wp_strip_all_tags( (string) $option_name );
    if ( preg_match( '/\\([0-9,]+\\s*\\x{C6D0}\\)/u', $plain_label ) ) {
        return $option_name;
    }

    $attribute_keys = array_keys( $variation_attributes );
    $target_attribute = $attribute_name ? $attribute_name : ( $attribute_keys[0] ?? '' );
    if ( '' === $target_attribute ) {
        return $option_name;
    }

    $target_attribute = rawurldecode( str_replace( 'attribute_', '', (string) $target_attribute ) );
    $matching_variation = avocadoss_find_single_attribute_variation( $product, $target_attribute, $option_name, $term );
    if ( ! $matching_variation ) {
        return $option_name;
    }

    $label = $option_name;
    $price = $matching_variation->get_price();
    if ( '' !== $price ) {
        $label .= ' (' . number_format_i18n( (float) $price ) . html_entity_decode( '&#50896;', ENT_QUOTES, 'UTF-8' ) . ')';
    }

    if ( ! $matching_variation->is_in_stock() ) {
        $label .= ' (' . html_entity_decode( '&#54408;&#51208;', ENT_QUOTES, 'UTF-8' ) . ')';
    }

    return $label;
}

function avocadoss_find_single_attribute_variation( WC_Product_Variable $product, $target_attribute, $option_name, $term = null ) {
    $option_candidates = array_filter( array_unique( array(
        (string) $option_name,
        sanitize_title( (string) $option_name ),
        is_object( $term ) && isset( $term->slug ) ? (string) $term->slug : '',
        is_object( $term ) && isset( $term->name ) ? (string) $term->name : '',
    ) ) );

    foreach ( $product->get_children() as $variation_id ) {
        $variation = wc_get_product( $variation_id );
        if ( ! $variation instanceof WC_Product_Variation ) {
            continue;
        }

        foreach ( $variation->get_attributes() as $attribute_key => $attribute_value ) {
            $attribute_key = rawurldecode( str_replace( 'attribute_', '', (string) $attribute_key ) );
            if ( $attribute_key !== $target_attribute ) {
                continue;
            }

            foreach ( $option_candidates as $candidate ) {
                if ( (string) $attribute_value === (string) $candidate || sanitize_title( (string) $attribute_value ) === sanitize_title( (string) $candidate ) ) {
                    return $variation;
                }
            }
        }
    }

    return null;
}
```
