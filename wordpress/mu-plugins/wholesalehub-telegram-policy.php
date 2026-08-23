<?php
/**
 * Plugin Name: WholesaleHub Telegram Policy
 * Description: Makes supplier approval notifications opt-out instead of silently opt-in.
 */

defined( 'ABSPATH' ) || exit;

// Supplier catalog approval is an operator-facing workflow. The application class
// historically required this constant to be defined elsewhere; when it was absent,
// approvals were staged silently. Default to enabled while still respecting an
// explicit production override to false in wp-config/environment bootstrap code.
if ( ! defined( 'WHOLESALEHUB_TELEGRAM_APPROVAL_AUTO_SEND' ) ) {
    define( 'WHOLESALEHUB_TELEGRAM_APPROVAL_AUTO_SEND', true );
}
