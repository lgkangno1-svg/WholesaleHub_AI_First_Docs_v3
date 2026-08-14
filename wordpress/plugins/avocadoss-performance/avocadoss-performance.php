<?php
/**
 * Plugin Name: Avocadoss Performance
 * Description: Core Web Vitals 최적화, WooCommerce Checkout Customization & Points Gateway
 * Version: 1.4
 */
require_once __DIR__ . '/avocadoss-multi-variation-cart.php';
require_once __DIR__ . '/avocadoss-telegram-approvals.php';
require_once __DIR__ . '/includes/class-wholesalehub-homepage.php';
remove_action("wp_head","wp_generator");
remove_action("wp_head","wlwmanifest_link");
remove_action("wp_head","rsd_link");
remove_action("wp_head","print_emoji_detection_script",7);
remove_action("wp_print_styles","print_emoji_styles");
add_action("wp_enqueue_scripts",function(){wp_dequeue_style("wp-block-library");wp_dequeue_style("wp-block-library-theme");wp_dequeue_style("global-styles");},100);
add_action("wp_enqueue_scripts",function(){if(!is_cart()&&!is_checkout()&&!is_account_page()&&!is_product()){wp_dequeue_script("wc-cart-fragments");}},99);
add_filter("wp_lazy_loading_enabled","__return_true");
add_action("wp_head",function(){if(is_front_page()){$d=["@context"=>"https://schema.org","@type"=>"Store","name"=>"도매허브","url"=>"https://hub.avocadoss.co.kr","description"=>"도매허브 B2B 쇼핑몰","address"=>["@type"=>"PostalAddress","addressCountry"=>"KR"],"currenciesAccepted"=>"KRW","paymentAccepted"=>"무통장, 카카오, 신용카드","inLanguage"=>"ko"];echo"<script type=\"application/ld+json\">".json_encode($d,320)."</script>\n";}},20);

add_action('wp_head', function(){
    echo '<link rel="preconnect" href="https://fonts.googleapis.com">' . PHP_EOL;
    echo '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' . PHP_EOL;
}, 0);

add_action('wp_footer', function(){
    echo '<div id="biz-info" style="background:#1A202C;color:#A0AEC0;text-align:center;padding:16px;font-size:0.82em;line-height:2;border-top:1px solid #2D3748;">';
    echo '상호: 도매허브 &nbsp;|&nbsp; 대표: 강호성 &nbsp;|&nbsp; 사업자등록번호: 502-40-62677<br>';
    echo '사업장 주소: 경기도 용인시 처인구 남사읍 처인성로 577, 104호';
    echo '</div>' . PHP_EOL;
}, 99);

// =========================================================================
// WooCommerce Checkout Field & Layout Customizations
// =========================================================================

add_filter( 'woocommerce_checkout_fields', 'avocadoss_custom_checkout_fields', 999 );
function avocadoss_custom_checkout_fields( $fields ) {
    // 1. Remove Last Name and Company fields
    unset( $fields['billing']['billing_last_name'] );
    unset( $fields['shipping']['shipping_last_name'] );
    unset( $fields['billing']['billing_company'] );
    unset( $fields['shipping']['shipping_company'] );
    
    // Make city and state optional (as they are hidden and managed automatically)
    $fields['billing']['billing_city']['required'] = false;
    $fields['shipping']['shipping_city']['required'] = false;
    $fields['billing']['billing_state']['required'] = false;
    $fields['shipping']['shipping_state']['required'] = false;

    // 2. Customize Billing Fields (주문자 정보)
    $fields['billing']['billing_first_name']['label'] = '이름';
    $fields['billing']['billing_first_name']['placeholder'] = '이름을 입력하세요';
    $fields['billing']['billing_first_name']['class'] = array( 'form-row-wide' );
    
    $fields['billing']['billing_phone']['label'] = '전화번호';
    $fields['billing']['billing_phone']['placeholder'] = '전화번호를 입력하세요';
    $fields['billing']['billing_phone']['required'] = true;
    $fields['billing']['billing_phone']['class'] = array( 'form-row-wide' );
    
    $fields['billing']['billing_email']['label'] = '이메일 주소';
    $fields['billing']['billing_email']['placeholder'] = '이메일 주소를 입력하세요';
    $fields['billing']['billing_email']['class'] = array( 'form-row-wide' );
    
    $fields['billing']['billing_postcode']['label'] = '주소 입력';
    $fields['billing']['billing_postcode']['placeholder'] = '우편번호';
    $fields['billing']['billing_postcode']['class'] = array( 'form-row-wide' );
    
    $fields['billing']['billing_address_1']['label'] = '';
    $fields['billing']['billing_address_1']['placeholder'] = '도로명 주소';
    $fields['billing']['billing_address_1']['class'] = array( 'form-row-wide' );
    
    $fields['billing']['billing_address_2']['label'] = '';
    $fields['billing']['billing_address_2']['placeholder'] = '상세 주소';
    $fields['billing']['billing_address_2']['class'] = array( 'form-row-wide' );

    // 3. Customize Shipping Fields (수취인 정보)
    $fields['shipping']['shipping_first_name']['label'] = '수취인 성함';
    $fields['shipping']['shipping_first_name']['placeholder'] = '수취인 성함을 입력하세요';
    $fields['shipping']['shipping_first_name']['class'] = array( 'form-row-wide' );
    
    $fields['shipping']['shipping_phone'] = array(
        'label'        => '전화번호',
        'placeholder'  => '전화번호를 입력하세요',
        'required'     => true,
        'class'        => array( 'form-row-wide' ),
        'clear'        => true,
        'validate'     => array( 'phone' ),
        'autocomplete' => 'tel',
        'priority'     => 100,
    );
    
    $fields['shipping']['shipping_postcode']['label'] = '주소 입력';
    $fields['shipping']['shipping_postcode']['placeholder'] = '우편번호';
    $fields['shipping']['shipping_postcode']['class'] = array( 'form-row-wide' );
    
    $fields['shipping']['shipping_address_1']['label'] = '';
    $fields['shipping']['shipping_address_1']['placeholder'] = '도로명 주소';
    $fields['shipping']['shipping_address_1']['class'] = array( 'form-row-wide' );
    
    $fields['shipping']['shipping_address_2']['label'] = '';
    $fields['shipping']['shipping_address_2']['placeholder'] = '상세 주소';
    $fields['shipping']['shipping_address_2']['class'] = array( 'form-row-wide' );

    // Force default country to KR
    $fields['billing']['billing_country']['default'] = 'KR';
    $fields['shipping']['shipping_country']['default'] = 'KR';

    return $fields;
}

// Override country locale address fields directly to prevent WooCommerce from overriding the label
add_filter( 'woocommerce_get_country_locale', 'avocadoss_custom_country_locale', 9999 );
function avocadoss_custom_country_locale( $locale ) {
    if ( isset( $locale['KR'] ) ) {
        $locale['KR']['postcode']['label'] = '주소 입력';
        $locale['KR']['postcode']['placeholder'] = '우편번호';
    }
    return $locale;
}

add_filter( 'woocommerce_default_address_fields', 'avocadoss_custom_default_address_fields', 9999 );
function avocadoss_custom_default_address_fields( $fields ) {
    $fields['postcode']['label'] = '주소 입력';
    $fields['postcode']['placeholder'] = '우편번호';
    return $fields;
}

// Force Ship to Different Address to be always enabled (keeps Recipient Info section open)
add_filter( 'woocommerce_ship_to_different_address_checked', '__return_true' );

// Rename section headings in WooCommerce
add_filter( 'gettext', 'avocadoss_rename_checkout_headings', 999, 3 );
function avocadoss_rename_checkout_headings( $translated_text, $text, $domain ) {
    if ( 'woocommerce' === $domain ) {
        if ( 'Billing details' === $text || 'Billing Details' === $text || '청구 상세 내용' === $translated_text ) {
            return '주문자 정보';
        }
        if ( 'Shipping details' === $text || 'Shipping Details' === $text || '배송 상세 내용' === $translated_text ) {
            return '수취인 정보';
        }
    }
    return $translated_text;
}

// Enqueue Custom CSS for Checkout Page
add_action( 'wp_head', 'avocadoss_checkout_custom_css' );
function avocadoss_checkout_custom_css() {
    if ( ! is_checkout() ) {
        return;
    }
    ?>
    <style type="text/css">
    /* Stack checkout columns vertically */
    .col2-set {
        display: flex !important;
        flex-direction: column !important;
        gap: 30px !important;
    }
    .col2-set .col-1, .col2-set .col-2 {
        float: none !important;
        width: 100% !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
    }
    
    /* Hide Country, State, City fields */
    #billing_country_field, #shipping_country_field,
    #billing_state_field, #shipping_state_field,
    #billing_city_field, #shipping_city_field {
        display: none !important;
    }
    
    /* Hide default checkbox of Ship to Different Address */
    #ship-to-different-address label {
        display: none !important;
    }
    
    /* Make postcode inputs look clickable */
    #billing_postcode, #shipping_postcode {
        cursor: pointer !important;
        background-color: #fcfcfc !important;
    }
    
    /* Formatting for headers */
    .woocommerce-billing-fields h3, #ship-to-different-address {
        font-size: 1.5em !important;
        font-weight: bold !important;
        border-bottom: 2px solid #e2e8f0 !important;
        padding-bottom: 8px !important;
        margin-bottom: 20px !important;
        color: #2d3748 !important;
    }
    </style>
    <?php
}

// Enqueue Custom JS for Checkout Page
add_action( 'wp_footer', 'avocadoss_checkout_custom_js' );
function avocadoss_checkout_custom_js() {
    if ( ! is_checkout() ) {
        return;
    }
    ?>
    <script type="text/javascript">
    jQuery(document).ready(function($) {
        function moveAndFormatComments() {
            // Move order comments (배송시 메세지) inside shipping fields wrapper
            if ($('#order_comments_field').length && $('.woocommerce-shipping-fields__field-wrapper').length) {
                $('#order_comments_field').appendTo('.woocommerce-shipping-fields__field-wrapper');
                $('#order_comments_field').addClass('form-row-wide').removeClass('notes');
                $('#order_comments_field label').text('배송시 메세지');
                $('#order_comments_field textarea').attr('placeholder', '배송시 메세지를 입력하세요');
            }
            
            // Hide Additional Fields heading if empty
            if ($('.woocommerce-additional-fields').length && !$('.woocommerce-additional-fields__field-wrapper').children().length) {
                $('.woocommerce-additional-fields').hide();
            }
            
            // Force the Ship to Different Address header text
            if ($('#ship-to-different-address').length && !$('.custom-shipping-title').length) {
                $('#ship-to-different-address').append('<span class="custom-shipping-title">수취인 정보</span>');
            }
            
            // Force postcode field label rename
            var billingPostcodeLabel = $('#billing_postcode_field label');
            if (billingPostcodeLabel.length) {
                billingPostcodeLabel.html('주소 입력 <span class="required" aria-hidden="true">*</span>');
            }
            var shippingPostcodeLabel = $('#shipping_postcode_field label');
            if (shippingPostcodeLabel.length) {
                shippingPostcodeLabel.html('주소 입력 <span class="required" aria-hidden="true">*</span>');
            }
        }
        
        function updatePlaceOrderButtonText() {
            var selectedPayment = $('input[name="payment_method"]:checked').val();
            var warningBox = $('.avocadoss-points-warning-box');
            var placeOrderBtn = $('#place_order');
            
            if (selectedPayment === 'avocadoss_points' && warningBox.length > 0) {
                var neededAmount = parseInt(warningBox.attr('data-needed'));
                if (neededAmount > 0) {
                    if (!placeOrderBtn.data('original-text')) {
                        placeOrderBtn.data('original-text', placeOrderBtn.text() || placeOrderBtn.val());
                    }
                    placeOrderBtn.text('충전하여 결제하기');
                    placeOrderBtn.val('충전하여 결제하기');
                }
            } else {
                var originalText = placeOrderBtn.data('original-text');
                if (originalText) {
                    placeOrderBtn.text(originalText);
                    placeOrderBtn.val(originalText);
                }
            }
        }
        
        moveAndFormatComments();
        updatePlaceOrderButtonText();
        
        // Run again after a short delay to cover dynamically updated forms
        setTimeout(function() {
            moveAndFormatComments();
            updatePlaceOrderButtonText();
        }, 1000);
        
        $(document.body).on('updated_checkout', function() {
            moveAndFormatComments();
            updatePlaceOrderButtonText();
        });

        $(document.body).on('change', 'input[name="payment_method"]', function() {
            updatePlaceOrderButtonText();
        });
    });
    </script>
    <?php
}

// =========================================================================
// WooCommerce Custom Points Payment Gateway ("적립금 결제")
// =========================================================================

add_action( 'plugins_loaded', 'avocadoss_init_points_gateway' );
function avocadoss_init_points_gateway() {
    if ( ! class_exists( 'WC_Payment_Gateway' ) ) return;

    class WC_Gateway_Avocadoss_Points extends WC_Payment_Gateway {
        public function __construct() {
            $this->id                 = 'avocadoss_points';
            $this->icon               = '';
            $this->has_fields         = false;
            $this->method_title       = '적립금 결제';
            $this->method_description = '회원님의 선불 적립금으로 결제합니다.';

            $this->init_form_fields();
            $this->init_settings();

            $this->title        = '적립금 결제';
            $this->description  = $this->get_option( 'description', '보유 중인 적립금으로 즉시 결제합니다.' );
            $this->enabled      = $this->get_option( 'enabled', 'yes' );

            add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'process_admin_options' ) );
        }

        public function init_form_fields() {
            $this->form_fields = array(
                'enabled' => array(
                    'title'   => '사용 여부',
                    'type'    => 'checkbox',
                    'label'   => '적립금 결제를 활성화합니다.',
                    'default' => 'yes',
                ),
                'description' => array(
                    'title'       => '설명',
                    'type'        => 'textarea',
                    'description' => '체크아웃 시 고객에게 보여지는 설명입니다.',
                    'default'     => '보유 중인 적립금으로 즉시 결제합니다.',
                ),
            );
        }

        public function process_payment( $order_id ) {
            $order = wc_get_order( $order_id );
            $user_id = $order->get_user_id();
            
            if ( ! $user_id ) {
                throw new Exception( '회원만 적립금으로 결제할 수 있습니다.' );
            }
            
            $points = (int) get_user_meta( $user_id, '_avocadoss_points', true );
            if ( $points < 0 ) $points = 0;
            $order_total = (int) $order->get_total();
            
            if ( $points >= $order_total ) {
                // 1. 잔액 충분: 즉시 결제 처리
                $new_points = $points - $order_total;
                update_user_meta( $user_id, '_avocadoss_points', $new_points );
                
                $order->add_order_note( sprintf( '적립금 결제 완료 (차감액: %s원, 잔액: %s원)', number_format($order_total), number_format($new_points) ) );
                $order->payment_complete();
                
                WC()->cart->empty_cart();
                
                return array(
                    'result'   => 'success',
                    'redirect' => $this->get_return_url( $order ),
                );
            } else {
                // 2. 잔액 부족: 충전하여 결제 연동
                $charge_amount = $order_total - $points;
                
                // 주문 상태를 on-hold로 변경 및 메타 데이터 설정
                $order->update_status( 'on-hold', '적립금 잔액 부족으로 무통장 충전 결제 대기 중.' );
                $order->update_meta_data( '_needs_charge_payment', 'yes' );
                $order->update_meta_data( '_charge_amount', $charge_amount );
                $order->save();
                
                // recharge_request CPT 자동 생성
                $user_info = get_userdata( $user_id );
                $sender = get_user_meta( $user_id, '_deposit_name', true );
                if ( empty( $sender ) ) {
                    $sender = $user_info->display_name;
                }
                
                $post_id = wp_insert_post( array(
                    'post_title'   => sprintf( '[주문연동] %s - %s원 충전 신청', $user_info->display_name, number_format($charge_amount) ),
                    'post_type'    => 'recharge_request',
                    'post_status'  => 'publish',
                ) );
                
                if ( $post_id ) {
                    update_post_meta( $post_id, '_user_id', $user_id );
                    update_post_meta( $post_id, '_amount', $charge_amount );
                    update_post_meta( $post_id, '_sender', $sender );
                    update_post_meta( $post_id, '_status', 'pending' );
                    update_post_meta( $post_id, '_related_order_id', $order_id );
                    
                    $order->add_order_note( sprintf( '충전하여 결제 신청 접수 완료 (충전 필요 금액: %s원, 충전 신청서 ID: %s)', number_format($charge_amount), $post_id ) );
                }
                
                WC()->cart->empty_cart();
                
                return array(
                    'result'   => 'success',
                    'redirect' => $this->get_return_url( $order ),
                );
            }
        }
    }
}

// Register Gateway in WooCommerce
add_filter( 'woocommerce_payment_gateways', 'avocadoss_add_points_gateway' );
function avocadoss_add_points_gateway( $gateways ) {
    $gateways[] = 'WC_Gateway_Avocadoss_Points';
    return $gateways;
}

// Validate points balance on checkout submit
add_action( 'woocommerce_checkout_process', 'avocadoss_validate_points_checkout' );
function avocadoss_validate_points_checkout() {
    if ( isset( $_POST['payment_method'] ) && 'avocadoss_points' === $_POST['payment_method'] ) {
        $user_id = get_current_user_id();
        if ( ! $user_id ) {
            wc_add_notice( '로그인이 필요한 결제 방법입니다.', 'error' );
            return;
        }
        // 잔액이 부족하더라도 결제 허용하므로 경고 및 차단 제거
    }
}

// Display points warning and balance on checkout review
add_action( 'woocommerce_review_order_before_payment', 'avocadoss_checkout_points_warning' );
function avocadoss_checkout_points_warning() {
    if ( ! is_user_logged_in() ) {
        echo '<div class="woocommerce-info">결제하려면 로그인이 필요합니다.</div>';
        return;
    }
    
    $user_id = get_current_user_id();
    $points = (int) get_user_meta( $user_id, '_avocadoss_points', true );
    if ( $points < 0 ) $points = 0;
    $cart_total = (int) WC()->cart->get_total( 'edit' );
    
    if ( $points < $cart_total ) {
        $needed = $cart_total - $points;
        echo '<div class="woocommerce-info avocadoss-points-warning-box" data-needed="' . $needed . '" style="margin-top:15px; margin-bottom:15px; border-left:4px solid #dd6b20; background:#fffaf0; padding:15px;">';
        echo '보유 적립금이 결제 금액보다 부족합니다.<br>';
        echo '현재 잔액: <strong>' . number_format($points) . '원</strong> | ';
        echo '결제 필요 금액: <strong>' . number_format($cart_total) . '원</strong><br>';
        echo '결제 시 부족한 <strong style="color:#e53e3e;">' . number_format($needed) . '원</strong>에 대한 충전 신청이 자동으로 생성되며, 입금 완료 즉시 결제가 진행됩니다.';
        echo '</div>';
    } else {
        echo '<div class="woocommerce-info" style="margin-top:15px; margin-bottom:15px; border-left:4px solid #3182ce; background:#ebf8ff; padding:15px;">';
        echo '현재 잔고: <strong>' . number_format($points) . '원</strong> (결제 후 잔액: ' . number_format($points - $cart_total) . '원)';
        echo '</div>';
    }
}

// =========================================================================
// Points CPT & My Account Recharge Interface
// =========================================================================

// 1. CPT Registration
add_action( 'init', 'avocadoss_register_recharge_cpt' );
function avocadoss_register_recharge_cpt() {
    register_post_type( 'recharge_request',
        array(
            'labels' => array(
                'name' => '적립금 충전 신청',
                'singular_name' => '적립금 충전 신청'
            ),
            'public' => false,
            'show_ui' => true,
            'capability_type' => 'post',
            'hierarchical' => false,
            'supports' => array( 'title', 'custom-fields' )
        )
    );
}

// 2. Register custom endpoints for My Account
add_action( 'init', 'avocadoss_add_recharge_endpoint' );
function avocadoss_add_recharge_endpoint() {
    add_rewrite_endpoint( 'recharge-points', EP_PAGES );
}

add_filter( 'query_vars', 'avocadoss_recharge_query_vars', 0 );
function avocadoss_recharge_query_vars( $vars ) {
    $vars[] = 'recharge-points';
    return $vars;
}

add_filter( 'woocommerce_account_menu_items', 'avocadoss_add_recharge_link' );
function avocadoss_add_recharge_link( $items ) {
    $logout = isset($items['customer-logout']) ? $items['customer-logout'] : '';
    unset( $items['customer-logout'] );
    
    $items['recharge-points'] = '적립금 충전';
    if ($logout) {
        $items['customer-logout'] = $logout;
    }
    
    return $items;
}

add_action( 'woocommerce_account_recharge-points_endpoint', 'avocadoss_recharge_content' );
function avocadoss_recharge_content() {
    $user_id = get_current_user_id();
    
    // Handle form submission
    if ( isset( $_POST['submit_recharge'] ) && isset( $_POST['recharge_nonce'] ) && wp_verify_nonce( $_POST['recharge_nonce'], 'avocadoss_recharge' ) ) {
        $amount = (int) $_POST['recharge_amount'];
        $sender = sanitize_text_field( $_POST['deposit_sender'] );
        
        if ( $amount > 0 && ! empty( $sender ) ) {
            // Save custom deposit name for matching
            update_user_meta( $user_id, '_deposit_name', $sender );
            
            // Create a pending recharge request
            $user_info = get_userdata( $user_id );
            $post_id = wp_insert_post( array(
                'post_title'   => sprintf( '%s - %s원 충전 신청', $user_info->display_name, number_format($amount) ),
                'post_type'    => 'recharge_request',
                'post_status'  => 'publish',
            ) );
            
            if ( $post_id ) {
                update_post_meta( $post_id, '_user_id', $user_id );
                update_post_meta( $post_id, '_amount', $amount );
                update_post_meta( $post_id, '_sender', $sender );
                update_post_meta( $post_id, '_status', 'pending' );
                
                echo '<div class="woocommerce-message" style="border-left:4px solid #38a169; background:#f0fff4; padding:15px; margin-bottom:20px;">';
                echo '<strong>충전 신청이 완료되었습니다!</strong> 아래 계좌로 입금해 주시기 바랍니다.<br>';
                echo '입금자명: <strong>' . esc_html($sender) . '</strong> | 금액: <strong>' . number_format($amount) . '원</strong>';
                echo '</div>';
            }
        }
    }
    
    $points = (int) get_user_meta( $user_id, '_avocadoss_points', true );
    $saved_sender = get_user_meta( $user_id, '_deposit_name', true );
    if ( empty( $saved_sender ) ) {
        $user_info = get_userdata( $user_id );
        $saved_sender = $user_info->display_name;
    }
    
    ?>
    <h3>적립금 충전 및 관리</h3>
    
    <div style="background:#edf2f7; padding:20px; border-radius:8px; margin-bottom:25px; border-left:4px solid #4a5568;">
        <span style="font-size:1.1em; color:#4a5568;">현재 나의 보유 적립금</span>
        <div style="font-size:2em; font-weight:bold; color:#2d3748; margin-top:5px;">
            <?php echo number_format($points); ?> 원
        </div>
    </div>
    
    <div style="border: 1px solid #e2e8f0; padding:25px; border-radius:8px; background:#fff;">
        <h4 style="margin-top:0; margin-bottom:15px; font-weight:bold;">무통장 입금 충전 신청</h4>
        
        <div style="background:#fffaf0; border-left:4px solid #dd6b20; padding:15px; margin-bottom:20px; font-size:0.95em; line-height:1.6;">
            <strong>입금 계좌 안내:</strong><br>
            카카오뱅크 <strong>3333-19-8058955</strong> (예금주: 강호성)<br>
            * 입력하신 입금자명과 금액이 실제 입금 내역과 일치하면 1분 이내에 자동으로 충전됩니다.
        </div>
        
        <form method="post" action="">
            <?php wp_nonce_field( 'avocadoss_recharge', 'recharge_nonce' ); ?>
            
            <p class="form-row form-row-wide" style="margin-bottom:15px;">
                <label for="recharge_amount" style="font-weight:bold; display:block; margin-bottom:5px;">충전 신청 금액 (원) <span class="required">*</span></label>
                <input type="number" class="input-text" name="recharge_amount" id="recharge_amount" required placeholder="예: 50000" min="1000" step="1000" style="width:100%; padding:10px;">
            </p>
            
            <p class="form-row form-row-wide" style="margin-bottom:20px;">
                <label for="deposit_sender" style="font-weight:bold; display:block; margin-bottom:5px;">실제 입금자명 <span class="required">*</span></label>
                <input type="text" class="input-text" name="deposit_sender" id="deposit_sender" required value="<?php echo esc_attr($saved_sender); ?>" placeholder="보내시는 분 성함" style="width:100%; padding:10px;">
            </p>
            
            <p style="margin-bottom:0;">
                <button type="submit" class="button" name="submit_recharge" value="submit" style="padding:12px 25px;">충전 신청하기</button>
            </p>
        </form>
    </div>
    
    <div style="margin-top: 35px;">
        <h4 style="font-weight:bold; margin-bottom:15px;">최근 충전 신청 내역</h4>
        <?php
        $requests = get_posts( array(
            'post_type'      => 'recharge_request',
            'posts_per_page' => 10,
            'meta_query'     => array(
                array(
                    'key'   => '_user_id',
                    'value' => $user_id,
                )
            ),
        ) );
        
        if ( $requests ) {
            echo '<table class="shop_table shop_table_responsive" style="width:100%; border-collapse:collapse;">';
            echo '<thead><tr style="border-bottom:2px solid #e2e8f0;"><th style="text-align:left; padding:10px 5px;">신청 일시</th><th style="text-align:left; padding:10px 5px;">충전 금액</th><th style="text-align:left; padding:10px 5px;">입금자명</th><th style="text-align:left; padding:10px 5px;">상태</th></tr></thead>';
            echo '<tbody>';
            foreach ( $requests as $req ) {
                $status = get_post_meta( $req->ID, '_status', true );
                $amount = get_post_meta( $req->ID, '_amount', true );
                $sender = get_post_meta( $req->ID, '_sender', true );
                $date = get_the_date( 'Y-m-d H:i', $req->ID );
                
                $status_label = ($status === 'completed') ? '<span style="color:#38a169; font-weight:bold;">충전완료</span>' : '<span style="color:#dd6b20;">입금대기</span>';
                
                echo '<tr style="border-bottom:1px solid #edf2f7;">';
                echo '<td style="padding:10px 5px;">' . esc_html($date) . '</td>';
                echo '<td style="padding:10px 5px;">' . number_format($amount) . '원</td>';
                echo '<td style="padding:10px 5px;">' . esc_html($sender) . '</td>';
                echo '<td style="padding:10px 5px;">' . $status_label . '</td>';
                echo '</tr>';
            }
            echo '</tbody>';
            echo '</table>';
        } else {
            echo '<p style="color:#718096; font-style:italic;">최근 충전 신청 내역이 없습니다.</p>';
        }
        ?>
    </div>
    <?php
}

// =========================================================================
// 상단 메뉴에 충전금 충전 및 실시간 잔액 표시 메뉴 추가
// =========================================================================
// 이미지 시그니처대로 상단 헤더에 충전/잔액 표시되므로 카테고리바에서는 비활성화
// add_filter( 'wp_nav_menu_items', 'avocadoss_add_recharge_menu_item', 9999, 2 );
function avocadoss_add_recharge_menu_item( $items, $args ) {
    if ( is_user_logged_in() ) {
        if ( empty( $args->theme_location ) || 'primary' === $args->theme_location || 'mobile_menu' === $args->theme_location ) {
            $user_id = get_current_user_id();
            $points = (int) get_user_meta( $user_id, '_avocadoss_points', true );
            $recharge_url = esc_url( wc_get_endpoint_url( 'recharge-points', '', wc_get_page_permalink( 'myaccount' ) ) );
            
            $recharge_item = sprintf(
                '<li class="menu-item menu-item-recharge" style="font-weight:600;"><a href="%s" class="menu-link">충전금 충전 (잔액: %s원)</a></li>',
                $recharge_url,
                number_format( $points )
            );
            $items .= $recharge_item;
        }
    }
    return $items;
}

// =========================================================================
// 커스텀 상단 헤더 및 디자인 스타일 추가 (제시된 이미지 구성 구현)
// =========================================================================

// 1. 헤더 CSS 스타일 추가
add_action( 'wp_head', 'avocadoss_custom_header_styles', 999 );
function avocadoss_custom_header_styles() {
    ?>
    <style type="text/css">
    /* 커스텀 상단 헤더 스타일 */
    .custom-top-header {
        background: #fff;
        border-bottom: 1px solid #edf2f7;
        padding: 12px 0;
        font-family: 'Inter', 'Noto Sans KR', sans-serif;
        width: 100%;
        box-sizing: border-box;
    }
    .custom-header-container {
        max-width: 1200px;
        margin: 0 auto;
        display: flex;
        align-items: center;
        justify-content: flex-end; /* 오른쪽 정렬 */
        gap: 20px;
        padding: 0 20px;
        box-sizing: border-box;
    }
    .custom-header-search {
        position: relative;
        width: 280px;
    }
    .custom-header-search .search-field {
        width: 100%;
        border: 1px solid #e2e8f0;
        border-radius: 99px;
        padding: 8px 40px 8px 20px;
        font-size: 0.88rem;
        outline: none;
        background-color: #fff;
        color: #2d3748;
        box-sizing: border-box;
    }
    .custom-header-search .search-submit {
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        cursor: pointer;
        color: #4a5568;
        padding: 0;
        display: flex;
        align-items: center;
    }
    .custom-header-user-status {
        border: 1px solid #e2e8f0;
        border-radius: 99px;
        padding: 8px 20px;
        background-color: #f8f9fa;
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 0.88rem;
        color: #4a5568;
    }
    .user-name-highlight {
        color: #38a169;
        font-weight: 700;
    }
    .deposit-val {
        color: #e53e3e;
        font-weight: 700;
    }
    .pill-divider {
        color: #e2e8f0;
    }
    .pill-link {
        color: #4a5568;
        text-decoration: none;
        font-weight: 500;
    }
    .pill-link:hover {
        color: #1a202c;
        text-decoration: underline;
    }
    .custom-header-nav-links {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 0.88rem;
    }
    .nav-text-link {
        color: #4a5568;
        text-decoration: none;
        font-weight: 500;
    }
    .nav-text-link:hover {
        color: #1a202c;
    }
    .nav-divider {
        color: #cbd5e1;
    }
    .nav-logout-btn {
        border: 1px solid #cbd5e1;
        border-radius: 99px;
        padding: 6px 18px;
        color: #2d3748;
        text-decoration: none;
        background-color: #fff;
        font-weight: 600;
        transition: all 0.2s ease;
    }
    .nav-logout-btn:hover {
        background-color: #f7fafc;
        border-color: #a0aec0;
    }

    /* 카테고리 메뉴 바 (Astra Primary Menu) 오버라이드 스타일 */
    .ast-main-header-wrap {
        border-bottom: none !important;
    }
    .ast-primary-header-bar {
        border-bottom: none !important;
        padding: 10px 0 !important;
    }
    .main-header-bar-navigation {
        display: flex !important;
        justify-content: flex-start !important;
        width: 100% !important;
    }
    .ast-builder-menu-1 {
        width: 100% !important;
        display: flex !important;
        justify-content: flex-start !important;
    }
    #primary-site-navigation-desktop {
        background: #f7f7f7 !important;
        border-radius: 20px !important;
        padding: 8px 24px !important;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03) !important;
        display: inline-block !important;
        flex-grow: 0 !important;
    }
    .main-header-menu .menu-item a {
        color: #2d3748 !important;
        font-weight: 600 !important;
        font-size: 0.95rem !important;
        padding: 0 16px !important;
        line-height: 2 !important;
    }
    .main-header-menu .menu-item a:hover {
        color: #38a169 !important;
    }
    .main-header-menu {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
    }
    
    /* 기존 아스트라 헤더 내 검색창이나 불필요 엘리먼트 제거 */
    .ast-header-search, .ast-search-menu-item {
        display: none !important;
    }
    
    @media (max-width: 920px) {
        .custom-header-container {
            flex-direction: column;
            gap: 10px;
            align-items: center;
        }
        .custom-header-search {
            width: 100%;
        }
    }
    </style>
    <?php
}

// 2. 헤더 HTML 출력 추가
add_action( 'astra_header_before', 'avocadoss_custom_top_header' );
function avocadoss_custom_top_header() {
    $user_id = get_current_user_id();
    $my_account_url = wc_get_page_permalink( 'myaccount' );
    
    if ( is_user_logged_in() ) {
        $user_info = get_userdata( $user_id );
        $user_name = get_user_meta( $user_id, 'billing_first_name', true ) ?: $user_info->display_name;
        $points = (int) get_user_meta( $user_id, '_avocadoss_points', true );
        if ($points < 0) $points = 0;
        
        $orders_url = wc_get_endpoint_url( 'orders', '', $my_account_url );
        $recharge_url = wc_get_endpoint_url( 'recharge-points', '', $my_account_url );
        $edit_profile_url = wc_get_endpoint_url( 'edit-account', '', $my_account_url );
        $logout_url = wc_logout_url( $my_account_url );
        
        ?>
        <div class="custom-top-header">
            <div class="custom-header-container">
                <!-- Search Bar -->
                <div class="custom-header-search">
                    <form role="search" method="get" class="search-form" action="<?php echo esc_url( home_url( '/' ) ); ?>">
                        <input type="search" class="search-field" placeholder="검색어를 입력해주세요" value="" name="s" />
                        <button type="submit" class="search-submit">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                        </button>
                    </form>
                </div>
                
                <!-- User Status Pill -->
                <div class="custom-header-user-status">
                    <span class="user-welcome"><span class="user-name-highlight"><?php echo esc_html( $user_name ); ?></span>님 로그인중</span>
                    <span class="pill-divider">|</span>
                    <span class="deposit-label">예치금</span>
                    <span class="deposit-val"><?php echo number_format( $points ); ?>원</span>
                    <span class="pill-divider">|</span>
                    <a href="<?php echo esc_url( $orders_url ); ?>" class="pill-link">내역</a>
                    <span class="pill-divider">|</span>
                    <a href="<?php echo esc_url( $recharge_url ); ?>" class="pill-link">충전</a>
                </div>
                
                <!-- Navigation Links -->
                <div class="custom-header-nav-links">
                    <a href="<?php echo esc_url( $edit_profile_url ); ?>" class="nav-text-link">정보수정</a>
                    <span class="nav-divider">|</span>
                    <a href="<?php echo esc_url( $my_account_url ); ?>" class="nav-text-link">마이페이지</a>
                    <span class="nav-divider">|</span>
                    <a href="<?php echo esc_url( $logout_url ); ?>" class="nav-logout-btn">로그아웃</a>
                </div>
            </div>
        </div>
        <?php
    } else {
        ?>
        <div class="custom-top-header">
            <div class="custom-header-container">
                <!-- Search Bar -->
                <div class="custom-header-search">
                    <form role="search" method="get" class="search-form" action="<?php echo esc_url( home_url( '/' ) ); ?>">
                        <input type="search" class="search-field" placeholder="검색어를 입력해주세요" value="" name="s" />
                        <button type="submit" class="search-submit">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                        </button>
                    </form>
                </div>
                
                <!-- Links for Logged Out -->
                <div class="custom-header-nav-links" style="margin-left: auto;">
                    <a href="<?php echo esc_url( $my_account_url ); ?>" class="nav-text-link">로그인</a>
                    <span class="nav-divider">|</span>
                    <a href="<?php echo esc_url( $my_account_url ); ?>" class="nav-text-link">회원가입</a>
                </div>
            </div>
        </div>
        <?php
    }
}

// =========================================================================
// 감사 페이지 및 주문 내역 페이지 입금 안내 노출
// =========================================================================
add_action( 'woocommerce_thankyou', 'avocadoss_display_charge_payment_instruction', 10, 1 );
add_action( 'woocommerce_order_details_after_order_table', 'avocadoss_display_charge_payment_instruction_details', 10, 1 );

function avocadoss_display_charge_payment_instruction( $order_id ) {
    $order = wc_get_order( $order_id );
    if ( ! $order ) return;
    
    $needs_charge = $order->get_meta( '_needs_charge_payment' );
    $charge_amount = (int) $order->get_meta( '_charge_amount' );
    
    if ( 'yes' === $needs_charge && $charge_amount > 0 ) {
        $user_id = $order->get_user_id();
        $sender = get_user_meta( $user_id, '_deposit_name', true );
        if ( empty( $sender ) ) {
            $sender = $order->get_billing_first_name();
        }
        
        ?>
        <div class="woocommerce-info" style="margin-top:20px; margin-bottom:20px; border-left:4px solid #dd6b20; background:#fffaf0; padding:20px; border-radius:8px;">
            <h4 style="margin-top:0; margin-bottom:10px; color:#dd6b20; font-weight:bold;">⏳ 충전하여 결제 - 입금 대기 중</h4>
            <p style="margin: 5px 0; font-size:1.1em; line-height:1.6;">
                주문을 완료하기 위해 아래 계좌로 부족한 충전금을 입금해 주시기 바랍니다.<br>
                입금 확인 즉시 충전 및 결제가 자동으로 완료됩니다.
            </p>
            <hr style="border-top:1px solid #fbd38d; margin:12px 0;">
            <ul style="list-style:none; padding-left:0; margin:0; line-height:1.8;">
                <li>입금 계좌: <strong>카카오뱅크 3333-19-8058955 (예금주: 강호성)</strong></li>
                <li>입금 금액: <strong style="color:#e53e3e; font-size:1.2em;"><?php echo number_format($charge_amount); ?>원</strong></li>
                <li>입금자명: <strong><?php echo esc_html($sender); ?></strong></li>
            </ul>
            <p style="margin-top:10px; margin-bottom:0; font-size:0.9em; color:#718096;">
                * 실제 입금하신 성함과 금액이 위 정보와 일치하면 1분 이내에 시스템이 자동 인식하여 주문 처리를 진행합니다.
            </p>
        </div>
        <?php
    }
}

function avocadoss_display_charge_payment_instruction_details( $order ) {
    if ( ! $order ) return;
    $needs_charge = $order->get_meta( '_needs_charge_payment' );
    $charge_amount = (int) $order->get_meta( '_charge_amount' );
    
    if ( 'yes' === $needs_charge && $charge_amount > 0 && $order->get_status() === 'on-hold' ) {
        $user_id = $order->get_user_id();
        $sender = get_user_meta( $user_id, '_deposit_name', true );
        if ( empty( $sender ) ) {
            $sender = $order->get_billing_first_name();
        }
        
        ?>
        <div class="woocommerce-info" style="margin-top:20px; margin-bottom:20px; border-left:4px solid #dd6b20; background:#fffaf0; padding:20px; border-radius:8px;">
            <h4 style="margin-top:0; margin-bottom:10px; color:#dd6b20; font-weight:bold;">⏳ 충전하여 결제 - 입금 대기 중</h4>
            <p style="margin: 5px 0; font-size:1.05em; line-height:1.6;">
                아래 계좌로 입금해 주시면 자동으로 충전 및 결제 완료 처리됩니다.
            </p>
            <ul style="list-style:none; padding-left:0; margin:10px 0 0 0; line-height:1.8;">
                <li>입금 계좌: <strong>카카오뱅크 3333-19-8058955 (예금주: 강호성)</strong></li>
                <li>입금 금액: <strong style="color:#e53e3e; font-size:1.15em;"><?php echo number_format($charge_amount); ?>원</strong></li>
                <li>입금자명: <strong><?php echo esc_html($sender); ?></strong></li>
            </ul>
        </div>
        <?php
    }
}

// =========================================================================
// WordPress Custom REST API Endpoint for n8n Matching
// =========================================================================

add_action( 'rest_api_init', 'avocadoss_register_deposit_webhook' );
function avocadoss_register_deposit_webhook() {
    register_rest_route( 'avocadoss/v1', '/deposit-webhook', array(
        'methods'             => 'POST',
        'callback'            => 'avocadoss_handle_deposit_webhook',
        'permission_callback' => 'avocadoss_verify_webhook_permission',
    ) );
}

function avocadoss_verify_webhook_permission( $request ) {
    $token = $request->get_header( 'X-Avocadoss-Key' );
    $expected_token = defined( 'AVOCADOSS_DEPOSIT_WEBHOOK_KEY' ) ? AVOCADOSS_DEPOSIT_WEBHOOK_KEY : ( getenv( 'AVOCADOSS_DEPOSIT_WEBHOOK_KEY' ) !== false ? getenv( 'AVOCADOSS_DEPOSIT_WEBHOOK_KEY' ) : '' );
    return $token === $expected_token;
}

function avocadoss_handle_deposit_webhook( $request ) {
    $params = $request->get_json_params();
    if ( empty( $params ) ) {
        $params = $request->get_body_params();
    }
    if ( empty( $params ) ) {
        $params = $_POST;
    }
    
    $raw_sender = isset( $params['sender'] ) ? $params['sender'] : '';
    $raw_amount = isset( $params['amount'] ) ? $params['amount'] : 0;
    
    $sender = trim( sanitize_text_field( $raw_sender ) );
    $amount = (int) preg_replace( '/[^0-9]/', '', $raw_amount );
    
    if ( empty( $sender ) || $amount <= 0 ) {
        return new WP_REST_Response( array( 'success' => false, 'message' => '입금자명 또는 금액이 유효하지 않습니다.' ), 400 );
    }
    
    // Find User
    $user_id = 0;
    
    // 1. Search by custom deposit name
    $users = get_users( array(
        'meta_key'   => '_deposit_name',
        'meta_value' => $sender,
        'number'     => 1
    ) );
    
    if ( ! empty( $users ) ) {
        $user_id = $users[0]->ID;
    } else {
        // 2. Search by billing first name
        $users = get_users( array(
            'meta_key'   => 'billing_first_name',
            'meta_value' => $sender,
            'number'     => 1
        ) );
        if ( ! empty( $users ) ) {
            $user_id = $users[0]->ID;
        } else {
            // 3. Search by display name
            $users = get_users( array(
                'search'         => $sender,
                'search_columns' => array( 'display_name' ),
                'number'         => 1
            ) );
            if ( ! empty( $users ) ) {
                $user_id = $users[0]->ID;
            }
        }
    }
    
    if ( ! $user_id ) {
        return new WP_REST_Response( array( 'success' => false, 'message' => sprintf( "'%s' 입금자명에 해당하는 가입 회원을 찾을 수 없습니다.", $sender ) ), 404 );
    }
    
    // Idempotency guard — atomic claim via unique option_name (prevents concurrent double-credit)
    $event_key = isset($params['event_id']) ? $params['event_id'] : hash('sha256', $sender . '|' . $amount . '|' . ($params['timestamp'] ?? $params['received_at'] ?? ''));
    $option_name = 'avocadoss_deposit_event_' . hash('sha256', $event_key);
    $claimed = add_option( $option_name, time(), '', false );
    if ( ! $claimed ) {
        return new WP_REST_Response( array( 'success' => true, 'message' => '이미 처리된 입금 이벤트입니다.', 'duplicate' => true ), 200 );
    }
    // Update points
    $points = (int) get_user_meta( $user_id, '_avocadoss_points', true );
    $new_points = $points + $amount;
    update_user_meta( $user_id, '_avocadoss_points', $new_points );
    
    // Match pending recharge requests
    $pending_requests = get_posts( array(
        'post_type'   => 'recharge_request',
        'meta_query'  => array(
            'relation' => 'AND',
            array(
                'key'   => '_user_id',
                'value' => $user_id,
            ),
            array(
                'key'   => '_amount',
                'value' => $amount,
            ),
            array(
                'key'   => '_status',
                'value' => 'pending',
            ),
        ),
        'posts_per_page' => 2,
    ) );
    $ambiguous_match = count($pending_requests) > 1;
    $request_matched = false;
    if ( ! $ambiguous_match && ! empty( $pending_requests ) ) {
        $req_post = $pending_requests[0];
        update_post_meta( $req_post->ID, '_status', 'completed' );
        wp_update_post( array(
            'ID'         => $req_post->ID,
            'post_title' => $req_post->post_title . ' [충전완료]',
        ) );
        $request_matched = true;
    }
    
    // =========================================================================
    // 추가: 주문 결제 연동 자동화 매칭 로직
    // =========================================================================
    $auto_paid_order = false;
    $related_order_id = 0;
    
    // 1단계: 이번 충전 신청과 연동된 주문 ID가 있는지 확인
    if ( $request_matched && ! empty( $pending_requests ) ) {
        $related_order_id = (int) get_post_meta( $pending_requests[0]->ID, '_related_order_id', true );
    }
    
    // 2단계: 연동된 주문 ID가 없으면, 해당 사용자의 대기 중인 충전 결제 주문이 있는지 직접 쿼리
    if ( ! $related_order_id ) {
        $unpaid_orders = wc_get_orders( array(
            'customer' => $user_id,
            'status'   => array( 'on-hold', 'pending' ),
            'meta_key' => '_needs_charge_payment',
            'meta_value' => 'yes',
            'limit'    => 1,
        ) );
        if ( ! empty( $unpaid_orders ) ) {
            $related_order_id = $unpaid_orders[0]->get_id();
        }
    }
    
    if ( $related_order_id ) {
        $order = wc_get_order( $related_order_id );
        if ( $order ) {
            $order_total = (int) $order->get_total();
            
            // 현재 사용자의 적립금 잔액 확인
            $current_points = (int) get_user_meta( $user_id, '_avocadoss_points', true );
            
            if ( $current_points >= $order_total ) {
                // 적립금 차감
                $final_points = $current_points - $order_total;
                update_user_meta( $user_id, '_avocadoss_points', $final_points );
                $new_points = $final_points; // 응답용 변수 업데이트
                
                // 주문 메타 갱신 및 결제 완료 처리
                $order->update_meta_data( '_needs_charge_payment', 'no' );
                $order->add_order_note( sprintf( '입금 확인으로 인한 충전금 자동 결제 완료 (차감액: %s원, 잔액: %s원)', number_format($order_total), number_format($final_points) ) );
                $order->payment_complete();
                $order->save();
                
                $auto_paid_order = true;
            }
        }
    }
    
    $user_info = get_userdata( $user_id );
    return new WP_REST_Response( array(
        'success'         => true,
        'message'         => sprintf( '%s 회원님께 %s원 충전 완료', $user_info->display_name, number_format($amount) ),
        'user_id'         => $user_id,
        'username'        => $user_info->user_login,
        'display_name'    => $user_info->display_name,
        'prev_points'     => $points,
        'new_points'      => $new_points,
        'request_matched' => $request_matched,
        'auto_paid_order' => $auto_paid_order,
        'related_order_id'=> $related_order_id
    ), 200 );
}

// P0 paid-order Telegram (payment_complete only — no early alerts)
add_action( 'woocommerce_payment_complete', 'avocadoss_send_paid_order_telegram', 20 );
function avocadoss_send_paid_order_telegram( $order_id ) {
    $order = wc_get_order( $order_id );
    if ( ! $order || $order->get_meta( '_whh_paid_telegram_sent_at' ) ) {
        return;
    }
    if ( ! function_exists( 'avocadoss_send_telegram_message' ) ) {
        return;
    }
    $message  = '✅ [결제완료] 새로운 주문이 결제 완료되었습니다.
';
    $message .= '주문번호: ' . $order->get_order_number() . '
';
    $message .= '주문금액: ' . wc_price( $order->get_total() ) . '
';
    $message .= '결제수단: ' . $order->get_payment_method_title() . '
';
    avocadoss_send_telegram_message( $message );
    $order->update_meta_data( '_whh_paid_telegram_sent_at', current_time( 'mysql', true ) );
    $order->save();
}

// 1) 가입폼에 사업자등록번호, 이름, 연락처, 사업장 주소(우편번호 + 기본주소 + 상세주소) 필드 추가
add_action( 'woocommerce_register_form', function() {
    ?>
    <p class="form-row form-row-wide">
        <label for="avo_business_number"><?php esc_html_e( '사업자등록번호', 'woocommerce' ); ?>&nbsp;<span class="required">*</span></label>
        <input type="text" class="woocommerce-Input woocommerce-Input--text input-text" name="avo_business_number" id="avo_business_number" placeholder="000-00-00000" value="<?php echo isset( $_POST['avo_business_number'] ) ? esc_attr( wp_unslash( $_POST['avo_business_number'] ) ) : ''; ?>" required />
    </p>
    <p class="form-row form-row-wide">
        <label for="avo_billing_first_name"><?php esc_html_e( '이름', 'woocommerce' ); ?>&nbsp;<span class="required">*</span></label>
        <input type="text" class="woocommerce-Input woocommerce-Input--text input-text" name="avo_billing_first_name" id="avo_billing_first_name" placeholder="이름을 입력하세요" value="<?php echo isset( $_POST['avo_billing_first_name'] ) ? esc_attr( wp_unslash( $_POST['avo_billing_first_name'] ) ) : ''; ?>" required />
    </p>
    <p class="form-row form-row-wide">
        <label for="avo_billing_phone"><?php esc_html_e( '연락처', 'woocommerce' ); ?>&nbsp;<span class="required">*</span></label>
        <input type="text" class="woocommerce-Input woocommerce-Input--text input-text" name="avo_billing_phone" id="avo_billing_phone" placeholder="예: 010-1234-5678" value="<?php echo isset( $_POST['avo_billing_phone'] ) ? esc_attr( wp_unslash( $_POST['avo_billing_phone'] ) ) : ''; ?>" required />
    </p>
    
    <!-- 우편번호 검색 필드 -->
    <p class="form-row form-row-wide" style="margin-bottom: 12px;">
        <label for="avo_billing_postcode"><?php esc_html_e( '우편번호', 'woocommerce' ); ?>&nbsp;<span class="required">*</span></label>
        <span style="display: flex; gap: 8px;">
            <input type="text" class="woocommerce-Input woocommerce-Input--text input-text" name="avo_billing_postcode" id="avo_billing_postcode" placeholder="우편번호" value="<?php echo isset( $_POST['avo_billing_postcode'] ) ? esc_attr( wp_unslash( $_POST['avo_billing_postcode'] ) ) : ''; ?>" style="background-color: #f7fafc; cursor: pointer; flex-grow: 1;" readonly required />
            <button type="button" class="button" id="avo_btn_postcode_search" style="padding: 0 16px; height: 42px; line-height: 42px; background-color: #1a202c; color: #fff; border: none; border-radius: 4px; font-weight: 600; cursor: pointer; font-size: 0.9em; transition: background-color 0.2s;">주소 검색</button>
        </span>
    </p>
    <p class="form-row form-row-wide" style="margin-bottom: 12px;">
        <label for="avo_billing_address"><?php esc_html_e( '사업장 주소', 'woocommerce' ); ?>&nbsp;<span class="required">*</span></label>
        <input type="text" class="woocommerce-Input woocommerce-Input--text input-text" name="avo_billing_address" id="avo_billing_address" placeholder="주소 검색 시 자동으로 입력됩니다." value="<?php echo isset( $_POST['avo_billing_address'] ) ? esc_attr( wp_unslash( $_POST['avo_billing_address'] ) ) : ''; ?>" style="background-color: #f7fafc; cursor: pointer;" readonly required />
    </p>
    <p class="form-row form-row-wide">
        <label for="avo_billing_address_detail"><?php esc_html_e( '상세 주소', 'woocommerce' ); ?>&nbsp;<span class="required">*</span></label>
        <input type="text" class="woocommerce-Input woocommerce-Input--text input-text" name="avo_billing_address_detail" id="avo_billing_address_detail" placeholder="상세 주소(동, 호수, 빌딩명 등)를 입력하세요" value="<?php echo isset( $_POST['avo_billing_address_detail'] ) ? esc_attr( wp_unslash( $_POST['avo_billing_address_detail'] ) ) : ''; ?>" required />
    </p>
    
    <p class="avo-register-note" style="font-size:0.9em;color:#718096;margin-top:10px;margin-bottom:15px;">가입 후 관리자 승인이 완료되어야 가격 확인 및 구매가 가능합니다.</p>
    
    <!-- Daum 우편번호 서비스 스크립트 및 트리거 JS -->
    <script src="//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js"></script>
    <script type="text/javascript">
        document.addEventListener('DOMContentLoaded', function() {
            var searchBtn = document.getElementById('avo_btn_postcode_search');
            var postcodeField = document.getElementById('avo_billing_postcode');
            var addressField = document.getElementById('avo_billing_address');
            
            function openDaumPostcode() {
                new daum.Postcode({
                    oncomplete: function(data) {
                        var addr = '';
                        if (data.userSelectedType === 'R') {
                            addr = data.roadAddress;
                        } else {
                            addr = data.jibunAddress;
                        }
                        
                        postcodeField.value = data.zonecode;
                        addressField.value = addr;
                        document.getElementById('avo_billing_address_detail').focus();
                    }
                }).open();
            }
            
            if (searchBtn) {
                searchBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    openDaumPostcode();
                });
            }
            if (postcodeField) {
                postcodeField.addEventListener('click', openDaumPostcode);
            }
            if (addressField) {
                addressField.addEventListener('click', openDaumPostcode);
            }
        });
    </script>
    <?php
} );

// 2) 가입 시 필수 입력 + 형식 검증
add_filter( 'woocommerce_registration_errors', function( $errors, $username, $email ) {
    $biz = isset( $_POST['avo_business_number'] ) ? trim( wp_unslash( $_POST['avo_business_number'] ) ) : '';
    $name = isset( $_POST['avo_billing_first_name'] ) ? trim( wp_unslash( $_POST['avo_billing_first_name'] ) ) : '';
    $phone = isset( $_POST['avo_billing_phone'] ) ? trim( wp_unslash( $_POST['avo_billing_phone'] ) ) : '';
    $postcode = isset( $_POST['avo_billing_postcode'] ) ? trim( wp_unslash( $_POST['avo_billing_postcode'] ) ) : '';
    $address = isset( $_POST['avo_billing_address'] ) ? trim( wp_unslash( $_POST['avo_billing_address'] ) ) : '';
    $detail = isset( $_POST['avo_billing_address_detail'] ) ? trim( wp_unslash( $_POST['avo_billing_address_detail'] ) ) : '';
    
    $password = isset( $_POST['password'] ) ? $_POST['password'] : '';
    $password_confirm = isset( $_POST['password_confirm'] ) ? $_POST['password_confirm'] : '';
    
    if ( empty( $password ) ) {
        $errors->add( 'password_error', '비밀번호를 입력해주세요.' );
    }
    if ( empty( $password_confirm ) ) {
        $errors->add( 'password_confirm_error', '비밀번호 확인을 입력해주세요.' );
    } elseif ( $password !== $password_confirm ) {
        $errors->add( 'password_mismatch_error', '입력하신 두 비밀번호가 일치하지 않습니다.' );
    }
    
    if ( '' === $biz ) {
        $errors->add( 'avo_business_number_error', '사업자등록번호를 입력해주세요.' );
    } elseif ( ! preg_match( '/^[0-9\-]{10,}$/', $biz ) ) {
        $errors->add( 'avo_business_number_error', '사업자등록번호 형식이 올바르지 않습니다.' );
    }
    if ( '' === $name ) {
        $errors->add( 'avo_billing_first_name_error', '이름을 입력해주세요.' );
    }
    if ( '' === $phone ) {
        $errors->add( 'avo_billing_phone_error', '연락처를 입력해주세요.' );
    }
    if ( '' === $postcode ) {
        $errors->add( 'avo_billing_postcode_error', '우편번호를 입력해주세요.' );
    }
    if ( '' === $address ) {
        $errors->add( 'avo_billing_address_error', '사업장 주소를 입력해주세요.' );
    }
    if ( '' === $detail ) {
        $errors->add( 'avo_billing_address_detail_error', '상세 주소를 입력해주세요.' );
    }
    return $errors;
}, 10, 3 );

// 3) 가입 완료 시 메타 저장 + 승인대기 상태 부여 + 관리자에게 승인메일 발송
add_action( 'woocommerce_created_customer', function( $customer_id, $new_customer_data, $password_generated ) {
    $biz = isset( $_POST['avo_business_number'] ) ? sanitize_text_field( wp_unslash( $_POST['avo_business_number'] ) ) : '';
    $name = isset( $_POST['avo_billing_first_name'] ) ? sanitize_text_field( wp_unslash( $_POST['avo_billing_first_name'] ) ) : '';
    $phone = isset( $_POST['avo_billing_phone'] ) ? sanitize_text_field( wp_unslash( $_POST['avo_billing_phone'] ) ) : '';
    $postcode = isset( $_POST['avo_billing_postcode'] ) ? sanitize_text_field( wp_unslash( $_POST['avo_billing_postcode'] ) ) : '';
    $address = isset( $_POST['avo_billing_address'] ) ? sanitize_text_field( wp_unslash( $_POST['avo_billing_address'] ) ) : '';
    $detail = isset( $_POST['avo_billing_address_detail'] ) ? sanitize_text_field( wp_unslash( $_POST['avo_billing_address_detail'] ) ) : '';
    
    update_user_meta( $customer_id, '_avo_business_number', $biz );
    update_user_meta( $customer_id, 'billing_first_name', $name );
    update_user_meta( $customer_id, 'first_name', $name );
    update_user_meta( $customer_id, 'billing_phone', $phone );
    update_user_meta( $customer_id, 'billing_postcode', $postcode );
    update_user_meta( $customer_id, 'billing_address_1', $address );
    update_user_meta( $customer_id, 'billing_address_2', $detail );
    update_user_meta( $customer_id, 'billing_country', 'KR' );
    update_user_meta( $customer_id, '_avo_approval_status', 'pending' );
    
    avo_send_approval_request_email( $customer_id );
}, 10, 3 );

// 이메일 원클릭 승인/거부용 토큰
function avo_approval_token( $user_id, $action ) {
    return substr( wp_hash( $user_id . '|' . $action . '|' . wp_salt( 'avo_approval' ) ), 0, 24 );
}

function avo_send_approval_request_email( $user_id ) {
    $user = get_user_by( 'id', $user_id );
    if ( ! $user ) {
        return;
    }
    $biz         = get_user_meta( $user_id, '_avo_business_number', true );
    $name        = get_user_meta( $user_id, 'billing_first_name', true );
    $phone       = get_user_meta( $user_id, 'billing_phone', true );
    
    $postcode    = get_user_meta( $user_id, 'billing_postcode', true );
    $address_1   = get_user_meta( $user_id, 'billing_address_1', true );
    $address_2   = get_user_meta( $user_id, 'billing_address_2', true );
    $address     = '[' . $postcode . '] ' . $address_1 . ' ' . $address_2;

    $approve_url = add_query_arg( array(
        'avo_action' => 'approve',
        'user'       => $user_id,
        'token'      => avo_approval_token( $user_id, 'approve' ),
    ), home_url( '/' ) );
    $reject_url  = add_query_arg( array(
        'avo_action' => 'reject',
        'user'       => $user_id,
        'token'      => avo_approval_token( $user_id, 'reject' ),
    ), home_url( '/' ) );

    $subject = '[도매허브] 신규 회원가입 승인 요청: ' . $user->user_email;
    $body  = "신규 회원가입이 있습니다.

";
    $body .= '이름: ' . $name . "
";
    $body .= '이메일: ' . $user->user_email . "
";
    $body .= '연락처: ' . $phone . "
";
    $body .= '사업장 주소: ' . $address . "
";
    $body .= '사업자등록번호: ' . $biz . "

";
    $body .= "아래 버튼을 눌러 바로 승인/거부할 수 있습니다 (로그인 불필요).

";
    $body .= '▶ 승인하기: ' . $approve_url . "
";
    $body .= '▶ 거부하기: ' . $reject_url . "
";

    $mail_result = wp_mail( 'tnfwod@naver.com', $subject, $body );
    error_log('AVO_DEBUG: sent approval mail to tnfwod@naver.com, result=' . ($mail_result ? 'SUCCESS' : 'FAIL'));
}

// 4) 이메일/관리자 페이지 공용 원클릭 승인·거부 처리 (토큰 인증, 로그인 불필요)
add_action( 'init', function() {
    if ( empty( $_GET['avo_action'] ) || empty( $_GET['user'] ) || empty( $_GET['token'] ) ) {
        return;
    }
    $action  = sanitize_text_field( wp_unslash( $_GET['avo_action'] ) );
    $user_id = absint( $_GET['user'] );
    $token   = sanitize_text_field( wp_unslash( $_GET['token'] ) );

    if ( ! in_array( $action, array( 'approve', 'reject' ), true ) ) {
        return;
    }
    if ( ! hash_equals( avo_approval_token( $user_id, $action ), $token ) ) {
        wp_die( '유효하지 않거나 만료된 링크입니다.' );
    }
    $user = get_user_by( 'id', $user_id );
    if ( ! $user ) {
        wp_die( '회원을 찾을 수 없습니다.' );
    }

    if ( 'approve' === $action ) {
        update_user_meta( $user_id, '_avo_approval_status', 'approved' );
        wp_mail(
            $user->user_email,
            '[도매허브] 회원가입이 승인되었습니다',
            "안녕하세요,

회원가입이 승인되었습니다. 로그인 후 가격 확인 및 구매가 가능합니다.

" . wc_get_page_permalink( 'myaccount' )
        );
        wp_die( '<h2>승인 완료</h2><p>' . esc_html( $user->user_email ) . ' 님의 가입을 승인했습니다.</p>', '승인 완료' );
    } else {
        update_user_meta( $user_id, '_avo_approval_status', 'rejected' );
        wp_mail(
            $user->user_email,
            '[도매허브] 회원가입이 거부되었습니다',
            "안녕하세요,

죄송합니다. 회원가입 신청이 거부되었습니다.

문의: tnfwod@naver.com"
        );
        wp_die( '<h2>거부 처리 완료</h2><p>' . esc_html( $user->user_email ) . ' 님의 가입을 거부했습니다.</p>', '거부 완료' );
    }
}, 1 );

// 5) wp-admin 회원목록에 B2B 가입정보(승인상태, 사업자번호, 이름, 연락처, 주소) 컬럼 추가
add_filter( 'manage_users_columns', function( $columns ) {
    $columns['avo_approval'] = '승인 상태';
    $columns['avo_name'] = '이름';
    $columns['avo_phone'] = '연락처';
    $columns['avo_business_number'] = '사업자등록번호';
    $columns['avo_address'] = '사업장 주소';
    return $columns;
} );

add_filter( 'manage_users_custom_column', function( $value, $column_name, $user_id ) {
    switch ( $column_name ) {
        case 'avo_approval':
            $status = get_user_meta( $user_id, '_avo_approval_status', true );
            if ( '' === $status ) {
                return '-';
            }
            $labels = array(
                'pending'  => '⏳ 대기중',
                'approved' => '✅ 승인됨',
                'rejected' => '❌ 거부됨',
            );
            $label = isset( $labels[ $status ] ) ? $labels[ $status ] : $status;
            
            $approve_url = add_query_arg( array(
                'avo_action' => 'approve',
                'user'       => $user_id,
                'token'      => avo_approval_token( $user_id, 'approve' ),
            ), home_url( '/' ) );
            $reject_url  = add_query_arg( array(
                'avo_action' => 'reject',
                'user'       => $user_id,
                'token'      => avo_approval_token( $user_id, 'reject' ),
            ), home_url( '/' ) );
            
            if ( 'pending' === $status ) {
                return $label . ' | <a href="' . esc_url( $approve_url ) . '" style="color:#38a169;font-weight:bold;">[승인]</a> <a href="' . esc_url( $reject_url ) . '" style="color:#e53e3e;font-weight:bold;">[거부]</a>';
            } elseif ( 'rejected' === $status ) {
                return $label . ' | <a href="' . esc_url( $approve_url ) . '" style="color:#38a169;font-weight:bold;">[다시 승인]</a>';
            }
            return $label;
            
        case 'avo_name':
            return esc_html( get_user_meta( $user_id, 'billing_first_name', true ) );
            
        case 'avo_phone':
            return esc_html( get_user_meta( $user_id, 'billing_phone', true ) );
            
        case 'avo_business_number':
            return esc_html( get_user_meta( $user_id, '_avo_business_number', true ) );
            
        case 'avo_address':
            $postcode  = get_user_meta( $user_id, 'billing_postcode', true );
            $address_1 = get_user_meta( $user_id, 'billing_address_1', true );
            $address_2 = get_user_meta( $user_id, 'billing_address_2', true );
            if ( ! $postcode && ! $address_1 ) {
                return '-';
            }
            return esc_html( '[' . $postcode . '] ' . $address_1 . ' ' . $address_2 );
            
        default:
            return $value;
    }
}, 10, 3 );

// 6) 가격/구매 가능 여부 판단 헬퍼
function avo_can_see_price() { error_log('AVO_DEBUG uid=' . get_current_user_id() . ' logged_in=' . (is_user_logged_in()?1:0) . ' status=' . get_user_meta(get_current_user_id(), '_avo_approval_status', true));
    if ( ! is_user_logged_in() ) {
        return false;
    }
    return 'approved' === get_user_meta( get_current_user_id(), '_avo_approval_status', true );
}

// 7) 미승인/비회원에게는 가격 숨기고 로그인 안내 표시
add_filter( 'woocommerce_get_price_html', function( $price_html, $product ) {
    if ( avo_can_see_price() ) {
        return $price_html;
    }
    return '<a class="avo-price-locked" href="' . esc_url( wc_get_page_permalink( 'myaccount' ) ) . '">로그인 후 가격 확인 가능</a>';
}, 10, 2 );

// 8) 미승인/비회원은 구매 불가 처리 (장바구니/결제 차단, 다중 방어)
add_filter( 'woocommerce_is_purchasable', function( $purchasable, $product ) {
    return avo_can_see_price() ? $purchasable : false;
}, 10, 2 );

add_filter( 'woocommerce_variation_is_purchasable', function( $purchasable, $variation ) {
    return avo_can_see_price() ? $purchasable : false;
}, 10, 2 );

add_filter( 'woocommerce_add_to_cart_validation', function( $passed, $product_id ) {
    if ( ! avo_can_see_price() ) {
        wc_add_notice( '로그인 후 승인된 회원만 구매할 수 있습니다.', 'error' );
        return false;
    }
    return $passed;
}, 10, 2 );

add_action( 'woocommerce_checkout_process', function() {
    if ( ! avo_can_see_price() ) {
        wc_add_notice( '로그인 후 승인된 회원만 결제할 수 있습니다.', 'error' );
    }
} );

// 9) 비승인 고객 안내 배너 (상점/상품 페이지)
add_action( 'woocommerce_before_shop_loop', 'avo_price_lock_notice' );
add_action( 'woocommerce_before_single_product', 'avo_price_lock_notice' );
function avo_price_lock_notice() {
    if ( avo_can_see_price() ) {
        return;
    }
    if ( is_user_logged_in() ) {
        $status = get_user_meta( get_current_user_id(), '_avo_approval_status', true );
        if ( 'rejected' === $status ) {
            echo '<div class="woocommerce-info">가입이 거부되었습니다. 문의: tnfwod@naver.com</div>';
        } else {
            echo '<div class="woocommerce-info">가입 승인 대기중입니다. 승인 후 가격 확인 및 구매가 가능합니다.</div>';
        }
    } else {
        echo '<div class="woocommerce-info">가격 확인 및 구매는 회원가입(사업자등록번호 필요) 후 관리자 승인을 받아야 가능합니다. <a href="' . esc_url( wc_get_page_permalink( 'myaccount' ) ) . '">회원가입 / 로그인</a></div>';
    }
}

// =========================================================================
// 운송장 번호 입력 + 고객용 배송 추적 (스마트택배 통합조회: tracker.delivery)
// =========================================================================
function wh_carrier_registry() {
    return array(
        'cj' => array(
            'label' => 'CJ대한통운',
            'aliases' => array('CJ대한통운','CJ택배','CJ','대한통운','CJ Logistics','CJ대한통운택배','cj대한통운','04'),
            'mode' => 'direct',
            'url' => 'https://www.cjlogistics.com/ko/tool/parcel/tracking?gnbInvcNo={TRACKING}',
            'domain' => 'cjlogistics.com',
        ),
        'lotte' => array(
            'label' => '롯데택배',
            'aliases' => array('롯데택배','롯데글로벌로지스','롯데','Lotte','Lotte Global Logistics','롯데글로벌','08'),
            'mode' => 'direct',
            'url' => 'https://www.lotteglogis.com/open/tracking?invno={TRACKING}',
            'domain' => 'lotteglogis.com',
        ),
        'hanjin' => array(
            'label' => '한진택배',
            'aliases' => array('한진','한진택배','HANJIN','hanjin','05'),
            'mode' => 'direct',
            'url' => 'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnum={TRACKING}&wblnumText=',
            'domain' => 'hanjin.com',
        ),
        'logen' => array(
            'label' => '로젠택배',
            'aliases' => array('로젠','로젠택배','LOGEN','logen','로젠물류','06'),
            'mode' => 'direct',
            'url' => 'https://www.ilogen.com/web/personal/trace?slipno={TRACKING}',
            'domain' => 'ilogen.com',
        ),
        'epost' => array(
            'label' => '우체국택배',
            'aliases' => array('우체국','우체국택배','우체국소포','우편','ePost','EPOST','우체국택배(소포)','01'),
            'mode' => 'direct',
            'url' => 'https://service.epost.go.kr/trace.RetrieveRegiPrclDeliv.postal?sid1={TRACKING}',
            'domain' => 'epost.go.kr',
        ),
        'kyungdong' => array(
            'label' => '경동택배',
            'aliases' => array('경동','경동택배','경동화물','KYUNGDONG'),
            'mode' => 'landing',
            'url' => 'https://www.kdexp.com/h/EMS/ETrackingInfo?trackNo={TRACKING}',
            'domain' => 'kdexp.com',
        ),
        'daesin' => array(
            'label' => '대신택배',
            'aliases' => array('대신','대신택배','대신정기화물','DAESIN'),
            'mode' => 'landing',
            'url' => 'https://www.daesinlogistics.co.kr/',
            'domain' => 'daesinlogistics.co.kr',
        ),
        'hapdong' => array(
            'label' => '합동택배',
            'aliases' => array('합동','합동택배','합동화물','HAPDONG'),
            'mode' => 'landing',
            'url' => 'https://www.hdexp.co.kr/',
            'domain' => 'hdexp.co.kr',
        ),
        'chunil' => array(
            'label' => '천일택배',
            'aliases' => array('천일','천일택배','천일정기화물','CHUNIL'),
            'mode' => 'landing',
            'url' => 'https://www.chunil.co.kr/',
            'domain' => 'chunil.co.kr',
        ),
        'ilyang' => array(
            'label' => '일양로지스',
            'aliases' => array('일양','일양택배','일양로지스','ILyang','ILYANG'),
            'mode' => 'direct',
            'url' => 'https://www.ilyanglogis.co.kr/page/TrackingResult.do?blNum={TRACKING}&trackingType=0',
            'domain' => 'ilyanglogis.co.kr',
        ),
        'dhl' => array(
            'label' => 'DHL',
            'aliases' => array('DHL','dhl'),
            'mode' => 'direct',
            'url' => 'https://www.dhl.com/kr-ko/home/tracking.html?tracking-id={TRACKING}',
            'domain' => 'dhl.com',
        ),
    );
}

function wh_normalize_carrier_name($carrier) {
    $raw = trim((string) $carrier);
    if ($raw === '') return '';
    $raw = preg_replace('/\s+/u', '', $raw);
    foreach (wh_carrier_registry() as $key => $info) {
        $aliases = array_merge(array($info['label']), $info['aliases']);
        foreach ($aliases as $alias) {
            if (strcasecmp($raw, preg_replace('/\s+/u', '', $alias)) === 0) {
                return $key;
            }
        }
    }
    return '';
}

function wh_get_tracking_url($carrier, $tracking_number) {
    $key = wh_normalize_carrier_name($carrier);
    if ($key === '') return null;
    $info = wh_carrier_registry()[$key];
    $tn = trim((string) $tracking_number);
    $tn = str_replace(array('-', ' '), '', $tn);
    if ($tn === '' || !preg_match('/^[0-9A-Za-z]+$/', $tn)) return null;
    if ($info['mode'] === 'direct') {
        return str_replace('{TRACKING}', rawurlencode($tn), $info['url']);
    }
    return str_replace('{TRACKING}', rawurlencode($tn), $info['url']);
}

function avo_carrier_list() {
    $list = array();
    foreach (wh_carrier_registry() as $key => $info) {
        $list[$key] = $info['label'];
    }
    return $list;
}

add_action( 'woocommerce_admin_order_data_after_shipping_address', function( $order ) {
    $carrier  = $order->get_meta( '_avo_carrier' );
    $tracking = $order->get_meta( '_avo_tracking_number' );
    ?>
    <div class="avo-tracking-fields" style="margin-top:10px;border-top:1px solid #eee;padding-top:10px;">
        <p><strong>배송 추적 정보</strong></p>
        <p class="form-field">
            <label for="avo_carrier">택배사</label>
            <select name="avo_carrier" id="avo_carrier" style="width:100%;">
                <option value="">선택</option>
                <?php foreach ( avo_carrier_list() as $code => $name ) : ?>
                    <option value="<?php echo esc_attr( $code ); ?>" <?php selected( $carrier, $code ); ?>><?php echo esc_html( $name ); ?></option>
                <?php endforeach; ?>
            </select>
        </p>
        <p class="form-field">
            <label for="avo_tracking_number">운송장 번호</label>
            <input type="text" name="avo_tracking_number" id="avo_tracking_number" value="<?php echo esc_attr( $tracking ); ?>" style="width:100%;" />
        </p>
    </div>
    <?php
} );

add_action( 'woocommerce_process_shop_order_meta', function( $order_id ) {
    $order = wc_get_order( $order_id );
    if ( ! $order ) {
        return;
    }
    $new_tracking = isset( $_POST['avo_tracking_number'] ) ? sanitize_text_field( wp_unslash( $_POST['avo_tracking_number'] ) ) : '';
    $new_carrier  = isset( $_POST['avo_carrier'] ) ? sanitize_text_field( wp_unslash( $_POST['avo_carrier'] ) ) : '';
    $old_tracking = $order->get_meta( '_avo_tracking_number' );

    $order->update_meta_data( '_avo_carrier', $new_carrier );
    $order->update_meta_data( '_avo_tracking_number', $new_tracking );
    $order->save();

    if ( $new_tracking && $new_tracking !== $old_tracking ) {
        avo_send_tracking_email( $order, $new_carrier, $new_tracking );
    }
} );

function avo_tracking_url( $carrier_code, $tracking_number ) {
    $url = wh_get_tracking_url( $carrier_code, $tracking_number );
    if ( $url !== null ) {
        return $url;
    }
    return '';
}

function avo_send_tracking_email( $order, $carrier_code, $tracking_number ) {
    $carriers     = avo_carrier_list();
    $carrier_name = isset( $carriers[ $carrier_code ] ) ? $carriers[ $carrier_code ] : '택배사';
    $url          = avo_tracking_url( $carrier_code, $tracking_number );
    $subject      = '[도매허브] 주문 #' . $order->get_order_number() . ' 발송 안내';
    $body  = $order->get_billing_first_name() . "님, 주문하신 상품이 발송되었습니다.\n\n";
    $body .= '택배사: ' . $carrier_name . "\n";
    $body .= '운송장 번호: ' . $tracking_number . "\n";
    $body .= '배송 조회: ' . $url . "\n";
    wp_mail( $order->get_billing_email(), $subject, $body );
}

// 고객 주문상세 페이지에 배송조회 버튼 노출
add_action( 'woocommerce_order_details_after_order_table', function( $order ) {
    $carrier  = $order->get_meta( '_avo_carrier' );
    $tracking = $order->get_meta( '_avo_tracking_number' );
    if ( ! $tracking ) {
        return;
    }
    $carriers     = avo_carrier_list();
    $carrier_name = isset( $carriers[ $carrier ] ) ? $carriers[ $carrier ] : '택배사';
    $url          = avo_tracking_url( $carrier, $tracking );
    echo '<div class="avo-tracking-box" style="margin:20px 0;padding:16px;background:#F0FFF4;border:1px solid #4A7C40;border-radius:8px;">';
    echo '<p style="margin-top:0;"><strong>배송 정보</strong></p>';
    echo '<p>' . esc_html( $carrier_name ) . ' / 운송장번호: ' . esc_html( $tracking ) . '</p>';
    echo '<p style="margin-bottom:0;"><a href="' . esc_url( $url ) . '" target="_blank" rel="noopener" style="display:inline-block;background:#4A7C40;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">배송 조회하기</a></p>';
    echo '</div>';
} );

// =========================================================================
// 주문번호 자동 생성 (사람이 읽기 쉬운 형식, 주문 생성 시 1회만 부여)
// =========================================================================
add_action( 'woocommerce_checkout_order_processed', function( $order_id ) {
    $order = wc_get_order( $order_id );
    if ( ! $order || $order->get_meta( '_avo_order_no' ) ) {
        return;
    }
    $formatted = 'ORD-' . $order->get_date_created()->date( 'Ymd' ) . '-' . str_pad( $order_id, 4, '0', STR_PAD_LEFT );
    $order->update_meta_data( '_avo_order_no', $formatted );
    $order->save();
}, 20 );

add_filter( 'woocommerce_order_number', function( $order_number, $order ) {
    $formatted = $order->get_meta( '_avo_order_no' );
    return $formatted ? $formatted : $order_number;
}, 10, 2 );

add_action('wp_footer', function(){
    echo '<!-- AVO_DEBUG_MARKER uid=' . get_current_user_id() . ' logged_in=' . (is_user_logged_in()?1:0) . ' approval=' . get_user_meta(get_current_user_id(), '_avo_approval_status', true) . ' can_see=' . (avo_can_see_price()?1:0) . ' -->';
}, 999);

// =========================================================================
// 쿠폰 기능 비활성화 (Disable Coupons)
// =========================================================================
add_filter( 'woocommerce_coupons_enabled', '__return_false', 9999 );


// =========================================================================
// B2B 관리자 대시보드 (B2B Admin Dashboard)
// =========================================================================

add_action('init', 'avo_admin_dashboard_router');
function avo_admin_dashboard_router() {
    $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    if (rtrim($path, '/') !== '/admin-dashboard') {
        return;
    }
    
    // 1. Session & Auth Cookie check
    $token_cookie_name = 'avo_admin_session';
    $secret_token = md5('tnfwod:90051ukk**:avocadoss_salt_1298');
    $is_authenticated = false;
    
    if (isset($_COOKIE[$token_cookie_name]) && $_COOKIE[$token_cookie_name] === $secret_token) {
        $is_authenticated = true;
    }
    
    // Handle Logout
    if (isset($_GET['action']) && $_GET['action'] === 'logout') {
        setcookie($token_cookie_name, '', time() - 3600, '/');
        header('Location: /admin-dashboard');
        exit;
    }
    
    // Handle Login Post
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action']) && $_POST['action'] === 'login') {
        $username = isset($_POST['username']) ? trim($_POST['username']) : '';
        $password = isset($_POST['password']) ? trim($_POST['password']) : '';
        
        if ($username === 'tnfwod' && $password === '90051ukk**') {
            setcookie($token_cookie_name, $secret_token, time() + 86400 * 7, '/');
            header('Location: /admin-dashboard');
            exit;
        } else {
            $GLOBALS['avo_login_error'] = '아이디 또는 비밀번호가 올바르지 않습니다.';
        }
    }
    
    // Render Login Page if not authenticated
    if (!$is_authenticated) {
        avo_render_admin_login_page();
        exit;
    }
    
    // Handle API requests if authenticated
    if (isset($_GET['api'])) {
        avo_handle_admin_api($_GET['api']);
        exit;
    }
    
    // Render Dashboard HTML
    avo_render_admin_dashboard_page();
    exit;
}

function avo_handle_admin_api($api) {
    header('Content-Type: application/json; charset=utf-8');
    
    switch ($api) {
        case 'stats':
            // Fetch WooCommerce orders
            $orders = wc_get_orders(array(
                'limit' => -1,
                'status' => array('wc-processing', 'wc-completed', 'wc-on-hold')
            ));
            
            $total_orders = count($orders);
            
            $total_revenue = 0;
            $today_revenue = 0;
            $month_revenue = 0;
            
            $today_start = strtotime('today midnight');
            $month_start = strtotime('first day of this month midnight');
            
            $daily_sales = array();
            $monthly_sales = array();
            
            // Initialize last 15 days
            for ($i = 14; $i >= 0; $i--) {
                $date_str = date('Y-m-d', strtotime("-$i days"));
                $daily_sales[$date_str] = 0;
            }
            
            // Initialize last 6 months
            for ($i = 5; $i >= 0; $i--) {
                $month_str = date('Y-m', strtotime("-$i months"));
                $monthly_sales[$month_str] = 0;
            }
            
            foreach ($orders as $order) {
                $total = (float)$order->get_total();
                $total_revenue += $total;
                
                $created_time = $order->get_date_created()->getTimestamp();
                
                if ($created_time >= $today_start) {
                    $today_revenue += $total;
                }
                
                if ($created_time >= $month_start) {
                    $month_revenue += $total;
                }
                
                // Add to daily sales
                $day_key = date('Y-m-d', $created_time);
                if (isset($daily_sales[$day_key])) {
                    $daily_sales[$day_key] += $total;
                }
                
                // Add to monthly sales
                $month_key = date('Y-m', $created_time);
                if (isset($monthly_sales[$month_key])) {
                    $monthly_sales[$month_key] += $total;
                }
            }
            
            // Get user count (customers)
            $users = get_users(array('role__not_in' => array('administrator')));
            $total_members = count($users);
            
            echo json_encode(array(
                'success' => true,
                'overview' => array(
                    'total_revenue' => $total_revenue,
                    'today_revenue' => $today_revenue,
                    'month_revenue' => $month_revenue,
                    'total_orders' => $total_orders,
                    'total_members' => $total_members
                ),
                'charts' => array(
                    'daily' => array(
                        'labels' => array_keys($daily_sales),
                        'data' => array_values($daily_sales)
                    ),
                    'monthly' => array(
                        'labels' => array_keys($monthly_sales),
                        'data' => array_values($monthly_sales)
                    )
                )
            ));
            break;
            
        case 'top_products':
            $orders = wc_get_orders(array(
                'limit' => -1,
                'status' => array('wc-processing', 'wc-completed', 'wc-on-hold')
            ));
            
            $product_sales = array();
            foreach ($orders as $order) {
                foreach ($order->get_items() as $item_id => $item) {
                    $product_id = $item->get_product_id();
                    $name = $item->get_name();
                    $quantity = (int)$item->get_quantity();
                    $total = (float)$item->get_total();
                    
                    if (!isset($product_sales[$product_id])) {
                        $product_sales[$product_id] = array(
                            'id' => $product_id,
                            'name' => $name,
                            'qty' => 0,
                            'total' => 0.0
                        );
                    }
                    $product_sales[$product_id]['qty'] += $quantity;
                    $product_sales[$product_id]['total'] += $total;
                }
            }
            
            usort($product_sales, function($a, $b) {
                return $b['qty'] - $a['qty'];
            });
            
            echo json_encode(array(
                'success' => true,
                'products' => array_slice($product_sales, 0, 10)
            ));
            break;
            
        case 'members':
            $users = get_users(array(
                'role__not_in' => array('administrator')
            ));
            
            $member_list = array();
            foreach ($users as $user) {
                $user_orders = wc_get_orders(array(
                    'limit' => -1,
                    'customer' => $user->ID,
                    'status' => array('wc-processing', 'wc-completed', 'wc-on-hold')
                ));
                
                $total_spent = 0;
                foreach ($user_orders as $o) {
                    $total_spent += (float)$o->get_total();
                }
                
                $approval_status = get_user_meta($user->ID, '_avo_approval_status', true);
                if (!$approval_status) {
                    $approval_status = 'pending';
                }
                
                $member_list[] = array(
                    'id' => $user->ID,
                    'username' => $user->user_login,
                    'email' => $user->user_email,
                    'billing_name' => get_user_meta($user->ID, 'billing_first_name', true) ?: $user->display_name,
                    'phone' => get_user_meta($user->ID, 'billing_phone', true) ?: '',
                    'registered' => date('Y-m-d', strtotime($user->user_registered)),
                    'approval_status' => $approval_status,
                    'order_count' => count($user_orders),
                    'total_spent' => $total_spent
                );
            }
            
            echo json_encode(array(
                'success' => true,
                'members' => $member_list
            ));
            break;
            
        case 'approve_member':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                echo json_encode(array('success' => false, 'message' => 'Invalid request method'));
                break;
            }
            
            $user_id = isset($_POST['user_id']) ? (int)$_POST['user_id'] : 0;
            $status = isset($_POST['status']) ? trim($_POST['status']) : '';
            
            if (!$user_id || !in_array($status, array('approved', 'pending', 'rejected'))) {
                echo json_encode(array('success' => false, 'message' => 'Invalid parameters'));
                break;
            }
            
            update_user_meta($user_id, '_avo_approval_status', $status);
            
            echo json_encode(array(
                'success' => true,
                'message' => '상태가 성공적으로 변경되었습니다.'
            ));
            break;
            
        case 'member_orders':
            $user_id = isset($_GET['user_id']) ? (int)$_GET['user_id'] : 0;
            if (!$user_id) {
                echo json_encode(array('success' => false, 'message' => 'Missing user ID'));
                break;
            }
            
            $orders = wc_get_orders(array(
                'limit' => -1,
                'customer' => $user_id
            ));
            
            $order_list = array();
            foreach ($orders as $order) {
                $items = array();
                foreach ($order->get_items() as $item) {
                    $items[] = $item->get_name() . ' x ' . $item->get_quantity();
                }
                
                $order_list[] = array(
                    'id' => $order->get_id(),
                    'number' => $order->get_order_number(),
                    'date' => $order->get_date_created()->date('Y-m-d H:i'),
                    'status' => $order->get_status(),
                    'total' => (float)$order->get_total(),
                    'payment' => $order->get_payment_method_title(),
                    'items' => implode(', ', $items)
                );
            }
            
            echo json_encode(array(
                'success' => true,
                'orders' => $order_list
            ));
            break;
            
        case 'orders':
            $date = isset($_GET['date']) ? trim($_GET['date']) : date('Y-m-d');
            $orders = wc_get_orders(array(
                'limit' => -1,
                'date_created' => $date . ' 00:00:00...' . $date . ' 23:59:59',
                'orderby' => 'date',
                'order' => 'DESC'
            ));
            
            $day_revenue = 0;
            $order_list = array();
            foreach ($orders as $order) {
                $items = array();
                foreach ($order->get_items() as $item) {
                    $items[] = $item->get_name() . ' x ' . $item->get_quantity();
                }
                
                $total = (float)$order->get_total();
                $day_revenue += $total;
                
                $order_list[] = array(
                    'id' => $order->get_id(),
                    'number' => $order->get_order_number(),
                    'date' => $order->get_date_created()->date('Y-m-d H:i'),
                    'billing_name' => $order->get_billing_first_name() ?: '비회원',
                    'status' => $order->get_status(),
                    'total' => $total,
                    'payment' => $order->get_payment_method_title(),
                    'items' => implode(', ', $items)
                );
            }
            
            echo json_encode(array(
                'success' => true,
                'date' => $date,
                'summary' => array(
                    'total_orders' => count($order_list),
                    'total_revenue' => $day_revenue
                ),
                'orders' => $order_list
            ));
            break;
            
        default:
            echo json_encode(array('success' => false, 'message' => 'Unknown API endpoint'));
            break;
    }
}

function avo_render_admin_login_page() {
    $error = isset($GLOBALS['avo_login_error']) ? $GLOBALS['avo_login_error'] : '';
    ?>
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>도매허브 Admin Login</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Inter:wght@300;400;500;700&display=swap" rel="stylesheet">
        <style>
            :root {
                --bg-gradient: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #022c22 100%);
                --card-bg: rgba(30, 41, 59, 0.45);
                --card-border: rgba(255, 255, 255, 0.08);
                --text-primary: #f8fafc;
                --text-secondary: #94a3b8;
                --accent: #10b981;
                --accent-hover: #059669;
                --input-bg: rgba(15, 23, 42, 0.6);
            }

            * {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
            }

            body {
                font-family: 'Inter', sans-serif;
                background: var(--bg-gradient);
                color: var(--text-primary);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
            }

            .orb {
                position: absolute;
                border-radius: 50%;
                filter: blur(80px);
                z-index: 1;
                opacity: 0.15;
            }
            .orb-1 {
                top: -10%;
                left: -10%;
                width: 50vw;
                height: 50vw;
                background: #4f46e5;
            }
            .orb-2 {
                bottom: -10%;
                right: -10%;
                width: 45vw;
                height: 45vw;
                background: #10b981;
            }

            .login-container {
                position: relative;
                z-index: 10;
                width: 100%;
                max-width: 450px;
                padding: 20px;
                animation: fadeIn 0.8s cubic-bezier(0.16, 1, 0.3, 1);
            }

            .login-card {
                background: var(--card-bg);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid var(--card-border);
                border-radius: 24px;
                padding: 40px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.3);
            }

            .logo-header {
                text-align: center;
                margin-bottom: 35px;
            }

            .logo-title {
                font-family: 'Outfit', sans-serif;
                font-size: 2.2rem;
                font-weight: 800;
                letter-spacing: -0.03em;
                background: linear-gradient(135deg, #f8fafc 30%, #a7f3d0 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                margin-bottom: 8px;
            }

            .logo-subtitle {
                font-size: 0.9rem;
                color: var(--text-secondary);
                text-transform: uppercase;
                letter-spacing: 0.15em;
            }

            .form-group {
                margin-bottom: 24px;
                position: relative;
            }

            .form-label {
                display: block;
                font-size: 0.85rem;
                font-weight: 500;
                color: var(--text-secondary);
                margin-bottom: 8px;
                letter-spacing: 0.02em;
            }

            .form-input {
                width: 100%;
                padding: 14px 16px;
                background: var(--input-bg);
                border: 1px solid rgba(255,255,255,0.06);
                border-radius: 12px;
                color: var(--text-primary);
                font-size: 0.95rem;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }

            .form-input:focus {
                outline: none;
                border-color: var(--accent);
                box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
                background: rgba(15, 23, 42, 0.8);
            }

            .btn-login {
                width: 100%;
                padding: 14px;
                background: var(--accent);
                color: #ffffff;
                border: none;
                border-radius: 12px;
                font-size: 1rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
                margin-top: 10px;
                box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);
            }

            .btn-login:hover {
                background: var(--accent-hover);
                transform: translateY(-1px);
                box-shadow: 0 6px 16px rgba(16, 185, 129, 0.35);
            }

            .btn-login:active {
                transform: translateY(0);
            }

            .error-message {
                background: rgba(239, 68, 68, 0.15);
                border: 1px solid rgba(239, 68, 68, 0.25);
                color: #fca5a5;
                padding: 12px;
                border-radius: 10px;
                font-size: 0.88rem;
                margin-bottom: 24px;
                display: flex;
                align-items: center;
                gap: 8px;
                animation: shake 0.4s ease-in-out;
            }

            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }

            @keyframes shake {
                0%, 100% { transform: translateX(0); }
                25% { transform: translateX(-5px); }
                75% { transform: translateX(5px); }
            }
        </style>
    </head>
    <body>
        <div class="orb orb-1"></div>
        <div class="orb orb-2"></div>

        <div class="login-container">
            <div class="login-card">
                <div class="logo-header">
                    <h1 class="logo-title">도매허브</h1>
                    <p class="logo-subtitle">Admin Portal</p>
                </div>

                <?php if ($error): ?>
                    <div class="error-message">
                        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                        </svg>
                        <span><?php echo esc_html($error); ?></span>
                    </div>
                <?php endif; ?>

                <form method="POST" action="">
                    <input type="hidden" name="action" value="login">
                    
                    <div class="form-group">
                        <label class="form-label" for="username">사용자 아이디</label>
                        <input class="form-input" type="text" id="username" name="username" placeholder="아이디를 입력하세요" required autocomplete="username">
                    </div>

                    <div class="form-group">
                        <label class="form-label" for="password">비밀번호</label>
                        <input class="form-input" type="password" id="password" name="password" placeholder="비밀번호를 입력하세요" required autocomplete="current-password">
                    </div>

                    <button class="btn-login" type="submit">로그인</button>
                </form>
            </div>
        </div>
    </body>
    </html>
    <?php
}

function avo_render_admin_dashboard_page() {
    ?>
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>도매허브 B2B Dashboard</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>
            :root {
                --bg-main: #090d16;
                --bg-sidebar: #0e1320;
                --bg-card: rgba(22, 30, 49, 0.6);
                --border-color: rgba(255, 255, 255, 0.05);
                --text-main: #f8fafc;
                --text-muted: #64748b;
                --text-soft: #94a3b8;
                --accent-primary: #10b981;
                --accent-primary-rgb: 16, 185, 129;
                --accent-blue: #3b82f6;
                --accent-blue-rgb: 59, 130, 246;
                --danger: #ef4444;
                --warning: #f59e0b;
                --glass-bg: rgba(14, 19, 32, 0.85);
            }

            * {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
            }

            body {
                font-family: 'Inter', sans-serif;
                background-color: var(--bg-main);
                color: var(--text-main);
                min-height: 100vh;
                display: flex;
                overflow: hidden;
            }

            /* Scrollbars */
            ::-webkit-scrollbar {
                width: 6px;
                height: 6px;
            }
            ::-webkit-scrollbar-track {
                background: rgba(0,0,0,0.1);
            }
            ::-webkit-scrollbar-thumb {
                background: rgba(255,255,255,0.15);
                border-radius: 4px;
            }
            ::-webkit-scrollbar-thumb:hover {
                background: rgba(255,255,255,0.25);
            }

            /* Layout Structure */
            .sidebar {
                width: 260px;
                background-color: var(--bg-sidebar);
                border-right: 1px solid var(--border-color);
                display: flex;
                flex-direction: column;
                flex-shrink: 0;
                z-index: 100;
            }

            .sidebar-header {
                padding: 30px 24px;
                border-bottom: 1px solid var(--border-color);
            }

            .sidebar-logo {
                font-family: 'Outfit', sans-serif;
                font-size: 1.5rem;
                font-weight: 800;
                letter-spacing: -0.02em;
                background: linear-gradient(135deg, #f8fafc 30%, #a7f3d0 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }

            .sidebar-nav {
                flex-grow: 1;
                padding: 24px 16px;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .nav-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 16px;
                color: var(--text-soft);
                text-decoration: none;
                border-radius: 12px;
                font-size: 0.95rem;
                font-weight: 500;
                transition: all 0.2s ease;
                cursor: pointer;
            }

            .nav-item:hover {
                color: var(--text-main);
                background-color: rgba(255, 255, 255, 0.03);
            }

            .nav-item.active {
                color: var(--text-main);
                background-color: rgba(16, 185, 129, 0.1);
                border: 1px solid rgba(16, 185, 129, 0.15);
            }

            .sidebar-footer {
                padding: 20px 16px;
                border-top: 1px solid var(--border-color);
            }

            .logout-btn {
                width: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                padding: 12px;
                background: rgba(239, 68, 68, 0.1);
                color: #fca5a5;
                border: 1px solid rgba(239, 68, 68, 0.15);
                border-radius: 12px;
                text-decoration: none;
                font-size: 0.9rem;
                font-weight: 600;
                transition: all 0.2s ease;
            }

            .logout-btn:hover {
                background: rgba(239, 68, 68, 0.2);
                color: #ffffff;
            }

            .main-content {
                flex-grow: 1;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }

            .topbar {
                height: 80px;
                border-bottom: 1px solid var(--border-color);
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0 40px;
                flex-shrink: 0;
            }

            .topbar-title {
                font-family: 'Outfit', sans-serif;
                font-size: 1.4rem;
                font-weight: 700;
            }

            .topbar-info {
                display: flex;
                align-items: center;
                gap: 20px;
            }

            .live-time {
                font-size: 0.9rem;
                color: var(--text-muted);
            }

            .admin-profile {
                display: flex;
                align-items: center;
                gap: 10px;
                background: rgba(255,255,255,0.03);
                padding: 8px 16px;
                border-radius: 99px;
                border: 1px solid var(--border-color);
            }

            .avatar {
                width: 24px;
                height: 24px;
                background: var(--accent-primary);
                color: white;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 0.8rem;
                font-weight: bold;
            }

            .admin-name {
                font-size: 0.9rem;
                font-weight: 600;
            }

            .content-pane {
                flex-grow: 1;
                overflow-y: auto;
                padding: 40px;
            }

            .tab-content {
                display: none;
                animation: fadeIn 0.4s ease;
            }

            .tab-content.active {
                display: block;
            }

            /* Dashboard Overview Cards */
            .metrics-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                gap: 24px;
                margin-bottom: 32px;
            }

            .metric-card {
                background: var(--bg-card);
                border: 1px solid var(--border-color);
                border-radius: 16px;
                padding: 24px;
                display: flex;
                align-items: center;
                gap: 20px;
                position: relative;
                overflow: hidden;
            }

            .metric-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                width: 4px;
                height: 100%;
                background: var(--accent-color, var(--accent-primary));
            }

            .metric-icon-box {
                width: 54px;
                height: 54px;
                border-radius: 14px;
                background: rgba(var(--accent-color-rgb, var(--accent-primary-rgb)), 0.1);
                color: rgba(var(--accent-color-rgb, var(--accent-primary-rgb)), 1);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.4rem;
            }

            .metric-info {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .metric-label {
                font-size: 0.85rem;
                color: var(--text-muted);
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }

            .metric-value {
                font-family: 'Outfit', sans-serif;
                font-size: 1.6rem;
                font-weight: 700;
            }

            /* Charts Layout */
            .charts-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
                gap: 24px;
                margin-bottom: 32px;
            }

            .chart-card {
                background: var(--bg-card);
                border: 1px solid var(--border-color);
                border-radius: 20px;
                padding: 28px;
            }

            .chart-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 24px;
            }

            .chart-title {
                font-family: 'Outfit', sans-serif;
                font-size: 1.1rem;
                font-weight: 700;
            }

            /* Tables & lists */
            .table-card {
                background: var(--bg-card);
                border: 1px solid var(--border-color);
                border-radius: 20px;
                padding: 28px;
                margin-bottom: 32px;
                overflow: hidden;
            }

            .table-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
            }

            .table-title {
                font-family: 'Outfit', sans-serif;
                font-size: 1.1rem;
                font-weight: 700;
            }

            .data-table-wrapper {
                overflow-x: auto;
            }

            .data-table {
                width: 100%;
                border-collapse: collapse;
                text-align: left;
            }

            .data-table th {
                padding: 14px 16px;
                border-bottom: 1px solid var(--border-color);
                color: var(--text-muted);
                font-size: 0.85rem;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }

            .data-table td {
                padding: 16px;
                border-bottom: 1px solid var(--border-color);
                font-size: 0.92rem;
                vertical-align: middle;
            }

            .data-table tbody tr {
                transition: background-color 0.2s ease;
            }

            .data-table tbody tr:hover {
                background-color: rgba(255,255,255,0.015);
            }

            /* Badge styles */
            .badge {
                display: inline-flex;
                align-items: center;
                padding: 4px 10px;
                border-radius: 99px;
                font-size: 0.78rem;
                font-weight: 600;
            }

            .badge-success {
                background: rgba(16, 185, 129, 0.12);
                color: #a7f3d0;
                border: 1px solid rgba(16, 185, 129, 0.2);
            }

            .badge-pending {
                background: rgba(245, 158, 11, 0.12);
                color: #fde68a;
                border: 1px solid rgba(245, 158, 11, 0.2);
            }

            .badge-danger {
                background: rgba(239, 68, 68, 0.12);
                color: #fca5a5;
                border: 1px solid rgba(239, 68, 68, 0.2);
            }

            .badge-blue {
                background: rgba(59, 130, 246, 0.12);
                color: #bfdbfe;
                border: 1px solid rgba(59, 130, 246, 0.2);
            }

            /* Form styles inside tables */
            .select-action {
                background: #0f172a;
                border: 1px solid var(--border-color);
                color: var(--text-main);
                padding: 6px 12px;
                border-radius: 8px;
                font-size: 0.85rem;
                outline: none;
                cursor: pointer;
                transition: border-color 0.2s;
            }

            .select-action:focus {
                border-color: var(--accent-primary);
            }

            /* Modals (Popups) */
            .modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(5px);
                z-index: 1000;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.3s ease;
            }

            .modal-overlay.active {
                opacity: 1;
                pointer-events: auto;
            }

            .modal-card {
                background: var(--glass-bg);
                border: 1px solid var(--border-color);
                border-radius: 24px;
                width: 100%;
                max-width: 800px;
                max-height: 80vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                transform: scale(0.95);
                transition: transform 0.3s ease;
            }

            .modal-overlay.active .modal-card {
                transform: scale(1);
            }

            .modal-header {
                padding: 24px 32px;
                border-bottom: 1px solid var(--border-color);
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .modal-title {
                font-family: 'Outfit', sans-serif;
                font-size: 1.25rem;
                font-weight: 700;
            }

            .modal-close {
                background: none;
                border: none;
                color: var(--text-muted);
                font-size: 1.5rem;
                cursor: pointer;
                transition: color 0.2s;
            }

            .modal-close:hover {
                color: var(--text-main);
            }

            .modal-body {
                padding: 32px;
                overflow-y: auto;
                flex-grow: 1;
            }

            /* Loader */
            .loader-overlay {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(9, 13, 22, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 50;
                border-radius: 20px;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.2s ease;
            }

            .loader-overlay.active {
                opacity: 1;
                pointer-events: auto;
            }

            .spinner {
                width: 40px;
                height: 40px;
                border: 4px solid rgba(255,255,255,0.05);
                border-top: 4px solid var(--accent-primary);
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }

            @keyframes spin {
                to { transform: rotate(360deg); }
            }

            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }
        </style>
    </head>
    <body>
        <!-- Sidebar Navigation -->
        <aside class="sidebar">
            <div class="sidebar-header">
                <div class="sidebar-logo">도매허브 B2B</div>
            </div>
            <nav class="sidebar-nav">
                <div class="nav-item active" data-tab="tab-dashboard">
                    <i class="fa-solid fa-chart-pie"></i>
                    <span>매출 통계</span>
                </div>
                <div class="nav-item" data-tab="tab-members">
                    <i class="fa-solid fa-users"></i>
                    <span>도매 회원 관리</span>
                </div>
                <div class="nav-item" data-tab="tab-orders">
                    <i class="fa-solid fa-receipt"></i>
                    <span>전체 주문 내역</span>
                </div>
            </nav>
            <div class="sidebar-footer">
                <a href="/admin-dashboard?action=logout" class="logout-btn">
                    <i class="fa-solid fa-right-from-bracket"></i>
                    <span>로그아웃</span>
                </a>
            </div>
        </aside>

        <!-- Main Content Area -->
        <main class="main-content">
            <header class="topbar">
                <h1 class="topbar-title" id="page-title">매출 통계 대시보드</h1>
                <div class="topbar-info">
                    <span class="live-time" id="clock">2026. 06. 23 (화) 15:00:00</span>
                    <div class="admin-profile">
                        <div class="avatar">A</div>
                        <span class="admin-name">tnfwod (관리자)</span>
                    </div>
                </div>
            </header>

            <div class="content-pane">
                <!-- TAB 1: DASHBOARD STATS -->
                <section id="tab-dashboard" class="tab-content active" style="position: relative;">
                    <div class="loader-overlay active" id="dashboard-loader">
                        <div class="spinner"></div>
                    </div>
                    
                    <!-- Top Metrics Grid -->
                    <div class="metrics-grid">
                        <div class="metric-card" style="--accent-color: #3b82f6; --accent-color-rgb: 59, 130, 246;">
                            <div class="metric-icon-box">
                                <i class="fa-solid fa-wallet"></i>
                            </div>
                            <div class="metric-info">
                                <span class="metric-label">누적 매출액</span>
                                <span class="metric-value" id="val-total-rev">0원</span>
                            </div>
                        </div>
                        <div class="metric-card" style="--accent-color: #10b981; --accent-color-rgb: 16, 185, 129;">
                            <div class="metric-icon-box">
                                <i class="fa-solid fa-calendar-days"></i>
                            </div>
                            <div class="metric-info">
                                <span class="metric-label">당월 매출액</span>
                                <span class="metric-value" id="val-month-rev">0원</span>
                            </div>
                        </div>
                        <div class="metric-card" style="--accent-color: #f59e0b; --accent-color-rgb: 245, 158, 11;">
                            <div class="metric-icon-box">
                                <i class="fa-solid fa-bolt"></i>
                            </div>
                            <div class="metric-info">
                                <span class="metric-label">금일 매출액</span>
                                <span class="metric-value" id="val-today-rev">0원</span>
                            </div>
                        </div>
                        <div class="metric-card" style="--accent-color: #a855f7; --accent-color-rgb: 168, 85, 247;">
                            <div class="metric-icon-box">
                                <i class="fa-solid fa-cart-shopping"></i>
                            </div>
                            <div class="metric-info">
                                <span class="metric-label">누적 주문수</span>
                                <span class="metric-value" id="val-total-ord">0건</span>
                            </div>
                        </div>
                        <div class="metric-card" style="--accent-color: #ec4899; --accent-color-rgb: 236, 72, 153;">
                            <div class="metric-icon-box">
                                <i class="fa-solid fa-user-group"></i>
                            </div>
                            <div class="metric-info">
                                <span class="metric-label">도매 회원수</span>
                                <span class="metric-value" id="val-total-mem">0명</span>
                            </div>
                        </div>
                    </div>

                    <!-- Charts Grid -->
                    <div class="charts-grid">
                        <div class="chart-card">
                            <div class="chart-header">
                                <h2 class="chart-title">최근 15일 일별 매출 추이</h2>
                            </div>
                            <div style="height: 300px; position: relative;">
                                <canvas id="dailyChart"></canvas>
                            </div>
                        </div>
                        <div class="chart-card">
                            <div class="chart-header">
                                <h2 class="chart-title">최근 6개월 월별 매출 비교</h2>
                            </div>
                            <div style="height: 300px; position: relative;">
                                <canvas id="monthlyChart"></canvas>
                            </div>
                        </div>
                    </div>

                    <!-- Top Sellers Table -->
                    <div class="table-card">
                        <div class="table-header">
                            <h2 class="table-title">가장 많이 판매된 품목 Top 10</h2>
                        </div>
                        <div class="data-table-wrapper">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>순위</th>
                                        <th>상품명</th>
                                        <th>총 판매수량</th>
                                        <th>누적 판매금액</th>
                                    </tr>
                                </thead>
                                <tbody id="top-products-body">
                                    <tr>
                                        <td colspan="4" style="text-align: center; color: var(--text-muted);">데이터를 불러오는 중입니다...</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>

                <!-- TAB 2: MEMBERS MANAGEMENT -->
                <section id="tab-members" class="tab-content" style="position: relative;">
                    <div class="loader-overlay active" id="members-loader">
                        <div class="spinner"></div>
                    </div>
                    
                    <div class="table-card">
                        <div class="table-header">
                            <h2 class="table-title">가입 도매 회원 목록 및 거래내역</h2>
                        </div>
                        <div class="data-table-wrapper">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>회원 ID</th>
                                        <th>성함 / 상호</th>
                                        <th>이메일 주소</th>
                                        <th>연락처</th>
                                        <th>가입일자</th>
                                        <th>주문수</th>
                                        <th>누적 구매금액</th>
                                        <th>B2B 승인 상태</th>
                                        <th>조회/관리</th>
                                    </tr>
                                </thead>
                                <tbody id="members-table-body">
                                    <tr>
                                        <td colspan="9" style="text-align: center; color: var(--text-muted);">데이터를 불러오는 중입니다...</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>

                <!-- TAB 3: ORDERS ARCHIVE -->
                <section id="tab-orders" class="tab-content" style="position: relative;">
                    <div class="loader-overlay active" id="orders-loader">
                        <div class="spinner"></div>
                    </div>
                    
                    <div class="table-card">
                        <div class="table-header" style="flex-direction: column; align-items: flex-start; gap: 16px;">
                            <h2 class="table-title">일별 주문 내역 조회</h2>
                            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                                <label for="order-date-picker" style="font-weight: 500; font-size: 0.92rem; color: var(--text-soft);">조회 일자:</label>
                                <input type="date" id="order-date-picker" class="select-action" style="padding: 8px 16px; font-size: 0.95rem; width: 160px;">
                            </div>
                        </div>

                        <!-- Daily Summary Cards -->
                        <div class="metrics-grid" id="daily-order-summary-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-bottom: 24px;">
                            <div class="metric-card" style="--accent-color: #3b82f6; --accent-color-rgb: 59, 130, 246; padding: 16px 20px;">
                                <div class="metric-icon-box" style="width: 44px; height: 44px; font-size: 1.1rem;"><i class="fa-solid fa-receipt"></i></div>
                                <div class="metric-info">
                                    <span class="metric-label" style="font-size: 0.75rem;">선택일 주문수</span>
                                    <span class="metric-value" id="val-day-ord-count" style="font-size: 1.3rem;">0건</span>
                                </div>
                            </div>
                            <div class="metric-card" style="--accent-color: #10b981; --accent-color-rgb: 16, 185, 129; padding: 16px 20px;">
                                <div class="metric-icon-box" style="width: 44px; height: 44px; font-size: 1.1rem;"><i class="fa-solid fa-wallet"></i></div>
                                <div class="metric-info">
                                    <span class="metric-label" style="font-size: 0.75rem;">선택일 매출액</span>
                                    <span class="metric-value" id="val-day-ord-rev" style="font-size: 1.3rem;">0원</span>
                                </div>
                            </div>
                        </div>
                        
                        <div class="data-table-wrapper">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>주문번호</th>
                                        <th>주문일시</th>
                                        <th>주문자</th>
                                        <th>품목 정보</th>
                                        <th>결제 수단</th>
                                        <th>결제금액</th>
                                        <th>주문 상태</th>
                                    </tr>
                                </thead>
                                <tbody id="orders-table-body">
                                    <tr>
                                        <td colspan="7" style="text-align: center; color: var(--text-muted);">데이터를 불러오는 중입니다...</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
            </div>
        </main>

        <!-- MEMBER ORDERS DETAIL POPUP MODAL -->
        <div class="modal-overlay" id="member-orders-modal">
            <div class="modal-card">
                <div class="modal-header">
                    <h3 class="modal-title" id="modal-user-title">회원 주문 상세 내역</h3>
                    <button class="modal-close" id="btn-close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="data-table-wrapper">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>주문번호</th>
                                    <th>주문일시</th>
                                    <th>품목 요약</th>
                                    <th>결제 수단</th>
                                    <th>주문 금액</th>
                                    <th>상태</th>
                                </tr>
                            </thead>
                            <tbody id="modal-orders-body">
                                <tr>
                                    <td colspan="6" style="text-align: center; color: var(--text-muted);">주문 내역을 불러오는 중입니다...</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <!-- FRONTEND LOGIC -->
        <script>
            document.addEventListener('DOMContentLoaded', function() {
                // Live Clock Setup
                function updateClock() {
                    const now = new Date();
                    const year = now.getFullYear();
                    const month = String(now.getMonth() + 1).padStart(2, '0');
                    const day = String(now.getDate()).padStart(2, '0');
                    const hours = String(now.getHours()).padStart(2, '0');
                    const minutes = String(now.getMinutes()).padStart(2, '0');
                    const seconds = String(now.getSeconds()).padStart(2, '0');
                    const weekDays = ['일', '월', '화', '수', '목', '금', '토'];
                    const weekDay = weekDays[now.getDay()];
                    
                    document.getElementById('clock').innerText = `${year}. ${month}. ${day} (${weekDay}) ${hours}:${minutes}:${seconds}`;
                }
                setInterval(updateClock, 1000);
                updateClock();

                // Tab Switch Logic
                const navItems = document.querySelectorAll('.nav-item');
                const tabContents = document.querySelectorAll('.tab-content');
                const pageTitle = document.getElementById('page-title');

                navItems.forEach(item => {
                    item.addEventListener('click', function() {
                        navItems.forEach(i => i.classList.remove('active'));
                        tabContents.forEach(c => c.classList.remove('active'));
                        
                        this.classList.add('active');
                        const tabId = this.getAttribute('data-tab');
                        document.getElementById(tabId).classList.add('active');
                        
                        // Title 변경
                        if (tabId === 'tab-dashboard') {
                            pageTitle.innerText = '매출 통계 대시보드';
                            loadDashboardData();
                        } else if (tabId === 'tab-members') {
                            pageTitle.innerText = '도매 회원 관리';
                            loadMembersData();
                        } else if (tabId === 'tab-orders') {
                            pageTitle.innerText = '전체 주문 내역';
                            loadOrdersData();
                        }
                    });
                });

                // Helpers
                function formatKRW(val) {
                    return Number(val).toLocaleString('ko-KR') + '원';
                }

                function getStatusBadge(status) {
                    const map = {
                        'completed': '<span class="badge badge-success">완료</span>',
                        'processing': '<span class="badge badge-blue">처리중</span>',
                        'on-hold': '<span class="badge badge-pending">대기중</span>',
                        'pending': '<span class="badge badge-pending">결제대기</span>',
                        'failed': '<span class="badge badge-danger">실패</span>',
                        'cancelled': '<span class="badge badge-danger">취소</span>',
                        'refunded': '<span class="badge badge-danger">환불</span>'
                    };
                    return map[status] || `<span class="badge">${status}</span>`;
                }

                // Chart References
                let dailyChartInstance = null;
                let monthlyChartInstance = null;

                // Load Data: Dashboard
                function loadDashboardData() {
                    const loader = document.getElementById('dashboard-loader');
                    loader.classList.add('active');
                    
                    // 1. Stats and charts
                    fetch('/admin-dashboard?api=stats')
                        .then(res => res.json())
                        .then(res => {
                            if(res.success) {
                                document.getElementById('val-total-rev').innerText = formatKRW(res.overview.total_revenue);
                                document.getElementById('val-month-rev').innerText = formatKRW(res.overview.month_revenue);
                                document.getElementById('val-today-rev').innerText = formatKRW(res.overview.today_revenue);
                                document.getElementById('val-total-ord').innerText = res.overview.total_orders + '건';
                                document.getElementById('val-total-mem').innerText = res.overview.total_members + '명';
                                
                                // Daily Chart
                                const ctxDaily = document.getElementById('dailyChart').getContext('2d');
                                if (dailyChartInstance) dailyChartInstance.destroy();
                                dailyChartInstance = new Chart(ctxDaily, {
                                    type: 'line',
                                    data: {
                                        labels: res.charts.daily.labels,
                                        datasets: [{
                                            label: '일별 매출 (KRW)',
                                            data: res.charts.daily.data,
                                            borderColor: '#3b82f6',
                                            backgroundColor: 'rgba(59, 130, 246, 0.05)',
                                            fill: true,
                                            tension: 0.35,
                                            borderWidth: 3
                                        }]
                                    },
                                    options: {
                                        responsive: true,
                                        maintainAspectRatio: false,
                                        plugins: { legend: { display: false } },
                                        scales: {
                                            y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#64748b' } },
                                            x: { grid: { display: false }, ticks: { color: '#64748b' } }
                                        }
                                    }
                                });

                                // Monthly Chart
                                const ctxMonthly = document.getElementById('monthlyChart').getContext('2d');
                                if (monthlyChartInstance) monthlyChartInstance.destroy();
                                monthlyChartInstance = new Chart(ctxMonthly, {
                                    type: 'bar',
                                    data: {
                                        labels: res.charts.monthly.labels,
                                        datasets: [{
                                            label: '월별 매출 (KRW)',
                                            data: res.charts.monthly.data,
                                            backgroundColor: 'rgba(16, 185, 129, 0.85)',
                                            borderRadius: 8,
                                            borderWidth: 0
                                        }]
                                    },
                                    options: {
                                        responsive: true,
                                        maintainAspectRatio: false,
                                        plugins: { legend: { display: false } },
                                        scales: {
                                            y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#64748b' } },
                                            x: { grid: { display: false }, ticks: { color: '#64748b' } }
                                        }
                                    }
                                });
                            }
                        })
                        .catch(err => console.error("Error stats API:", err));

                    // 2. Top products
                    fetch('/admin-dashboard?api=top_products')
                        .then(res => res.json())
                        .then(res => {
                            if(res.success) {
                                const body = document.getElementById('top-products-body');
                                body.innerHTML = '';
                                if(res.products.length === 0) {
                                    body.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">판매 내역이 없습니다.</td></tr>';
                                    return;
                                }
                                res.products.forEach((prod, index) => {
                                    body.innerHTML += `
                                        <tr>
                                            <td style="font-weight:600; color:${index===0?'#f59e0b':index===1?'#cbd5e1':index===2?'#b45309':'var(--text-soft)'};"># ${index + 1}</td>
                                            <td style="font-weight: 500;">${prod.name}</td>
                                            <td>${prod.qty}개</td>
                                            <td>${formatKRW(prod.total)}</td>
                                        </tr>
                                    `;
                                });
                            }
                        })
                        .catch(err => console.error("Error top products:", err))
                        .finally(() => loader.classList.remove('active'));
                }

                // Load Data: Members
                function loadMembersData() {
                    const loader = document.getElementById('members-loader');
                    loader.classList.add('active');
                    
                    fetch('/admin-dashboard?api=members')
                        .then(res => res.json())
                        .then(res => {
                            if(res.success) {
                                const body = document.getElementById('members-table-body');
                                body.innerHTML = '';
                                if(res.members.length === 0) {
                                    body.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">가입된 회원이 없습니다.</td></tr>';
                                    return;
                                }
                                res.members.forEach(mem => {
                                    let badgeClass = 'badge-pending';
                                    let badgeText = '대기';
                                    if(mem.approval_status === 'approved') {
                                        badgeClass = 'badge-success';
                                        badgeText = '승인됨';
                                    } else if(mem.approval_status === 'rejected') {
                                        badgeClass = 'badge-danger';
                                        badgeText = '거절됨';
                                    }
                                    
                                    body.innerHTML += `
                                        <tr>
                                            <td>${mem.id}</td>
                                            <td style="font-weight: 500;">${mem.billing_name} (${mem.username})</td>
                                            <td style="color: var(--text-soft);">${mem.email}</td>
                                            <td>${mem.phone}</td>
                                            <td style="color: var(--text-muted);">${mem.registered}</td>
                                            <td>${mem.order_count}건</td>
                                            <td style="font-weight: 600; color: var(--accent-blue);">${formatKRW(mem.total_spent)}</td>
                                            <td>
                                                <select class="select-action" onchange="updateMemberStatus(${mem.id}, this.value)">
                                                    <option value="pending" ${mem.approval_status==='pending'?'selected':''}>대기</option>
                                                    <option value="approved" ${mem.approval_status==='approved'?'selected':''}>승인</option>
                                                    <option value="rejected" ${mem.approval_status==='rejected'?'selected':''}>거절</option>
                                                </select>
                                            </td>
                                            <td>
                                                <button class="select-action" onclick="showMemberOrders(${mem.id}, '${mem.billing_name}')" style="background:#1e293b; color:var(--text-main);">
                                                    <i class="fa-solid fa-magnifying-glass"></i> 주문조회
                                                </button>
                                            </td>
                                        </tr>
                                    `;
                                });
                            }
                        })
                        .catch(err => console.error("Error members API:", err))
                        .finally(() => loader.classList.remove('active'));
                }

                // Global Update Member Status (exposes to window so inline onchange can call)
                window.updateMemberStatus = function(userId, newStatus) {
                    const formData = new FormData();
                    formData.append('user_id', userId);
                    formData.append('status', newStatus);
                    
                    fetch('/admin-dashboard?api=approve_member', {
                        method: 'POST',
                        body: formData
                    })
                    .then(res => res.json())
                    .then(res => {
                        if(res.success) {
                            // Reload members table to update stats correctly
                            loadMembersData();
                        } else {
                            alert('변경에 실패했습니다: ' + res.message);
                        }
                    })
                    .catch(err => alert('에러가 발생했습니다: ' + err));
                };

                // Global Show Member Orders
                window.showMemberOrders = function(userId, name) {
                    const modal = document.getElementById('member-orders-modal');
                    const title = document.getElementById('modal-user-title');
                    const body = document.getElementById('modal-orders-body');
                    
                    title.innerText = `[${name}] 회원 주문 내역`;
                    body.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">주문을 불러오는 중입니다...</td></tr>';
                    modal.classList.add('active');
                    
                    fetch(`/admin-dashboard?api=member_orders&user_id=${userId}`)
                        .then(res => res.json())
                        .then(res => {
                            if(res.success) {
                                body.innerHTML = '';
                                if(res.orders.length === 0) {
                                    body.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">주문 내역이 없습니다.</td></tr>';
                                    return;
                                }
                                res.orders.forEach(order => {
                                    body.innerHTML += `
                                        <tr>
                                            <td style="font-weight:600; color:var(--text-soft);">${order.number}</td>
                                            <td style="color:var(--text-muted); font-size:0.85rem;">${order.date}</td>
                                            <td style="max-width:200px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${order.items}</td>
                                            <td>${order.payment}</td>
                                            <td style="font-weight:600;">${formatKRW(order.total)}</td>
                                            <td>${getStatusBadge(order.status)}</td>
                                        </tr>
                                    `;
                                });
                            }
                        })
                        .catch(err => {
                            body.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--danger);">주문을 가져오는 중 오류가 발생했습니다.</td></tr>';
                        });
                };

                // Close Modal
                document.getElementById('btn-close-modal').addEventListener('click', function() {
                    document.getElementById('member-orders-modal').classList.remove('active');
                });
                document.getElementById('member-orders-modal').addEventListener('click', function(e) {
                    if(e.target === this) {
                        this.classList.remove('active');
                    }
                });

                // Load Data: Orders
                function loadOrdersData(date) {
                    const loader = document.getElementById('orders-loader');
                    loader.classList.add('active');
                    
                    if (!date) {
                        const datePicker = document.getElementById('order-date-picker');
                        date = datePicker.value;
                    }
                    
                    fetch('/admin-dashboard?api=orders&date=' + date)
                        .then(res => res.json())
                        .then(res => {
                            if(res.success) {
                                // Update daily summary metrics
                                document.getElementById('val-day-ord-count').innerText = res.summary.total_orders + '건';
                                document.getElementById('val-day-ord-rev').innerText = formatKRW(res.summary.total_revenue);
                                
                                const body = document.getElementById('orders-table-body');
                                body.innerHTML = '';
                                if(res.orders.length === 0) {
                                    body.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">선택하신 일자의 주문 내역이 없습니다.</td></tr>';
                                    return;
                                }
                                res.orders.forEach(order => {
                                    body.innerHTML += `
                                        <tr>
                                            <td style="font-weight:600; color:var(--text-soft);">${order.number}</td>
                                            <td style="color: var(--text-muted); font-size:0.85rem;">${order.date}</td>
                                            <td style="font-weight: 500;">${order.billing_name}</td>
                                            <td style="max-width: 250px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="${order.items}">${order.items}</td>
                                            <td>${order.payment}</td>
                                            <td style="font-weight: 600; color:var(--text-main);">${formatKRW(order.total)}</td>
                                            <td>${getStatusBadge(order.status)}</td>
                                        </tr>
                                    `;
                                });
                            }
                        })
                        .catch(err => console.error("Error orders API:", err))
                        .finally(() => loader.classList.remove('active'));
                }

                // Initial Load
                loadDashboardData();
                
                // Initialize Date Picker to today
                const datePicker = document.getElementById('order-date-picker');
                if (datePicker) {
                    const todayStr = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
                    datePicker.value = todayStr;
                    datePicker.addEventListener('change', function() {
                        loadOrdersData(this.value);
                    });
                }
            });
        </script>
    </body>
    </html>
    <?php
}

// =========================================================================
// B2B 회원가입 개선: 아이디/비밀번호 직접 입력, 중복 확인, 승인대기 로그인 제한
// =========================================================================

// 1. 우커머스 가입 폼에 사용자 아이디와 비밀번호 직접 입력 필드 활성화
add_filter( 'woocommerce_registration_generate_username', '__return_false', 999 );
add_filter( 'woocommerce_registration_generate_password', '__return_false', 999 );

// 2. 가입 즉시 자동 로그인을 차단하고 승인대기 알림 메시지 출력
add_action( 'woocommerce_registration_redirect', function( $redirect_to ) {
    wp_logout();
    return add_query_arg( 'registration', 'success', wc_get_page_permalink( 'myaccount' ) );
}, 999 );

add_action( 'wp', function() {
    if ( isset( $_GET['registration'] ) && 'success' === $_GET['registration'] ) {
        wc_add_notice( '회원가입 신청이 완료되었습니다. 관리자 승인이 완료되면 이메일로 안내해 드립니다.', 'notice' );
    }
} );

// 3. 승인되지 않은(대기/거부) 회원의 로그인 차단
add_filter( 'wp_authenticate_user', 'avocadoss_block_pending_users_login', 99, 2 );
function avocadoss_block_pending_users_login( $user, $password ) {
    if ( is_wp_error( $user ) ) {
        return $user;
    }
    
    $status = get_user_meta( $user->ID, '_avo_approval_status', true );
    
    if ( 'pending' === $status ) {
        return new WP_Error( 'avo_pending_approval', '회원가입 승인 대기 중입니다. 관리자 승인이 완료되면 이메일로 안내해 드립니다.' );
    } elseif ( 'rejected' === $status ) {
        return new WP_Error( 'avo_rejected_approval', '회원가입 승인이 거절되었습니다. 고객센터(tnfwod@naver.com)로 문의해 주세요.' );
    }
    
    return $user;
}

// 4. 아이디 중복확인 AJAX 엔드포인트 등록
add_action( 'wp_ajax_nopriv_avo_check_username_duplicate', 'avo_check_username_duplicate' );
add_action( 'wp_ajax_avo_check_username_duplicate', 'avo_check_username_duplicate' );
function avo_check_username_duplicate() {
    $username = isset( $_POST['username'] ) ? sanitize_user( wp_unslash( $_POST['username'] ) ) : '';
    if ( empty( $username ) ) {
        wp_send_json_error( array( 'message' => '아이디를 입력해주세요.' ) );
    }
    
    if ( username_exists( $username ) ) {
        wp_send_json_error( array( 'message' => '이미 사용 중인 아이디입니다.' ) );
    } else {
        wp_send_json_success( array( 'message' => '사용 가능한 아이디입니다.' ) );
    }
}

// 5. 회원가입 폼 필드 라벨 수정, 비밀번호 확인 추가, 이메일 위치 이동 및 중복확인/비밀번호 검증 주입
add_action( 'wp_footer', function() {
    if ( ! is_account_page() || is_user_logged_in() ) {
        return;
    }
    ?>
    <script type="text/javascript">
    jQuery(document).ready(function($) {
        // 1. 사용자 명 -> 로그인 ID 변경 및 중복확인 버튼 주입
        var $usernameInput = $('#reg_username');
        if ($usernameInput.length) {
            var $row = $usernameInput.closest('.form-row');
            var $usernameLabel = $('label[for="reg_username"]');
            if ($usernameLabel.length) {
                $usernameLabel.html('로그인 ID&nbsp;<span class="required">*</span>');
            }
            
            // 중복 확인 버튼 및 입력란 감싸기
            $usernameInput.wrap('<span style="display: flex; gap: 8px; width: 100%;"></span>');
            var $btn = $('<button type="button" id="avo_btn_check_username" class="button" style="padding: 0 16px; height: 42px; line-height: 42px; background-color: #1a202c; color: #fff; border: none; border-radius: 4px; font-weight: 600; cursor: pointer; font-size: 0.9em; transition: background-color 0.2s; white-space: nowrap;">중복 확인</button>');
            $usernameInput.after($btn);
            
            var $msg = $('<div id="avo_username_check_msg" style="margin-top: 4px; font-size: 0.85em; font-weight: 600; min-height: 1.5em;"></div>');
            $row.append($msg);
            
            var usernameChecked = false;
            var checkedUsernameVal = '';
            
            $btn.on('click', function(e) {
                e.preventDefault();
                var username = $usernameInput.val().trim();
                if (!username) {
                    $msg.css('color', '#e53e3e').text('로그인 ID를 입력해주세요.');
                    return;
                }
                if (username.length < 4) {
                    $msg.css('color', '#e53e3e').text('로그인 ID는 4자 이상이어야 합니다.');
                    return;
                }
                
                $btn.prop('disabled', true).text('확인 중...');
                
                $.ajax({
                    url: '/wp-admin/admin-ajax.php',
                    type: 'POST',
                    data: {
                        action: 'avo_check_username_duplicate',
                        username: username
                    },
                    success: function(response) {
                        $btn.prop('disabled', false).text('중복 확인');
                        if (response.success) {
                            $msg.css('color', '#38a169').text('사용 가능한 로그인 ID입니다.');
                            usernameChecked = true;
                            checkedUsernameVal = username;
                        } else {
                            $msg.css('color', '#e53e3e').text('이미 사용 중인 로그인 ID입니다.');
                            usernameChecked = false;
                            checkedUsernameVal = '';
                        }
                    },
                    error: function() {
                        $btn.prop('disabled', false).text('중복 확인');
                        $msg.css('color', '#e53e3e').text('서버 오류가 발생했습니다.');
                        usernameChecked = false;
                        checkedUsernameVal = '';
                    }
                });
            });
            
            $usernameInput.on('input', function() {
                if ($usernameInput.val().trim() !== checkedUsernameVal) {
                    usernameChecked = false;
                    $msg.text('');
                }
            });
        }

        // 2. 비밀번호 -> 로그인 비밀번호 변경 및 비밀번호 확인 필드 추가
        var $passwordInput = $('#reg_password');
        if ($passwordInput.length) {
            var $passwordLabel = $('label[for="reg_password"]');
            if ($passwordLabel.length) {
                $passwordLabel.html('로그인 비밀번호&nbsp;<span class="required">*</span>');
            }
            
            var $passwordRow = $passwordInput.closest('.form-row');
            if ($passwordRow.length && !$('#reg_password_confirm').length) {
                var $confirmRow = $('<p class="woocommerce-form-row woocommerce-form-row--wide form-row form-row-wide">' +
                    '<label for="reg_password_confirm">비밀번호 확인&nbsp;<span class="required">*</span></label>' +
                    '<input type="password" class="woocommerce-Input woocommerce-Input--text input-text" name="password_confirm" id="reg_password_confirm" autocomplete="new-password" required />' +
                    '</p>');
                $passwordRow.after($confirmRow);
            }
        }

        // 3. 이메일 주소 필드를 비밀번호 확인 필드 아래로 이동
        var $emailRow = $('#reg_email').closest('.form-row');
        var $confirmPasswordRow = $('#reg_password_confirm').closest('.form-row');
        if ($emailRow.length && $confirmPasswordRow.length) {
            $emailRow.insertAfter($confirmPasswordRow);
        }
        
        // 4. 회원가입 폼 제출 시 검증 (중복확인 및 비밀번호 일치 확인)
        $('form.register').on('submit', function(e) {
            if ($usernameInput.length) {
                var currentUsername = $usernameInput.val().trim();
                if (currentUsername && (!usernameChecked || currentUsername !== checkedUsernameVal)) {
                    e.preventDefault();
                    if ($msg.length) {
                        $msg.css('color', '#e53e3e').text('로그인 ID 중복 확인을 완료해주세요.');
                    }
                    alert('로그인 ID 중복 확인을 해주세요.');
                    return;
                }
            }
            
            var password = $('#reg_password').val();
            var confirmPassword = $('#reg_password_confirm').val();
            if (password !== confirmPassword) {
                e.preventDefault();
                alert('입력하신 두 비밀번호가 일치하지 않습니다.');
            }
        });
    });
    </script>
    <?php
} );

// =========================================================================
// 메인화면/홈페이지 브라우저 타이틀 변경
// =========================================================================
add_filter( 'pre_get_document_title', 'avo_custom_homepage_title', 9999 );
add_filter( 'rank_math/frontend/title', 'avo_custom_homepage_title', 9999 );
function avo_custom_homepage_title( $title ) {
    if ( is_front_page() || is_home() ) {
        return '도매허브 | 여러 상품을 한곳에서';
    }
    return $title;
}

add_filter( 'rank_math/frontend/description', 'avo_custom_homepage_description', 9999 );
function avo_custom_homepage_description( $desc ) {
    if ( is_front_page() || is_home() ) {
        return '농산물, 과일, 축산물, 가공식품, 수산물까지 다양한 도매 먹거리를 한 곳에서 확인하세요.';
    }
    return $desc;
}
// =========================================================================
// SEO & Webmaster Tool Verification & Tracking Codes
// =========================================================================
add_action( 'wp_head', 'avocadoss_seo_verification_tags', 1 );
function avocadoss_seo_verification_tags() {
    // 1. Naver Search Advisor Verification
    echo '<meta name="naver-site-verification" content="9288cd51db95d099a5db3ffa6ef20573fac6ba3f" />' . PHP_EOL;
    echo '<meta name="naver-site-verification" content="49596794750a44aa918f86579ee2984e35bc49d6" />' . PHP_EOL;
    
    // 2. Google Search Console Verification
    echo '<meta name="google-site-verification" content="google3f499a6d7425375d" />' . PHP_EOL;
    
    // 3. Bing Webmaster Tools Verification
    // echo '<meta name="msvalidate.01" content="YOUR_BING_VERIFICATION_KEY" />' . PHP_EOL;
    
    // 4. Google Analytics 4 (GA4) Tracking Code (gtag.js) - Placeholder
    /*
    ?>
    <!-- Global site tag (gtag.js) - Google Analytics -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-XXXXXXXXXX');
    </script>
    <?php
    */
}

// =========================================================================
// 인기 상품(Featured) 상단 노출 및 일반 상품과 분리
// =========================================================================

// 1. 숍 페이지 최상단에 인기 상품 섹션 출력
add_action( 'woocommerce_before_shop_loop', 'avo_display_featured_products_at_top', 5 );
function avo_display_featured_products_at_top() {
    if ( is_shop() && ! is_paged() && ! is_search() ) {
        $featured_ids = wc_get_featured_product_ids();
        if ( ! empty( $featured_ids ) ) {
            echo '<div class="avo-featured-products-section" style="margin-bottom: 40px; width: 100%;">';
            echo '<h2 style="font-size: 1.6em; font-weight: 700; color: #1a202c; margin-bottom: 20px; border-bottom: 3px solid #1a202c; padding-bottom: 8px; display: flex; align-items: center; gap: 8px;">🔥 인기 상품</h2>';
            echo do_shortcode( '[featured_products columns="4" limit="8" orderby="menu_order" order="ASC"]' );
            echo '</div>';
            
            echo '<div class="avo-regular-products-section-title" style="width: 100%;">';
            echo '<h2 style="font-size: 1.6em; font-weight: 700; color: #718096; margin-bottom: 20px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-top: 20px;">일반 상품</h2>';
            echo '</div>';
        }
    }
}

// 2. 하단 일반 상품 목록에서 인기 상품 제외 (중복 방지)
add_action( 'woocommerce_product_query', 'avo_exclude_featured_products_from_shop', 99 );
function avo_exclude_featured_products_from_shop( $q ) {
    if ( ! is_admin() && $q->is_main_query() && is_shop() && ! is_search() ) {
        $featured_ids = wc_get_featured_product_ids();
        if ( ! empty( $featured_ids ) ) {
            $q->set( 'post__not_in', $featured_ids );
        }
    }
}



// =========================================================================
// WooCommerce single-option products: append final customer price to option label
// =========================================================================
add_filter( 'woocommerce_variation_option_name', 'avocadoss_append_variation_price_to_option_label', 10, 4 );
function avocadoss_append_variation_price_to_option_label( $option_name, $term = null, $attribute_name = '', $product = null ) {
    if ( ! $product instanceof WC_Product_Variable ) {
        return $option_name;
    }

    // Skip multi-attribute products because a single option label cannot safely represent a full variation price.
    $variation_attributes = $product->get_variation_attributes();
    if ( count( $variation_attributes ) !== 1 ) {
        return $option_name;
    }

    $plain_label = wp_strip_all_tags( (string) $option_name );
    if ( preg_match( '/\([0-9,]+\s*\x{C6D0}\)/u', $plain_label ) ) {
        return $option_name;
    }

    $attribute_keys = array_keys( $variation_attributes );
    $target_attribute = $attribute_name ? $attribute_name : ( $attribute_keys[0] ?? '' );
    if ( '' === $target_attribute ) {
        return $option_name;
    }

    $target_attribute = rawurldecode( str_replace( 'attribute_', '', (string) $target_attribute ) );
    $matching_variation = avocadoss_find_single_attribute_variation( $product, $target_attribute, $option_name, $term );
    if ( ! $matching_variation ) {
        return $option_name;
    }

    $label = $option_name;
    $price = $matching_variation->get_price();
    if ( '' !== $price ) {
        $label .= ' (' . number_format_i18n( (float) $price ) . html_entity_decode( '&#50896;', ENT_QUOTES, 'UTF-8' ) . ')';
    }

    if ( ! $matching_variation->is_in_stock() ) {
        $label .= ' (' . html_entity_decode( '&#54408;&#51208;', ENT_QUOTES, 'UTF-8' ) . ')';
    }

    return $label;
}

function avocadoss_find_single_attribute_variation( WC_Product_Variable $product, $target_attribute, $option_name, $term = null ) {
    $option_candidates = array_filter( array_unique( array(
        (string) $option_name,
        sanitize_title( (string) $option_name ),
        is_object( $term ) && isset( $term->slug ) ? (string) $term->slug : '',
        is_object( $term ) && isset( $term->name ) ? (string) $term->name : '',
    ) ) );

    foreach ( $product->get_children() as $variation_id ) {
        $variation = wc_get_product( $variation_id );
        if ( ! $variation instanceof WC_Product_Variation ) {
            continue;
        }

        foreach ( $variation->get_attributes() as $attribute_key => $attribute_value ) {
            $attribute_key = rawurldecode( str_replace( 'attribute_', '', (string) $attribute_key ) );
            if ( $attribute_key !== $target_attribute ) {
                continue;
            }

            foreach ( $option_candidates as $candidate ) {
                if ( (string) $attribute_value === (string) $candidate || sanitize_title( (string) $attribute_value ) === sanitize_title( (string) $candidate ) ) {
                    return $variation;
                }
            }
        }
    }

    return null;
}


// =========================================================================
// WooCommerce product pages: hide internal B2B source text from customer-facing content
// =========================================================================
add_filter( 'the_content', 'avocadoss_remove_b2b_source_text_from_product_content', 20 );
add_filter( 'woocommerce_short_description', 'avocadoss_remove_b2b_source_text_from_product_content', 20 );
add_filter( 'rank_math/frontend/description', 'avocadoss_remove_b2b_source_text_from_product_content', 20 );
add_filter( 'rank_math/opengraph/facebook/description', 'avocadoss_remove_b2b_source_text_from_product_content', 20 );
add_filter( 'rank_math/opengraph/twitter/description', 'avocadoss_remove_b2b_source_text_from_product_content', 20 );
function avocadoss_remove_b2b_source_text_from_product_content( $content ) {
    if ( is_admin() || ! function_exists( 'is_product' ) || ! is_product() ) {
        return $content;
    }

    return avocadoss_strip_internal_b2b_source_text( (string) $content );
}


add_filter( 'rank_math/json_ld', 'avocadoss_remove_b2b_source_from_rank_math_schema', 20 );
function avocadoss_remove_b2b_source_from_rank_math_schema( $data ) {
    if ( is_admin() || ! function_exists( 'is_product' ) || ! is_product() ) {
        return $data;
    }

    return avocadoss_strip_internal_b2b_source_from_value( $data );
}

function avocadoss_strip_internal_b2b_source_from_value( $value ) {
    if ( is_string( $value ) ) {
        return avocadoss_strip_internal_b2b_source_text( $value );
    }

    if ( is_array( $value ) ) {
        foreach ( $value as $key => $child ) {
            $value[ $key ] = avocadoss_strip_internal_b2b_source_from_value( $child );
        }
    }

    return $value;
}

function avocadoss_strip_internal_b2b_source_text( $content ) {
    $patterns = array(
        '/<p\b[^>]*>(?:(?!<\/p>).)*(?:B2B\s*자동화|원문\s*링크|walldob2b\.com|dailyfood|공급처|원가|원본\s*URL)(?:(?!<\/p>).)*<\/p>/isu',
        '/<a\b[^>]*href=["\'][^"\']*(?:walldob2b\.com|dailyfood)[^"\']*["\'][^>]*>.*?<\/a>/isu',
        '/본\s*상품은\s*B2B\s*자동화\s*시스템을\s*통해\s*등록되었습니다\.?/u',
        '/원문\s*링크\s*:\s*https?:\/\/[^\s<]+/iu',
        '/https?:\/\/walldob2b\.com\/[^\s<]+/iu',
    );

    return trim( preg_replace( $patterns, '', $content ) );
}

// =========================================================================
// WooCommerce single-option products: group similar options, then sort by final customer price
// =========================================================================
add_filter( 'woocommerce_dropdown_variation_attribute_options_args', 'avocadoss_sort_single_attribute_variation_options', 20 );
function avocadoss_sort_single_attribute_variation_options( $args ) {
    $product = $args['product'] ?? null;
    if ( ! $product instanceof WC_Product_Variable || empty( $args['options'] ) || is_admin() ) {
        return $args;
    }

    $variation_attributes = $product->get_variation_attributes();
    if ( count( $variation_attributes ) !== 1 ) {
        return $args;
    }

    $attribute = rawurldecode( str_replace( 'attribute_', '', (string) ( $args['attribute'] ?? '' ) ) );
    if ( '' === $attribute ) {
        return $args;
    }

    $options = array_values( (array) $args['options'] );
    if ( count( $options ) < 2 ) {
        return $args;
    }

    $group_order = array();
    $rows = array();
    foreach ( $options as $index => $option ) {
        $variation = avocadoss_find_single_attribute_variation( $product, $attribute, $option, null );
        if ( ! $variation || '' === $variation->get_price() ) {
            return $args;
        }

        $group = avocadoss_variation_option_group_key( (string) $option );
        if ( ! isset( $group_order[ $group ] ) ) {
            $group_order[ $group ] = count( $group_order );
        }

        $rows[] = array(
            'option' => $option,
            'index'  => $index,
            'group'  => $group,
            'price'  => (float) $variation->get_price(),
        );
    }

    $group_counts = array_count_values( array_column( $rows, 'group' ) );
    if ( max( $group_counts ) < 2 && count( $group_counts ) === count( $rows ) ) {
        return $args;
    }

    usort( $rows, function ( $a, $b ) use ( $group_order ) {
        $group_compare = $group_order[ $a['group'] ] <=> $group_order[ $b['group'] ];
        if ( 0 !== $group_compare ) {
            return $group_compare;
        }

        $price_compare = $a['price'] <=> $b['price'];
        if ( 0 !== $price_compare ) {
            return $price_compare;
        }

        return $a['index'] <=> $b['index'];
    } );

    $args['options'] = array_column( $rows, 'option' );
    return $args;
}

function avocadoss_variation_option_group_key( $option_name ) {
    $key = wp_strip_all_tags( (string) $option_name );
    $key = preg_replace( '/\([0-9,]+\s*\x{C6D0}\)/u', '', $key );
    $key = preg_replace( '/\([^)]*\d+[^)]*(?:kg|g|개|과|입|팩|박스|망)[^)]*\)/iu', '', $key );
    $key = preg_replace( '/\[[^\]]*\d+[^\]]*(?:kg|g|개|과|입|팩|박스|망)[^\]]*\]/iu', '', $key );
    $key = preg_replace( '/\d+\s*[-~]\s*\d+\s*(?:kg|g|개|과|입|팩|박스|망)?/iu', '', $key );
    $key = preg_replace( '/\d+(?:\.\d+)?\s*(?:kg|g|개|과|입|팩|박스|망)/iu', '', $key );
    $key = preg_replace( '/\b내외\b/u', '', $key );
    $key = preg_replace( '/\s+/u', ' ', $key );

    return trim( $key );
}

// =========================================================================
// Jeju & Island/Mountain Shipping Surcharge (제주/도서산간 추가 배송비)
// =========================================================================

add_action( 'woocommerce_cart_calculate_fees', 'avocadoss_add_jeju_island_shipping_fee', 20 );
function avocadoss_add_jeju_island_shipping_fee() {
    if ( is_admin() && ! defined( 'DOING_AJAX' ) ) {
        return;
    }

    // Get postcode & address from the WC Session / Customer object
    $shipping_postcode = WC()->customer->get_shipping_postcode();
    $shipping_address_1 = WC()->customer->get_shipping_address_1();
    $shipping_address_2 = WC()->customer->get_shipping_address_2();
    $full_address = $shipping_address_1 . ' ' . $shipping_address_2;

    if ( avocadoss_is_jeju_or_island_address( $shipping_postcode, $full_address ) ) {
        // Add 4,000 KRW fee
        WC()->cart->add_fee( '제주/도서산간 추가배송비', 4000, false );
    }
}

function avocadoss_is_jeju_or_island_address( $postcode, $address ) {
    // 1. Clean postcode (numbers only)
    $clean_postcode = preg_replace( '/[^0-9]/', '', $postcode );

    if ( ! empty( $clean_postcode ) ) {
        $zip = intval( $clean_postcode );

        // Jeju 5-digit postcodes: 63000 ~ 63699
        if ( $zip >= 63000 && $zip <= 63699 ) {
            return true;
        }

        // Jeju old 6-digit postcodes: 690000 ~ 699999
        if ( $zip >= 690000 && $zip <= 699999 ) {
            return true;
        }

        // Island Postcode ranges (5-digit)
        // Incheon Ongjin-gun: 23100 ~ 23136
        if ( $zip >= 23100 && $zip <= 23136 ) {
            return true;
        }
        // Gyeongnam Ulleung-gun (Ulleungdo/Dokdo): 40200 ~ 40240
        if ( $zip >= 40200 && $zip <= 40240 ) {
            return true;
        }
        // Jeonnam Shinan-gun: 58800 ~ 58866
        if ( $zip >= 58800 && $zip <= 58866 ) {
            return true;
        }
        // Jeonnam Jindo-gun: 58900 ~ 58958
        if ( $zip >= 58900 && $zip <= 58958 ) {
            return true;
        }
        // Jeonnam Wando-gun: 59100 ~ 59166
        if ( $zip >= 59100 && $zip <= 59166 ) {
            return true;
        }
    }

    // 2. Keyword matching in address (fallback & extra protection)
    if ( ! empty( $address ) ) {
        $clean_address = str_replace( ' ', '', $address );

        // Jeju keywords
        if ( preg_match( '/제주|jeju/iu', $clean_address ) ) {
            return true;
        }

        // Specific island / remote area keywords
        $island_keywords = array(
            '울릉도', '울릉군', '독도', '백령도', '대청도', '소청도', '연평도', '덕적도',
            '자월도', '영흥도', '거문도', '초도', '손죽도', '조도면', '청산도', '청산면',
            '소안도', '소안면', '보길도', '보길면', '생일도', '생일면', '금당도', '금당면',
            '욕지도', '한산도', '사량도', '매물도', '추자도', '추자면', '가파도', '마라도',
            '비양도', '우도면', '우도광', '도서산간', '도서지역'
        );

        foreach ( $island_keywords as $keyword ) {
            if ( strpos( $clean_address, $keyword ) !== false ) {
                return true;
            }
        }
    }

    return false;
}


// =========================================================================
// Customer login/logout redirect
// =========================================================================

add_filter( 'woocommerce_login_redirect', 'avocadoss_customer_login_redirect', 20, 2 );
add_filter( 'login_redirect', 'avocadoss_customer_wp_login_redirect', 20, 3 );

function avocadoss_customer_wp_login_redirect( $redirect_to, $requested_redirect_to, $user ) {
    if ( is_wp_error( $user ) || avocadoss_is_staff_user( $user ) ) {
        return $redirect_to;
    }

    $requested_redirect = avocadoss_normalize_redirect_url( $requested_redirect_to );
    if ( avocadoss_should_preserve_customer_redirect( $requested_redirect ) ) {
        return $requested_redirect;
    }

    $normalized_redirect = avocadoss_normalize_redirect_url( $redirect_to );
    if ( avocadoss_should_preserve_customer_redirect( $normalized_redirect ) ) {
        return $normalized_redirect;
    }

    return avocadoss_customer_shop_redirect_url();
}

function avocadoss_customer_login_redirect( $redirect, $user ) {
    if ( is_wp_error( $user ) || avocadoss_is_staff_user( $user ) ) {
        return $redirect;
    }

    $requested_redirect = avocadoss_normalize_redirect_url( $redirect );
    if ( avocadoss_should_preserve_customer_redirect( $requested_redirect ) ) {
        return $requested_redirect;
    }

    $posted_redirect = isset( $_REQUEST['redirect'] ) ? avocadoss_normalize_redirect_url( wp_unslash( $_REQUEST['redirect'] ) ) : '';
    if ( avocadoss_should_preserve_customer_redirect( $posted_redirect ) ) {
        return $posted_redirect;
    }

    $posted_redirect_to = isset( $_REQUEST['redirect_to'] ) ? avocadoss_normalize_redirect_url( wp_unslash( $_REQUEST['redirect_to'] ) ) : '';
    if ( avocadoss_should_preserve_customer_redirect( $posted_redirect_to ) ) {
        return $posted_redirect_to;
    }

    return avocadoss_customer_shop_redirect_url();
}

add_filter( 'woocommerce_logout_default_redirect_url', 'avocadoss_customer_logout_redirect_url' );
function avocadoss_customer_logout_redirect_url( $redirect ) {
    if ( current_user_can( 'manage_options' ) || current_user_can( 'manage_woocommerce' ) || current_user_can( 'edit_posts' ) ) {
        return $redirect;
    }

    return avocadoss_customer_shop_redirect_url();
}

function avocadoss_customer_shop_redirect_url() {
    if ( function_exists( 'wc_get_page_id' ) ) {
        $shop_page_id = wc_get_page_id( 'shop' );
        if ( $shop_page_id > 0 ) {
            $shop_url = get_permalink( $shop_page_id );
            if ( $shop_url ) {
                return $shop_url;
            }
        }
    }

    return home_url( '/' );
}

function avocadoss_should_preserve_customer_redirect( $redirect ) {
    if ( '' === $redirect ) {
        return false;
    }

    $path = avocadoss_redirect_path( $redirect );
    if ( '' === $path ) {
        return false;
    }

    if ( false !== strpos( $path, '/checkout' ) || false !== strpos( $path, '/cart' ) ) {
        return true;
    }

    if ( false !== strpos( $path, '/wp-admin' ) || false !== strpos( $path, '/wp-login.php' ) ) {
        return false;
    }

    if ( false !== strpos( $path, '/my-account' ) ) {
        return false;
    }

    return true;
}

function avocadoss_normalize_redirect_url( $redirect ) {
    $redirect = trim( (string) $redirect );
    if ( '' === $redirect ) {
        return '';
    }

    return wp_validate_redirect( $redirect, '' );
}

function avocadoss_redirect_path( $redirect ) {
    $path = wp_parse_url( $redirect, PHP_URL_PATH );
    if ( ! is_string( $path ) ) {
        return '';
    }

    return '/' . ltrim( strtolower( $path ), '/' );
}

function avocadoss_is_staff_user( $user ) {
    return user_can( $user, 'manage_options' ) || user_can( $user, 'manage_woocommerce' ) || user_can( $user, 'edit_posts' );
}

// =========================================================================
// Security Hardening Features
// =========================================================================

// Disable XML-RPC
add_filter( 'xmlrpc_enabled', '__return_false' );

// Restrict WP REST API user enumeration (block /wp-json/wp/v2/users for non-logged-in users)
add_filter( 'rest_authentication_errors', function( $result ) {
    if ( ! empty( $result ) ) {
        return $result;
    }
    // Request is for user endpoint
    if ( isset( $_SERVER['REQUEST_URI'] ) && strpos( strtolower( $_SERVER['REQUEST_URI'] ), '/wp/v2/users' ) !== false ) {
        if ( ! is_user_logged_in() ) {
            return new WP_Error( 'rest_forbidden', '접근 권한이 없습니다.', array( 'status' => 401 ) );
        }
    }
    return $result;
});

// Disable detailed login error messages to prevent username enumeration
add_filter( 'login_errors', function() {
    return '입력하신 로그인 정보가 올바르지 않습니다.';
});

// Remove WordPress version query strings from styles and scripts
add_filter( 'style_loader_src', 'avocadoss_remove_wp_ver_string', 9999 );
add_filter( 'script_loader_src', 'avocadoss_remove_wp_ver_string', 9999 );
function avocadoss_remove_wp_ver_string( $src ) {
    if ( strpos( $src, 'ver=' . get_bloginfo( 'version' ) ) ) {
        $src = remove_query_arg( 'ver', $src );
    }
    return $src;
}

// =========================================================================
// Admin User Profile: Manual Points & Deposit Name Management
// =========================================================================

// Show points management fields on edit user profile screen
add_action( 'show_user_profile', 'avocadoss_admin_user_points_fields' );
add_action( 'edit_user_profile', 'avocadoss_admin_user_points_fields' );

function avocadoss_admin_user_points_fields( $user ) {
    if ( ! current_user_can( 'manage_options' ) ) {
        return;
    }

    $points = (int) get_user_meta( $user->ID, '_avocadoss_points', true );
    if ( $points < 0 ) {
        $points = 0;
    }
    
    $deposit_name = get_user_meta( $user->ID, '_deposit_name', true );
    ?>
    <hr />
    <h2>도매허브 적립금 및 입금자명 관리 (수동 조절)</h2>
    <table class="form-table">
        <tr>
            <th><label for="avocadoss_points">현재 보유 적립금 (원)</label></th>
            <td>
                <input type="number" name="avocadoss_points" id="avocadoss_points" value="<?php echo esc_attr( $points ); ?>" class="regular-text" min="0" required />
                <p class="description">사용자의 현재 보유 적립금을 설정합니다. 단위는 원(KRW)입니다. 값을 수정한 후 하단의 사용자 업데이트 버튼을 클릭하면 반영됩니다.</p>
            </td>
        </tr>
        <tr>
            <th><label for="avocadoss_deposit_name">입금자명</label></th>
            <td>
                <input type="text" name="avocadoss_deposit_name" id="avocadoss_deposit_name" value="<?php echo esc_attr( $deposit_name ); ?>" class="regular-text" />
                <p class="description">자동 입금 매칭(카카오뱅크 등) 시 사용되는 사용자의 입금자명입니다.</p>
            </td>
        </tr>
    </table>
    <?php
}

// Save points management fields when profile is updated
add_action( 'personal_options_update', 'avocadoss_admin_save_user_points_fields' );
add_action( 'edit_user_profile_update', 'avocadoss_admin_save_user_points_fields' );

function avocadoss_admin_save_user_points_fields( $user_id ) {
    if ( ! current_user_can( 'manage_options' ) ) {
        return;
    }

    if ( isset( $_POST['avocadoss_points'] ) ) {
        $points = (int) $_POST['avocadoss_points'];
        if ( $points < 0 ) {
            $points = 0;
        }
        update_user_meta( $user_id, '_avocadoss_points', $points );
    }

    if ( isset( $_POST['avocadoss_deposit_name'] ) ) {
        $deposit_name = sanitize_text_field( $_POST['avocadoss_deposit_name'] );
        update_user_meta( $user_id, '_deposit_name', $deposit_name );
    }
}

// Add custom columns to Users list table
add_filter( 'manage_users_columns', 'avocadoss_add_users_points_column' );
function avocadoss_add_users_points_column( $columns ) {
    $columns['avocadoss_points'] = '보유 적립금';
    $columns['avocadoss_deposit_name'] = '입금자명';
    return $columns;
}

// Display points and deposit name in the custom columns
add_filter( 'manage_users_custom_column', 'avocadoss_show_users_points_column_content', 10, 3 );
function avocadoss_show_users_points_column_content( $output, $column_name, $user_id ) {
    if ( 'avocadoss_points' === $column_name ) {
        $points = (int) get_user_meta( $user_id, '_avocadoss_points', true );
        return '<strong>' . number_format( $points ) . '원</strong>';
    }
    if ( 'avocadoss_deposit_name' === $column_name ) {
        $deposit_name = get_user_meta( $user_id, '_deposit_name', true );
        return esc_html( $deposit_name ? $deposit_name : '-' );
    }
    return $output;
}

// Make the points column sortable
add_filter( 'manage_users_sortable_columns', 'avocadoss_make_users_points_column_sortable' );
function avocadoss_make_users_points_column_sortable( $columns ) {
    $columns['avocadoss_points'] = 'avocadoss_points';
    return $columns;
}

// Handle points sorting logic
add_action( 'pre_get_users', 'avocadoss_sort_users_by_points' );
function avocadoss_sort_users_by_points( $query ) {
    if ( ! is_admin() ) {
        return;
    }
    
    $orderby = $query->get( 'orderby' );
    if ( 'avocadoss_points' === $orderby ) {
        $query->set( 'meta_key', '_avocadoss_points' );
        $query->set( 'orderby', 'meta_value_num' );
    }
}

