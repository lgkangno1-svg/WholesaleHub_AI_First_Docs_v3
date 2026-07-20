<?php
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}



add_action( 'wp_head', 'avocadoss_header_dom_assets', 30 );
function avocadoss_header_dom_assets() {
    if ( is_admin() ) {
        return;
    }
    ?>
    <style>
    .custom-header-container{justify-content:space-between!important;gap:18px!important}.avocadoss-inline-brand{display:inline-flex;align-items:center;gap:10px;text-decoration:none;color:#111827!important;font-weight:900;font-size:1.38rem;letter-spacing:-.03em;white-space:nowrap;margin-right:8px}.avocadoss-inline-brand-mark{display:inline-grid;place-items:center;width:38px;height:38px;border-radius:12px;background:#16a34a;color:#fff;font-weight:900;font-size:1.05rem}.avocadoss-inline-cart{color:#2d3748;text-decoration:none;font-weight:700}.avocadoss-inline-cart:hover,.avocadoss-inline-brand:hover{color:#16a34a!important}.custom-header-search{margin-right:auto}.avocadoss-simple-buy-now{margin-left:10px!important}@media(max-width:768px){.custom-header-container{flex-wrap:wrap!important;justify-content:flex-start!important}.avocadoss-inline-brand{font-size:1.2rem}.custom-header-search{order:2;width:100%!important}.custom-header-user-status,.custom-header-nav-links{order:3;flex-wrap:wrap}.avocadoss-inline-brand-mark{width:34px;height:34px}}@media(max-width:640px){.avocadoss-simple-buy-now{display:block;width:100%;margin:10px 0 0!important}}
    </style>
    <?php
}

add_action( 'wp_footer', 'avocadoss_header_dom_script', 30 );
function avocadoss_header_dom_script() {
    if ( is_admin() ) {
        return;
    }
    $home_url = home_url( '/' );
    $cart_url = function_exists( 'wc_get_cart_url' ) ? wc_get_cart_url() : home_url( '/cart/' );
    $count = ( function_exists( 'WC' ) && WC()->cart ) ? WC()->cart->get_cart_contents_count() : 0;
    $cart_label = '장바구니' . ( $count > 0 ? ' ' . $count : '' );
    ?>
    <script>
    document.addEventListener('DOMContentLoaded',function(){
      var container=document.querySelector('.custom-top-header .custom-header-container');
      if(!container){return;}
      document.querySelectorAll('.avocadoss-top-brand-bar').forEach(function(el){el.remove();});
      if(!container.querySelector('.avocadoss-inline-brand')){
        var brand=document.createElement('a');
        brand.className='avocadoss-inline-brand';
        brand.href=<?php echo wp_json_encode( $home_url ); ?>;
        brand.setAttribute('aria-label','도매허브 홈');
        brand.innerHTML='<span class="avocadoss-inline-brand-mark">도</span><span>도매허브</span>';
        container.insertBefore(brand,container.firstChild);
      }
      // Removed duplicate cart link injection
    });
    </script>
    <?php
}

add_action( 'woocommerce_after_add_to_cart_form', 'avocadoss_multi_variation_cart_ui', 12 );
function avocadoss_multi_variation_cart_ui() {
    global $product;
    if ( ! $product || ! $product->is_type( 'variable' ) ) {
        return;
    }

    wp_enqueue_script( 'jquery' );
    avocadoss_multi_variation_assets();

    echo '<div class="avocadoss-multi-cart" data-product-id="' . esc_attr( $product->get_id() ) . '" data-nonce="' . esc_attr( wp_create_nonce( 'avocadoss_multi_cart' ) ) . '">';
    echo '<h3>선택한 옵션 목록</h3>';
    echo '<p class="avocadoss-multi-cart-note">위 옵션 드롭다운에서 옵션을 선택하면 여기에 추가됩니다.</p>';
    echo '<div class="avocadoss-selected-options" aria-live="polite"></div>';
    echo '<div class="avocadoss-empty-selection">아직 선택한 옵션이 없습니다.</div>';
    echo '<div class="avocadoss-selected-total">총 선택 금액: <strong>0원</strong></div>';
    echo '<div class="avocadoss-purchase-actions">';
    echo '<button type="button" class="button avocadoss-add-selected" disabled>장바구니 담기</button>';
    echo '<button type="button" class="button alt avocadoss-buy-selected" disabled>바로구매</button>';
    echo '</div>';
    echo '<div class="avocadoss-multi-cart-message" role="status"></div>';
    echo '</div>';
}

add_action( 'woocommerce_after_add_to_cart_button', 'avocadoss_simple_buy_now_button', 20 );
function avocadoss_simple_buy_now_button() {
    global $product;
    if ( ! $product || ! $product->is_type( 'simple' ) || ! $product->is_purchasable() || ! $product->is_in_stock() ) {
        return;
    }

    echo '<button type="button" class="button alt avocadoss-simple-buy-now" data-product-id="' . esc_attr( $product->get_id() ) . '">바로구매</button>';
}

add_filter( 'woocommerce_add_to_cart_redirect', 'avocadoss_buy_now_redirect' );
function avocadoss_buy_now_redirect( $url ) {
    if ( isset( $_REQUEST['avocadoss_buy_now'] ) && '1' === sanitize_text_field( wp_unslash( $_REQUEST['avocadoss_buy_now'] ) ) ) {
        return wc_get_checkout_url();
    }
    return $url;
}

add_action( 'wp_footer', 'avocadoss_simple_buy_now_script', 40 );
function avocadoss_simple_buy_now_script() {
    if ( ! is_product() ) {
        return;
    }
    ?>
    <script>
    document.addEventListener('click',function(event){
      var button=event.target.closest('.avocadoss-simple-buy-now');
      if(!button){return;}
      var form=button.closest('form.cart');
      if(!form||!form.reportValidity()){return;}
      ['add-to-cart','avocadoss_buy_now'].forEach(function(name){
        var input=form.querySelector('input[type="hidden"][name="'+name+'"]');
        if(!input){input=document.createElement('input');input.type='hidden';input.name=name;form.appendChild(input);}
        input.value=name==='add-to-cart'?button.getAttribute('data-product-id'):'1';
      });
      button.disabled=true;
      form.submit();
    });
    </script>
    <?php
}

add_action( 'wp_ajax_avocadoss_add_multi_variations', 'avocadoss_add_multi_variations' );
add_action( 'wp_ajax_nopriv_avocadoss_add_multi_variations', 'avocadoss_add_multi_variations' );
function avocadoss_add_multi_variations() {
    check_ajax_referer( 'avocadoss_multi_cart', 'nonce' );
    $product_id = absint( $_POST['product_id'] ?? 0 );
    $items = json_decode( wp_unslash( $_POST['items'] ?? '[]' ), true );
    if ( ! $product_id || ! is_array( $items ) ) {
        wp_send_json_error( array( 'message' => '선택한 옵션이 없습니다.' ), 400 );
    }

    $added = 0;
    $errors = array();
    foreach ( $items as $item ) {
        $variation_id = absint( $item['variation_id'] ?? 0 );
        $quantity = absint( $item['quantity'] ?? 0 );
        $label = sanitize_text_field( $item['label'] ?? (string) $variation_id );
        if ( $variation_id <= 0 || $quantity <= 0 ) {
            continue;
        }
        $variation = wc_get_product( $variation_id );
        if ( ! $variation || (int) $variation->get_parent_id() !== $product_id ) {
            $errors[] = $label . ': 상품 정보가 일치하지 않습니다.';
            continue;
        }
        if ( ! $variation->is_purchasable() || ! $variation->is_in_stock() ) {
            $errors[] = $label . ': 품절 또는 구매 불가입니다.';
            continue;
        }
        if ( WC()->cart->add_to_cart( $product_id, $quantity, $variation_id, $variation->get_variation_attributes() ) ) {
            $added++;
        } else {
            $errors[] = $label . ': 장바구니 담기 실패';
        }
    }

    if ( 0 === $added ) {
        wp_send_json_error( array( 'message' => '장바구니에 담긴 옵션이 없습니다.', 'errors' => $errors ), 400 );
    }

    wp_send_json_success( array( 'message' => '선택한 옵션이 장바구니에 담겼습니다.', 'cart_url' => wc_get_cart_url(), 'checkout_url' => wc_get_checkout_url(), 'errors' => $errors ) );
}

add_filter( 'wp_nav_menu_items', 'avocadoss_add_cart_link_to_menu', 20, 2 );
function avocadoss_add_cart_link_to_menu( $items, $args ) {
    if ( is_admin() || ! function_exists( 'WC' ) || ! WC()->cart ) {
        return $items;
    }
    $count = WC()->cart->get_cart_contents_count();
    $label = '장바구니' . ( $count > 0 ? ' ' . $count : '' );
    $items .= '<li class="menu-item avocadoss-header-cart-menu"><a class="avocadoss-header-cart-link" href="' . esc_url( wc_get_cart_url() ) . '">' . esc_html( $label ) . '</a></li>';
    return $items;
}

add_filter( 'woocommerce_add_to_cart_fragments', 'avocadoss_cart_menu_fragment' );
function avocadoss_cart_menu_fragment( $fragments ) {
    if ( ! function_exists( 'WC' ) || ! WC()->cart ) {
        return $fragments;
    }
    $count = WC()->cart->get_cart_contents_count();
    $label = '장바구니' . ( $count > 0 ? ' ' . $count : '' );
    $fragments['a.avocadoss-header-cart-link'] = '<a class="avocadoss-header-cart-link" href="' . esc_url( wc_get_cart_url() ) . '">' . esc_html( $label ) . '</a>';
    return $fragments;
}

function avocadoss_multi_variation_assets() {
    static $printed = false;
    if ( $printed ) {
        return;
    }
    $printed = true;
    ?>
    <style>
    .avocadoss-top-brand-bar{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px clamp(16px,4vw,42px);background:#fff;border-bottom:1px solid #e5e7eb;position:relative;z-index:30}.avocadoss-top-brand{display:inline-flex;align-items:center;gap:9px;text-decoration:none;color:#111827;font-weight:800;font-size:1.25rem}.avocadoss-top-brand-mark{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#16a34a;color:#fff;font-weight:900}.avocadoss-top-cart{white-space:nowrap;text-decoration:none;color:#111827;font-weight:800;padding:8px 12px;border:1px solid #d1d5db;border-radius:999px;background:#f9fafb}.avocadoss-top-cart:hover,.avocadoss-top-brand:hover{color:#16a34a}.single-product form.variations_form .woocommerce-variation-add-to-cart,.single-product form.variations_form .single_add_to_cart_button,.single-product form.variations_form > .quantity{display:none!important}.single-product form.variations_form .woocommerce-variation.single_variation{display:block!important;margin-bottom:12px}@media(max-width:640px){.avocadoss-top-brand-bar{padding:10px 14px}.avocadoss-top-brand-text{font-size:1.08rem}.avocadoss-top-cart{padding:7px 10px}}.avocadoss-multi-cart{margin:22px 0;padding:18px;border:1px solid #e2e8f0;border-radius:14px;background:#fff}.avocadoss-multi-cart h3{margin:0 0 8px;font-size:1.1rem}.avocadoss-multi-cart-note,.avocadoss-empty-selection{margin:0 0 14px;color:#64748b}.avocadoss-selected-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:10px;padding:12px 0;border-top:1px solid #edf2f7}.avocadoss-selected-info{display:flex;flex-direction:column;gap:4px}.avocadoss-selected-info strong{line-height:1.35}.avocadoss-selected-info span{font-weight:700;color:#1a202c}.avocadoss-selected-qty{display:flex;align-items:center;gap:6px}.avocadoss-selected-qty input{width:58px;text-align:center}.avocadoss-selected-qty button,.avocadoss-remove-selected{min-width:34px;height:34px;border:1px solid #cbd5e0;background:#f8fafc;border-radius:8px;color:#111827!important;font-size:20px!important;font-weight:800;line-height:1;display:inline-flex;align-items:center;justify-content:center;text-indent:0!important;overflow:visible}.avocadoss-selected-qty button:hover{background:#eef2f7;border-color:#94a3b8}.avocadoss-remove-selected{color:#b91c1c!important;font-size:14px!important}.avocadoss-selected-total{display:flex;justify-content:flex-end;margin-top:12px;font-size:1rem}.avocadoss-purchase-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.avocadoss-purchase-actions .button{width:100%;margin:0}.avocadoss-purchase-actions .button:disabled{opacity:.5;cursor:not-allowed}.avocadoss-multi-cart-message{margin-top:10px;font-weight:600}.avocadoss-header-cart-menu a{font-weight:700}@media(max-width:640px){.avocadoss-selected-row{grid-template-columns:1fr;align-items:flex-start}.avocadoss-selected-qty,.avocadoss-purchase-actions{width:100%}.avocadoss-purchase-actions{grid-template-columns:1fr}.avocadoss-selected-qty input{flex:1}.avocadoss-remove-selected{width:100%}}
    </style>
    <script>
    jQuery(function($){
      function money(v){return new Intl.NumberFormat('ko-KR').format(Math.round(Number(v)||0))+'원';}
      function labelFromForm(form){var parts=[];form.find('select').each(function(){var txt=$(this).find('option:selected').text();if(txt&&txt.indexOf('옵션')===-1){parts.push($.trim(txt));}});return parts.join(' / ');}
      function rows(box){return box.find('.avocadoss-selected-row');}
      function refresh(box){var total=0;rows(box).each(function(){total += Number($(this).data('price')) * parseInt($(this).find('input').val()||'0',10);});box.find('.avocadoss-selected-total strong').text(money(total));box.find('.avocadoss-empty-selection').toggle(rows(box).length===0);box.find('.avocadoss-add-selected,.avocadoss-buy-selected').prop('disabled',rows(box).length===0);}
      $('form.variations_form').on('found_variation',function(e,variation){var form=$(this);var box=form.siblings('.avocadoss-multi-cart');if(!box.length){box=form.closest('.product').find('.avocadoss-multi-cart').first();}if(!box.length||!variation||!variation.variation_id){return;}if(variation.is_in_stock===false||variation.is_purchasable===false){box.find('.avocadoss-multi-cart-message').text('품절 또는 구매 불가 옵션입니다.');return;}var id=String(variation.variation_id);var existing=box.find('.avocadoss-selected-row[data-variation-id="'+id+'"]');if(existing.length){var input=existing.find('input');input.val(parseInt(input.val()||'0',10)+1);box.find('.avocadoss-multi-cart-message').text('이미 선택한 옵션이라 수량을 1개 늘렸습니다.');refresh(box);return;}var label=labelFromForm(form)||variation.variation_description||'선택 옵션';var price=variation.display_price||variation.display_regular_price||0;var row=$('<div class="avocadoss-selected-row"/>').attr('data-variation-id',id).attr('data-label',label).data('price',price);row.append($('<div class="avocadoss-selected-info"/>').append($('<strong/>').text(label)).append($('<span/>').text(money(price))));row.append('<div class="avocadoss-selected-qty"><button type="button" class="avocadoss-qty-minus" aria-label="수량 감소"><span aria-hidden="true">-</span></button><input type="number" min="1" step="1" value="1" inputmode="numeric" aria-label="선택 옵션 수량"><button type="button" class="avocadoss-qty-plus" aria-label="수량 증가"><span aria-hidden="true">+</span></button></div>');row.append('<button type="button" class="avocadoss-remove-selected">삭제</button>');box.find('.avocadoss-selected-options').append(row);box.find('.avocadoss-multi-cart-message').text('선택 목록에 추가했습니다.');refresh(box);});
      $(document).on('click','.avocadoss-qty-minus,.avocadoss-qty-plus',function(){var input=$(this).siblings('input');var v=parseInt(input.val()||'1',10)+($(this).hasClass('avocadoss-qty-plus')?1:-1);input.val(Math.max(1,v));refresh($(this).closest('.avocadoss-multi-cart'));});
      $(document).on('change','.avocadoss-selected-qty input',function(){this.value=Math.max(1,parseInt(this.value||'1',10));refresh($(this).closest('.avocadoss-multi-cart'));});
      $(document).on('click','.avocadoss-remove-selected',function(){var box=$(this).closest('.avocadoss-multi-cart');$(this).closest('.avocadoss-selected-row').remove();refresh(box);});
      $(document).on('click','.avocadoss-add-selected,.avocadoss-buy-selected',function(){var btn=$(this);var box=btn.closest('.avocadoss-multi-cart');var buyNow=btn.hasClass('avocadoss-buy-selected');var items=[];rows(box).each(function(){items.push({variation_id:$(this).data('variation-id'),quantity:parseInt($(this).find('input').val()||'1',10),label:$(this).data('label')});});var msg=box.find('.avocadoss-multi-cart-message');if(!items.length){msg.text('선택한 옵션이 없습니다.');return;}box.find('.avocadoss-add-selected,.avocadoss-buy-selected').prop('disabled',true);$.post(wc_add_to_cart_params.ajax_url,{action:'avocadoss_add_multi_variations',nonce:box.data('nonce'),product_id:box.data('product-id'),items:JSON.stringify(items)}).done(function(res){msg.text(res.data.message);if(buyNow&&res.data.checkout_url){window.location.href=res.data.checkout_url;return;}$(document.body).trigger('wc_fragment_refresh');}).fail(function(xhr){var data=xhr.responseJSON&&xhr.responseJSON.data;msg.text((data&&data.message)||'장바구니 담기에 실패했습니다.');}).always(function(){refresh(box);});});
      $('.avocadoss-multi-cart').each(function(){refresh($(this));});
    });
    </script>
    <?php
}
