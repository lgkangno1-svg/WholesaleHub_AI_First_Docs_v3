<?php
/**
 * Plugin Name: Avocadoss Deposit Webhook Guard
 * Description: Fails closed before the recharge/deposit REST webhook reaches application code.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Resolve the deposit webhook secret without ever exposing it in output/logs.
 */
function avocadoss_guard_deposit_webhook_secret(): string {
    if ( defined( 'AVOCADOSS_DEPOSIT_WEBHOOK_KEY' ) ) {
        $defined = trim( (string) AVOCADOSS_DEPOSIT_WEBHOOK_KEY );
        if ( '' !== $defined ) {
            return $defined;
        }
    }

    $environment = getenv( 'AVOCADOSS_DEPOSIT_WEBHOOK_KEY' );
    if ( false !== $environment ) {
        $environment = trim( (string) $environment );
        if ( '' !== $environment ) {
            return $environment;
        }
    }

    return '';
}

/**
 * The legacy permission callback compares strings directly. If both the configured
 * secret and incoming header are empty, that comparison can succeed. Block the exact
 * route earlier and use a constant-time comparison for configured secrets.
 */
add_filter(
    'rest_pre_dispatch',
    static function ( $result, $server, $request ) {
        unset( $server );

        if ( ! $request instanceof WP_REST_Request || '/avocadoss/v1/deposit-webhook' !== $request->get_route() ) {
            return $result;
        }

        $expected = avocadoss_guard_deposit_webhook_secret();
        if ( '' === $expected ) {
            return new WP_Error(
                'avocadoss_deposit_webhook_not_configured',
                '입금 확인 연동이 안전하게 구성되지 않았습니다.',
                array( 'status' => 503 )
            );
        }

        $provided = trim( (string) $request->get_header( 'X-Avocadoss-Key' ) );
        if ( '' === $provided || ! hash_equals( $expected, $provided ) ) {
            return new WP_Error(
                'avocadoss_deposit_webhook_unauthorized',
                '인증되지 않은 요청입니다.',
                array( 'status' => 401 )
            );
        }

        return $result;
    },
    1,
    3
);
