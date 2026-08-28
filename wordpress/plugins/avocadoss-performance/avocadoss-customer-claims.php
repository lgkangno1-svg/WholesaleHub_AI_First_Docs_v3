<?php
/**
 * Private customer defect/refund claims. Approval here records a CS status only.
 */

defined( 'ABSPATH' ) || exit;

if ( ! function_exists( 'avocadoss_telegram_send_photo' ) ) {
    /**
     * Send one local image with Telegram's multipart sendPhoto API.
     *
     * @return array|false Telegram result payload, or false on failure.
     */
    function avocadoss_telegram_send_photo( $file_path, $caption ) {
        $token   = trim( (string) get_option( 'avocadoss_telegram_bot_token', '' ) );
        $chat_id = trim( (string) get_option( 'avocadoss_telegram_chat_id', '' ) );
        if ( '' === $token && defined( 'AVOCADOSS_TG_BOT_TOKEN' ) ) {
            $token = trim( (string) AVOCADOSS_TG_BOT_TOKEN );
        }
        if ( '' === $chat_id && defined( 'AVOCADOSS_TG_CHAT_ID' ) ) {
            $chat_id = trim( (string) AVOCADOSS_TG_CHAT_ID );
        }
        if ( '' === $token || '' === $chat_id || ! preg_match( '/^[0-9]+:[A-Za-z0-9_-]+$/', $token ) || ! is_readable( $file_path ) ) {
            return false;
        }
        if ( ! function_exists( 'curl_init' ) || ! class_exists( 'CURLFile' ) ) {
            return false;
        }

        $curl = curl_init( 'https://api.telegram.org/bot' . $token . '/sendPhoto' );
        if ( false === $curl ) {
            return false;
        }
        curl_setopt_array( $curl, array(
            CURLOPT_POST           => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT        => (int) apply_filters( 'avocadoss_telegram_http_timeout', 60 ),
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_POSTFIELDS     => array(
                'chat_id' => $chat_id,
                'caption' => wp_strip_all_tags( (string) $caption ),
                'photo'   => new CURLFile( $file_path ),
            ),
        ) );
        $body = curl_exec( $curl );
        $code = (int) curl_getinfo( $curl, CURLINFO_HTTP_CODE );
        curl_close( $curl );
        if ( ! is_string( $body ) || 200 > $code || 300 <= $code ) {
            return false;
        }
        $decoded = json_decode( $body, true );
        return is_array( $decoded ) && ! empty( $decoded['ok'] ) && is_array( $decoded['result'] ) ? $decoded['result'] : false;
    }
}

final class Avocadoss_Customer_Claims {
    private const SCHEMA_OPTION  = 'avocadoss_customer_claim_schema';
    private const SCHEMA_VERSION = '1.0.0';
    private const MAX_BYTES      = 10485760;
    private const MAX_FILES      = 20;
    private const MAX_PIXELS     = 80000000;

    private const EVIDENCE = array(
        'waybill'          => '운송장 사진',
        'box_exterior'     => '박스 외관 사진',
        'damaged_product'  => '파손/불량 물품 사진',
        'transaction_proof'=> '거래내역 증빙',
    );
    private const REASONS = array(
        'damaged'      => '파손',
        'spoiled'      => '변질',
        'quality'      => '품질불량',
        'misdelivered' => '오배송',
        'shortage'     => '수량부족',
        'other'        => '기타',
    );
    private const RESOLUTIONS = array(
        'refund'       => '환불 요청',
        'redelivery'   => '재배송 요청',
        'admin_review' => '관리자 확인 요청',
    );
    private const STATUSES = array(
        'submitted' => '접수됨',
        'reviewing' => '검토중',
        'approved'  => '승인됨',
        'rejected'  => '반려됨',
        'resolved'  => '처리완료',
    );

    public static function boot() {
        add_action( 'plugins_loaded', array( __CLASS__, 'maybe_install_schema' ), 20 );
        add_action( 'woocommerce_order_details_after_order_table', array( __CLASS__, 'render_customer_claims' ), 25 );
        add_action( 'admin_post_wh_claim_submit', array( __CLASS__, 'submit' ) );
        add_action( 'admin_post_nopriv_wh_claim_submit', array( __CLASS__, 'submit' ) );
        add_action( 'admin_post_wh_claim_evidence', array( __CLASS__, 'download_evidence' ) );
        add_action( 'admin_post_nopriv_wh_claim_evidence', array( __CLASS__, 'download_evidence' ) );
        add_action( 'admin_post_wh_claim_status', array( __CLASS__, 'change_status' ) );
        add_action( 'woocommerce_admin_order_data_after_order_details', array( __CLASS__, 'render_admin_claims' ) );

        // 주문상세(불량/환불 요청) 화면에서 청구/배송 주소 블록을 숨깁니다.
        add_filter(
            'wc_get_template',
            static function ( $template, $template_name ) {
                return 'order/order-details-customer.php' === $template_name ? '' : $template;
            },
            10,
            2
        );

        if ( defined( 'WP_CLI' ) && WP_CLI ) {
            WP_CLI::add_command( 'avocadoss claims-retry', array( __CLASS__, 'cli_retry' ) );
        }
    }

    public static function maybe_install_schema() {
        if ( self::SCHEMA_VERSION === (string) get_option( self::SCHEMA_OPTION, '' ) ) {
            return;
        }
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset  = $wpdb->get_charset_collate();
        $claims   = self::claims_table();
        $evidence = self::evidence_table();
        dbDelta( "CREATE TABLE {$claims} (
            id bigint unsigned NOT NULL AUTO_INCREMENT,
            claim_key varchar(32) NOT NULL,
            idempotency_key varchar(64) NOT NULL,
            customer_user_id bigint unsigned NOT NULL,
            order_id bigint unsigned NOT NULL,
            order_item_id bigint unsigned NOT NULL,
            variation_id bigint unsigned NOT NULL DEFAULT 0,
            purchased_qty int unsigned NOT NULL,
            requested_qty int unsigned NOT NULL,
            reason_code varchar(32) NOT NULL,
            customer_note text NOT NULL,
            requested_resolution varchar(32) NOT NULL,
            status varchar(20) NOT NULL DEFAULT 'submitted',
            telegram_sent_at datetime NULL,
            telegram_message_refs text NULL,
            telegram_delivery varchar(16) NOT NULL DEFAULT 'none',
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY claim_key (claim_key),
            UNIQUE KEY idempotency_key (idempotency_key),
            KEY customer_order_item (customer_user_id,order_id,order_item_id),
            KEY claim_status (status)
        ) {$charset};" );
        dbDelta( "CREATE TABLE {$evidence} (
            id bigint unsigned NOT NULL AUTO_INCREMENT,
            claim_id bigint unsigned NOT NULL,
            evidence_type varchar(32) NOT NULL,
            stored_file_path varchar(512) NOT NULL,
            mime varchar(64) NOT NULL,
            size int unsigned NOT NULL,
            telegram_sent_at datetime NULL,
            created_at datetime NOT NULL,
            PRIMARY KEY  (id),
            KEY claim_id (claim_id)
        ) {$charset};" );
        update_option( self::SCHEMA_OPTION, self::SCHEMA_VERSION, false );
    }

    private static function claims_table() {
        global $wpdb;
        return $wpdb->prefix . 'wholesalehub_claims';
    }

    private static function evidence_table() {
        global $wpdb;
        return $wpdb->prefix . 'wholesalehub_claim_evidence';
    }

    private static function is_admin_user() {
        return current_user_can( 'manage_woocommerce' );
    }

    private static function eligible_order( $order ) {
        $paid = function_exists( 'wc_get_is_paid_statuses' ) ? wc_get_is_paid_statuses() : array();
        $allowed = array_unique( array_merge( array( 'processing', 'completed' ), array_map( static function ( $status ) {
            return 0 === strpos( $status, 'wc-' ) ? substr( $status, 3 ) : $status;
        }, $paid ) ) );
        $blocked = array( 'pending', 'on-hold', 'failed', 'cancelled', 'checkout-draft', 'refunded' );
        return ! in_array( $order->get_status(), $blocked, true ) && in_array( $order->get_status(), $allowed, true );
    }

    private static function remaining_qty( $order, $item ) {
        $purchased = max( 0, (int) $item->get_quantity() );
        if ( empty( $order->get_refunds() ) ) {
            return $purchased;
        }
        return max( 0, $purchased - abs( (int) $order->get_qty_refunded_for_item( $item->get_id() ) ) );
    }

    private static function option_summary( $item ) {
        $parts = array();
        foreach ( $item->get_formatted_meta_data( '_' ) as $meta ) {
            $key   = trim( wp_strip_all_tags( (string) $meta->display_key ) );
            $value = trim( wp_strip_all_tags( (string) $meta->display_value ) );
            if ( '' !== $value ) {
                $parts[] = ( '' !== $key ? $key . ': ' : '' ) . $value;
            }
        }
        return empty( $parts ) ? '-' : implode( ', ', array_unique( $parts ) );
    }

    private static function claims_for_item( $customer_id, $order_id, $item_id ) {
        global $wpdb;
        return $wpdb->get_results( $wpdb->prepare(
            'SELECT * FROM ' . self::claims_table() . ' WHERE customer_user_id=%d AND order_id=%d AND order_item_id=%d ORDER BY id DESC',
            $customer_id,
            $order_id,
            $item_id
        ), ARRAY_A );
    }

    private static function active_claim( $customer_id, $order_id, $item_id ) {
        global $wpdb;
        return $wpdb->get_row( $wpdb->prepare(
            "SELECT * FROM " . self::claims_table() . " WHERE customer_user_id=%d AND order_id=%d AND order_item_id=%d AND status IN ('submitted','reviewing') ORDER BY id DESC LIMIT 1",
            $customer_id,
            $order_id,
            $item_id
        ), ARRAY_A );
    }

    public static function render_customer_claims( $order ) {
        if ( ! $order instanceof WC_Order || ! is_user_logged_in() || ( (int) $order->get_customer_id() !== get_current_user_id() && ! self::is_admin_user() ) ) {
            return;
        }
        $eligible   = self::eligible_order( $order );
        $customer_id = (int) $order->get_customer_id();
        $rendered   = false;
        foreach ( $order->get_items() as $item_id => $item ) {
            if ( ! $item instanceof WC_Order_Item_Product ) {
                continue;
            }
            $claims = self::claims_for_item( $customer_id, $order->get_id(), $item_id );
            $active = null;
            foreach ( $claims as $claim ) {
                if ( in_array( $claim['status'], array( 'submitted', 'reviewing' ), true ) ) {
                    $active = $claim;
                    break;
                }
            }
            $remaining = self::remaining_qty( $order, $item );
            if ( empty( $claims ) && ( ! $eligible || 1 > $remaining ) ) {
                continue;
            }
            if ( ! $rendered ) {
                echo '<section class="wh-claims" aria-labelledby="wh-claims-title"><h2 id="wh-claims-title">불량/환불 요청</h2>';
                $rendered = true;
            }
            echo '<article class="wh-claim-item"><strong>' . esc_html( $item->get_name() ) . '</strong><div class="wh-claim-option">' . esc_html( self::option_summary( $item ) ) . '</div>';
            foreach ( $claims as $claim ) {
                $label = isset( self::STATUSES[ $claim['status'] ] ) ? self::STATUSES[ $claim['status'] ] : $claim['status'];
                echo '<p class="wh-claim-status">불량/환불 요청 · 상태: ' . esc_html( $label ) . ' · 접수번호: ' . esc_html( $claim['claim_key'] ) . ' · 접수일시: ' . esc_html( $claim['created_at'] ) . '</p>';
            }
            if ( $eligible && 0 < $remaining && ! $active ) {
                self::render_form( $order, $item, $remaining );
            }
            echo '</article>';
        }
        if ( $rendered ) {
            echo '</section>';
            self::render_assets();
        }
    }

    private static function render_form( $order, $item, $remaining ) {
        $id = 'wh-claim-modal-' . $item->get_id();
        echo '<p>환불 가능 잔여수량: ' . (int) $remaining . '</p><button type="button" class="button wh-claim-open" data-target="' . esc_attr( $id ) . '">불량/환불 요청</button>';
        echo '<div id="' . esc_attr( $id ) . '" class="wh-claim-modal" hidden><div class="wh-claim-dialog" role="dialog" aria-modal="true" aria-labelledby="' . esc_attr( $id ) . '-title"><button type="button" class="wh-claim-close" aria-label="닫기">×</button><h3 id="' . esc_attr( $id ) . '-title">불량/환불 요청</h3>';
        echo '<form method="post" enctype="multipart/form-data" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '"><input type="hidden" name="action" value="wh_claim_submit"><input type="hidden" name="order_id" value="' . (int) $order->get_id() . '"><input type="hidden" name="order_item_id" value="' . (int) $item->get_id() . '">';
        wp_nonce_field( 'wh_claim_submit_' . $order->get_id() . '_' . $item->get_id(), 'wh_claim_nonce' );
        echo '<dl><dt>주문번호</dt><dd>' . esc_html( $order->get_order_number() ) . '</dd><dt>상품명</dt><dd>' . esc_html( $item->get_name() ) . '</dd><dt>옵션명</dt><dd>' . esc_html( self::option_summary( $item ) ) . '</dd><dt>구매수량</dt><dd>' . (int) $item->get_quantity() . '</dd></dl>';
        echo '<label>문제수량<select name="requested_qty" required>';
        for ( $qty = 1; $qty <= $remaining; $qty++ ) {
            echo '<option value="' . (int) $qty . '">' . (int) $qty . '</option>';
        }
        echo '</select></label><label>문제유형<select name="reason_code" required><option value="">선택</option>';
        foreach ( self::REASONS as $value => $label ) {
            echo '<option value="' . esc_attr( $value ) . '">' . esc_html( $label ) . '</option>';
        }
        echo '</select></label><label>상세내용<textarea name="customer_note" rows="5" maxlength="3000" required></textarea></label><label>희망처리<select name="requested_resolution" required><option value="">선택</option>';
        foreach ( self::RESOLUTIONS as $value => $label ) {
            echo '<option value="' . esc_attr( $value ) . '">' . esc_html( $label ) . '</option>';
        }
        echo '</select></label>';
        foreach ( self::EVIDENCE as $type => $label ) {
            $multiple = 'damaged_product' === $type ? ' multiple' : '';
            echo '<label>' . esc_html( $label ) . ' (필수)<input type="file" name="evidence_' . esc_attr( $type ) . '[]" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" required' . $multiple . '></label>';
        }
        echo '<p class="description">JPG, PNG, WebP만 가능하며 파일당 최대 10MB입니다. HEIC는 JPG/PNG로 변환해 주세요.</p><button type="submit" class="button alt">요청 접수</button></form></div></div>';
    }

    private static function render_assets() {
        ?>
        <style>
        .wh-claims{margin:24px 0}.wh-claim-item{position:relative;margin:12px 0;padding:16px;border:1px solid #ddd;border-radius:8px}.wh-claim-option{color:#666}.wh-claim-status{padding:8px;background:#f5f5f5}.wh-claim-modal{position:fixed;z-index:99999;inset:0;background:rgba(0,0,0,.55);padding:4vh 16px;overflow:auto}.wh-claim-dialog{position:relative;max-width:640px;margin:auto;padding:24px;background:#fff;border-radius:8px}.wh-claim-close{position:absolute;right:12px;top:8px;border:0;background:none;font-size:28px}.wh-claim-dialog label{display:block;margin:14px 0;font-weight:600}.wh-claim-dialog input[type=file],.wh-claim-dialog select,.wh-claim-dialog textarea{display:block;width:100%;margin-top:5px}.wh-claim-dialog dl{display:grid;grid-template-columns:90px 1fr;gap:5px}.wh-claim-dialog dt{font-weight:600}.wh-claim-dialog dd{margin:0}
        </style>
        <script>
        document.addEventListener('click',function(e){var open=e.target.closest('.wh-claim-open'),close=e.target.closest('.wh-claim-close');if(open){var modal=document.getElementById(open.dataset.target);if(modal){modal.hidden=false;modal.querySelector('select,textarea,input,button').focus();}}if(close){close.closest('.wh-claim-modal').hidden=true;}if(e.target.classList.contains('wh-claim-modal')){e.target.hidden=true;}});
        document.addEventListener('keydown',function(e){if(e.key==='Escape'){document.querySelectorAll('.wh-claim-modal:not([hidden])').forEach(function(m){m.hidden=true;});}});
        </script>
        <?php
    }

    public static function submit() {
        if ( ! is_user_logged_in() ) {
            wp_die( '로그인이 필요합니다.', '접근 거부', array( 'response' => 403 ) );
        }
        $order_id = isset( $_POST['order_id'] ) ? absint( $_POST['order_id'] ) : 0;
        $item_id  = isset( $_POST['order_item_id'] ) ? absint( $_POST['order_item_id'] ) : 0;
        $nonce    = isset( $_POST['wh_claim_nonce'] ) ? sanitize_text_field( wp_unslash( $_POST['wh_claim_nonce'] ) ) : '';
        if ( ! wp_verify_nonce( $nonce, 'wh_claim_submit_' . $order_id . '_' . $item_id ) ) {
            wp_die( '요청 확인에 실패했습니다. 다시 시도해 주세요.', '접근 거부', array( 'response' => 403 ) );
        }
        $order = wc_get_order( $order_id );
        if ( ! $order ) {
            wp_die( '주문을 찾을 수 없습니다.', '접근 거부', array( 'response' => 403 ) );
        }
        if ( (int) $order->get_customer_id() !== get_current_user_id() && ! self::is_admin_user() ) {
            wp_die( '해당 주문에 대한 권한이 없습니다.', '접근 거부', array( 'response' => 403 ) );
        }
        $item = $order->get_item( $item_id );
        if ( ! $item instanceof WC_Order_Item_Product ) {
            wp_die( '주문 상품을 확인할 수 없습니다.', '접근 거부', array( 'response' => 403 ) );
        }
        if ( ! self::eligible_order( $order ) ) {
            self::redirect_error( $order, '현재 주문 상태에서는 불량/환불 요청을 접수할 수 없습니다.' );
        }
        $requested_qty = isset( $_POST['requested_qty'] ) ? absint( $_POST['requested_qty'] ) : 0;
        $purchased_qty = (int) $item->get_quantity();
        $remaining_qty = self::remaining_qty( $order, $item );
        if ( 1 > $requested_qty || $requested_qty > $purchased_qty || $requested_qty > $remaining_qty ) {
            wp_die( '문제수량이 주문 또는 환불 가능 수량 범위를 벗어났습니다.', '접근 거부', array( 'response' => 403 ) );
        }
        $customer_id = (int) $order->get_customer_id();
        $active = self::active_claim( $customer_id, $order_id, $item_id );
        if ( $active ) {
            self::redirect_error( $order, '현재 처리 중인 불량/환불 요청이 있습니다. 상태: ' . self::STATUSES[ $active['status'] ] );
        }
        $reason = isset( $_POST['reason_code'] ) ? sanitize_key( wp_unslash( $_POST['reason_code'] ) ) : '';
        $resolution = isset( $_POST['requested_resolution'] ) ? sanitize_key( wp_unslash( $_POST['requested_resolution'] ) ) : '';
        $note = isset( $_POST['customer_note'] ) ? trim( sanitize_textarea_field( wp_unslash( $_POST['customer_note'] ) ) ) : '';
        if ( ! isset( self::REASONS[ $reason ] ) || ! isset( self::RESOLUTIONS[ $resolution ] ) || '' === $note ) {
            self::redirect_error( $order, '문제유형, 상세내용, 희망처리를 모두 입력해 주세요.' );
        }
        if ( self::text_length( $note ) > 3000 ) {
            self::redirect_error( $order, '상세내용은 3,000자 이하로 입력해 주세요.' );
        }

        $files = self::collect_and_validate_files( $order );
        $digest_parts = array();
        foreach ( $files as $file ) {
            $file_hash = hash_file( 'sha256', $file['tmp_name'] );
            if ( false === $file_hash ) {
                self::redirect_error( $order, '증빙자료를 확인하지 못했습니다. 다시 첨부해 주세요.' );
            }
            $digest_parts[] = $file['type'] . ':' . $file_hash;
        }
        $idempotency = hash( 'sha256', $customer_id . '|' . $order_id . '|' . $item_id . '|' . hash( 'sha256', implode( '|', $digest_parts ) ) );
        $lock_name = 'wh_claim_' . substr( hash( 'sha256', $customer_id . '|' . $order_id . '|' . $item_id ), 0, 40 );
        global $wpdb;
        $locked = '1' === (string) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, 10)', $lock_name ) );
        if ( ! $locked ) {
            self::redirect_error( $order, '요청이 처리 중입니다. 잠시 후 다시 시도해 주세요.' );
        }

        $claim_id = 0;
        try {
            $active = self::active_claim( $customer_id, $order_id, $item_id );
            if ( $active ) {
                $wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock_name ) );
                self::redirect_error( $order, '현재 처리 중인 불량/환불 요청이 있습니다. 상태: ' . self::STATUSES[ $active['status'] ] );
            }
            $existing = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::claims_table() . ' WHERE idempotency_key=%s LIMIT 1', $idempotency ), ARRAY_A );
            if ( $existing ) {
                $wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock_name ) );
                self::redirect_error( $order, '이미 접수된 요청입니다. 접수번호: ' . $existing['claim_key'] );
            }
            self::ensure_private_root();
            $now = current_time( 'mysql' );
            if ( false === $wpdb->query( 'START TRANSACTION' ) ) {
                throw new RuntimeException( 'transaction_start_failed' );
            }
            $inserted = $wpdb->insert( self::claims_table(), array(
                'claim_key'           => 'TMP-' . wp_generate_password( 20, false, false ),
                'idempotency_key'     => $idempotency,
                'customer_user_id'    => $customer_id,
                'order_id'            => $order_id,
                'order_item_id'       => $item_id,
                'variation_id'        => (int) $item->get_variation_id(),
                'purchased_qty'       => $purchased_qty,
                'requested_qty'       => $requested_qty,
                'reason_code'         => $reason,
                'customer_note'       => $note,
                'requested_resolution'=> $resolution,
                'status'              => 'submitted',
                'telegram_delivery'   => 'none',
                'created_at'          => $now,
                'updated_at'          => $now,
            ) );
            if ( ! $inserted ) {
                throw new RuntimeException( 'claim_insert_failed' );
            }
            $claim_id = (int) $wpdb->insert_id;
            $claim_key = 'CS-' . wp_date( 'Ymd', null, new DateTimeZone( 'Asia/Seoul' ) ) . '-' . str_pad( (string) $claim_id, 4, '0', STR_PAD_LEFT );
            if ( false === $wpdb->update( self::claims_table(), array( 'claim_key' => $claim_key ), array( 'id' => $claim_id ) ) ) {
                throw new RuntimeException( 'claim_key_update_failed' );
            }
            $type_counts = array();
            foreach ( $files as $file ) {
                $type_counts[ $file['type'] ] = isset( $type_counts[ $file['type'] ] ) ? $type_counts[ $file['type'] ] + 1 : 1;
                $relative = $claim_id . '/' . $file['type'] . '/' . $type_counts[ $file['type'] ] . '.' . $file['ext'];
                $absolute = self::private_root() . '/' . $relative;
                if ( ! wp_mkdir_p( dirname( $absolute ) ) || ! self::reencode_image( $file, $absolute ) ) {
                    throw new RuntimeException( 'evidence_store_failed' );
                }
                $size = filesize( $absolute );
                if ( false === $size || ! $wpdb->insert( self::evidence_table(), array(
                    'claim_id'        => $claim_id,
                    'evidence_type'   => $file['type'],
                    'stored_file_path'=> $relative,
                    'mime'            => $file['mime'],
                    'size'            => (int) $size,
                    'created_at'      => $now,
                ) ) ) {
                    throw new RuntimeException( 'evidence_insert_failed' );
                }
            }
            if ( false === $wpdb->query( 'COMMIT' ) ) {
                throw new RuntimeException( 'transaction_commit_failed' );
            }
        } catch ( Throwable $error ) {
            $wpdb->query( 'ROLLBACK' );
            $private_root = self::private_root();
            if ( $claim_id && '' !== $private_root ) {
                self::remove_tree( $private_root . '/' . $claim_id );
            }
            $wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock_name ) );
            self::redirect_error( $order, '증빙자료를 안전하게 저장하지 못했습니다. 다시 시도해 주세요.' );
        } finally {
            $wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock_name ) );
        }

        self::send_telegram( $claim_id );
        if ( function_exists( 'wc_add_notice' ) ) {
            $claim_key = $wpdb->get_var( $wpdb->prepare( 'SELECT claim_key FROM ' . self::claims_table() . ' WHERE id=%d', $claim_id ) );
            wc_add_notice( '불량/환불 요청이 접수되었습니다. 접수번호: ' . $claim_key, 'success' );
        }
        wp_safe_redirect( $order->get_view_order_url() );
        exit;
    }

    private static function text_length( $text ) {
        return function_exists( 'mb_strlen' ) ? mb_strlen( $text ) : strlen( $text );
    }

    private static function redirect_error( $order, $message ) {
        if ( function_exists( 'wc_add_notice' ) ) {
            wc_add_notice( $message, 'error' );
            wp_safe_redirect( $order->get_view_order_url() );
            exit;
        }
        wp_die( esc_html( $message ), '요청 실패', array( 'response' => 400 ) );
    }

    private static function collect_and_validate_files( $order ) {
        $files = array();
        foreach ( self::EVIDENCE as $type => $unused ) {
            $field = 'evidence_' . $type;
            if ( empty( $_FILES[ $field ] ) || ! is_array( $_FILES[ $field ]['name'] ) ) {
                self::redirect_error( $order, '필수 증빙자료 4종을 모두 첨부해주세요.' );
            }
            $valid_for_type = 0;
            foreach ( $_FILES[ $field ]['name'] as $index => $name ) {
                $error = isset( $_FILES[ $field ]['error'][ $index ] ) ? (int) $_FILES[ $field ]['error'][ $index ] : UPLOAD_ERR_NO_FILE;
                if ( UPLOAD_ERR_NO_FILE === $error ) {
                    continue;
                }
                if ( UPLOAD_ERR_OK !== $error ) {
                    self::redirect_error( $order, '사진 업로드에 실패했습니다. 파일 크기와 형식을 확인해 주세요.' );
                }
                $file = array(
                    'type'     => $type,
                    'name'     => (string) $name,
                    'tmp_name' => isset( $_FILES[ $field ]['tmp_name'][ $index ] ) ? (string) $_FILES[ $field ]['tmp_name'][ $index ] : '',
                    'size'     => isset( $_FILES[ $field ]['size'][ $index ] ) ? (int) $_FILES[ $field ]['size'][ $index ] : 0,
                );
                $files[] = self::validate_file( $order, $file );
                $valid_for_type++;
                if ( count( $files ) > self::MAX_FILES ) {
                    self::redirect_error( $order, '증빙사진은 최대 20개까지 첨부할 수 있습니다.' );
                }
            }
            if ( 1 > $valid_for_type ) {
                self::redirect_error( $order, '필수 증빙자료 4종을 모두 첨부해주세요.' );
            }
        }
        return $files;
    }

    private static function validate_file( $order, $file ) {
        $ext = strtolower( pathinfo( $file['name'], PATHINFO_EXTENSION ) );
        if ( in_array( $ext, array( 'heic', 'heif' ), true ) ) {
            self::redirect_error( $order, 'HEIC 사진은 지원하지 않습니다. JPG 또는 PNG로 변환해 주세요.' );
        }
        if ( 1 > $file['size'] || self::MAX_BYTES < $file['size'] || ! is_uploaded_file( $file['tmp_name'] ) ) {
            self::redirect_error( $order, '사진은 파일당 10MB 이하의 정상적인 업로드 파일이어야 합니다.' );
        }
        if ( ! function_exists( 'mime_content_type' ) ) {
            self::redirect_error( $order, '서버에서 사진 형식을 안전하게 확인할 수 없습니다.' );
        }
        $allowed = array( 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp' );
        $checked = wp_check_filetype_and_ext( $file['tmp_name'], $file['name'], $allowed );
        $actual  = (string) mime_content_type( $file['tmp_name'] );
        $image   = @getimagesize( $file['tmp_name'] );
        if ( ! isset( $allowed[ $ext ] ) || empty( $checked['ext'] ) || empty( $checked['type'] ) || $allowed[ $ext ] !== $actual || $checked['type'] !== $actual || ! is_array( $image ) || empty( $image[0] ) || empty( $image[1] ) || ( isset( $image['mime'] ) && $image['mime'] !== $actual ) ) {
            self::redirect_error( $order, 'JPG, PNG, WebP 형식의 실제 이미지 파일만 첨부할 수 있습니다.' );
        }
        if ( (int) $image[0] * (int) $image[1] > self::MAX_PIXELS ) {
            self::redirect_error( $order, '이미지 해상도가 너무 큽니다. 크기를 줄인 뒤 다시 첨부해 주세요.' );
        }
        $file['ext']  = 'jpeg' === $ext ? 'jpg' : $ext;
        $file['mime'] = $actual;
        return $file;
    }

    private static function private_root() {
        $uploads = wp_upload_dir();
        if ( ! empty( $uploads['error'] ) || empty( $uploads['basedir'] ) ) {
            return '';
        }
        return trailingslashit( $uploads['basedir'] ) . 'wh-claims';
    }

    private static function ensure_private_root() {
        $root = self::private_root();
        if ( '' === $root || ! wp_mkdir_p( $root ) ) {
            throw new RuntimeException( 'private_root_failed' );
        }
        $htaccess = $root . '/.htaccess';
        if ( ! file_exists( $htaccess ) ) {
            $rules = "Options -Indexes\n<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n";
            if ( false === file_put_contents( $htaccess, $rules, LOCK_EX ) ) {
                throw new RuntimeException( 'htaccess_failed' );
            }
        }
        $index = $root . '/index.php';
        if ( ! file_exists( $index ) && false === file_put_contents( $index, "<?php\n// Silence is golden.\n", LOCK_EX ) ) {
            throw new RuntimeException( 'index_failed' );
        }
    }

    private static function reencode_image( $file, $destination ) {
        if ( function_exists( 'wp_get_image_editor' ) ) {
            $editor = wp_get_image_editor( $file['tmp_name'] );
            if ( ! is_wp_error( $editor ) ) {
                $size = $editor->get_size();
                $ready = true;
                if ( isset( $size['width'], $size['height'] ) && ( 2560 < $size['width'] || 2560 < $size['height'] ) ) {
                    $ready = ! is_wp_error( $editor->resize( 2560, 2560, false ) );
                }
                $editor->set_quality( 90 );
                if ( $ready ) {
                    $saved = $editor->save( $destination, $file['mime'] );
                    if ( ! is_wp_error( $saved ) && is_file( $destination ) ) {
                        return true;
                    }
                }
            }
        }
        return self::gd_reencode( $file, $destination );
    }

    private static function gd_reencode( $file, $destination ) {
        $loaders = array( 'image/jpeg' => 'imagecreatefromjpeg', 'image/png' => 'imagecreatefrompng', 'image/webp' => 'imagecreatefromwebp' );
        if ( empty( $loaders[ $file['mime'] ] ) || ! function_exists( $loaders[ $file['mime'] ] ) ) {
            return false;
        }
        $image = @$loaders[ $file['mime'] ]( $file['tmp_name'] );
        if ( false === $image ) {
            return false;
        }
        $width = imagesx( $image );
        $height = imagesy( $image );
        if ( 2560 < $width || 2560 < $height ) {
            $scale = min( 2560 / $width, 2560 / $height );
            $resized = imagescale( $image, max( 1, (int) round( $width * $scale ) ), max( 1, (int) round( $height * $scale ) ), IMG_BICUBIC );
            if ( false === $resized ) {
                imagedestroy( $image );
                return false;
            }
            imagedestroy( $image );
            $image = $resized;
        }
        if ( 'image/png' === $file['mime'] ) {
            imagealphablending( $image, false );
            imagesavealpha( $image, true );
            $saved = imagepng( $image, $destination, 6 );
        } elseif ( 'image/webp' === $file['mime'] && function_exists( 'imagewebp' ) ) {
            $saved = imagewebp( $image, $destination, 90 );
        } else {
            $saved = imagejpeg( $image, $destination, 92 );
        }
        imagedestroy( $image );
        return $saved && is_file( $destination );
    }

    private static function remove_tree( $path ) {
        if ( ! is_dir( $path ) ) {
            return;
        }
        foreach ( scandir( $path ) as $entry ) {
            if ( '.' === $entry || '..' === $entry ) {
                continue;
            }
            $child = $path . '/' . $entry;
            is_dir( $child ) ? self::remove_tree( $child ) : unlink( $child );
        }
        rmdir( $path );
    }

    public static function send_telegram( $claim_id, $retry_failed_evidence = false ) {
        global $wpdb;
        $claim = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::claims_table() . ' WHERE id=%d', $claim_id ), ARRAY_A );
        if ( ! $claim ) {
            return false;
        }
        if ( ! $retry_failed_evidence && ! empty( $claim['telegram_sent_at'] ) ) {
            return 'full' === $claim['telegram_delivery'];
        }
        $order = wc_get_order( (int) $claim['order_id'] );
        $item  = $order ? $order->get_item( (int) $claim['order_item_id'] ) : false;
        if ( ! $order || ! $item instanceof WC_Order_Item_Product ) {
            return false;
        }
        $refs = json_decode( (string) $claim['telegram_message_refs'], true );
        $refs = is_array( $refs ) ? array_values( array_filter( array_map( 'absint', $refs ) ) ) : array();
        if ( ! $retry_failed_evidence && empty( $claim['telegram_sent_at'] ) ) {
            try {
                $kst = ( new DateTimeImmutable( $claim['created_at'], wp_timezone() ) )->setTimezone( new DateTimeZone( 'Asia/Seoul' ) )->format( 'Y-m-d H:i:s' );
            } catch ( Exception $error ) {
                $kst = $claim['created_at'];
            }
            $message = implode( "\n", array(
                '🚨 도매허브 불량/환불 요청 접수',
                '',
                '접수번호: ' . $claim['claim_key'],
                '주문번호: ' . $order->get_order_number(),
                '상품: ' . $item->get_name(),
                '옵션: ' . self::option_summary( $item ),
                '문제수량: ' . (int) $claim['requested_qty'] . ' / 구매수량 ' . (int) $claim['purchased_qty'],
                '문제유형: ' . self::REASONS[ $claim['reason_code'] ],
                '희망처리: ' . self::RESOLUTIONS[ $claim['requested_resolution'] ],
                '접수시각: ' . $kst . ' KST',
                '고객 설명:',
                $claim['customer_note'],
            ) );
            if ( function_exists( 'avocadoss_send_telegram_message' ) && avocadoss_send_telegram_message( $message ) ) {
                $claim['telegram_sent_at'] = current_time( 'mysql' );
                $wpdb->update( self::claims_table(), array( 'telegram_sent_at' => $claim['telegram_sent_at'] ), array( 'id' => $claim_id ) );
            }
        }
        $evidence = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::evidence_table() . ' WHERE claim_id=%d ORDER BY id', $claim_id ), ARRAY_A );
        $totals = array_count_values( array_column( $evidence, 'evidence_type' ) );
        $indexes = array();
        foreach ( $evidence as $file ) {
            $type = $file['evidence_type'];
            $indexes[ $type ] = isset( $indexes[ $type ] ) ? $indexes[ $type ] + 1 : 1;
            if ( ! empty( $file['telegram_sent_at'] ) ) {
                continue;
            }
            $absolute = self::safe_evidence_path( $file['stored_file_path'] );
            if ( ! $absolute ) {
                continue;
            }
            $prefixes = array( 'waybill' => '1/4', 'box_exterior' => '2/4', 'damaged_product' => '3/4', 'transaction_proof' => '4/4' );
            $caption = '[' . $prefixes[ $type ] . ' ' . self::EVIDENCE[ $type ];
            if ( in_array( $type, array( 'damaged_product', 'transaction_proof' ), true ) || 1 < $totals[ $type ] ) {
                $caption .= ' ' . $indexes[ $type ] . '/' . $totals[ $type ];
            }
            $result = avocadoss_telegram_send_photo( $absolute, $caption . ']' );
            if ( is_array( $result ) && ! empty( $result['message_id'] ) ) {
                $refs[] = absint( $result['message_id'] );
                $wpdb->update( self::evidence_table(), array( 'telegram_sent_at' => current_time( 'mysql' ) ), array( 'id' => (int) $file['id'] ) );
            }
        }
        $sent_files = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::evidence_table() . ' WHERE claim_id=%d AND telegram_sent_at IS NOT NULL', $claim_id ) );
        $delivery = ! empty( $claim['telegram_sent_at'] ) && $sent_files === count( $evidence ) ? 'full' : ( empty( $claim['telegram_sent_at'] ) && 0 === $sent_files ? 'none' : 'partial' );
        $wpdb->update( self::claims_table(), array(
            'telegram_message_refs' => wp_json_encode( array_values( array_unique( $refs ) ) ),
            'telegram_delivery'     => $delivery,
            'updated_at'            => current_time( 'mysql' ),
        ), array( 'id' => $claim_id ) );
        return 'full' === $delivery;
    }

    private static function safe_evidence_path( $relative ) {
        $private_root = self::private_root();
        if ( '' === $private_root ) {
            return false;
        }
        $root = realpath( $private_root );
        $path = realpath( $private_root . '/' . ltrim( (string) $relative, '/\\' ) );
        if ( false === $root || false === $path || 0 !== strpos( $path, $root . DIRECTORY_SEPARATOR ) || ! is_file( $path ) ) {
            return false;
        }
        return $path;
    }

    private static function evidence_url( $claim_id, $file_id, $inline = false ) {
        $url = add_query_arg( array(
            'action'   => 'wh_claim_evidence',
            'claim_id' => (int) $claim_id,
            'file_id'  => (int) $file_id,
            'view'     => $inline ? 1 : 0,
        ), admin_url( 'admin-post.php' ) );
        return wp_nonce_url( $url, 'wh_claim_evidence_' . $claim_id . '_' . $file_id, 'wh_claim_evidence_nonce' );
    }

    public static function download_evidence() {
        if ( ! is_user_logged_in() ) {
            wp_die( '로그인이 필요합니다.', '접근 거부', array( 'response' => 403 ) );
        }
        $claim_id = isset( $_GET['claim_id'] ) ? absint( $_GET['claim_id'] ) : 0;
        $file_id  = isset( $_GET['file_id'] ) ? absint( $_GET['file_id'] ) : 0;
        $nonce    = isset( $_GET['wh_claim_evidence_nonce'] ) ? sanitize_text_field( wp_unslash( $_GET['wh_claim_evidence_nonce'] ) ) : '';
        if ( ! wp_verify_nonce( $nonce, 'wh_claim_evidence_' . $claim_id . '_' . $file_id ) ) {
            wp_die( '유효하지 않은 다운로드 요청입니다.', '접근 거부', array( 'response' => 403 ) );
        }
        global $wpdb;
        $row = $wpdb->get_row( $wpdb->prepare(
            'SELECT e.*,c.customer_user_id FROM ' . self::evidence_table() . ' e INNER JOIN ' . self::claims_table() . ' c ON c.id=e.claim_id WHERE e.id=%d AND e.claim_id=%d',
            $file_id,
            $claim_id
        ), ARRAY_A );
        if ( ! $row || ( (int) $row['customer_user_id'] !== get_current_user_id() && ! self::is_admin_user() ) ) {
            wp_die( '증빙자료를 볼 권한이 없습니다.', '접근 거부', array( 'response' => 403 ) );
        }
        $path = self::safe_evidence_path( $row['stored_file_path'] );
        $allowed_mimes = array( 'image/jpeg', 'image/png', 'image/webp' );
        if ( ! $path || ! in_array( $row['mime'], $allowed_mimes, true ) ) {
            wp_die( '증빙자료를 찾을 수 없습니다.', '찾을 수 없음', array( 'response' => 404 ) );
        }
        nocache_headers();
        header( 'X-Content-Type-Options: nosniff' );
        header( 'Content-Type: ' . $row['mime'] );
        header( 'Content-Length: ' . filesize( $path ) );
        header( 'Content-Disposition: ' . ( ! empty( $_GET['view'] ) ? 'inline' : 'attachment' ) . '; filename="claim-evidence-' . $file_id . '.' . pathinfo( $path, PATHINFO_EXTENSION ) . '"' );
        readfile( $path );
        exit;
    }

    public static function render_admin_claims( $order ) {
        if ( ! self::is_admin_user() || ! $order instanceof WC_Order ) {
            return;
        }
        global $wpdb;
        $claims = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::claims_table() . ' WHERE order_id=%d ORDER BY id DESC', $order->get_id() ), ARRAY_A );
        if ( empty( $claims ) ) {
            return;
        }
        echo '<div class="order_data_column_container wh-admin-claims" style="clear:both;padding:12px"><h3>불량/환불 요청</h3>';
        foreach ( $claims as $claim ) {
            $item = $order->get_item( (int) $claim['order_item_id'] );
            $evidence = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::evidence_table() . ' WHERE claim_id=%d ORDER BY id', $claim['id'] ), ARRAY_A );
            echo '<section style="margin:12px 0;padding:12px;border:1px solid #ccd0d4"><p><strong>' . esc_html( $claim['claim_key'] ) . '</strong> · ' . esc_html( self::STATUSES[ $claim['status'] ] ) . ' · ' . esc_html( $claim['created_at'] ) . '</p>';
            echo '<p>상품/옵션: ' . esc_html( $item ? $item->get_name() . ' / ' . self::option_summary( $item ) : '삭제된 주문항목' ) . '<br>수량: ' . (int) $claim['requested_qty'] . ' / ' . (int) $claim['purchased_qty'] . '<br>사유: ' . esc_html( self::REASONS[ $claim['reason_code'] ] ) . '<br>희망처리: ' . esc_html( self::RESOLUTIONS[ $claim['requested_resolution'] ] ) . '<br>설명:<br>' . nl2br( esc_html( $claim['customer_note'] ) ) . '</p><div style="display:flex;gap:8px;flex-wrap:wrap">';
            foreach ( $evidence as $file ) {
                $view = self::evidence_url( $claim['id'], $file['id'], true );
                $download = self::evidence_url( $claim['id'], $file['id'], false );
                echo '<figure style="margin:0;width:120px"><a href="' . esc_url( $download ) . '"><img src="' . esc_url( $view ) . '" alt="' . esc_attr( self::EVIDENCE[ $file['evidence_type'] ] ) . '" style="width:120px;height:90px;object-fit:cover"></a><figcaption>' . esc_html( self::EVIDENCE[ $file['evidence_type'] ] ) . '</figcaption></figure>';
            }
            echo '</div><form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="margin-top:10px"><input type="hidden" name="action" value="wh_claim_status"><input type="hidden" name="claim_id" value="' . (int) $claim['id'] . '"><input type="hidden" name="order_id" value="' . (int) $order->get_id() . '">';
            wp_nonce_field( 'wh_claim_status_' . $claim['id'], 'wh_claim_status_nonce' );
            echo '<select name="status"><option value="reviewing">검토중</option><option value="approved">승인</option><option value="rejected">반려</option><option value="resolved">처리완료</option></select> <button class="button" type="submit">상태 변경</button><small> 승인도 상태만 변경하며 실제 환불은 실행하지 않습니다.</small></form></section>';
        }
        echo '</div>';
    }

    public static function change_status() {
        if ( ! self::is_admin_user() ) {
            wp_die( '권한이 없습니다.', '접근 거부', array( 'response' => 403 ) );
        }
        $claim_id = isset( $_POST['claim_id'] ) ? absint( $_POST['claim_id'] ) : 0;
        $order_id = isset( $_POST['order_id'] ) ? absint( $_POST['order_id'] ) : 0;
        $nonce = isset( $_POST['wh_claim_status_nonce'] ) ? sanitize_text_field( wp_unslash( $_POST['wh_claim_status_nonce'] ) ) : '';
        if ( ! wp_verify_nonce( $nonce, 'wh_claim_status_' . $claim_id ) ) {
            wp_die( '유효하지 않은 요청입니다.', '접근 거부', array( 'response' => 403 ) );
        }
        $status = isset( $_POST['status'] ) ? sanitize_key( wp_unslash( $_POST['status'] ) ) : '';
        if ( ! in_array( $status, array( 'reviewing', 'approved', 'rejected', 'resolved' ), true ) ) {
            wp_die( '허용되지 않은 상태입니다.', '잘못된 요청', array( 'response' => 400 ) );
        }
        global $wpdb;
        $updated = $wpdb->query( $wpdb->prepare( 'UPDATE ' . self::claims_table() . ' SET status=%s,updated_at=%s WHERE id=%d AND order_id=%d', $status, current_time( 'mysql' ), $claim_id, $order_id ) );
        if ( 1 !== $updated ) {
            wp_die( '요청을 찾지 못했거나 상태가 변경되지 않았습니다.', '잘못된 요청', array( 'response' => 400 ) );
        }
        wp_safe_redirect( wp_get_referer() ? wp_get_referer() : admin_url( 'edit.php?post_type=shop_order' ) );
        exit;
    }

    public static function cli_retry( $args ) {
        $claim_id = isset( $args[0] ) ? absint( $args[0] ) : 0;
        if ( ! $claim_id ) {
            WP_CLI::error( 'claim_id가 필요합니다.' );
        }
        self::send_telegram( $claim_id, true );
        global $wpdb;
        $delivery = $wpdb->get_var( $wpdb->prepare( 'SELECT telegram_delivery FROM ' . self::claims_table() . ' WHERE id=%d', $claim_id ) );
        if ( null === $delivery ) {
            WP_CLI::error( '요청을 찾을 수 없습니다.' );
        }
        WP_CLI::success( 'Telegram 재전송 결과: ' . $delivery );
    }
}

Avocadoss_Customer_Claims::boot();
