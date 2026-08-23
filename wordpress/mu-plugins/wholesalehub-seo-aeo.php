<?php
/**
 * Plugin Name: WholesaleHub SEO / AEO Baseline
 * Description: Adds conservative crawl controls and WebSite structured data for the storefront.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Keep transactional/private surfaces out of search indexes while preserving crawlable links.
 */
add_filter(
    'wp_robots',
    static function ( array $robots ): array {
        $private_surface =
            ( function_exists( 'is_cart' ) && is_cart() )
            || ( function_exists( 'is_checkout' ) && is_checkout() )
            || ( function_exists( 'is_account_page' ) && is_account_page() )
            || is_search();

        if ( $private_surface ) {
            $robots['noindex'] = true;
            $robots['follow']  = true;
            unset( $robots['index'] );
        }

        return $robots;
    },
    20
);

/**
 * Public Q&A rendered by wholesalehub-front-page.php.
 * The content is intentionally useful to people first; no special AI-only text is emitted.
 */
function wholesalehub_public_faq_items(): array {
    return array(
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
}

/**
 * WooCommerce (or an installed SEO plugin) remains the owner of Product and
 * Breadcrumb structured data. Add only a small WebSite graph on the storefront.
 * Google removed FAQ rich results in 2026, so the visible FAQ is not duplicated as
 * FAQPage markup merely to chase a discontinued search feature.
 */
add_action(
    'wp_head',
    static function (): void {
        if ( ! ( is_front_page() || ( function_exists( 'is_shop' ) && is_shop() ) ) ) {
            return;
        }

        $home = home_url( '/' );
        $graph = array(
            '@context' => 'https://schema.org',
            '@type'    => 'WebSite',
            '@id'      => $home . '#website',
            'url'      => $home,
            'name'     => '도매허브',
            'inLanguage' => 'ko-KR',
            'potentialAction' => array(
                '@type'       => 'SearchAction',
                'target'      => array(
                    '@type'       => 'EntryPoint',
                    'urlTemplate' => add_query_arg(
                        array(
                            's'         => '{search_term_string}',
                            'post_type' => 'product',
                        ),
                        $home
                    ),
                ),
                'query-input' => 'required name=search_term_string',
            ),
        );

        echo '<script type="application/ld+json" id="wholesalehub-seo-aeo-schema">'
            . wp_json_encode( $graph, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES )
            . '</script>' . PHP_EOL;
    },
    30
);

add_action(
    'wp_enqueue_scripts',
    static function (): void {
        if ( ! ( is_front_page() || ( function_exists( 'is_shop' ) && is_shop() ) ) ) {
            return;
        }
        $relative = '/assets/wholesalehub-seo-aeo.css';
        $path     = WPMU_PLUGIN_DIR . $relative;
        wp_enqueue_style(
            'wholesalehub-seo-aeo',
            WPMU_PLUGIN_URL . $relative,
            array(),
            is_readable( $path ) ? (string) filemtime( $path ) : '1.0.0'
        );
    },
    40
);
