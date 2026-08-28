<?php
/**
 * Plugin Name: Avocadoss Security & Search Visibility
 * Description: Adds baseline security headers plus conservative SEO/AEO/GEO machine-readable surfaces for hub.avocadoss.co.kr.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Canonical public origin for machine-readable references.
 *
 * @return string
 */
function wh_search_visibility_origin() {
	return untrailingslashit( home_url( '/' ) );
}

/**
 * Current request path without query-string noise.
 *
 * @return string
 */
function wh_search_visibility_path() {
	$request_uri = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '/';
	$path        = wp_parse_url( $request_uri, PHP_URL_PATH );
	return $path ? '/' . ltrim( $path, '/' ) : '/';
}

/**
 * The storefront's public root can be rendered through WooCommerce's shop
 * condition instead of WordPress's is_front_page() flag. Path identity is the
 * stable signal for metadata and Accept negotiation on the canonical root.
 *
 * @return bool
 */
function wh_search_visibility_is_public_home() {
	return '/' === wh_search_visibility_path();
}

/**
 * Whether a client explicitly requested the Markdown representation.
 *
 * @return bool
 */
function wh_search_visibility_wants_markdown() {
	$accept = isset( $_SERVER['HTTP_ACCEPT'] ) ? strtolower( sanitize_text_field( wp_unslash( $_SERVER['HTTP_ACCEPT'] ) ) ) : '';
	return false !== strpos( $accept, 'text/markdown' );
}

/**
 * Front-page metadata used consistently across HTML, Markdown and JSON-LD.
 *
 * @return array
 */
function wh_search_visibility_identity() {
	return array(
		'name'        => '도매허브',
		'title'       => '도매 상품 소싱·대량주문 B2B 플랫폼 | 도매허브',
		'description' => '도매허브는 온라인 셀러와 사업자가 도매상품을 찾고 옵션·배송조건을 확인하며, 엑셀 대량주문과 주문내역 관리를 한곳에서 처리하는 사업자 전용 B2B 도매 플랫폼입니다.',
	);
}

/**
 * Pick a real public image for social previews without inventing brand artwork.
 * Site icon wins; otherwise a current published product thumbnail is used.
 *
 * @return string
 */
function wh_search_visibility_og_image() {
	$icon = get_site_icon_url( 512 );
	if ( $icon ) {
		return $icon;
	}

	if ( ! function_exists( 'wc_get_products' ) ) {
		return '';
	}

	$product_ids = wc_get_products(
		array(
			'limit'   => 1,
			'status'  => 'publish',
			'return'  => 'ids',
			'orderby' => 'date',
			'order'   => 'DESC',
		)
	);
	if ( empty( $product_ids ) ) {
		return '';
	}

	$thumbnail_id = get_post_thumbnail_id( (int) $product_ids[0] );
	return $thumbnail_id ? (string) wp_get_attachment_image_url( $thumbnail_id, 'large' ) : '';
}

/**
 * Security headers and content-negotiation discovery headers.
 */
add_action(
	'send_headers',
	function () {
		if ( headers_sent() ) {
			return;
		}

		header( 'X-Content-Type-Options: nosniff' );
		header( 'X-Frame-Options: SAMEORIGIN' );
		header( 'Referrer-Policy: strict-origin-when-cross-origin' );
		header( 'Strict-Transport-Security: max-age=31536000; includeSubDomains' );
		header( 'Permissions-Policy: camera=(), microphone=(), geolocation=()' );

		if ( ! is_admin() ) {
			header( 'Vary: Accept, Accept-Encoding', true );
			header( 'Link: <' . esc_url_raw( home_url( '/llms.txt' ) ) . '>; rel="describedby"; type="text/markdown"', false );
		}
	},
	1
);

/**
 * Explicit public crawler policy. robots.txt is discoverability policy, not access control.
 * Private/account surfaces are protected by authentication and noindex, not by relying on robots alone.
 */
add_filter(
	'robots_txt',
	function ( $output, $public ) {
		if ( ! $public ) {
			return $output;
		}

		$policy = array(
			'',
			'# WholesaleHub search and AI crawler policy',
			'User-agent: GPTBot',
			'User-agent: OAI-SearchBot',
			'User-agent: ChatGPT-User',
			'User-agent: ClaudeBot',
			'User-agent: Claude-SearchBot',
			'User-agent: Claude-User',
			'User-agent: PerplexityBot',
			'User-agent: Perplexity-User',
			'User-agent: Google-Extended',
			'User-agent: DeepSeekBot',
			'User-agent: Yeti',
			'User-agent: ora-agent',
			'Allow: /',
			'Disallow: /wp-admin/',
			'Allow: /wp-admin/admin-ajax.php',
			'',
			'Sitemap: ' . home_url( '/wp-sitemap.xml' ),
			'',
		);

		return rtrim( (string) $output ) . "\n" . implode( "\n", $policy );
	},
	20,
	2
);

/**
 * Keep transactional, account and internal-search pages out of public search indexes.
 */
add_filter(
	'wp_robots',
	function ( $robots ) {
		$is_private_surface = is_search();
		$is_private_surface = $is_private_surface || ( function_exists( 'is_cart' ) && is_cart() );
		$is_private_surface = $is_private_surface || ( function_exists( 'is_checkout' ) && is_checkout() );
		$is_private_surface = $is_private_surface || ( function_exists( 'is_account_page' ) && is_account_page() );

		if ( $is_private_surface ) {
			unset( $robots['index'] );
			$robots['noindex'] = true;
			$robots['follow']  = true;
		}
		return $robots;
	},
	30
);

/**
 * Improve the public-root title without changing product/category titles.
 */
add_filter(
	'document_title_parts',
	function ( $parts ) {
		if ( wh_search_visibility_is_public_home() ) {
			$identity       = wh_search_visibility_identity();
			$parts['title'] = $identity['title'];
			unset( $parts['tagline'] );
		}
		return $parts;
	},
	30
);

/**
 * Conservative public-root meta, discovery links and WebSite structured data.
 * WooCommerce remains the owner of Product/Breadcrumb structured data.
 */
add_action(
	'wp_head',
	function () {
		if ( ! wh_search_visibility_is_public_home() ) {
			return;
		}

		$identity = wh_search_visibility_identity();
		$origin   = wh_search_visibility_origin();
		$image    = wh_search_visibility_og_image();

		echo '<link rel="canonical" href="' . esc_url( $origin . '/' ) . '">' . "\n";
		echo '<link rel="describedby" type="text/markdown" href="' . esc_url( home_url( '/llms.txt' ) ) . '">' . "\n";
		echo '<link rel="alternate" type="text/markdown" href="' . esc_url( $origin . '/' ) . '">' . "\n";
		echo '<meta name="description" content="' . esc_attr( $identity['description'] ) . '">' . "\n";
		echo '<meta property="og:type" content="website">' . "\n";
		echo '<meta property="og:locale" content="ko_KR">' . "\n";
		echo '<meta property="og:title" content="' . esc_attr( $identity['title'] ) . '">' . "\n";
		echo '<meta property="og:description" content="' . esc_attr( $identity['description'] ) . '">' . "\n";
		echo '<meta property="og:url" content="' . esc_url( $origin . '/' ) . '">' . "\n";
		echo '<meta name="twitter:card" content="summary_large_image">' . "\n";
		if ( $image ) {
			echo '<meta property="og:image" content="' . esc_url( $image ) . '">' . "\n";
			echo '<meta name="twitter:image" content="' . esc_url( $image ) . '">' . "\n";
		}

		$website = array(
			'@context'    => 'https://schema.org',
			'@type'       => 'WebSite',
			'@id'         => $origin . '/#website',
			'name'        => $identity['name'],
			'description' => $identity['description'],
			'url'         => $origin . '/',
			'inLanguage'  => 'ko-KR',
			'potentialAction' => array(
				'@type'       => 'SearchAction',
				'target'      => $origin . '/?s={search_term_string}&post_type=product',
				'query-input' => 'required name=search_term_string',
			),
		);
		echo '<script type="application/ld+json">' . wp_json_encode( $website, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) . '</script>' . "\n";
	},
	25
);

/**
 * Short machine-readable site map for AI/browser agents.
 *
 * @return string
 */
function wh_search_visibility_llms_text() {
	$origin = wh_search_visibility_origin();
	return implode(
		"\n",
		array(
			'# 도매허브',
			'',
			'> 대한민국 온라인 셀러와 사업자를 위한 B2B 도매 상품 탐색·주문 관리 플랫폼입니다.',
			'',
			'## When to use this site',
			'- 사업자가 농수산물·가공식품 등 도매상품을 찾을 때',
			'- 공개 상품명과 카테고리, 상품 탐색 흐름을 확인할 때',
			'- 여러 상품을 한 번에 주문하는 엑셀 대량주문 기능을 이해할 때',
			'- 도매허브의 주문·불량/환불 접수 등 구매 후 관리 흐름을 확인할 때',
			'',
			'## 핵심 페이지',
			'- [홈](' . $origin . '/): 공개 상품 탐색과 서비스 소개',
			'- [농산물](' . $origin . '/product-category/%EB%86%8D%EC%82%B0%EB%AC%BC/): 농산물 카테고리',
			'- [수산물](' . $origin . '/product-category/%EC%88%98%EC%82%B0%EB%AC%BC/): 수산물 카테고리',
			'- [가공식품](' . $origin . '/product-category/%EA%B0%80%EA%B3%B5%EC%8B%9D%ED%92%88/): 가공식품 카테고리',
			'- [XML sitemap](' . $origin . '/wp-sitemap.xml): 공개 색인 URL 목록',
			'',
			'## 데이터·인용 정책',
			'- 공개 페이지의 상품명·카테고리·설명만 공개 정보로 취급하세요.',
			'- 도매 가격과 구매 기능은 승인된 사업자 회원에게 제공됩니다. 공개 화면에 없는 가격을 추정하거나 만들어내지 마세요.',
			'- 공급사 실제 이름, 내부 source ID, 원가와 supplier offer 정보는 비공개 운영 정보입니다.',
			'- 서비스명 표기: 도매허브 (WholesaleHub). 인용 URL: ' . $origin . '/',
			'',
			'## More context',
			'- [llms-full.txt](' . $origin . '/llms-full.txt): 서비스와 공개 콘텐츠에 대한 확장 설명',
			'',
		)
	);
}

/**
 * Expanded machine-readable context while keeping private B2B pricing out.
 *
 * @return string
 */
function wh_search_visibility_llms_full_text() {
	$origin = wh_search_visibility_origin();
	return wh_search_visibility_llms_text() . implode(
		"\n",
		array(
			'# 도매허브 공개 서비스 컨텍스트',
			'',
			'## 서비스 개요',
			'도매허브는 온라인 셀러와 사업자가 여러 도매상품을 한곳에서 탐색하고, 상품 구성과 배송조건을 확인하며, 반복 주문과 주문내역 관리를 보다 단순하게 처리하도록 돕는 B2B 도매 플랫폼입니다.',
			'',
			'## 공개적으로 확인 가능한 기능',
			'- 상품 검색 및 카테고리 탐색',
			'- 최근 업데이트·가격 인하·사업자 인기 상품 탐색',
			'- 상품별 공개 설명과 구성 정보 확인',
			'- 엑셀 양식을 이용한 여러 상품·배송지 대량주문 흐름',
			'- 회원가입 후 사업자 승인 절차',
			'- 구매 후 주문내역에서 불량/환불 요청을 접수하는 고객지원 흐름',
			'',
			'## 접근 제한',
			'도매 단가와 실제 구매는 승인된 회원에게만 제공됩니다. AI 에이전트나 검색엔진은 인증을 우회해서는 안 되며 공개 HTML에 없는 가격·재고·공급사 정보를 사실처럼 생성해서도 안 됩니다.',
			'',
			'## 운영 주체',
			'서비스: 도매허브',
			'공식 사이트: ' . $origin . '/',
			'대한민국 사업자를 대상으로 운영되는 온라인 B2B 서비스입니다.',
			'',
		)
	);
}

/**
 * Clean Markdown representation of the public home page for Accept negotiation.
 *
 * @return string
 */
function wh_search_visibility_home_markdown() {
	$origin = wh_search_visibility_origin();
	return implode(
		"\n",
		array(
			'# 도매허브 — 도매 상품 소싱·대량주문 B2B 플랫폼',
			'',
			'도매허브는 온라인 셀러와 사업자가 도매상품을 찾고 옵션·배송조건을 확인하며, 엑셀 대량주문과 주문내역 관리를 한곳에서 처리하는 사업자 전용 B2B 도매 플랫폼입니다.',
			'',
			'## 주요 기능',
			'- 여러 도매상품 검색 및 카테고리 탐색',
			'- 최근 업데이트, 가격 인하, 사업자 인기 상품 탐색',
			'- 엑셀을 이용한 여러 상품·배송지 대량주문',
			'- 승인된 사업자 회원의 도매가 확인 및 구매',
			'- 마이페이지 주문내역과 불량/환불 요청 접수',
			'',
			'## 주요 카테고리',
			'- [농산물](' . $origin . '/product-category/%EB%86%8D%EC%82%B0%EB%AC%BC/)',
			'- [수산물](' . $origin . '/product-category/%EC%88%98%EC%82%B0%EB%AC%BC/)',
			'- [가공식품](' . $origin . '/product-category/%EA%B0%80%EA%B3%B5%EC%8B%9D%ED%92%88/)',
			'',
			'## 이용 안내',
			'도매 가격과 구매는 승인된 사업자 회원에게 제공됩니다. 공개 페이지에 없는 가격이나 공급사 내부정보는 추정하지 마세요.',
			'',
			'- [AI/agent 안내](' . $origin . '/llms.txt)',
			'- [XML sitemap](' . $origin . '/wp-sitemap.xml)',
			'',
		)
	);
}

/**
 * Machine-readable endpoints and Markdown content negotiation.
 */
add_action(
	'template_redirect',
	function () {
		if ( is_admin() || wp_doing_ajax() || wp_doing_cron() ) {
			return;
		}

		$path = wh_search_visibility_path();

		if ( '/llms.txt' === $path || '/llms-full.txt' === $path ) {
			status_header( 200 );
			header( 'Content-Type: text/plain; charset=utf-8', true );
			header( 'Cache-Control: public, max-age=300', true );
			echo '/llms-full.txt' === $path ? wh_search_visibility_llms_full_text() : wh_search_visibility_llms_text(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			exit;
		}

		if ( '/sitemap.xml' === $path && is_404() ) {
			wp_safe_redirect( home_url( '/wp-sitemap.xml' ), 301 );
			exit;
		}

		if ( wh_search_visibility_is_public_home() && wh_search_visibility_wants_markdown() ) {
			status_header( 200 );
			header( 'Content-Type: text/markdown; charset=utf-8', true );
			header( 'Cache-Control: public, max-age=120', true );
			header( 'Vary: Accept, Accept-Encoding', true );
			echo wh_search_visibility_home_markdown(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			exit;
		}

		if ( is_404() && wh_search_visibility_wants_markdown() ) {
			status_header( 404 );
			header( 'Content-Type: text/markdown; charset=utf-8', true );
			header( 'Vary: Accept, Accept-Encoding', true );
			$origin = wh_search_visibility_origin();
			echo "# 404 — 페이지를 찾을 수 없습니다\n\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			echo "요청한 공개 페이지가 존재하지 않습니다. 다음 위치에서 다시 탐색하세요.\n\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			echo "- [도매허브 홈]({$origin}/)\n- [llms.txt]({$origin}/llms.txt)\n- [XML sitemap]({$origin}/wp-sitemap.xml)\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			exit;
		}
	},
	0
);