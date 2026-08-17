<?php
/**
 * Plugin Name: Avocadoss Supplier Order Export
 * Description: Creates immutable-snapshot supplier XLSX files and delivers them through the existing Telegram admin chat.
 * Version: 1.0.0
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

require_once __DIR__ . '/includes/class-wholesalehub-supplier-order-export.php';
require_once __DIR__ . '/includes/class-wholesalehub-monthly-tax-export.php';

add_action(
    'template_redirect',
    function () {
        $redirects = get_option( 'avocadoss_display_group_redirects', array() );
        if ( ! is_array( $redirects ) || empty( $redirects ) || empty( $_SERVER['REQUEST_URI'] ) ) {
            return;
        }
        $path = trim( (string) wp_parse_url( wp_unslash( $_SERVER['REQUEST_URI'] ), PHP_URL_PATH ), '/' );
        $requested_slug = rawurldecode( basename( $path ) );
        foreach ( $redirects as $old_slug => $target_product_id ) {
            if ( rawurldecode( (string) $old_slug ) !== $requested_slug ) {
                continue;
            }
            $target = get_permalink( absint( $target_product_id ) );
            if ( $target ) {
                wp_safe_redirect( $target, 301, 'WholesaleHub display group' );
                exit;
            }
        }
    },
    0
);
