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
		?>
		<article class="whh-product-card">
			<a class="whh-product-image" href="<?php echo esc_url( get_permalink( $product_id ) ); ?>">
				<?php echo wp_kses_post( $product->get_image( 'woocommerce_thumbnail', array( 'loading' => 'lazy', 'alt' => $product->get_name() ) ) ); ?>
				<?php if ( $badge ) : ?><span class="whh-badge"><?php echo esc_html( $badge ); ?></span><?php endif; ?>
			</a>
			<div class="whh-product-body">
				<h3><a href="<?php echo esc_url( get_permalink( $product_id ) ); ?>"><?php echo esc_html( $product->get_name() ); ?></a></h3>
				<div class="whh-price"><?php echo wp_kses_post( $product->get_price_html() ); ?></div>
				<ul class="whh-product-facts" aria-label="배송 안내">
					<li><?php echo esc_html( $settings['shipping_text'] ); ?></li>
					<li><?php echo esc_html( preg_replace( '/^결제 후\s*/u', '', $settings['fulfillment_text'] ) ); ?></li>
				</ul>
				<a class="whh-more" href="<?php echo esc_url( get_permalink( $product_id ) ); ?>">상품 보기 →</a>
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
						<a href="#product-categories">카테고리</a>
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

		<section id="product-categories" class="whh-categories" aria-labelledby="whh-category-title">
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
	</main>
</div>
<?php get_footer(); ?>