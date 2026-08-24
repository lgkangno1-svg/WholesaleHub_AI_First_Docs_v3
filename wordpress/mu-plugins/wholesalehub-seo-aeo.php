<?php
/**
 * Plugin Name: WholesaleHub SEO / AEO Baseline
 * Description: Adds conservative crawl controls, agent resources, Markdown negotiation and structured data for the storefront.
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
 * Public Q&A rendered by wholesalehub-front-page.php and reused by the Markdown representation.
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

function wholesalehub_agentic_request_path(): string {
    $request_uri = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( (string) $_SERVER['REQUEST_URI'] ) : '/';
    $path        = (string) parse_url( $request_uri, PHP_URL_PATH );
    $normalized  = '/' . ltrim( $path, '/' );

    return '/' === $normalized ? '/' : untrailingslashit( $normalized );
}

/**
 * Return the quality and specificity of an RFC-style Accept match.
 * Specificity is used as the tie-breaker so an explicit media type beats a wildcard.
 *
 * @return array{0: float, 1: int}
 */
function wholesalehub_accept_quality( string $accept, string $candidate ): array {
    $candidate_parts = explode( '/', strtolower( $candidate ), 2 );
    if ( 2 !== count( $candidate_parts ) ) {
        return array( 0.0, -1 );
    }

    $best_specificity = -1;
    $best_quality     = 0.0;

    foreach ( explode( ',', strtolower( $accept ) ) as $raw_range ) {
        $parts      = array_map( 'trim', explode( ';', $raw_range ) );
        $media_type = array_shift( $parts );
        if ( ! is_string( $media_type ) || '' === $media_type ) {
            continue;
        }

        $range_parts = explode( '/', $media_type, 2 );
        if ( 2 !== count( $range_parts ) ) {
            continue;
        }

        $quality = 1.0;
        foreach ( $parts as $parameter ) {
            if ( 0 === strpos( $parameter, 'q=' ) ) {
                $quality = max( 0.0, min( 1.0, (float) substr( $parameter, 2 ) ) );
            }
        }

        $specificity = -1;
        if ( '*' === $range_parts[0] && '*' === $range_parts[1] ) {
            $specificity = 0;
        } elseif ( $range_parts[0] === $candidate_parts[0] && '*' === $range_parts[1] ) {
            $specificity = 1;
        } elseif ( $range_parts[0] === $candidate_parts[0] && $range_parts[1] === $candidate_parts[1] ) {
            $specificity = 2;
        }

        if ( $specificity > $best_specificity || ( $specificity === $best_specificity && $quality > $best_quality ) ) {
            $best_specificity = $specificity;
            $best_quality     = $quality;
        }
    }

    return array( $best_quality, $best_specificity );
}

/**
 * Decide which canonical homepage representation the client prefers.
 *
 * @return 'html'|'markdown'|'none'
 */
function wholesalehub_negotiate_home_representation(): string {
    $accept = isset( $_SERVER['HTTP_ACCEPT'] ) ? trim( (string) wp_unslash( $_SERVER['HTTP_ACCEPT'] ) ) : '';
    if ( '' === $accept ) {
        return 'html';
    }

    list( $markdown_quality, $markdown_specificity ) = wholesalehub_accept_quality( $accept, 'text/markdown' );
    list( $html_quality, $html_specificity )         = wholesalehub_accept_quality( $accept, 'text/html' );

    if ( $markdown_quality <= 0.0 && $html_quality <= 0.0 ) {
        return 'none';
    }

    if ( $markdown_quality > $html_quality ) {
        return 'markdown';
    }

    if ( $markdown_quality === $html_quality && $markdown_quality > 0.0 && $markdown_specificity > $html_specificity ) {
        return 'markdown';
    }

    return 'html';
}

function wholesalehub_agentic_vary_header(): void {
    header( 'Vary: Accept, Accept-Encoding', true );
}

function wholesalehub_agentic_markdown_header( int $status = 200 ): void {
    status_header( $status );
    header( 'Content-Type: text/markdown; charset=utf-8', true );
    wholesalehub_agentic_vary_header();
    header( 'Cache-Control: public, max-age=300', true );
}

function wholesalehub_agentic_site_summary_markdown(): string {
    $home = home_url( '/' );
    $faq  = wholesalehub_public_faq_items();

    $lines = array(
        '# 도매허브 (WholesaleHub)',
        '',
        '> 여러 도매상품을 한곳에서 확인하고 주문할 수 있는 사업자 전용 B2B 도매 쇼핑몰입니다.',
        '',
        '도매허브는 농산물, 수산물, 축산물, 가공식품과 공동구매 상품을 사업자가 탐색할 수 있도록 제공합니다. 공개 화면에서는 상품명, 카테고리와 서비스 이용 방법을 확인할 수 있고, 실제 도매가 확인과 구매는 승인된 회원에게 제공됩니다. 상품 가격, 판매 가능 여부, 옵션과 배송 조건은 연결된 공급 정보에 따라 바뀔 수 있으므로 주문 직전 상품 상세의 최신 표시를 기준으로 판단해야 합니다.',
        '',
        '## 주요 이용 흐름',
        '',
        '1. 상품명, 품종 또는 규격으로 검색하거나 카테고리에서 상품을 찾습니다.',
        '2. 상품 상세에서 옵션별 가격, 판매 가능 여부와 배송 조건을 확인합니다.',
        '3. 승인된 사업자 회원은 수취인과 배송 정보를 입력해 주문을 진행합니다.',
        '4. 주문 후에는 마이페이지 주문내역에서 진행 상태와 상품별 불량·환불 요청을 관리합니다.',
        '',
        '## 카테고리',
        '',
        '- [농산물](' . home_url( '/product-category/%eb%86%8d%ec%82%b0%eb%ac%bc/' ) . ')',
        '- [수산물](' . home_url( '/product-category/%ec%88%98%ec%82%b0%eb%ac%bc/' ) . ')',
        '- [축산물](' . home_url( '/product-category/%ec%b6%95%ec%82%b0%eb%ac%bc/' ) . ')',
        '- [가공식품](' . home_url( '/product-category/%ea%b0%80%ea%b3%b5%ec%8b%9d%ed%92%88/' ) . ')',
        '- [공동구매](' . home_url( '/product-category/%ea%b3%b5%eb%8f%99%ea%b5%ac%eb%a7%a4/' ) . ')',
        '',
        '## 자주 묻는 질문',
        '',
    );

    foreach ( $faq as $item ) {
        $lines[] = '### ' . $item['question'];
        $lines[] = '';
        $lines[] = $item['answer'];
        $lines[] = '';
    }

    $lines[] = '## 신뢰 및 에이전트 리소스';
    $lines[] = '';
    $lines[] = '- [서비스 소개](' . home_url( '/about' ) . ')';
    $lines[] = '- [연락처](' . home_url( '/contact' ) . ')';
    $lines[] = '- [개인정보 안내](' . home_url( '/privacy' ) . ')';
    $lines[] = '- [Developer / Agent Resources](' . home_url( '/developer' ) . ')';
    $lines[] = '- [llms.txt](' . home_url( '/llms.txt' ) . ')';
    $lines[] = '- [Agent instructions](' . home_url( '/agent-instructions.md' ) . ')';
    $lines[] = '- [WordPress sitemap](' . home_url( '/wp-sitemap.xml' ) . ')';
    $lines[] = '- [Agent resource sitemap](' . home_url( '/agent-sitemap.xml' ) . ')';
    $lines[] = '';
    $lines[] = 'Canonical URL: ' . $home;

    return implode( "\n", $lines ) . "\n";
}

function wholesalehub_agentic_llms_markdown(): string {
    return '# 도매허브 (WholesaleHub)\n\n'
        . '> 사업자 전용 B2B 도매 쇼핑몰. 농수축산물, 가공식품과 공동구매 상품을 탐색하고 승인된 사업자 회원이 주문하는 서비스입니다.\n\n'
        . '## When to use this site\n\n'
        . '- 사업자가 도매 상품의 공개 상품명, 카테고리, 옵션과 최신 판매 조건을 확인해야 할 때 사용합니다.\n'
        . '- 여러 도매상품을 한곳에서 비교하거나 주문 전 배송 조건과 이용 흐름을 파악해야 할 때 사용합니다.\n'
        . '- 도매허브 자체의 서비스 설명, 연락처, 개인정보 안내 또는 기계 판독 가능한 에이전트 리소스를 찾을 때 사용합니다.\n\n'
        . '## Do not assume\n\n'
        . '- 로그인 전 화면에 표시되지 않은 도매 가격이나 재고를 추정하지 마세요.\n'
        . '- 공급사 실명, 내부 원가, 비공개 매핑, 승인 상태 또는 관리자 데이터를 공개 정보로 간주하지 마세요.\n'
        . '- 공개 API, MCP 서버, 웹훅 또는 자동 주문 API가 있다고 가정하지 마세요. 현재 공개 개발자 인터페이스는 문서화된 웹 리소스 범위로 제한됩니다.\n\n'
        . '## How an agent should use WholesaleHub\n\n'
        . '1. 공개 탐색은 canonical 홈페이지와 상품/카테고리 URL을 사용합니다.\n'
        . '2. canonical 홈페이지를 가져올 때 `Accept: text/markdown`을 보내면 Markdown 표현을 받을 수 있습니다.\n'
        . '3. 정확한 가격·판매 가능 여부·배송 조건은 주문 시점의 상품 상세 표시를 우선합니다.\n'
        . '4. 회원 전용 정보가 필요한 경우 사용자가 직접 로그인/승인 절차를 완료하도록 안내하고 인증 우회를 시도하지 않습니다.\n\n'
        . '## Key resources\n\n'
        . '- [Homepage](' . home_url( '/' ) . ')\n'
        . '- [Developer / Agent Resources](' . home_url( '/developer' ) . ')\n'
        . '- [Agent instructions](' . home_url( '/agent-instructions.md' ) . ')\n'
        . '- [About](' . home_url( '/about' ) . ')\n'
        . '- [Contact](' . home_url( '/contact' ) . ')\n'
        . '- [Privacy](' . home_url( '/privacy' ) . ')\n'
        . '- [WordPress sitemap](' . home_url( '/wp-sitemap.xml' ) . ')\n'
        . '- [Agent resource sitemap](' . home_url( '/agent-sitemap.xml' ) . ')\n';
}

function wholesalehub_agentic_instructions_markdown(): string {
    return '# WholesaleHub agent instructions\n\n'
        . '## Best-fit jobs\n\n'
        . 'Use 도매허브 when the user needs to discover or compare publicly listed B2B wholesale products, understand the service flow, locate product categories, or verify public ordering and delivery guidance. The storefront is intended for business customers. Public pages may be read without authentication, while wholesale prices and purchasing are restricted to approved members.\n\n'
        . '## Retrieval rules\n\n'
        . '- Prefer the canonical URL and request `Accept: text/markdown` when your client supports content negotiation.\n'
        . '- Treat product-detail values shown at retrieval time as more authoritative than summaries or cached snippets.\n'
        . '- Follow real HTTP status codes. A missing URL returns 404; use the recovery links in that response rather than treating the path as valid.\n'
        . '- Respect robots.txt and normal rate limits. Do not bypass login, approval, anti-bot, payment, cart, checkout, or account controls.\n\n'
        . '## Data boundaries\n\n'
        . 'Do not infer private supplier identities, internal supplier costs, hidden mappings, account balances, customer orders, or administrator-only data. Do not claim that WholesaleHub exposes an OpenAPI API, webhook API, or MCP server unless the developer page explicitly announces one in the future.\n\n'
        . '## Useful URLs\n\n'
        . '- ' . home_url( '/' ) . '\n'
        . '- ' . home_url( '/llms.txt' ) . '\n'
        . '- ' . home_url( '/developer' ) . '\n'
        . '- ' . home_url( '/agent-sitemap.xml' ) . '\n';
}

function wholesalehub_agentic_developer_markdown(): string {
    return '# 도매허브 Developer / Agent Resources\n\n'
        . '도매허브(WholesaleHub)는 사업자 전용 도매 쇼핑몰입니다. 이 페이지는 개발자와 AI 에이전트가 공개적으로 사용 가능한 인터페이스와 사용 경계를 정확히 식별하도록 돕기 위한 리소스 인덱스입니다. 현재 도매허브는 외부 개발자를 위한 공개 주문 API, OpenAPI 명세, 인증 API, 웹훅 API 또는 MCP 서버를 공식 제공하지 않습니다. 따라서 비공개 WordPress/WooCommerce 엔드포인트를 공개 API처럼 사용하거나 로그인·승인·결제 흐름을 우회해서는 안 됩니다.\n\n'
        . '## Supported public machine interfaces\n\n'
        . '- Canonical homepage with `Accept: text/markdown` content negotiation\n'
        . '- `llms.txt` with when-to-use and data-boundary guidance\n'
        . '- `agent-instructions.md` with agent retrieval rules\n'
        . '- WordPress XML sitemap and a small agent-resource sitemap\n'
        . '- Normal public product and category pages, subject to current storefront access rules\n\n'
        . '## Authentication and ordering\n\n'
        . 'Wholesale prices and purchasing are member-only. Agents should direct the user through the normal membership approval and authenticated storefront flow. No credential-sharing or automated checkout contract is published here. If a public API, OpenAPI document, webhook contract or MCP server is introduced later, it should be linked from this page and llms.txt before agents rely on it.\n\n'
        . '## Resources\n\n'
        . '- [Homepage](' . home_url( '/' ) . ')\n'
        . '- [llms.txt](' . home_url( '/llms.txt' ) . ')\n'
        . '- [Agent instructions](' . home_url( '/agent-instructions.md' ) . ')\n'
        . '- [Agent resource sitemap](' . home_url( '/agent-sitemap.xml' ) . ')\n';
}

function wholesalehub_agentic_trust_markdown( string $kind ): string {
    if ( 'about' === $kind ) {
        return '# 도매허브 소개\n\n'
            . '도매허브는 여러 도매상품을 한곳에서 살펴볼 수 있도록 구성한 사업자 전용 B2B 도매 쇼핑몰입니다. 농산물, 수산물, 축산물, 가공식품과 공동구매 상품을 카테고리와 검색으로 탐색하고, 승인된 사업자 회원이 상품별 옵션과 주문 시점의 판매 조건을 확인한 뒤 주문할 수 있도록 운영합니다. 공급 상황이 자주 바뀌는 도매 특성 때문에 가격, 판매 가능 여부, 옵션과 배송 조건은 고정 정보로 단정하지 않고 연결된 공급 정보를 기준으로 갱신합니다. 공개 페이지의 설명은 서비스 이해를 위한 안내이며 실제 주문 판단은 상품 상세에 표시되는 최신 조건을 기준으로 해야 합니다.\n\n'
            . '도매허브는 공급사 내부 정보와 고객에게 공개되는 상품 정보를 분리해 운영하는 것을 원칙으로 합니다. 비공개 공급사 실명, 내부 원가, 승인 대기 정보와 관리자 데이터는 일반 방문자에게 제공되는 공개 정보가 아닙니다. 주문 이후에는 마이페이지 주문내역을 통해 주문 상태를 확인하고, 필요한 경우 상품별 불량·환불 요청을 접수할 수 있도록 구성되어 있습니다. 생물 상품의 품질 관리상 현재 제주도 및 도서산간 지역 배송은 지원하지 않는 정책이 적용될 수 있으므로 주문 단계의 제한 안내를 확인해야 합니다.\n\n'
            . '운영 주체는 도매허브이며, 공개 사업자 정보는 사이트 하단에 표시됩니다. 상호: 도매허브, 대표: 강호성, 사업자등록번호: 502-40-62677, 사업장 주소: 경기도 용인시 처인구 남사읍 처인성로 577, 104호, 연락처: 010-3999-8933. 서비스 문의는 연락처 페이지의 안내를 이용할 수 있습니다.\n';
    }

    if ( 'contact' === $kind ) {
        return '# 도매허브 연락처\n\n'
            . '도매허브 이용 중 상품, 주문, 배송, 회원 승인 또는 사이트 사용과 관련한 문의가 필요한 경우 아래 공개 연락처를 사용할 수 있습니다. 문의할 때는 개인정보를 과도하게 보내지 말고, 주문 관련 문의라면 주문을 식별할 수 있는 최소 정보와 필요한 사실만 전달하는 것을 권장합니다. 비밀번호, 결제 비밀정보, 관리자 인증정보와 같은 민감한 인증 수단은 일반 문의 채널로 보내지 마세요. 상품 가격이나 판매 가능 여부는 공급 상황에 따라 변동될 수 있으므로 문의 답변보다 주문 시점의 상품 상세 표시가 최신일 수 있습니다.\n\n'
            . '상호: 도매허브. 대표: 강호성. 사업자등록번호: 502-40-62677. 사업장 주소: 경기도 용인시 처인구 남사읍 처인성로 577, 104호. 공개 연락처: 010-3999-8933. 통신판매업 관련 상태는 사이트 하단에 표시되는 최신 고지를 확인해 주세요. 회원 전용 주문이나 고객 계정과 관련된 사항은 가능하면 로그인 후 마이페이지의 주문내역과 정상 고객지원 흐름을 이용하는 것이 가장 정확합니다.\n\n'
            . 'AI 에이전트나 자동화 도구는 이 연락처를 대량 메시지 전송, 인증 우회, 자동 주문 또는 비공개 정보 요청에 사용해서는 안 됩니다. 개발자·에이전트가 사용할 수 있는 공개 리소스는 `/developer`, `/llms.txt`, `/agent-instructions.md`에 별도로 정리되어 있습니다. 공개 API, 웹훅 또는 MCP 서버가 문서화되어 있지 않은 한 그러한 인터페이스가 존재한다고 가정하지 마세요.\n';
    }

    return '# 도매허브 개인정보 안내\n\n'
        . '이 페이지는 도매허브의 공개 신뢰 앵커와 기본 개인정보 안내를 제공하기 위한 페이지입니다. WordPress에 운영자가 확정한 별도의 정식 개인정보 처리방침 페이지가 설정되어 있는 경우 그 정식 페이지가 우선합니다. 도매허브 서비스는 회원가입 및 사업자 회원 승인, 주문과 배송 처리, 고객 문의와 불량·환불 요청, 서비스 보안과 오류 대응을 위해 필요한 범위에서 회원 및 주문 관련 정보를 처리할 수 있습니다. 주문 배송에는 수취인 이름, 연락처, 주소와 배송 메시지처럼 이행에 필요한 정보가 포함될 수 있고, 고객지원 과정에서는 사용자가 직접 제출한 주문 식별 정보나 증빙 자료가 포함될 수 있습니다.\n\n'
        . '서비스는 공개 페이지와 회원 전용 영역을 구분하며, 비밀번호나 관리자 인증정보를 공개 페이지에 표시하지 않습니다. 사용자는 계정, 주문 또는 문의와 관련해 필요한 범위를 넘어서는 민감한 정보를 일반 문의 채널에 보내지 않는 것이 좋습니다. 주문 이행이나 고객지원에 외부 배송·처리 주체가 관여하는 경우에는 실제 운영과 적용 법령에 따라 필요한 범위의 정보가 처리될 수 있습니다. 구체적인 수집 항목, 보유 기간, 제3자 제공 또는 처리위탁 사항처럼 법률상 정확한 고지가 필요한 내용은 운영자가 확정한 정식 개인정보 처리방침과 개별 동의 화면을 기준으로 해야 하며, 이 기술 안내가 그 법적 고지를 대체하지 않습니다.\n\n'
        . '개인정보 관련 문의나 정정·삭제 등 계정 정보에 관한 요청은 도매허브의 공개 연락처 또는 로그인 후 제공되는 정상 고객지원 흐름을 이용해 주세요. AI 에이전트는 로그인, 회원 승인, 주문, 결제 또는 계정 보호 장치를 우회해서 개인정보에 접근해서는 안 되며, 공개 웹페이지에 표시되지 않은 고객 데이터나 내부 공급사 데이터를 추정하거나 수집해서도 안 됩니다. 정식 개인정보 처리방침 URL이 별도로 설정된 경우 해당 문서가 이 페이지보다 우선합니다.\n';
}

function wholesalehub_agentic_render_html_document( string $title, string $description, string $markdown ): void {
    status_header( 200 );
    header( 'Content-Type: text/html; charset=utf-8', true );
    wholesalehub_agentic_vary_header();
    header( 'Cache-Control: public, max-age=300', true );

    $home = home_url( '/' );
    $paragraphs = preg_split( '/\n\n+/', trim( $markdown ) );
    $body = '';
    if ( is_array( $paragraphs ) ) {
        foreach ( $paragraphs as $paragraph ) {
            if ( 0 === strpos( $paragraph, '# ' ) ) {
                continue;
            }
            if ( 0 === strpos( $paragraph, '## ' ) ) {
                $body .= '<h2>' . esc_html( substr( $paragraph, 3 ) ) . '</h2>';
                continue;
            }
            if ( preg_match( '/^- /m', $paragraph ) ) {
                $body .= '<ul>';
                foreach ( preg_split( '/\n/', $paragraph ) as $line ) {
                    if ( 0 === strpos( $line, '- ' ) ) {
                        $body .= '<li>' . wp_kses_post( preg_replace( '/\[([^\]]+)\]\(([^)]+)\)/', '<a href="$2">$1</a>', substr( $line, 2 ) ) ) . '</li>';
                    }
                }
                $body .= '</ul>';
                continue;
            }
            $linked = preg_replace( '/\[([^\]]+)\]\(([^)]+)\)/', '<a href="$2">$1</a>', $paragraph );
            $body  .= '<p>' . wp_kses_post( (string) $linked ) . '</p>';
        }
    }

    echo '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
    echo '<title>' . esc_html( $title ) . '</title><meta name="description" content="' . esc_attr( $description ) . '">';
    echo '<link rel="canonical" href="' . esc_url( home_url( wholesalehub_agentic_request_path() ) ) . '">';
    echo '<style>body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2937;background:#f8fafc;line-height:1.75}main{max-width:860px;margin:0 auto;padding:56px 24px 80px}a{color:#0f766e}h1{font-size:2rem;line-height:1.25;margin:0 0 24px}h2{margin-top:38px;font-size:1.3rem}p,li{font-size:1rem}.crumb{margin-bottom:24px}.box{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:30px;box-shadow:0 8px 24px rgba(15,23,42,.04)}</style></head><body>';
    echo '<main><nav class="crumb"><a href="' . esc_url( $home ) . '">도매허브 홈</a></nav><div class="box"><h1>' . esc_html( $title ) . '</h1>' . $body . '</div></main></body></html>';
    exit;
}

function wholesalehub_agentic_render_404(): void {
    status_header( 404 );
    nocache_headers();
    wholesalehub_agentic_vary_header();
    header( 'X-Robots-Tag: noindex, follow', true );

    if ( 'markdown' === wholesalehub_negotiate_home_representation() ) {
        header( 'Content-Type: text/markdown; charset=utf-8', true );
        echo '# 404 — 페이지를 찾을 수 없습니다\n\n'
            . '요청한 경로는 도매허브에 존재하지 않습니다. 아래 공개 인덱스에서 다시 찾으세요.\n\n'
            . '- [도매허브 홈](' . home_url( '/' ) . ')\n'
            . '- [WordPress sitemap](' . home_url( '/wp-sitemap.xml' ) . ')\n'
            . '- [llms.txt](' . home_url( '/llms.txt' ) . ')\n'
            . '- [Developer / Agent Resources](' . home_url( '/developer' ) . ')\n';
        exit;
    }

    get_header();
    echo '<main id="primary" class="site-main" style="max-width:760px;margin:0 auto;padding:64px 24px 96px">';
    echo '<h1>페이지를 찾을 수 없습니다</h1><p>요청한 주소에 해당하는 페이지가 없습니다. 아래 경로에서 원하는 정보를 다시 찾아보세요.</p>';
    echo '<ul><li><a href="' . esc_url( home_url( '/' ) ) . '">도매허브 홈</a></li><li><a href="' . esc_url( home_url( '/wp-sitemap.xml' ) ) . '">사이트맵</a></li><li><a href="' . esc_url( home_url( '/llms.txt' ) ) . '">llms.txt</a></li><li><a href="' . esc_url( home_url( '/developer' ) ) . '">Developer / Agent Resources</a></li></ul>';
    echo '</main>';
    get_footer();
    exit;
}

function wholesalehub_agentic_social_image_url(): string {
    $image = get_site_icon_url( 512 );
    if ( $image ) {
        return (string) $image;
    }

    $custom_logo_id = (int) get_theme_mod( 'custom_logo' );
    if ( $custom_logo_id > 0 ) {
        $custom_logo = wp_get_attachment_image_url( $custom_logo_id, 'full' );
        if ( $custom_logo ) {
            return (string) $custom_logo;
        }
    }

    if ( function_exists( 'wc_placeholder_img_src' ) ) {
        return (string) wc_placeholder_img_src( 'woocommerce_single' );
    }

    return '';
}

/**
 * Explicitly advertise that common AI/agent crawlers are allowed at the origin.
 * Cloudflare/WAF policy can still block before WordPress, so deployment smoke tests verify public reachability separately.
 */
add_filter(
    'robots_txt',
    static function ( string $output, bool $public ): string {
        if ( ! $public ) {
            return $output;
        }

        $agent_rules = array(
            'ChatGPT-User',
            'ClaudeBot',
            'Google-Extended',
            'DeepSeekBot',
            'ora-agent',
        );

        foreach ( $agent_rules as $user_agent ) {
            if ( false === stripos( $output, 'User-agent: ' . $user_agent ) ) {
                $output .= "\nUser-agent: {$user_agent}\nAllow: /\n";
            }
        }

        $agent_sitemap = home_url( '/agent-sitemap.xml' );
        if ( false === strpos( $output, $agent_sitemap ) ) {
            $output .= "\nSitemap: {$agent_sitemap}\n";
        }

        return ltrim( $output );
    },
    20,
    2
);

/**
 * Make virtual trust/developer resources discoverable without changing storefront layout.
 */
add_action(
    'wp_head',
    static function (): void {
        if ( ! ( is_front_page() || ( function_exists( 'is_shop' ) && is_shop() ) ) ) {
            return;
        }

        echo '<link rel="help" href="' . esc_url( home_url( '/developer' ) ) . '">' . PHP_EOL;
        echo '<link rel="author" href="' . esc_url( home_url( '/about' ) ) . '">' . PHP_EOL;
        echo '<link rel="privacy-policy" href="' . esc_url( home_url( '/privacy' ) ) . '">' . PHP_EOL;
        echo '<link rel="alternate" type="text/plain" href="' . esc_url( home_url( '/llms.txt' ) ) . '">' . PHP_EOL;

        $social_image = wholesalehub_agentic_social_image_url();
        if ( '' !== $social_image ) {
            echo '<meta property="og:image" content="' . esc_url( $social_image ) . '">' . PHP_EOL;
            echo '<meta property="og:image:alt" content="도매허브 — 사업자 전용 B2B 도매 쇼핑몰">' . PHP_EOL;
        }
    },
    29
);

/**
 * WooCommerce (or an installed SEO plugin) remains the owner of Product and Breadcrumb data.
 * Add a small Organization + WebSite graph on the storefront so identity is machine-readable.
 */
add_action(
    'wp_head',
    static function (): void {
        if ( ! ( is_front_page() || ( function_exists( 'is_shop' ) && is_shop() ) ) ) {
            return;
        }

        $home         = home_url( '/' );
        $social_image = wholesalehub_agentic_social_image_url();
        $organization = array(
            '@type'       => 'Organization',
            '@id'         => $home . '#organization',
            'name'        => '도매허브',
            'description' => '농수축산물, 가공식품과 공동구매 상품을 한곳에서 탐색하고 승인된 사업자 회원이 주문할 수 있는 B2B 도매 쇼핑몰',
            'url'         => $home,
            'telephone'   => '010-3999-8933',
            'address'     => array(
                '@type'           => 'PostalAddress',
                'streetAddress'   => '남사읍 처인성로 577, 104호',
                'addressLocality' => '용인시 처인구',
                'addressRegion'   => '경기도',
                'addressCountry'  => 'KR',
            ),
        );

        if ( '' !== $social_image ) {
            $organization['logo'] = array(
                '@type' => 'ImageObject',
                'url'   => $social_image,
            );
        }

        $website = array(
            '@type'      => 'WebSite',
            '@id'        => $home . '#website',
            'url'        => $home,
            'name'       => '도매허브',
            'description'=> '사업자 전용 B2B 도매 상품 탐색 및 주문 서비스',
            'inLanguage' => 'ko-KR',
            'publisher'  => array( '@id' => $home . '#organization' ),
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

        $graph = array(
            '@context' => 'https://schema.org',
            '@graph'   => array( $organization, $website ),
        );

        echo '<script type="application/ld+json" id="wholesalehub-seo-aeo-schema">'
            . wp_json_encode( $graph, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES )
            . '</script>' . PHP_EOL;
    },
    30
);

/**
 * Vary is required on both HTML and Markdown variants of the canonical homepage.
 */
add_action(
    'send_headers',
    static function (): void {
        if ( is_front_page() ) {
            wholesalehub_agentic_vary_header();
        }
    },
    20
);

/**
 * Virtual machine-readable resources and canonical Markdown negotiation.
 * These paths are intentionally served by the MU plugin, so no rewrite flush or database page creation is required.
 */
add_action(
    'template_redirect',
    static function (): void {
        $path = wholesalehub_agentic_request_path();

        if ( is_front_page() ) {
            $representation = wholesalehub_negotiate_home_representation();
            if ( 'markdown' === $representation ) {
                wholesalehub_agentic_markdown_header();
                echo wholesalehub_agentic_site_summary_markdown();
                exit;
            }
            if ( 'none' === $representation ) {
                status_header( 406 );
                header( 'Content-Type: text/plain; charset=utf-8', true );
                wholesalehub_agentic_vary_header();
                echo "Not Acceptable. This URL provides text/html and text/markdown.\n";
                exit;
            }
        }

        if ( '/llms.txt' === $path ) {
            status_header( 200 );
            header( 'Content-Type: text/plain; charset=utf-8', true );
            header( 'Cache-Control: public, max-age=300', true );
            echo wholesalehub_agentic_llms_markdown();
            exit;
        }

        if ( '/agent-instructions.md' === $path ) {
            wholesalehub_agentic_markdown_header();
            echo wholesalehub_agentic_instructions_markdown();
            exit;
        }

        if ( '/agent-sitemap.xml' === $path ) {
            status_header( 200 );
            header( 'Content-Type: application/xml; charset=utf-8', true );
            header( 'Cache-Control: public, max-age=3600', true );
            $urls = array(
                home_url( '/' ),
                home_url( '/about' ),
                home_url( '/contact' ),
                home_url( '/privacy' ),
                home_url( '/developer' ),
                home_url( '/llms.txt' ),
                home_url( '/agent-instructions.md' ),
            );
            echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
            echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
            foreach ( $urls as $url ) {
                echo '  <url><loc>' . esc_url( $url ) . '</loc></url>' . "\n";
            }
            echo '</urlset>' . "\n";
            exit;
        }

        if ( in_array( $path, array( '/developer', '/about', '/contact', '/privacy' ), true ) ) {
            $representation = wholesalehub_negotiate_home_representation();
            if ( 'none' === $representation ) {
                status_header( 406 );
                header( 'Content-Type: text/plain; charset=utf-8', true );
                wholesalehub_agentic_vary_header();
                echo "Not Acceptable. This URL provides text/html and text/markdown.\n";
                exit;
            }

            if ( '/developer' === $path ) {
                $title       = '도매허브 Developer / Agent Resources';
                $description = '도매허브의 공개 개발자·AI 에이전트 리소스, 사용 범위와 데이터 경계를 안내합니다.';
                $markdown    = wholesalehub_agentic_developer_markdown();
            } elseif ( '/about' === $path ) {
                $title       = '도매허브 소개';
                $description = '사업자 전용 B2B 도매 쇼핑몰 도매허브의 서비스 범위와 운영 원칙을 안내합니다.';
                $markdown    = wholesalehub_agentic_trust_markdown( 'about' );
            } elseif ( '/contact' === $path ) {
                $title       = '도매허브 연락처';
                $description = '도매허브 공개 연락처와 안전한 문의 방법을 안내합니다.';
                $markdown    = wholesalehub_agentic_trust_markdown( 'contact' );
            } else {
                $title       = '도매허브 개인정보 안내';
                $description = '도매허브의 기본 개인정보 안내와 정식 개인정보 처리방침 우선 원칙을 설명합니다.';
                $markdown    = wholesalehub_agentic_trust_markdown( 'privacy' );

                if ( 'markdown' !== $representation ) {
                    $policy_url = get_privacy_policy_url();
                    if ( $policy_url && untrailingslashit( $policy_url ) !== untrailingslashit( home_url( '/privacy' ) ) ) {
                        wp_safe_redirect( $policy_url, 302 );
                        exit;
                    }
                }
            }

            if ( 'markdown' === $representation ) {
                wholesalehub_agentic_markdown_header();
                echo $markdown;
                exit;
            }

            wholesalehub_agentic_render_html_document( $title, $description, $markdown );
        }

        if ( is_404() ) {
            wholesalehub_agentic_render_404();
        }
    },
    1
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
