<?php
/**
 * Plugin Name: WholesaleHub Meta Privacy Policy
 * Description: Keeps Meta Pixel tracking available while blocking B2B catalog exposure and emitting a one-time registration event.
 */

defined( 'ABSPATH' ) || exit;

const WH_META_REGISTRATION_COOKIE       = 'wh_meta_registration';
const WH_META_REGISTRATION_TOKEN_META   = '_wh_meta_complete_registration_token_hash';
const WH_META_REGISTRATION_EXPIRES_META = '_wh_meta_complete_registration_token_expires';
const WH_META_REGISTRATION_EVENT_META   = '_wh_meta_complete_registration_event_id';
const WH_META_REGISTRATION_SENT_META    = '_wh_meta_complete_registration_sent';
const WH_META_REGISTRATION_TTL          = 15 * MINUTE_IN_SECONDS;

/**
 * Always report Meta product synchronization as disabled.
 *
 * @return bool
 */
function wh_meta_disable_product_sync() {
	return false;
}

/**
 * Block Meta's full catalog batch synchronization.
 *
 * @return bool
 */
function wh_meta_block_full_batch_sync() {
	return true;
}

/**
 * Force a protected Meta option to remain disabled.
 *
 * @return string
 */
function wh_meta_force_disabled_option() {
	return 'no';
}

/**
 * Remove the Meta-hosted checkout URL if product data reaches preparation.
 * Product data should already be rejected by the sync filters above.
 *
 * @param array $product_data Prepared Meta product data.
 * @return array
 */
function wh_meta_remove_checkout_url( $product_data ) {
	if ( is_array( $product_data ) ) {
		unset( $product_data['checkout_url'] );
	}
	return $product_data;
}

add_filter( 'facebook_for_woocommerce_block_full_batch_api_sync', 'wh_meta_block_full_batch_sync', PHP_INT_MAX );
add_filter( 'wc_facebook_is_product_sync_enabled', 'wh_meta_disable_product_sync', PHP_INT_MAX, 2 );
add_filter( 'wc_facebook_should_sync_product', 'wh_meta_disable_product_sync', PHP_INT_MAX, 2 );
add_filter( 'facebook_for_woocommerce_integration_prepare_product', 'wh_meta_remove_checkout_url', PHP_INT_MAX, 2 );

foreach ( array(
	'wc_facebook_enable_product_sync',
	'wc_facebook_enable_facebook_managed_coupons',
	'wc_facebook_legacy_feed_file_generation_enabled',
	'wc_facebook_enable_new_style_feed_generator',
) as $wh_meta_disabled_option ) {
	add_filter( 'pre_option_' . $wh_meta_disabled_option, 'wh_meta_force_disabled_option', PHP_INT_MAX );
	add_filter( 'pre_update_option_' . $wh_meta_disabled_option, 'wh_meta_force_disabled_option', PHP_INT_MAX, 3 );
}
unset( $wh_meta_disabled_option );

/**
 * Persist fail-closed values and remove an already-scheduled product feed job.
 */
function wh_meta_enforce_catalog_policy() {
	if ( '1' === get_option( 'wh_meta_catalog_policy_version', '' ) ) {
		return;
	}

	$disabled_options = array(
		'wc_facebook_enable_product_sync',
		'wc_facebook_enable_facebook_managed_coupons',
		'wc_facebook_legacy_feed_file_generation_enabled',
		'wc_facebook_enable_new_style_feed_generator',
	);

	foreach ( $disabled_options as $option_name ) {
		// Temporarily bypass the read override so update_option can compare and
		// repair the raw stored value. The pre-update guard still forces "no".
		remove_filter( 'pre_option_' . $option_name, 'wh_meta_force_disabled_option', PHP_INT_MAX );
		update_option( $option_name, 'no', false );
		add_filter( 'pre_option_' . $option_name, 'wh_meta_force_disabled_option', PHP_INT_MAX );
	}

	if ( function_exists( 'as_unschedule_all_actions' ) ) {
		as_unschedule_all_actions( 'wc_facebook_regenerate_feed' );
	}

	update_option( 'wh_meta_catalog_policy_version', '1', false );
}
add_action( 'init', 'wh_meta_enforce_catalog_policy', PHP_INT_MAX );

/**
 * Show the policy where an administrator configures WooCommerce integrations.
 */
function wh_meta_admin_policy_notice() {
	if ( ! current_user_can( 'manage_woocommerce' ) ) {
		return;
	}

	$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : '';
	if ( 'wc-settings' !== $page ) {
		return;
	}

	echo '<div class="notice notice-info"><p>' . esc_html__(
		'도매Hub 정책: Meta Pixel/CAPI 추적은 허용하지만 상품·가격 Catalog 동기화와 Meta 관리 쿠폰은 차단됩니다. Facebook/Instagram Checkout은 Meta 연결 과정에서도 활성화하지 마세요.',
		'wholesalehub'
	) . '</p></div>';
}
add_action( 'admin_notices', 'wh_meta_admin_policy_notice' );

/**
 * Required B2B registration fields stored after a successful registration.
 *
 * @param int $customer_id Customer ID.
 * @return bool
 */
function wh_meta_has_complete_b2b_profile( $customer_id ) {
	if ( 'pending' !== get_user_meta( $customer_id, '_avo_approval_status', true ) ) {
		return false;
	}

	$required_meta = array(
		'_avo_business_number',
		'billing_first_name',
		'billing_company',
		'billing_phone',
		'billing_postcode',
		'billing_address_1',
		'billing_address_2',
	);

	foreach ( $required_meta as $meta_key ) {
		if ( '' === trim( (string) get_user_meta( $customer_id, $meta_key, true ) ) ) {
			return false;
		}
	}

	return true;
}

/**
 * Confirm this hook came from the public WooCommerce B2B registration form.
 *
 * @return bool
 */
function wh_meta_is_public_registration_request() {
	if ( is_admin() || wp_doing_ajax() || wp_doing_cron() || ( defined( 'WP_CLI' ) && WP_CLI ) ) {
		return false;
	}

	if ( 'POST' !== strtoupper( isset( $_SERVER['REQUEST_METHOD'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ) ) : '' ) ) {
		return false;
	}

	$nonce = isset( $_POST['woocommerce-register-nonce'] ) ? sanitize_text_field( wp_unslash( $_POST['woocommerce-register-nonce'] ) ) : '';
	if ( ! $nonce || ! wp_verify_nonce( $nonce, 'woocommerce-register' ) ) {
		return false;
	}

	$required_post_fields = array(
		'avo_business_number',
		'avo_billing_first_name',
		'avo_business_company',
		'avo_billing_phone',
		'avo_billing_postcode',
		'avo_billing_address',
		'avo_billing_address_detail',
	);

	foreach ( $required_post_fields as $field_name ) {
		if ( empty( $_POST[ $field_name ] ) ) {
			return false;
		}
	}

	return true;
}

/**
 * Hash the browser token without storing the raw value in WordPress.
 *
 * @param string $token Raw browser token.
 * @return string
 */
function wh_meta_hash_registration_token( $token ) {
	return hash_hmac( 'sha256', (string) $token, wp_salt( 'auth' ) );
}

/**
 * Set or clear the short-lived browser registration cookie.
 *
 * @param string $value  Cookie value.
 * @param int    $expiry Unix expiry.
 * @return bool
 */
function wh_meta_set_registration_cookie( $value, $expiry ) {
	if ( headers_sent() ) {
		return false;
	}

	return setcookie(
		WH_META_REGISTRATION_COOKIE,
		(string) $value,
		array(
			'expires'  => (int) $expiry,
			'path'     => '/',
			'secure'   => is_ssl(),
			'httponly' => true,
			'samesite' => 'Lax',
		)
	);
}

/**
 * Arm a browser-specific CompleteRegistration event after real B2B signup.
 *
 * @param int $customer_id Customer ID.
 */
function wh_meta_arm_complete_registration( $customer_id ) {
	$customer_id = absint( $customer_id );
	if ( ! $customer_id || ! wh_meta_is_public_registration_request() || ! wh_meta_has_complete_b2b_profile( $customer_id ) ) {
		return;
	}

	if ( get_user_meta( $customer_id, WH_META_REGISTRATION_SENT_META, true ) ) {
		return;
	}

	$user = get_userdata( $customer_id );
	if ( ! $user || ! in_array( 'customer', (array) $user->roles, true ) ) {
		return;
	}

	$token    = wp_generate_password( 48, false, false );
	$event_id = 'whreg_' . str_replace( '-', '', wp_generate_uuid4() );
	$expiry   = time() + WH_META_REGISTRATION_TTL;

	update_user_meta( $customer_id, WH_META_REGISTRATION_TOKEN_META, wh_meta_hash_registration_token( $token ) );
	update_user_meta( $customer_id, WH_META_REGISTRATION_EXPIRES_META, $expiry );
	update_user_meta( $customer_id, WH_META_REGISTRATION_EVENT_META, $event_id );

	if ( ! wh_meta_set_registration_cookie( $customer_id . '.' . $token, $expiry ) ) {
		delete_user_meta( $customer_id, WH_META_REGISTRATION_TOKEN_META );
		delete_user_meta( $customer_id, WH_META_REGISTRATION_EXPIRES_META );
		delete_user_meta( $customer_id, WH_META_REGISTRATION_EVENT_META );
	}
}
add_action( 'woocommerce_created_customer', 'wh_meta_arm_complete_registration', 30, 1 );

/**
 * Read and validate the browser registration marker.
 *
 * @return array|null Array with customer_id and event_id, or null.
 */
function wh_meta_get_pending_registration_event() {
	if ( is_admin() || wp_doing_ajax() || wp_doing_cron() || empty( $_COOKIE[ WH_META_REGISTRATION_COOKIE ] ) ) {
		return null;
	}

	$cookie_value = sanitize_text_field( wp_unslash( $_COOKIE[ WH_META_REGISTRATION_COOKIE ] ) );
	$parts        = explode( '.', $cookie_value, 2 );
	if ( 2 !== count( $parts ) ) {
		return null;
	}

	$customer_id = absint( $parts[0] );
	$token       = $parts[1];
	$stored_hash = (string) get_user_meta( $customer_id, WH_META_REGISTRATION_TOKEN_META, true );
	$expiry      = (int) get_user_meta( $customer_id, WH_META_REGISTRATION_EXPIRES_META, true );
	$event_id    = (string) get_user_meta( $customer_id, WH_META_REGISTRATION_EVENT_META, true );

	if (
		! $customer_id ||
		! $stored_hash ||
		! $event_id ||
		$expiry < time() ||
		get_user_meta( $customer_id, WH_META_REGISTRATION_SENT_META, true ) ||
		! hash_equals( $stored_hash, wh_meta_hash_registration_token( $token ) ) ||
		! wh_meta_has_complete_b2b_profile( $customer_id )
	) {
		return null;
	}

	return array(
		'customer_id' => $customer_id,
		'event_id'    => $event_id,
	);
}

/**
 * Return the deterministic option name for a registration event claim.
 *
 * @param int $customer_id Customer ID.
 * @return string
 */
function wh_meta_registration_claim_option_name( $customer_id ) {
	return 'wh_meta_registration_claim_' . absint( $customer_id );
}

/**
 * Delete a claim only if its current stored value still belongs to the caller.
 *
 * The SQL comparison prevents a delayed request from deleting a newer owner's
 * replacement claim after the original claim expires.
 *
 * @param int    $customer_id Customer ID.
 * @param string $expected_claim Exact claim value observed or acquired.
 * @return bool Whether the expected claim was deleted.
 */
function wh_meta_compare_delete_registration_claim( $customer_id, $expected_claim ) {
	$option_name = wh_meta_registration_claim_option_name( $customer_id );
	if ( '' === (string) $expected_claim ) {
		return false;
	}

	global $wpdb;
	if ( isset( $wpdb, $wpdb->options ) && method_exists( $wpdb, 'prepare' ) && method_exists( $wpdb, 'query' ) ) {
		$deleted = $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$wpdb->options} WHERE option_name = %s AND option_value = %s",
				$option_name,
				(string) $expected_claim
			)
		);
		if ( 1 === $deleted ) {
			wp_cache_delete( $option_name, 'options' );
			return true;
		}

		return false;
	}

	// Test/non-standard bootstrap fallback; normal WordPress requests use $wpdb.
	if ( (string) get_option( $option_name, '' ) !== (string) $expected_claim ) {
		return false;
	}

	return delete_option( $option_name );
}

/**
 * Atomically claim a registration event before browser output is generated.
 *
 * WordPress enforces a unique index on option_name, so add_option() is an
 * atomic compare-and-set across concurrent PHP requests. Claims expire after
 * five minutes and are replaced only with an ownership-aware compare-delete.
 *
 * @param int $customer_id Customer ID.
 * @return string|false Exact claim value for its owner, or false when busy.
 */
function wh_meta_claim_registration_event( $customer_id ) {
	$customer_id = absint( $customer_id );
	if ( ! $customer_id ) {
		return false;
	}

	$option_name = wh_meta_registration_claim_option_name( $customer_id );
	$claim       = ( time() + ( 5 * MINUTE_IN_SECONDS ) ) . ':' . wp_generate_uuid4();
	if ( add_option( $option_name, $claim, '', false ) ) {
		return $claim;
	}

	$existing_claim = (string) get_option( $option_name, '' );
	$claim_parts     = explode( ':', $existing_claim, 2 );
	if ( 2 !== count( $claim_parts ) || (int) $claim_parts[0] >= time() ) {
		return false;
	}

	if ( ! wh_meta_compare_delete_registration_claim( $customer_id, $existing_claim ) ) {
		return false;
	}

	return add_option( $option_name, $claim, '', false ) ? $claim : false;
}

/**
 * Release a registration event claim owned by the current request.
 *
 * @param int    $customer_id Customer ID.
 * @param string $claim Exact claim value returned to its owner.
 */
function wh_meta_release_registration_event_claim( $customer_id, $claim ) {
	wh_meta_compare_delete_registration_claim( $customer_id, $claim );
}

/**
 * Emit browser CompleteRegistration through Meta for WooCommerce's public Pixel API.
 * The installed plugin has no supported public custom CAPI API, so no token or private
 * plugin property is accessed here. Native CAPI remains responsible for core events.
 */
function wh_meta_emit_complete_registration() {
	$pending = wh_meta_get_pending_registration_event();
	if ( ! $pending || ! function_exists( 'facebook_for_woocommerce' ) || ! class_exists( 'WC_Facebookcommerce_Pixel' ) ) {
		return;
	}

	$plugin      = facebook_for_woocommerce();
	$integration = $plugin ? $plugin->get_integration() : null;
	$connection  = $plugin ? $plugin->get_connection_handler() : null;
	if (
		! $integration ||
		! $connection ||
		! $connection->is_connected() ||
		'' === (string) $integration->get_facebook_pixel_id()
	) {
		return;
	}

	$claimed_customer_id = $pending['customer_id'];
	$claim               = wh_meta_claim_registration_event( $claimed_customer_id );
	if ( ! $claim ) {
		return;
	}

	// Re-read after the atomic claim in case another request completed first.
	$pending = wh_meta_get_pending_registration_event();
	if ( ! $pending ) {
		wh_meta_release_registration_event_claim( $claimed_customer_id, $claim );
		return;
	}

	try {
		$pixel = new WC_Facebookcommerce_Pixel( array() );
		$pixel->inject_event(
			'CompleteRegistration',
			array(
				'event_id'    => $pending['event_id'],
				'custom_data' => array(
					'status'            => 'pending_approval',
					'registration_type' => 'b2b_wholesale',
				),
			)
		);
	} catch ( Throwable $exception ) {
		wh_meta_release_registration_event_claim( $pending['customer_id'], $claim );
		return;
	}

	update_user_meta( $pending['customer_id'], WH_META_REGISTRATION_SENT_META, gmdate( 'c' ) );
	if ( ! get_user_meta( $pending['customer_id'], WH_META_REGISTRATION_SENT_META, true ) ) {
		return;
	}

	delete_user_meta( $pending['customer_id'], WH_META_REGISTRATION_TOKEN_META );
	delete_user_meta( $pending['customer_id'], WH_META_REGISTRATION_EXPIRES_META );
	delete_user_meta( $pending['customer_id'], WH_META_REGISTRATION_EVENT_META );
	wh_meta_set_registration_cookie( '', time() - HOUR_IN_SECONDS );
	unset( $_COOKIE[ WH_META_REGISTRATION_COOKIE ] );
	wh_meta_release_registration_event_claim( $pending['customer_id'], $claim );
}
add_action( 'wp_enqueue_scripts', 'wh_meta_emit_complete_registration', PHP_INT_MAX );
