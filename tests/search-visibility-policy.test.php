<?php
/**
 * Static regression contract for the WordPress search-visibility layer.
 * Runs without bootstrapping WordPress so CI can catch accidental removals cheaply.
 */

$root     = dirname( __DIR__ );
$policy   = file_get_contents( $root . '/wordpress/mu-plugins/avocadoss-security-headers.php' );
$homepage = file_get_contents( $root . '/wordpress/plugins/avocadoss-performance/templates/wholesalehub-front-page.php' );

if ( false === $policy || false === $homepage ) {
	fwrite( STDERR, "fixture read failed\n" );
	exit( 1 );
}

$required_policy_signals = array(
	"'/llms.txt'",
	"'/llms-full.txt'",
	"'text/markdown'",
	"'Vary: Accept, Accept-Encoding'",
	"wh_search_visibility_is_public_home",
	"'OAI-SearchBot'",
	"'ChatGPT-User'",
	"'Claude-SearchBot'",
	"'PerplexityBot'",
	"'Yeti'",
	"'DeepSeekBot'",
	"'ora-agent'",
	"'Sitemap: ' . home_url( '/wp-sitemap.xml' )",
	"add_filter(\n\t'wp_robots'",
	"'noindex'",
	"'WebSite'",
	"'SearchAction'",
	"rel=\"canonical\"",
	"'og:type'",
	"'og:image'",
	"'/sitemap.xml'",
	"status_header( 404 )",
	'공개 화면에 없는 가격을 추정하거나 만들어내지 마세요.',
);

foreach ( $required_policy_signals as $signal ) {
	if ( false === strpos( $policy, $signal ) ) {
		fwrite( STDERR, "missing search visibility signal: {$signal}\n" );
		exit( 1 );
	}
}

$required_homepage_signals = array(
	'id="recent-updates"',
	'최근 업데이트 상품',
	'상품 보기 →',
	'id="product-categories"',
	'카테고리별 상품 탐색',
);

foreach ( $required_homepage_signals as $signal ) {
	if ( false === strpos( $homepage, $signal ) ) {
		fwrite( STDERR, "missing product-first homepage signal: {$signal}\n" );
		exit( 1 );
	}
}

if ( false !== strpos( $homepage, '도매허브는 어떤 서비스인가요?' ) || false !== strpos( $homepage, 'id="wholesalehub-guide"' ) ) {
	fwrite( STDERR, "oversized guide returned to the product-first homepage\n" );
	exit( 1 );
}

$recent_position   = strpos( $homepage, 'id="recent-updates"' );
$category_position = strpos( $homepage, 'id="product-categories"' );
if ( false === $recent_position || false === $category_position || $recent_position >= $category_position ) {
	fwrite( STDERR, "product discovery order regressed\n" );
	exit( 1 );
}

if ( preg_match( '/최저가\s*보장|수익\s*보장|무조건\s*최저/u', $policy . $homepage ) ) {
	fwrite( STDERR, "prohibited exaggerated marketing claim detected\n" );
	exit( 1 );
}

echo "SEARCH_VISIBILITY_POLICY_OK\n";
