<?php
/**
 * Plugin Name: Avocadoss Security Headers
 * Description: Adds baseline security response headers for hub.avocadoss.co.kr.
 */

defined( 'ABSPATH' ) || exit;

add_action( 'send_headers', function () {
	if ( headers_sent() ) {
		return;
	}
	header( 'X-Content-Type-Options: nosniff' );
	header( 'X-Frame-Options: SAMEORIGIN' );
	header( 'Referrer-Policy: strict-origin-when-cross-origin' );
	header( 'Strict-Transport-Security: max-age=31536000; includeSubDomains' );
	header( 'Permissions-Policy: camera=(), microphone=(), geolocation=()' );
}, 1 );