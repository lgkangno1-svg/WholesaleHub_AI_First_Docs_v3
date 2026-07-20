<?php
/*
Plugin Name: Avocadoss Login Recovery Fallback
Description: Alerts the administrator through Telegram when a password-reset email cannot be sent.
*/

defined( 'ABSPATH' ) || exit;

/**
 * Extract a WordPress password-reset URL from wp_mail_failed error data.
 *
 * @param WP_Error $error Mail failure error.
 * @return string
 */
function avocadoss_login_recovery_reset_url( $error ) {
	if ( ! is_wp_error( $error ) ) {
		return '';
	}

	$data = $error->get_error_data( 'wp_mail_failed' );
	if ( ! is_array( $data ) || empty( $data['message'] ) ) {
		return '';
	}

	$message = html_entity_decode( (string) $data['message'], ENT_QUOTES, 'UTF-8' );
	if ( ! preg_match( '~https?://[^\s<>"\']+action=rp[^\s<>"\']+~i', $message, $matches ) ) {
		return '';
	}

	return esc_url_raw( rtrim( $matches[0], ".,;)" ) );
}

/**
 * Preserve a secure recovery path while the WordPress mail transport is down.
 *
 * @param WP_Error $error Mail failure error.
 */
function avocadoss_login_recovery_notify_admin( $error ) {
	$reset_url = avocadoss_login_recovery_reset_url( $error );
	if ( ! $reset_url || ! function_exists( 'avocadoss_send_telegram' ) ) {
		return;
	}

	$dedupe_key = 'avo_reset_fallback_' . md5( $reset_url );
	if ( get_transient( $dedupe_key ) ) {
		return;
	}
	set_transient( $dedupe_key, 1, 10 * MINUTE_IN_SECONDS );

	$query = wp_parse_url( $reset_url, PHP_URL_QUERY );
	parse_str( (string) $query, $params );
	$login = isset( $params['login'] ) ? sanitize_user( wp_unslash( $params['login'] ) ) : '(확인 필요)';

	$message  = "🔐 <b>회원 비밀번호 재설정 전달 필요</b>\n";
	$message .= "메일 발송 실패로 관리자에게 안전하게 대체 전달합니다.\n";
	$message .= '아이디: <b>' . esc_html( $login ) . "</b>\n";
	$message .= '<a href="' . esc_url( $reset_url ) . '">1회용 비밀번호 재설정 링크</a>';

	avocadoss_send_telegram( $message );
}
add_action( 'wp_mail_failed', 'avocadoss_login_recovery_notify_admin', 10, 1 );

