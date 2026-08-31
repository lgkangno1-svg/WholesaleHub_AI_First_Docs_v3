<?php
/**
 * Plugin Name: WholesaleHub Admin Email Suppression
 * Description: Keeps membership approval in Telegram while suppressing selected administrator mailbox notices.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Prevent administrator-only signup and password-change notices from being sent.
 * Customer-facing account messages are intentionally not changed here.
 */
add_filter( 'pre_wp_mail', static function ( $pre, $atts ) {
    $subject = isset( $atts['subject'] ) ? (string) $atts['subject'] : '';

    if ( 0 === strpos( $subject, '[도매허브] 신규 회원가입 승인 요청:' ) ) {
        return true;
    }

    if ( 1 === preg_match( '/비밀번호 변경됨$/u', $subject ) ) {
        return true;
    }

    return $pre;
}, 999, 2 );

/** Suppress the WordPress core administrator notification for a new user. */
add_filter( 'wp_new_user_notification_email_admin', static function ( $email ) {
    if ( is_array( $email ) ) {
        $email['to'] = '';
    }
    return $email;
}, 999 );

/** Suppress the WordPress core administrator notification after a password reset. */
add_action( 'plugins_loaded', static function () {
    remove_action( 'after_password_reset', 'wp_password_change_notification' );
}, 999 );

/** Defensive fallback if another component invokes the core password notifier directly. */
add_filter( 'wp_password_change_notification_email', static function ( $email ) {
    if ( is_array( $email ) ) {
        $email['to'] = '';
    }
    return $email;
}, 999 );
