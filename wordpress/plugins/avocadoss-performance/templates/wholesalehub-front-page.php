<?php
/**
 * WholesaleHub front page.
 *
 * @package AvocadossPerformance
 */

defined( 'ABSPATH' ) || exit;

$settings    = WholesaleHub_Homepage::settings();
$limit       = max( 1, min( 8, (int) $settings['section_limit'] ) );
$recent_ids  = $settings['enable_all_products'] ? WholesaleHub_Homepage::latest_product_ids( $limit ) : array();
$drop_ids    = $settings['enable_price_drops'] ? array_slice( WholesaleHub_Homepage::cached_ids( WholesaleHub_Homepage::DROP_CACHE ), 0, $limit ) : array();
$popular_ids = $settings['enable_popular'] ? array_slice( WholesaleHub_Homepage::cached_ids( WholesaleHub_Homepage::POPULAR_CACHE ), 0, $limit ) : array();
$faq_items   = function_exists( 'wholesalehub_public_faq_items' )
    ? wholesalehub_public_faq_items()
    : array(
        array(
            'question' => '도매허브는 어떤 서비스인가요?',
            'answer'   => '도매허브는 사업자가 여러 도매상품의 구성과 판매 조건을 확인하고 필요한 상품을 주문할 수 있는 B2B 도매 쇼핑몰입니다.',
        ),
        array(
            'question' => '상품 가격과 재고는 어떻게 관리되나요?',
            'answer'   => '상품 가격과 판매 가능 여부는 연결된 공급 정보를 기준으로 동기화하며, 공급 상황에 따라 가격·재고·출고 조건이 바뀔 수 있습니다. 주문 전 상품 상세의 최신 정보를 확인해주세요.',
        ),
        array(
            'question' => '배송 중 파손이나 상품 불량은 어디에서 접수하나요?',
            'answer'   => '마이페이지의 주문내역에서 해당 주문을 열고 상품별 불량·환불 요청을 접수할 수 있습니다. 운송장, 박스 외관, 파손·불량 상품, 거래내역 증빙 사진이 필요합니다.',
        ),
        array(
            'question' => '제주도와 도서산간 지역도 배송되나요?',
            'answer'   => '현재 생물 상품의 품질 관리를 위해 제주도 및 도서산간 지역 배송은 지원하지 않습니다. 주문 단계에서 제한 지역 여부를 확인합니다.',
        ),
    );

$render_cards = static function ( $ids, $badge = '' ) use ( $settings ) {
    if ( empty( $ids ) ) {
        return;
    }
    echo '<div class="whh-product-grid">';
    foreach ( $ids as $product_id ) {
        $product = wc_get_product( $product_id );
        if ( ! $product ) {
            continue;
        }
        $permalink = get_permalink( $product_id );
        ?>
        <article class="whh-product-card">
            <a class="whh-product-image" href="<?php echo esc_url( $permalink ); ?>">
                <?php echo wp_kses_post( $product->get_image( 'woocommerce_thumbnail', array( 'loading' => 'lazy', 'alt' => $product->get_name() ) ) ); ?>
                <?php if ( $badge ) : ?><span class="whh-badge"><?php echo esc_html( $badge ); ?></span><?php endif; ?>
            </a>
            <div class="whh-product-body">
                <h3><a href="<?php echo esc_url( $permalink ); ?>"><?php echo esc_html( $product->get_name() ); ?></a></h3>
                <div class="whh-price"><?php echo wp_kses_post( $product->get_price_html() ); ?></div>
                <ul class="whh-product-facts" aria-label="배송 안내">
                    <li><?php echo esc_html( $settings['shipping_text'] ); ?></li>
                    <li><?php echo esc_html( preg_replace( '/^결제 후\s*/u', '', $settings['fulfillment_text'] ) ); ?></li>
                </ul>
                <a class="whh-card-cta" href="<?php echo esc_url( $permalink ); ?>">상품 자세히 보기 <span aria-hidden="true">→</span></a>
            </div>
        </article>
        <?php
    }
    echo '</div>';
};

get_header();
?>
<div class="whh-notice" role="note"><div class="whh-shell"><strong><?php echo esc_html( $settings['shipping_text'] ); ?></strong><span aria-hidden="true">·</span><span><?php echo esc_html( $settings['fulfillment_text'] ); ?></span><small>상품 및 공급 상황에 따라 일정이 달라질 수 있습니다.</small></div></div>

<div id="primary" class="content-area whh-home">
    <main id="main" class="site-main">
        <section class="whh-hero">
            <div class="whh-shell whh-hero-grid">
                <div class="whh-hero-copy">
                    <p class="whh-eyebrow">도매허브 · 사업자 전용 도매 마켓</p>
                    <h1>여러 도매상품을<br>한곳에서</h1>
                    <p class="whh-lead">상품과 구성 조건을 살펴보고<br>사업자에게 맞는 상품을 빠르게 찾아보세요.</p>
                    <form class="whh-search" role="search" method="get" action="<?php echo esc_url( home_url( '/' ) ); ?>">
                        <label class="screen-reader-text" for="whh-search-input">상품 검색</label>
                        <input id="whh-search-input" type="search" name="s" placeholder="상품명, 품종 또는 규격을 검색해보세요" autocomplete="off">
                        <input type="hidden" name="post_type" value="product">
                        <button type="submit" aria-label="검색">검색</button>
                    </form>
                    <div class="whh-hero-actions">
                        <?php if ( $recent_ids ) : ?><a href="#recent-updates">최근 업데이트</a><?php endif; ?>
                        <?php if ( $drop_ids ) : ?><a href="#recent-price-drops">가격 인하</a><?php endif; ?>
                        <?php if ( $popular_ids ) : ?><a href="#business-popular">사업자 인기</a><?php endif; ?>
                        <a href="#how-to-use">이용 방법</a>
                    </div>
                </div>
                <div class="whh-hero-panel" aria-hidden="true"><span>도매 상품 탐색</span><strong>필요한 품목을<br>더 빠르게 비교하세요</strong><div class="whh-panel-lines"><i></i><i></i><i></i></div></div>
            </div>
        </section>

        <?php if ( $recent_ids ) : ?>
        <section id="recent-updates" class="whh-products-section"><div class="whh-shell"><div class="whh-section-heading"><div><p class="whh-kicker">최근 업데이트</p><h2>최근 업데이트 상품</h2></div><p>방금 들어온 상품과 새로 바뀐 상품을 확인하세요.</p></div><?php $render_cards( $recent_ids, '새 상품' ); ?></div></section>
        <?php endif; ?>

        <?php if ( $drop_ids ) : ?>
        <section id="recent-price-drops" class="whh-products-section whh-products-muted"><div class="whh-shell"><div class="whh-section-heading"><div><p class="whh-kicker">가격 인하</p><h2>최근 가격 인하 상품</h2></div><p>최근 공급 조건이 좋아진 상품입니다.</p></div><?php $render_cards( $drop_ids, '가격 인하' ); ?></div></section>
        <?php endif; ?>

        <?php if ( $popular_ids ) : ?>
        <section id="business-popular" class="whh-products-section"><div class="whh-shell"><div class="whh-section-heading"><div><p class="whh-kicker">사업자 인기</p><h2>사업자 인기 상품</h2></div><p>최근 실제 주문량이 많은 상품입니다.</p></div><?php $render_cards( $popular_ids, '사업자 인기' ); ?></div></section>
        <?php endif; ?>

        <section class="whh-categories" aria-labelledby="whh-category-title">
            <div class="whh-shell">
                <div class="whh-section-heading compact"><div><p class="whh-kicker">상품 카테고리</p><h2 id="whh-category-title">카테고리별 상품 탐색</h2></div></div>
                <div class="whh-category-grid">
                    <a href="<?php echo esc_url( home_url( '/product-category/%eb%86%8d%ec%82%b0%eb%ac%bc/' ) ); ?>"><span>01</span><b>농산물</b><em>→</em></a>
                    <a href="<?php echo esc_url( home_url( '/product-category/%ec%88%98%ec%82%b0%eb%ac%bc/' ) ); ?>"><span>02</span><b>수산물</b><em>→</em></a>
                    <a href="<?php echo esc_url( home_url( '/product-category/%ec%b6%95%ec%82%b0%eb%ac%bc/' ) ); ?>"><span>03</span><b>축산물</b><em>→</em></a>
                    <a href="<?php echo esc_url( home_url( '/product-category/%ea%b0%80%ea%b3%b5%ec%8b%9d%ed%92%88/' ) ); ?>"><span>04</span><b>가공식품</b><em>→</em></a>
                    <a href="<?php echo esc_url( home_url( '/product-category/%ea%b3%b5%eb%8f%99%ea%b5%ac%eb%a7%a4/' ) ); ?>"><span>05</span><b>공동구매</b><em>→</em></a>
                </div>
            </div>
        </section>

        <section id="how-to-use" class="whh-guide" aria-labelledby="whh-guide-title">
            <div class="whh-shell">
                <div class="whh-section-heading"><div><p class="whh-kicker">처음 이용하시나요?</p><h2 id="whh-guide-title">도매허브 이용 방법</h2></div><p>상품 탐색부터 주문 이후 관리까지 한 흐름으로 확인하세요.</p></div>
                <div class="whh-guide-grid">
                    <article class="whh-guide-card"><span>01</span><h3>상품 검색</h3><p>상품명·품종·규격으로 검색하거나 카테고리에서 필요한 품목을 찾습니다.</p></article>
                    <article class="whh-guide-card"><span>02</span><h3>옵션과 배송 확인</h3><p>상품 상세에서 옵션별 가격, 판매 가능 여부와 배송 조건을 확인합니다.</p></article>
                    <article class="whh-guide-card"><span>03</span><h3>주문 및 결제</h3><p>수취인과 배송 정보를 입력하고 보유 충전금 또는 안내된 방식으로 주문을 진행합니다.</p></article>
                    <article class="whh-guide-card"><span>04</span><h3>주문 이후 관리</h3><p>마이페이지 주문내역에서 주문을 확인하고 필요하면 상품별 불량·환불 요청을 접수합니다.</p></article>
                </div>
            </div>
        </section>

        <section class="whh-faq" aria-labelledby="whh-faq-title">
            <div class="whh-shell">
                <div class="whh-section-heading"><div><p class="whh-kicker">자주 묻는 질문</p><h2 id="whh-faq-title">주문 전 알아두세요</h2></div><p>도매허브 이용에 필요한 핵심 내용을 정리했습니다.</p></div>
                <div class="whh-faq-list">
                    <?php foreach ( $faq_items as $faq ) : ?>
                        <details>
                            <summary><?php echo esc_html( $faq['question'] ); ?></summary>
                            <div class="whh-faq-answer"><p><?php echo esc_html( $faq['answer'] ); ?></p></div>
                        </details>
                    <?php endforeach; ?>
                </div>
            </div>
        </section>
    </main>
</div>
<?php get_footer(); ?>
