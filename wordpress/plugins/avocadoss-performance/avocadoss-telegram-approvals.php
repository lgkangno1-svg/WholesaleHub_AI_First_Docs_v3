<?php
/**
 * Telegram order notifications plus crawler-product and membership approvals.
 * Loaded by avocadoss-performance.php; no credentials are stored in this file.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

function avocadoss_telegram_api_request( $method, array $body ) {
    $token   = trim( (string) get_option( 'avocadoss_telegram_bot_token', '' ) );
    $chat_id = trim( (string) get_option( 'avocadoss_telegram_chat_id', '' ) );

    if ( '' === $token && defined( 'AVOCADOSS_TG_BOT_TOKEN' ) ) {
        $token = trim( (string) AVOCADOSS_TG_BOT_TOKEN );
    }
    if ( '' === $chat_id && defined( 'AVOCADOSS_TG_CHAT_ID' ) ) {
        $chat_id = trim( (string) AVOCADOSS_TG_CHAT_ID );
    }

    if ( '' === $token || '' === $chat_id || ! preg_match( '/^[0-9]+:[A-Za-z0-9_-]+$/', $token ) ) {
        return false;
    }

    if ( ! isset( $body['chat_id'] ) && in_array( $method, array( 'sendMessage', 'editMessageText' ), true ) ) {
        $body['chat_id'] = $chat_id;
    }

    $response = wp_remote_post( 'https://api.telegram.org/bot' . $token . '/' . $method, array(
        'timeout' => (int) apply_filters( 'avocadoss_telegram_http_timeout', 60 ),
        'body'    => $body,
    ) );

    if ( is_wp_error( $response ) || 200 > wp_remote_retrieve_response_code( $response ) || 300 <= wp_remote_retrieve_response_code( $response ) ) {
        return false;
    }

    $decoded = json_decode( wp_remote_retrieve_body( $response ), true );
    return is_array( $decoded ) && ! empty( $decoded['ok'] ) ? $decoded['result'] : false;
}

/* Restore the existing order-notification path if an older deployed plugin file omitted it. */
if ( ! function_exists( 'avocadoss_send_telegram_message' ) ) {
    add_action( 'init', 'avocadoss_schedule_telegram_order_digest' );
    add_action( 'woocommerce_new_order', 'avocadoss_handle_new_order_telegram_notice', 30, 1 );
    add_action( 'avocadoss_telegram_hourly_order_digest', 'avocadoss_send_hourly_telegram_order_digest' );

    function avocadoss_schedule_telegram_order_digest() {
        if ( ! wp_next_scheduled( 'avocadoss_telegram_hourly_order_digest' ) ) {
            wp_schedule_event( time() + HOUR_IN_SECONDS, 'hourly', 'avocadoss_telegram_hourly_order_digest' );
        }
    }

    function avocadoss_handle_new_order_telegram_notice( $order_id ) {
        $order_id = absint( $order_id );
        if ( ! $order_id ) {
            return;
        }
        if ( 'hourly' === get_option( 'avocadoss_telegram_notice_mode', 'instant' ) ) {
            avocadoss_queue_telegram_order_notice( $order_id );
            return;
        }
        $order = wc_get_order( $order_id );
        if ( ! $order || avocadoss_send_telegram_message( avocadoss_build_telegram_order_message( $order ) ) ) {
            return;
        }
        avocadoss_queue_telegram_order_notice( $order_id );
    }

    function avocadoss_send_hourly_telegram_order_digest() {
        $queue = get_option( 'avocadoss_telegram_order_queue', array() );
        if ( ! is_array( $queue ) || empty( $queue ) ) {
            return;
        }
        $messages = array();
        foreach ( array_unique( array_map( 'absint', $queue ) ) as $order_id ) {
            $order = wc_get_order( $order_id );
            if ( $order ) {
                $messages[] = avocadoss_build_telegram_order_message( $order );
            }
        }
        if ( empty( $messages ) || avocadoss_send_telegram_message( "도매허브 주문 알림 모음\n\n" . implode( "\n\n---\n\n", $messages ) ) ) {
            update_option( 'avocadoss_telegram_order_queue', array(), false );
        }
    }

    function avocadoss_queue_telegram_order_notice( $order_id ) {
        $queue = get_option( 'avocadoss_telegram_order_queue', array() );
        $queue = is_array( $queue ) ? $queue : array();
        $queue[] = absint( $order_id );
        update_option( 'avocadoss_telegram_order_queue', array_values( array_unique( array_filter( $queue ) ) ), false );
    }

    function avocadoss_send_telegram_message( $message ) {
        return false !== avocadoss_telegram_api_request( 'sendMessage', array(
            'text' => wp_strip_all_tags( (string) $message ),
        ) );
    }

    function avocadoss_build_telegram_order_message( WC_Order $order ) {
        $lines = array(
            '도매허브 새 주문이 들어왔습니다.',
            '주문번호: #' . $order->get_order_number(),
            '사업자명: ' . avocadoss_get_order_business_name_for_notice( $order ),
            '주문 항목 옵션:',
        );
        foreach ( $order->get_items() as $item ) {
            if ( $item instanceof WC_Order_Item_Product ) {
                $lines[] = '- ' . avocadoss_get_order_item_option_summary_for_notice( $item ) . ' x ' . $item->get_quantity();
            }
        }
        return implode( "\n", $lines );
    }

    function avocadoss_get_order_business_name_for_notice( WC_Order $order ) {
        $candidates = array( $order->get_meta( '_avo_business_name', true ), $order->get_billing_company(), $order->get_formatted_billing_full_name() );
        if ( $order->get_user_id() ) {
            $candidates[] = get_user_meta( $order->get_user_id(), 'billing_company', true );
            $candidates[] = get_user_meta( $order->get_user_id(), 'billing_first_name', true );
        }
        foreach ( $candidates as $candidate ) {
            $candidate = trim( wp_strip_all_tags( (string) $candidate ) );
            if ( '' !== $candidate ) {
                return $candidate;
            }
        }
        return '미확인';
    }

    function avocadoss_get_order_item_option_summary_for_notice( WC_Order_Item_Product $item ) {
        $parts = array();
        foreach ( $item->get_formatted_meta_data( '_' ) as $meta ) {
            $key   = trim( wp_strip_all_tags( (string) $meta->display_key ) );
            $value = trim( wp_strip_all_tags( (string) $meta->display_value ) );
            if ( '' !== $value ) {
                $parts[] = ( '' !== $key ? $key . ': ' : '' ) . $value;
            }
        }
        return $item->get_name() . ( empty( $parts ) ? '' : ' / ' . implode( ', ', array_unique( $parts ) ) );
    }
}

function avocadoss_price_change_report_text( $value, $fallback ) {
    $text = trim( preg_replace( '/\s+/u', ' ', wp_strip_all_tags( (string) $value ) ) );
    if ( '' === $text ) {
        return $fallback;
    }
    return function_exists( 'mb_substr' ) ? mb_substr( $text, 0, 160 ) : substr( $text, 0, 160 );
}

function avocadoss_price_change_report_amount( $amount ) {
    $amount = round( (float) $amount, 2 );
    if ( abs( $amount - round( $amount ) ) < 0.001 ) {
        return number_format( $amount, 0 ) . '원';
    }
    return rtrim( rtrim( number_format( $amount, 2 ), '0' ), '.' ) . '원';
}

function avocadoss_price_change_report_text_length( $text ) {
    return function_exists( 'mb_strlen' ) ? mb_strlen( $text ) : strlen( $text );
}

function avocadoss_build_price_change_report_messages( array $report ) {
    $run_at = isset( $report['run_at'] ) ? (string) $report['run_at'] : '';
    try {
        $reported_at = ( new DateTimeImmutable( $run_at ) )->setTimezone( wp_timezone() )->format( 'Y-m-d H:i:s' );
    } catch ( Exception $error ) {
        $reported_at = current_time( 'mysql' );
    }

    $pipeline_status = isset( $report['pipeline_status'] ) ? trim( (string) $report['pipeline_status'] ) : '';
    $totals          = isset( $report['totals'] ) && is_array( $report['totals'] ) ? $report['totals'] : array();
    $status_labels   = array(
        'success'         => '성공',
        'partial_success' => '부분 성공',
        'failed'          => '실패',
        'no_change'       => '변경 없음',
        'dry_run'         => 'Dry-run',
    );
    $summary_lines   = array();
    if ( '' !== $pipeline_status ) {
        $summary_lines[] = '💰 도매Hub 가격 동기화';
        $summary_lines[] = '실행: ' . $reported_at . ' KST';
        $summary_lines[] = '상태: ' . ( isset( $status_labels[ $pipeline_status ] ) ? $status_labels[ $pipeline_status ] : $pipeline_status );
        $summary_lines[] = '';
        $summary_lines[] = '전체';
        $summary_lines[] = '- 확인 옵션: ' . absint( isset( $totals['checked_count'] ) ? $totals['checked_count'] : 0 ) . '개';
        $summary_lines[] = '- 가격 변경 감지: ' . absint( isset( $totals['price_change_detected'] ) ? $totals['price_change_detected'] : 0 ) . '개';
        $summary_lines[] = '- Woo 반영 성공: ' . absint( isset( $totals['applied_count'] ) ? $totals['applied_count'] : 0 ) . '개';
        $summary_lines[] = '- 변경 없음: ' . absint( isset( $totals['no_change_count'] ) ? $totals['no_change_count'] : 0 ) . '개';
        $summary_lines[] = '- 보류: ' . absint( isset( $totals['held_count'] ) ? $totals['held_count'] : 0 ) . '개';
        $summary_lines[] = '- 실패: ' . absint( isset( $totals['failed_count'] ) ? $totals['failed_count'] : 0 ) . '개';
        $issue_counts = isset( $report['issue_counts'] ) && is_array( $report['issue_counts'] ) ? $report['issue_counts'] : array();
        if ( ! empty( $issue_counts ) ) {
            $summary_lines[] = '';
            $summary_lines[] = '보류/실패 사유';
            foreach ( $issue_counts as $reason => $count ) {
                $summary_lines[] = '- ' . sanitize_key( $reason ) . ': ' . absint( $count ) . '개';
            }
        }
        $examples = isset( $report['issue_examples'] ) && is_array( $report['issue_examples'] ) ? array_slice( $report['issue_examples'], 0, 5 ) : array();
        if ( ! empty( $examples ) ) {
            $summary_lines[] = '';
            $summary_lines[] = '확인 필요 옵션';
            foreach ( $examples as $example ) {
                if ( ! is_array( $example ) ) {
                    continue;
                }
                $summary_lines[] = '- ' . avocadoss_price_change_report_text(
                    ( isset( $example['product_name'] ) ? $example['product_name'] : '' ) . ' / ' .
                    ( isset( $example['option_name'] ) ? $example['option_name'] : '' ),
                    isset( $example['classification'] ) ? $example['classification'] : '확인 필요'
                );
            }
        }
    }

    $groups  = array();
    $changes = isset( $report['changes'] ) && is_array( $report['changes'] ) ? $report['changes'] : array();
    foreach ( $changes as $change ) {
        if ( ! is_array( $change ) || ! isset( $change['product_id'], $change['variation_id'], $change['before_price'], $change['after_price'] ) ) {
            continue;
        }
        if ( ! is_numeric( $change['before_price'] ) || ! is_numeric( $change['after_price'] ) || (float) $change['before_price'] === (float) $change['after_price'] ) {
            continue;
        }
        $product_id   = absint( $change['product_id'] );
        $variation_id = absint( $change['variation_id'] );
        if ( ! $product_id || ! $variation_id ) {
            continue;
        }
        $product_name = avocadoss_price_change_report_text( isset( $change['product_name'] ) ? $change['product_name'] : '', '상품 #' . $product_id );
        $option_name  = avocadoss_price_change_report_text( isset( $change['option_name'] ) ? $change['option_name'] : '', '옵션 #' . $variation_id );
        if ( ! isset( $groups[ $product_id ] ) ) {
            $groups[ $product_id ] = array( 'name' => $product_name, 'changes' => array() );
        }
        $groups[ $product_id ]['changes'][] = array(
            'option_name'  => $option_name,
            'before_price' => (float) $change['before_price'],
            'after_price'  => (float) $change['after_price'],
        );
    }
    if ( empty( $groups ) ) {
        return empty( $summary_lines ) ? array() : array( implode( "\n", $summary_lines ) );
    }

    $change_count = array_sum( array_map( static function ( $group ) {
        return count( $group['changes'] );
    }, $groups ) );
    $header_lines = empty( $summary_lines ) ? array(
        '💰 옵션 가격 자동 업데이트',
        '반영 시각: ' . $reported_at,
        '총 ' . $change_count . '개 옵션 / ' . count( $groups ) . '개 상품',
    ) : array_merge(
        $summary_lines,
        array( '', '반영 상세: ' . $change_count . '개 옵션 / ' . count( $groups ) . '개 상품' )
    );
    $header = implode( "\n", $header_lines );
    $chunks  = array();
    $current = $header;
    foreach ( $groups as $group ) {
        $product_line = "\n\n" . $group['name'];
        if ( avocadoss_price_change_report_text_length( $current . $product_line ) > 3200 ) {
            $chunks[] = $current;
            $current  = $header . "\n(계속)";
        }
        $current .= $product_line;
        foreach ( $group['changes'] as $change ) {
            $difference = $change['after_price'] - $change['before_price'];
            $line       = "\n• " . $change['option_name'] . ': '
                . avocadoss_price_change_report_amount( $change['before_price'] ) . ' → '
                . avocadoss_price_change_report_amount( $change['after_price'] ) . ' ('
                . ( 0 < $difference ? '+' : '' ) . avocadoss_price_change_report_amount( $difference ) . ')';
            if ( avocadoss_price_change_report_text_length( $current . $line ) > 3200 ) {
                $chunks[] = $current;
                $current  = $header . "\n(계속)\n\n" . $group['name'];
            }
            $current .= $line;
        }
    }
    $chunks[] = $current;
    return $chunks;
}

function avocadoss_send_price_change_report( array $report ) {
    $report_id = isset( $report['report_id'] ) ? strtolower( trim( (string) $report['report_id'] ) ) : '';
    if ( ! preg_match( '/^[a-f0-9]{64}$/', $report_id ) ) {
        return new WP_Error( 'invalid_price_report_id', '가격 변경 보고서 ID가 올바르지 않습니다.' );
    }
    $messages = avocadoss_build_price_change_report_messages( $report );
    if ( empty( $messages ) ) {
        return array( 'status' => 'no_changes', 'message_count' => 0 );
    }

    $report_key = 'avo_price_report_' . substr( $report_id, 0, 40 );
    if ( get_transient( $report_key ) ) {
        return array( 'status' => 'already_sent', 'message_count' => count( $messages ) );
    }
    foreach ( $messages as $index => $message ) {
        $chunk_key = $report_key . '_c' . $index;
        if ( get_transient( $chunk_key ) ) {
            continue;
        }
        if ( ! avocadoss_send_telegram_message( $message ) ) {
            return new WP_Error( 'price_report_send_failed', 'Telegram 가격 변경 보고 전송에 실패했습니다.' );
        }
        set_transient( $chunk_key, 1, 90 * DAY_IN_SECONDS );
    }
    set_transient( $report_key, 1, 90 * DAY_IN_SECONDS );
    return array( 'status' => 'sent', 'message_count' => count( $messages ) );
}

if ( defined( 'WP_CLI' ) && WP_CLI ) {
    WP_CLI::add_command( 'avocadoss telegram-price-report', static function ( $args ) {
        $path = isset( $args[0] ) ? (string) $args[0] : '';
        if ( '' === $path || ! is_readable( $path ) ) {
            WP_CLI::error( '읽을 수 있는 가격 변경 보고서 파일이 필요합니다.' );
        }
        $report = json_decode( file_get_contents( $path ), true );
        if ( ! is_array( $report ) ) {
            WP_CLI::error( '가격 변경 보고서 JSON이 올바르지 않습니다.' );
        }
        $result = avocadoss_send_price_change_report( $report );
        if ( is_wp_error( $result ) ) {
            WP_CLI::error( $result->get_error_message() );
        }
        WP_CLI::log( wp_json_encode( $result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) );
        WP_CLI::success( 'Telegram 가격 변경 보고 처리를 완료했습니다.' );
    } );
}

function avocadoss_telegram_callback_nonce_hash( $nonce ) {
    return hash_hmac( 'sha256', (string) $nonce, wp_salt( 'nonce' ) );
}

function avocadoss_new_telegram_callback_nonce() {
    return wp_generate_password( 12, false, false );
}

function avocadoss_send_telegram_approval_message( $text, array $buttons ) {
    $result = avocadoss_telegram_api_request( 'sendMessage', array(
        'text'         => (string) $text,
        'reply_markup' => wp_json_encode( array( 'inline_keyboard' => $buttons ) ),
    ) );
    return is_array( $result ) && ! empty( $result['message_id'] ) ? absint( $result['message_id'] ) : 0;
}

function avocadoss_is_crawler_approval_product( $product_id ) {
    return 'product' === get_post_type( $product_id )
        && 'draft_candidate' === get_post_meta( $product_id, '_wholesalehub_mvp_created', true );
}

function avocadoss_product_approval_categories() {
    $allowed_names = array( '농산물', '축산물', '수산물', '가공식품', '공동구매' );
    $categories = get_terms( array(
        'taxonomy'   => 'product_cat',
        'hide_empty' => false,
        'parent'     => 0,
        'name'       => $allowed_names,
    ) );
    if ( is_wp_error( $categories ) ) {
        return array();
    }
    $by_name = array();
    foreach ( $categories as $category ) {
        $by_name[ $category->name ] = $category;
    }
    $ordered = array();
    foreach ( $allowed_names as $name ) {
        if ( isset( $by_name[ $name ] ) ) {
            $ordered[] = $by_name[ $name ];
        }
    }
    return $ordered;
}

function avocadoss_product_approval_category( $term_id ) {
    $term_id = absint( $term_id );
    foreach ( avocadoss_product_approval_categories() as $category ) {
        if ( $term_id === (int) $category->term_id ) {
            return $category;
        }
    }
    return null;
}

function avocadoss_product_approval_message_text( $product_id, $selected_category_id = 0 ) {
    $product = wc_get_product( $product_id );
    $post    = get_post( $product_id );
    if ( ! $product || ! $post ) {
        return '';
    }
    $selected = avocadoss_product_approval_category( $selected_category_id );
    return implode( "\n", array(
        '신규 상품 등록 요청',
        '상품명: ' . $product->get_name(),
        '상품 ID: ' . $product_id,
        'SKU: ' . ( $product->get_sku() ?: '-' ),
        '선택 카테고리: ' . ( $selected ? $selected->name : '미선택' ),
        '옵션 개수: ' . count( $product->get_children() ),
        '생성 시각: ' . get_date_from_gmt( $post->post_date_gmt, 'Y-m-d H:i:s' ),
        '상품 편집: ' . admin_url( 'post.php?post=' . $product_id . '&action=edit' ),
    ) );
}

function avocadoss_product_approval_buttons( $product_id, $nonce, $mode = 'initial', $selected_category_id = 0 ) {
    if ( 'categories' === $mode ) {
        $rows = array();
        $row  = array();
        foreach ( avocadoss_product_approval_categories() as $category ) {
            $row[] = array( 'text' => $category->name, 'callback_data' => 'pa:' . $product_id . ':c' . $category->term_id . ':' . $nonce );
            if ( 2 === count( $row ) ) {
                $rows[] = $row;
                $row    = array();
            }
        }
        if ( ! empty( $row ) ) {
            $rows[] = $row;
        }
        $rows[] = array(
            array( 'text' => '⏸ 임시글 유지', 'callback_data' => 'pa:' . $product_id . ':hold:' . $nonce ),
        );
        return $rows;
    }

    if ( $selected_category_id && avocadoss_product_approval_category( $selected_category_id ) ) {
        return array(
            array(
                array( 'text' => '✅ 게시 승인', 'callback_data' => 'pa:' . $product_id . ':publish:' . $nonce ),
                array( 'text' => '📁 카테고리 변경', 'callback_data' => 'pa:' . $product_id . ':choose:' . $nonce ),
            ),
            array(
                array( 'text' => '⏸ 임시글 유지', 'callback_data' => 'pa:' . $product_id . ':hold:' . $nonce ),
            ),
        );
    }

    return array(
        array(
            array( 'text' => '📁 카테고리 선택', 'callback_data' => 'pa:' . $product_id . ':choose:' . $nonce ),
            array( 'text' => '⏸ 임시글 유지', 'callback_data' => 'pa:' . $product_id . ':hold:' . $nonce ),
        ),
    );
}

function avocadoss_publish_approved_product( $product_id, $category_id ) {
    global $wpdb;

    $post     = get_post( $product_id );
    $category = avocadoss_product_approval_category( $category_id );
    if ( ! $post || ! $category ) {
        return 0;
    }
    if ( ! avocadoss_ensure_product_thumbnail( $product_id ) ) {
        return 0;
    }

    $previous_categories = wp_get_object_terms( $product_id, 'product_cat', array( 'fields' => 'ids' ) );
    $assigned = wp_set_object_terms( $product_id, array( (int) $category->term_id ), 'product_cat', false );
    if ( is_wp_error( $assigned ) ) {
        return 0;
    }

    $data = array( 'post_status' => 'publish' );
    if ( '' === trim( $post->post_name ) ) {
        $data['post_name'] = wp_unique_post_slug( sanitize_title( $post->post_title ), $product_id, 'publish', 'product', 0 );
    }
    $updated = $wpdb->update(
        $wpdb->posts,
        $data,
        array( 'ID' => $product_id, 'post_status' => 'draft', 'post_type' => 'product' ),
        array_fill( 0, count( $data ), '%s' ),
        array( '%d', '%s', '%s' )
    );
    if ( 1 !== $updated ) {
        wp_set_object_terms( $product_id, is_wp_error( $previous_categories ) ? array() : $previous_categories, 'product_cat', false );
        return 0;
    }
    return 1;
}

function avocadoss_product_source_image_url( $product_id ) {
    $keys = array( '_wholesalehub_source_image_url', '_source_image_url' );
    foreach ( $keys as $key ) {
        $url = esc_url_raw( (string) get_post_meta( $product_id, $key, true ) );
        if ( wp_http_validate_url( $url ) ) {
            return $url;
        }
    }
    $product = wc_get_product( $product_id );
    if ( ! $product ) {
        return '';
    }
    foreach ( $product->get_children() as $variation_id ) {
        foreach ( $keys as $key ) {
            $url = esc_url_raw( (string) get_post_meta( $variation_id, $key, true ) );
            if ( wp_http_validate_url( $url ) ) {
                return $url;
            }
        }
    }
    return '';
}

function avocadoss_ensure_product_thumbnail( $product_id ) {
    if ( has_post_thumbnail( $product_id ) ) {
        return true;
    }
    $url = avocadoss_product_source_image_url( $product_id );
    if ( ! $url ) {
        update_post_meta( $product_id, '_avocadoss_pa_thumbnail_error', 'source_image_missing' );
        return false;
    }
    require_once ABSPATH . 'wp-admin/includes/file.php';
    require_once ABSPATH . 'wp-admin/includes/media.php';
    require_once ABSPATH . 'wp-admin/includes/image.php';
    $attachment_id = media_sideload_image(
        $url,
        $product_id,
        get_the_title( $product_id ),
        'id'
    );
    if ( is_wp_error( $attachment_id ) || ! set_post_thumbnail( $product_id, $attachment_id ) ) {
        update_post_meta(
            $product_id,
            '_avocadoss_pa_thumbnail_error',
            is_wp_error( $attachment_id ) ? $attachment_id->get_error_message() : 'set_post_thumbnail_failed'
        );
        return false;
    }
    delete_post_meta( $product_id, '_avocadoss_pa_thumbnail_error' );
    update_post_meta( $product_id, '_avocadoss_pa_thumbnail_source_url', $url );
    return true;
}

if ( defined( 'WP_CLI' ) && WP_CLI ) {
    WP_CLI::add_command(
        'avocadoss repair-approved-thumbnails',
        function () {
            $query = new WP_Query( array(
                'post_type'      => 'product',
                'post_status'    => array( 'publish', 'draft' ),
                'posts_per_page' => -1,
                'fields'         => 'ids',
                'meta_key'       => '_wholesalehub_mvp_created',
                'meta_value'     => 'draft_candidate',
            ) );
            $repaired = 0;
            $failed   = 0;
            foreach ( $query->posts as $product_id ) {
                if ( has_post_thumbnail( $product_id ) ) {
                    continue;
                }
                if ( avocadoss_ensure_product_thumbnail( $product_id ) ) {
                    ++$repaired;
                } else {
                    ++$failed;
                }
            }
            WP_CLI::log( wp_json_encode( array( 'repaired' => $repaired, 'failed' => $failed ) ) );
        }
    );
    WP_CLI::add_command(
        'avocadoss refresh-product-approval-buttons',
        function () {
            $query = new WP_Query( array(
                'post_type'      => 'product',
                'post_status'    => 'draft',
                'posts_per_page' => -1,
                'fields'         => 'ids',
                'meta_key'       => '_wholesalehub_mvp_created',
                'meta_value'     => 'draft_candidate',
            ) );
            $updated = 0;
            $failed  = 0;
            foreach ( $query->posts as $product_id ) {
                $message_id = absint( get_post_meta( $product_id, '_avocadoss_pa_message_id', true ) );
                if ( ! $message_id || get_post_meta( $product_id, '_avocadoss_pa_processed', true ) ) {
                    continue;
                }
                $nonce = avocadoss_new_telegram_callback_nonce();
                update_post_meta( $product_id, '_avocadoss_pa_nonce', avocadoss_telegram_callback_nonce_hash( $nonce ) );
                delete_post_meta( $product_id, '_avocadoss_pa_category_id' );
                $result = avocadoss_telegram_api_request(
                    'editMessageText',
                    array(
                        'message_id'   => $message_id,
                        'text'         => avocadoss_product_approval_message_text( $product_id ),
                        'reply_markup' => wp_json_encode( array(
                            'inline_keyboard' => avocadoss_product_approval_buttons( $product_id, $nonce ),
                        ) ),
                    )
                );
                if ( false === $result ) {
                    ++$failed;
                } else {
                    ++$updated;
                }
            }
            WP_CLI::log( wp_json_encode( array( 'updated' => $updated, 'failed' => $failed ) ) );
        }
    );
}

add_action( 'woocommerce_rest_insert_product_object', 'avocadoss_schedule_crawler_product_approval', 20, 3 );
function avocadoss_schedule_crawler_product_approval( $product, $request, $creating ) {
    if ( ! $creating || ! $product instanceof WC_Product || 'draft' !== $product->get_status() || ! avocadoss_is_crawler_approval_product( $product->get_id() ) ) {
        return;
    }
    if ( get_post_meta( $product->get_id(), '_avocadoss_pa_notified', true ) || get_post_meta( $product->get_id(), '_avocadoss_pa_processed', true ) ) {
        return;
    }
    if ( ! wp_next_scheduled( 'avocadoss_send_product_approval_request', array( $product->get_id() ) ) ) {
        wp_schedule_single_event( time() + MINUTE_IN_SECONDS, 'avocadoss_send_product_approval_request', array( $product->get_id() ) );
    }
}

add_action( 'avocadoss_send_product_approval_request', 'avocadoss_send_product_approval_request', 10, 1 );
function avocadoss_send_product_approval_request( $product_id ) {
    $product_id = absint( $product_id );
    $product    = wc_get_product( $product_id );
    if ( ! $product || 'draft' !== get_post_status( $product_id ) || ! avocadoss_is_crawler_approval_product( $product_id ) || get_post_meta( $product_id, '_avocadoss_pa_notified', true ) || get_post_meta( $product_id, '_avocadoss_pa_processed', true ) ) {
        return false;
    }
    if ( ! add_post_meta( $product_id, '_avocadoss_pa_sending', current_time( 'mysql' ), true ) ) {
        return false;
    }

    $nonce = avocadoss_new_telegram_callback_nonce();
    update_post_meta( $product_id, '_avocadoss_pa_nonce', avocadoss_telegram_callback_nonce_hash( $nonce ) );
    delete_post_meta( $product_id, '_avocadoss_pa_category_id' );
    $categories = wp_get_post_terms( $product_id, 'product_cat', array( 'fields' => 'names' ) );
    $created    = get_post_datetime( $product_id );
    $edit_link  = admin_url( 'post.php?post=' . $product_id . '&action=edit' );
    $lines      = array(
        '신규 상품 등록 요청',
        '상품명: ' . $product->get_name(),
        '상품 ID: ' . $product_id,
        'SKU: ' . ( $product->get_sku() ?: '-' ),
        '크롤링 출처: ' . ( function_exists( 'avocadoss_product_identity_source' ) ? ( avocadoss_product_identity_source( $product_id ) ?: '-' ) : '-' ),
        '카테고리: ' . ( is_wp_error( $categories ) || empty( $categories ) ? '-' : implode( ', ', $categories ) ),
        '옵션 개수: ' . count( $product->get_children() ),
        '생성 시각: ' . ( $created ? $created->format( 'Y-m-d H:i:s' ) : current_time( 'mysql' ) ),
        '상품 편집: ' . $edit_link,
    );
    $message_id = avocadoss_send_telegram_approval_message(
        implode( "\n", $lines ),
        avocadoss_product_approval_buttons( $product_id, $nonce )
    );
    delete_post_meta( $product_id, '_avocadoss_pa_sending' );
    if ( ! $message_id ) {
        delete_post_meta( $product_id, '_avocadoss_pa_nonce' );
        error_log( 'AVO Telegram approval: product notification failed for product ' . $product_id );
        return false;
    }
    update_post_meta( $product_id, '_avocadoss_pa_notified', current_time( 'mysql' ) );
    update_post_meta( $product_id, '_avocadoss_pa_message_id', $message_id );
    return true;
}

add_action( 'added_user_meta', 'avocadoss_sync_membership_status_meta', 10, 4 );
add_action( 'updated_user_meta', 'avocadoss_sync_membership_status_meta', 10, 4 );
function avocadoss_sync_membership_status_meta( $meta_id, $user_id, $meta_key, $meta_value ) {
    if ( '_avo_approval_status' === $meta_key && in_array( $meta_value, array( 'pending', 'approved', 'rejected' ), true ) ) {
        update_user_meta( $user_id, 'avocadoss_membership_status', $meta_value );
    }
}

add_filter( 'wp_authenticate_user', 'avocadoss_block_membership_status_login', 100, 2 );
function avocadoss_block_membership_status_login( $user, $password ) {
    if ( is_wp_error( $user ) ) {
        return $user;
    }
    $status = get_user_meta( $user->ID, 'avocadoss_membership_status', true );
    if ( 'pending' === $status ) {
        return new WP_Error( 'avocadoss_membership_pending', '회원가입 승인 대기 중입니다.' );
    }
    if ( 'rejected' === $status ) {
        return new WP_Error( 'avocadoss_membership_rejected', '회원가입 승인이 거절되었습니다.' );
    }
    return $user;
}

function avocadoss_send_membership_approval_request( $user_id ) {
    $user_id = absint( $user_id );
    $user    = get_user_by( 'id', $user_id );
    if ( ! $user || 'pending' !== get_user_meta( $user_id, 'avocadoss_membership_status', true ) || get_user_meta( $user_id, '_avocadoss_ua_processed', true ) ) {
        return false;
    }
    if ( get_user_meta( $user_id, '_avocadoss_ua_notified', true ) || ! add_user_meta( $user_id, '_avocadoss_ua_sending', current_time( 'mysql' ), true ) ) {
        return false;
    }

    $nonce = avocadoss_new_telegram_callback_nonce();
    update_user_meta( $user_id, '_avocadoss_ua_nonce', avocadoss_telegram_callback_nonce_hash( $nonce ) );
    $lines = array(
        '가입 승인 요청',
        '이름: ' . ( get_user_meta( $user_id, 'billing_first_name', true ) ?: $user->display_name ),
        '사용자명: ' . $user->user_login,
        '이메일: ' . $user->user_email,
        '연락처: ' . ( get_user_meta( $user_id, 'billing_phone', true ) ?: '-' ),
        '사업자등록번호: ' . ( get_user_meta( $user_id, '_avo_business_number', true ) ?: '-' ),
        '신청 시각: ' . get_date_from_gmt( $user->user_registered, 'Y-m-d H:i:s' ),
    );
    $company = get_user_meta( $user_id, 'billing_company', true );
    if ( '' !== trim( (string) $company ) ) {
        array_splice( $lines, 5, 0, '업체명: ' . $company );
    }
    $message_id = avocadoss_send_telegram_approval_message( implode( "\n", $lines ), array(
        array(
            array( 'text' => '✅ 가입 승인', 'callback_data' => 'ua:' . $user_id . ':approve:' . $nonce ),
            array( 'text' => '❌ 가입 거절', 'callback_data' => 'ua:' . $user_id . ':reject:' . $nonce ),
        ),
    ) );
    delete_user_meta( $user_id, '_avocadoss_ua_sending' );
    if ( ! $message_id ) {
        delete_user_meta( $user_id, '_avocadoss_ua_nonce' );
        error_log( 'AVO Telegram approval: membership notification failed for user ' . $user_id );
        return false;
    }
    update_user_meta( $user_id, '_avocadoss_ua_notified', current_time( 'mysql' ) );
    update_user_meta( $user_id, '_avocadoss_ua_message_id', $message_id );
    return true;
}

add_action( 'woocommerce_created_customer', 'avocadoss_send_membership_approval_request_after_registration', 20, 1 );
function avocadoss_send_membership_approval_request_after_registration( $user_id ) {
    $user_id = absint( $user_id );
    if ( ! $user_id ) {
        return;
    }
    if ( '' === get_user_meta( $user_id, 'avocadoss_membership_status', true ) && 'pending' === get_user_meta( $user_id, '_avo_approval_status', true ) ) {
        update_user_meta( $user_id, 'avocadoss_membership_status', 'pending' );
    }
    avocadoss_send_membership_approval_request( $user_id );
}

function avocadoss_telegram_callback_authorized( $from_id, $chat_id ) {
    $configured_chat = trim( (string) get_option( 'avocadoss_telegram_chat_id', '' ) );
    if ( '' === $configured_chat && defined( 'AVOCADOSS_TG_CHAT_ID' ) ) {
        $configured_chat = trim( (string) AVOCADOSS_TG_CHAT_ID );
    }
    $allowed_user    = trim( (string) get_option( 'avocadoss_telegram_allowed_user_id', $configured_chat ) );
    return '' !== $configured_chat
        && hash_equals( $configured_chat, (string) $chat_id )
        && '' !== $allowed_user
        && hash_equals( $allowed_user, (string) $from_id );
}

function avocadoss_process_telegram_callback( array $callback ) {
    $data       = isset( $callback['data'] ) ? (string) $callback['data'] : '';
    $from_id    = isset( $callback['from_id'] ) ? (string) $callback['from_id'] : '';
    $chat_id    = isset( $callback['chat_id'] ) ? (string) $callback['chat_id'] : '';
    $message_id = isset( $callback['message_id'] ) ? absint( $callback['message_id'] ) : 0;
    $admin      = sanitize_text_field( isset( $callback['admin'] ) ? $callback['admin'] : $from_id );
    if ( ! avocadoss_telegram_callback_authorized( $from_id, $chat_id ) ) {
        return array( 'ok' => false, 'message' => '권한이 없습니다.' );
    }
    if ( ! preg_match( '/^(pa|ua):([1-9][0-9]*):(publish|hold|choose|c[1-9][0-9]*|approve|reject):([A-Za-z0-9]{12})$/', $data, $matches ) ) {
        return array( 'ok' => false, 'message' => '잘못된 요청입니다.' );
    }
    $type   = $matches[1];
    $id     = absint( $matches[2] );
    $action = $matches[3];
    $nonce  = $matches[4];
    if ( 'pa' === $type && ( in_array( $action, array( 'publish', 'hold', 'choose' ), true ) || 1 === preg_match( '/^c[1-9][0-9]*$/', $action ) ) ) {
        return avocadoss_process_product_telegram_callback( $id, $action, $nonce, $message_id, $admin );
    }
    if ( 'ua' === $type && in_array( $action, array( 'approve', 'reject' ), true ) ) {
        return avocadoss_process_user_telegram_callback( $id, $action, $nonce, $message_id, $admin );
    }
    return array( 'ok' => false, 'message' => '잘못된 요청입니다.' );
}

function avocadoss_process_product_telegram_callback( $product_id, $action, $nonce, $message_id, $admin ) {
    $stored = get_post_meta( $product_id, '_avocadoss_pa_nonce', true );
    if ( ! $stored || ! hash_equals( $stored, avocadoss_telegram_callback_nonce_hash( $nonce ) ) ) {
        return array( 'ok' => false, 'message' => '만료되었거나 이미 처리된 요청입니다.' );
    }
    if ( ! get_post( $product_id ) || 'draft' !== get_post_status( $product_id ) || ! avocadoss_is_crawler_approval_product( $product_id ) || get_post_meta( $product_id, '_avocadoss_pa_processed', true ) ) {
        return array( 'ok' => false, 'message' => '승인 가능한 draft 상품이 아닙니다.' );
    }
    if ( $message_id && absint( get_post_meta( $product_id, '_avocadoss_pa_message_id', true ) ) !== $message_id ) {
        return array( 'ok' => false, 'message' => '원본 메시지가 일치하지 않습니다.' );
    }
    if ( 'choose' === $action ) {
        return array(
            'ok'      => true,
            'message' => '카테고리를 선택하세요.',
            'text'    => avocadoss_product_approval_message_text( $product_id ),
            'buttons' => avocadoss_product_approval_buttons( $product_id, $nonce, 'categories' ),
        );
    }
    if ( 1 === preg_match( '/^c[1-9][0-9]*$/', $action ) ) {
        $category = avocadoss_product_approval_category( absint( substr( $action, 1 ) ) );
        if ( ! $category ) {
            return array( 'ok' => false, 'message' => '선택할 수 없는 카테고리입니다.' );
        }
        update_post_meta( $product_id, '_avocadoss_pa_category_id', (int) $category->term_id );
        return array(
            'ok'      => true,
            'message' => '카테고리를 선택했습니다. 게시 승인 버튼을 누르세요.',
            'text'    => avocadoss_product_approval_message_text( $product_id, (int) $category->term_id ),
            'buttons' => avocadoss_product_approval_buttons( $product_id, $nonce, 'selected', (int) $category->term_id ),
        );
    }
    $selected_category_id = absint( get_post_meta( $product_id, '_avocadoss_pa_category_id', true ) );
    if ( 'publish' === $action ) {
        if ( ! function_exists( 'avocadoss_product_identity_prepare_for_publish' ) ) {
            return array( 'ok' => false, 'message' => '상품 식별자 검증 기능이 없어 게시를 중단했습니다.' );
        }
        $identity = avocadoss_product_identity_prepare_for_publish( $product_id );
        if ( is_wp_error( $identity ) ) {
            return array( 'ok' => false, 'message' => $identity->get_error_message() );
        }
    }
    if ( 'publish' === $action && ! avocadoss_product_approval_category( $selected_category_id ) ) {
        return array( 'ok' => false, 'message' => '게시 전에 카테고리를 선택하세요.' );
    }
    if ( ! add_post_meta( $product_id, '_avocadoss_pa_processing', current_time( 'mysql' ), true ) ) {
        return array( 'ok' => false, 'message' => '이미 처리 중입니다.' );
    }
    if ( 'publish' === $action ) {
        $updated = avocadoss_publish_approved_product( $product_id, $selected_category_id );
        if ( 1 !== $updated ) {
            delete_post_meta( $product_id, '_avocadoss_pa_processing' );
            error_log( 'AVO Telegram approval: product publish failed for product ' . $product_id );
            return array( 'ok' => false, 'message' => '게시 상태 변경에 실패했습니다.' );
        }
        clean_post_cache( $product_id );
        if ( function_exists( 'wc_delete_product_transients' ) ) {
            wc_delete_product_transients( $product_id );
        }
    }
    $processed = current_time( 'mysql' );
    update_post_meta( $product_id, '_avocadoss_pa_processed', 'publish' === $action ? 'published' : 'held' );
    update_post_meta( $product_id, '_avocadoss_pa_processed_by', $admin );
    update_post_meta( $product_id, '_avocadoss_pa_processed_at', $processed );
    delete_post_meta( $product_id, '_avocadoss_pa_nonce' );
    delete_post_meta( $product_id, '_avocadoss_pa_processing' );
    $text = ( 'publish' === $action ? '게시 승인 완료' : '임시글 유지 결정' ) . ' · 상품 ID ' . $product_id . ' · 처리 관리자 ' . $admin . ' · 처리 시각 ' . $processed;
    return array( 'ok' => true, 'message' => '처리했습니다.', 'text' => $text );
}

function avocadoss_process_user_telegram_callback( $user_id, $action, $nonce, $message_id, $admin ) {
    $stored = get_user_meta( $user_id, '_avocadoss_ua_nonce', true );
    if ( ! $stored || ! hash_equals( $stored, avocadoss_telegram_callback_nonce_hash( $nonce ) ) ) {
        return array( 'ok' => false, 'message' => '만료되었거나 이미 처리된 요청입니다.' );
    }
    $user = get_user_by( 'id', $user_id );
    if ( ! $user || 'pending' !== get_user_meta( $user_id, 'avocadoss_membership_status', true ) || get_user_meta( $user_id, '_avocadoss_ua_processed', true ) ) {
        return array( 'ok' => false, 'message' => '승인 대기 중인 회원이 아닙니다.' );
    }
    if ( $message_id && absint( get_user_meta( $user_id, '_avocadoss_ua_message_id', true ) ) !== $message_id ) {
        return array( 'ok' => false, 'message' => '원본 메시지가 일치하지 않습니다.' );
    }
    if ( ! add_user_meta( $user_id, '_avocadoss_ua_processing', current_time( 'mysql' ), true ) ) {
        return array( 'ok' => false, 'message' => '이미 처리 중입니다.' );
    }
    $status = 'approve' === $action ? 'approved' : 'rejected';
    update_user_meta( $user_id, 'avocadoss_membership_status', $status );
    update_user_meta( $user_id, '_avo_approval_status', $status );
    if ( 'approve' === $action ) {
        $user->set_role( 'customer' );
        wp_mail(
            $user->user_email,
            '[도매허브] 회원가입이 승인되었습니다',
            "안녕하세요,\n\n회원가입이 승인되었습니다. 로그인 후 가격 확인 및 구매가 가능합니다.\n\n" . wc_get_page_permalink( 'myaccount' )
        );
    } else {
        wp_mail(
            $user->user_email,
            '[도매허브] 회원가입이 거부되었습니다',
            "안녕하세요,\n\n죄송합니다. 회원가입 신청이 거부되었습니다.\n\n문의: admin@avocadoss.co.kr"
        );
    }
    $processed = current_time( 'mysql' );
    update_user_meta( $user_id, '_avocadoss_ua_processed', $status );
    update_user_meta( $user_id, '_avocadoss_ua_processed_by', $admin );
    update_user_meta( $user_id, '_avocadoss_ua_processed_at', $processed );
    delete_user_meta( $user_id, '_avocadoss_ua_nonce' );
    delete_user_meta( $user_id, '_avocadoss_ua_processing' );
    $text = ( 'approve' === $action ? '가입 승인 완료' : '가입 거절 완료' ) . ' · ' . $user->user_email . ' · 처리 관리자 ' . $admin . ' · 처리 시각 ' . $processed;
    return array( 'ok' => true, 'message' => '처리했습니다.', 'text' => $text );
}

add_action( 'rest_api_init', 'avocadoss_register_telegram_callback_route' );
function avocadoss_register_telegram_callback_route() {
    register_rest_route( 'avocadoss/v1', '/telegram-callback', array(
        'methods'             => WP_REST_Server::CREATABLE,
        'callback'            => 'avocadoss_handle_telegram_webhook',
        'permission_callback' => 'avocadoss_verify_telegram_webhook_secret',
    ) );
}

function avocadoss_get_telegram_webhook_secret() {
    $secret = (string) get_option( 'avocadoss_telegram_webhook_secret', '' );
    if ( '' === $secret ) {
        $secret = wp_generate_password( 40, false, false );
        add_option( 'avocadoss_telegram_webhook_secret', $secret, '', false );
        $secret = (string) get_option( 'avocadoss_telegram_webhook_secret', '' );
    }
    return $secret;
}

function avocadoss_verify_telegram_webhook_secret( WP_REST_Request $request ) {
    $stored   = avocadoss_get_telegram_webhook_secret();
    $provided = (string) $request->get_header( 'x-telegram-bot-api-secret-token' );
    return '' !== $stored && '' !== $provided && hash_equals( $stored, $provided );
}

function avocadoss_handle_telegram_webhook( WP_REST_Request $request ) {
    $update   = $request->get_json_params();
    $callback = is_array( $update ) && isset( $update['callback_query'] ) && is_array( $update['callback_query'] ) ? $update['callback_query'] : null;
    if ( ! $callback ) {
        return new WP_REST_Response( array( 'ok' => true ), 200 );
    }
    $message    = isset( $callback['message'] ) && is_array( $callback['message'] ) ? $callback['message'] : array();
    $chat       = isset( $message['chat'] ) && is_array( $message['chat'] ) ? $message['chat'] : array();
    $from       = isset( $callback['from'] ) && is_array( $callback['from'] ) ? $callback['from'] : array();
    $callback_id = isset( $callback['id'] ) ? sanitize_text_field( $callback['id'] ) : '';
    $admin       = isset( $from['username'] ) ? $from['username'] : ( isset( $from['first_name'] ) ? $from['first_name'] : ( isset( $from['id'] ) ? $from['id'] : '' ) );
    $result      = avocadoss_process_telegram_callback( array(
        'data'       => isset( $callback['data'] ) ? $callback['data'] : '',
        'from_id'    => isset( $from['id'] ) ? $from['id'] : '',
        'chat_id'    => isset( $chat['id'] ) ? $chat['id'] : '',
        'message_id' => isset( $message['message_id'] ) ? $message['message_id'] : 0,
        'admin'      => $admin,
    ) );
    if ( '' !== $callback_id ) {
        avocadoss_telegram_api_request( 'answerCallbackQuery', array(
            'callback_query_id' => $callback_id,
            'text'              => isset( $result['message'] ) ? $result['message'] : '처리하지 못했습니다.',
            'show_alert'        => empty( $result['ok'] ) ? 'true' : 'false',
        ) );
    }
    if ( ! empty( $result['ok'] ) && ! empty( $result['text'] ) && ! empty( $message['message_id'] ) ) {
        avocadoss_telegram_api_request( 'editMessageText', array(
            'chat_id'      => isset( $chat['id'] ) ? $chat['id'] : '',
            'message_id'   => absint( $message['message_id'] ),
            'text'         => $result['text'],
            'reply_markup' => wp_json_encode( array(
                'inline_keyboard' => isset( $result['buttons'] ) ? $result['buttons'] : array(),
            ) ),
        ) );
    }
    return new WP_REST_Response( array( 'ok' => true ), 200 );
}

function avocadoss_configure_telegram_webhook() {
    $secret = avocadoss_get_telegram_webhook_secret();
    if ( '' === $secret ) {
        return false;
    }
    return false !== avocadoss_telegram_api_request( 'setWebhook', array(
        'url'             => rest_url( 'avocadoss/v1/telegram-callback' ),
        'secret_token'    => $secret,
        'allowed_updates' => wp_json_encode( array( 'callback_query' ) ),
    ) );
}
