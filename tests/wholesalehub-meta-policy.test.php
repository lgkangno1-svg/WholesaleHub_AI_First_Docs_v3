<?php
declare(strict_types=1);

define( 'ABSPATH', '/tmp/' );
define( 'MINUTE_IN_SECONDS', 60 );
define( 'HOUR_IN_SECONDS', 3600 );
define( 'WP_CLI', false );

$GLOBALS['wh_hooks']         = array();
$GLOBALS['wh_user_meta']     = array();
$GLOBALS['wh_options']       = array();
$GLOBALS['wh_admin']         = false;
$GLOBALS['wh_ajax']          = false;
$GLOBALS['wh_cron']          = false;
$GLOBALS['wh_unscheduled']   = array();
$GLOBALS['wh_pixel_events']  = array();
$GLOBALS['wh_fake_connected'] = true;

function add_action( $hook, $callback, $priority = 10, $accepted_args = 1 ): void {
	$GLOBALS['wh_hooks']['action'][ $hook ][] = array( $callback, $priority, $accepted_args );
}
function add_filter( $hook, $callback, $priority = 10, $accepted_args = 1 ): void {
	$GLOBALS['wh_hooks']['filter'][ $hook ][] = array( $callback, $priority, $accepted_args );
}
function remove_filter( $hook, $callback, $priority = 10 ): bool { return true; }
function is_admin(): bool { return (bool) $GLOBALS['wh_admin']; }
function wp_doing_ajax(): bool { return (bool) $GLOBALS['wh_ajax']; }
function wp_doing_cron(): bool { return (bool) $GLOBALS['wh_cron']; }
function absint( $value ): int { return abs( (int) $value ); }
function wp_unslash( $value ) { return $value; }
function sanitize_text_field( $value ): string { return trim( (string) $value ); }
function sanitize_key( $value ): string { return strtolower( preg_replace( '/[^a-z0-9_\-]/', '', (string) $value ) ); }
function wp_verify_nonce( $nonce, $action ): bool { return 'valid-registration-nonce' === $nonce && 'woocommerce-register' === $action; }
function current_user_can( $capability ): bool { return true; }
function esc_html__( $text, $domain = '' ): string { return (string) $text; }
function is_ssl(): bool { return true; }
function wp_salt( $scheme = 'auth' ): string { return 'test-only-salt-' . $scheme; }
function wp_generate_password( $length = 12, $special_chars = true, $extra_special_chars = false ): string { return str_repeat( 'A', (int) $length ); }
function wp_generate_uuid4(): string { return '11111111-2222-4333-8444-555555555555'; }
function get_userdata( $user_id ) { return (object) array( 'ID' => (int) $user_id, 'roles' => array( 'customer' ) ); }
function get_user_meta( $user_id, $key, $single = false ) {
	return $GLOBALS['wh_user_meta'][ (int) $user_id ][ (string) $key ] ?? '';
}
function update_user_meta( $user_id, $key, $value ): bool {
	$GLOBALS['wh_user_meta'][ (int) $user_id ][ (string) $key ] = $value;
	return true;
}
function delete_user_meta( $user_id, $key ): bool {
	unset( $GLOBALS['wh_user_meta'][ (int) $user_id ][ (string) $key ] );
	return true;
}
function get_option( $key, $default = false ) { return $GLOBALS['wh_options'][ (string) $key ] ?? $default; }
function update_option( $key, $value, $autoload = null ): bool {
	$GLOBALS['wh_options'][ (string) $key ] = $value;
	return true;
}
function add_option( $key, $value = '', $deprecated = '', $autoload = 'yes' ): bool {
	$key = (string) $key;
	if ( array_key_exists( $key, $GLOBALS['wh_options'] ) ) {
		return false;
	}
	$GLOBALS['wh_options'][ $key ] = $value;
	return true;
}
function delete_option( $key ): bool {
	$key = (string) $key;
	if ( ! array_key_exists( $key, $GLOBALS['wh_options'] ) ) {
		return false;
	}
	unset( $GLOBALS['wh_options'][ $key ] );
	return true;
}
function wp_cache_delete( $key, $group = '' ): bool { return true; }
function as_unschedule_all_actions( $hook ): void { $GLOBALS['wh_unscheduled'][] = (string) $hook; }

class WH_Fake_Meta_Integration {
	public function get_facebook_pixel_id(): string { return 'configured-withheld-id'; }
}
class WH_Fake_Meta_Connection {
	public function is_connected(): bool { return (bool) $GLOBALS['wh_fake_connected']; }
}
class WH_Fake_Meta_Plugin {
	public function get_integration(): WH_Fake_Meta_Integration { return new WH_Fake_Meta_Integration(); }
	public function get_connection_handler(): WH_Fake_Meta_Connection { return new WH_Fake_Meta_Connection(); }
}
function facebook_for_woocommerce(): WH_Fake_Meta_Plugin { return new WH_Fake_Meta_Plugin(); }

class WC_Facebookcommerce_Pixel {
	public function __construct( $user_info ) {}
	public function inject_event( $event_name, $params, $method = 'track' ): void {
		$GLOBALS['wh_pixel_events'][] = array( 'name' => $event_name, 'params' => $params, 'method' => $method );
	}
}

class WH_Fake_Wpdb {
	public string $options = 'wp_options';

	public function prepare( $query, ...$args ) {
		return array( 'query' => $query, 'args' => $args );
	}

	public function query( $prepared ): int {
		$option_name   = (string) $prepared['args'][0];
		$expected_value = (string) $prepared['args'][1];
		if ( (string) get_option( $option_name, '' ) !== $expected_value ) {
			return 0;
		}
		unset( $GLOBALS['wh_options'][ $option_name ] );
		return 1;
	}
}

require __DIR__ . '/../wordpress/mu-plugins/wholesalehub-meta-policy.php';

function check( bool $condition, string $name ): void {
	if ( ! $condition ) {
		fwrite( STDERR, "FAIL: {$name}\n" );
		exit( 1 );
	}
	echo "PASS: {$name}\n";
}

function seed_b2b_profile( int $user_id ): void {
	foreach ( array(
		'_avo_business_number',
		'billing_first_name',
		'billing_company',
		'billing_phone',
		'billing_postcode',
		'billing_address_1',
		'billing_address_2',
	) as $key ) {
		$GLOBALS['wh_user_meta'][ $user_id ][ $key ] = 'synthetic-value';
	}
	$GLOBALS['wh_user_meta'][ $user_id ]['_avo_approval_status'] = 'pending';
}

// Run the registration arm before producing output so setcookie() is testable.
$registration_user = 101;
seed_b2b_profile( $registration_user );
$_SERVER['REQUEST_METHOD'] = 'POST';
$_POST = array(
	'woocommerce-register-nonce' => 'valid-registration-nonce',
	'avo_business_number'        => 'synthetic',
	'avo_billing_first_name'     => 'synthetic',
	'avo_business_company'       => 'synthetic',
	'avo_billing_phone'          => 'synthetic',
	'avo_billing_postcode'       => 'synthetic',
	'avo_billing_address'        => 'synthetic',
	'avo_billing_address_detail' => 'synthetic',
);
wh_meta_arm_complete_registration( $registration_user );
$armed_before_output = ! empty( $GLOBALS['wh_user_meta'][ $registration_user ][ WH_META_REGISTRATION_TOKEN_META ] )
	&& ! empty( $GLOBALS['wh_user_meta'][ $registration_user ][ WH_META_REGISTRATION_EVENT_META ] );

check( $armed_before_output, 'real public B2B registration arms one browser event' );
check( isset( $GLOBALS['wh_hooks']['filter']['facebook_for_woocommerce_block_full_batch_api_sync'] ), 'full batch sync filter registered' );
check( isset( $GLOBALS['wh_hooks']['filter']['wc_facebook_is_product_sync_enabled'] ), 'global product sync filter registered' );
check( isset( $GLOBALS['wh_hooks']['filter']['wc_facebook_should_sync_product'] ), 'per-product fail-closed filter registered' );
check( true === wh_meta_block_full_batch_sync(), 'full batch sync is blocked' );
check( false === wh_meta_disable_product_sync(), 'product sync is disabled' );
check( 'no' === wh_meta_force_disabled_option(), 'protected Meta options are forced off' );
check( ! isset( wh_meta_remove_checkout_url( array( 'name' => 'x', 'checkout_url' => 'private' ) )['checkout_url'] ), 'catalog checkout URL is stripped' );

$GLOBALS['wh_admin'] = true;
check( false === wh_meta_is_public_registration_request(), 'admin-created user is not a registration event' );
$GLOBALS['wh_admin'] = false;
unset( $_POST['avo_business_number'] );
check( false === wh_meta_is_public_registration_request(), 'validation failure is not a registration event' );

$event_user = 202;
$token      = 'browser-only-token';
$event_id   = 'whreg_test_once';
seed_b2b_profile( $event_user );
update_user_meta( $event_user, WH_META_REGISTRATION_TOKEN_META, wh_meta_hash_registration_token( $token ) );
update_user_meta( $event_user, WH_META_REGISTRATION_EXPIRES_META, time() + 300 );
update_user_meta( $event_user, WH_META_REGISTRATION_EVENT_META, $event_id );
$_COOKIE[ WH_META_REGISTRATION_COOKIE ] = $event_user . '.' . $token;

wh_meta_emit_complete_registration();
check( 1 === count( $GLOBALS['wh_pixel_events'] ), 'CompleteRegistration emitted once' );
check( 'CompleteRegistration' === $GLOBALS['wh_pixel_events'][0]['name'], 'standard CompleteRegistration event name used' );
check(
	array( 'status', 'registration_type' ) === array_keys( $GLOBALS['wh_pixel_events'][0]['params']['custom_data'] ),
	'custom event contains only approved non-PII fields'
);
check( ! empty( get_user_meta( $event_user, WH_META_REGISTRATION_SENT_META, true ) ), 'sent marker persisted' );

$_COOKIE[ WH_META_REGISTRATION_COOKIE ] = $event_user . '.' . $token;
wh_meta_emit_complete_registration();
check( 1 === count( $GLOBALS['wh_pixel_events'] ), 'refresh or replay does not duplicate registration event' );

$concurrent_user = 303;
$concurrent_token = 'concurrent-browser-token';
seed_b2b_profile( $concurrent_user );
update_user_meta( $concurrent_user, WH_META_REGISTRATION_TOKEN_META, wh_meta_hash_registration_token( $concurrent_token ) );
update_user_meta( $concurrent_user, WH_META_REGISTRATION_EXPIRES_META, time() + 300 );
update_user_meta( $concurrent_user, WH_META_REGISTRATION_EVENT_META, 'whreg_test_concurrent' );
$_COOKIE[ WH_META_REGISTRATION_COOKIE ] = $concurrent_user . '.' . $concurrent_token;
$concurrent_claim = wh_meta_claim_registration_event( $concurrent_user );
check( is_string( $concurrent_claim ), 'first concurrent request acquires atomic claim' );
wh_meta_emit_complete_registration();
check( 1 === count( $GLOBALS['wh_pixel_events'] ), 'second concurrent request cannot duplicate registration event' );
wh_meta_release_registration_event_claim( $concurrent_user, $concurrent_claim );
wh_meta_emit_complete_registration();
check( 2 === count( $GLOBALS['wh_pixel_events'] ), 'event emits after failed request releases its claim' );
$_COOKIE[ WH_META_REGISTRATION_COOKIE ] = $concurrent_user . '.' . $concurrent_token;
wh_meta_emit_complete_registration();
check( 2 === count( $GLOBALS['wh_pixel_events'] ), 'concurrent event also remains exactly once after completion' );

$stale_user       = 404;
$stale_option     = wh_meta_registration_claim_option_name( $stale_user );
$stale_claim      = ( time() - 1 ) . ':stale-owner';
$GLOBALS['wh_options'][ $stale_option ] = $stale_claim;
$GLOBALS['wpdb'] = new WH_Fake_Wpdb();
$replacement_claim = wh_meta_claim_registration_event( $stale_user );
check( is_string( $replacement_claim ) && $stale_claim !== $replacement_claim, 'stale claim is replaced safely' );
wh_meta_release_registration_event_claim( $stale_user, $stale_claim );
check( $replacement_claim === get_option( $stale_option, '' ), 'old owner cannot delete replacement claim' );
check( false === wh_meta_claim_registration_event( $stale_user ), 'replacement claim remains exclusive' );
wh_meta_release_registration_event_claim( $stale_user, $replacement_claim );
unset( $GLOBALS['wpdb'] );

$GLOBALS['wh_options']['wc_facebook_enable_product_sync'] = 'yes';
$GLOBALS['wh_options']['wc_facebook_enable_facebook_managed_coupons'] = 'yes';
wh_meta_enforce_catalog_policy();
check( 'no' === $GLOBALS['wh_options']['wc_facebook_enable_product_sync'], 'stored product sync option disabled' );
check( 'no' === $GLOBALS['wh_options']['wc_facebook_enable_facebook_managed_coupons'], 'stored managed coupons option disabled' );
check( in_array( 'wc_facebook_regenerate_feed', $GLOBALS['wh_unscheduled'], true ), 'existing product feed schedule removed' );
check( '1' === $GLOBALS['wh_options']['wh_meta_catalog_policy_version'], 'catalog policy persistence version recorded' );

echo "PASS: WholesaleHub Meta policy\n";
