<?php
declare(strict_types=1);

define('ABSPATH', '/tmp/');
function add_action(...$args): void {}
function add_filter(...$args): void {}
function remove_action(...$args): void {}
function wp_strip_all_tags($text, $remove_breaks = false): string { return trim((string) strip_tags((string) $text)); }
function check(bool $condition, string $name): void {
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$name}\n");
        exit(1);
    }
    echo "PASS: {$name}\n";
}

require __DIR__ . '/../wordpress/plugins/wholesalehub-supplier-lanes/includes/class-wholesalehub-marketplace-bulk.php';
require __DIR__ . '/../wordpress/plugins/wholesalehub-supplier-lanes/wholesalehub-supplier-lanes.php';

$mp = WholesaleHub_Marketplace_Bulk::class;

// --- Coupang synthetic fixture ---
$coupangHeaders = ['묶음배송번호','주문번호','등록상품명','등록옵션명','노출상품명(옵션명)','노출상품ID','옵션ID','업체상품코드','구매수(수량)','수취인이름','수취인전화번호','우편번호','수취인 주소','배송메세지','개인통관번호(PCCC)'];
$coupangRows = [
    $coupangHeaders,
    ['B1','ORD-1','샤인머스켓','2kg','샤인머스켓 2kg','P-100','O-200','SC-1','2','홍길동','01012345678','63503','제주 서귀포시','문앞','P123'],
    ['B1','ORD-2','샤인머스켓','1kg','샤인머스켓 1kg','P-101','O-201','SC-2','1','김철수','01087654321','04524','서울 중구','',''],
];
$c = $mp::parse_coupang($coupangRows);
check(is_array($c) && !isset($c['error']), 'coupang parse ok');
check(count($c) === 2, 'coupang 2 rows');
check($c[0]['marketplace'] === 'coupang' && $c[0]['external_product_id'] === 'P-100' && $c[0]['external_option_key'] === 'O-200', 'coupang stable id');
check($c[0]['quantity'] === 2 && $c[0]['recipient'] === '홍길동' && $c[0]['postcode'] === '63503', 'coupang fields');
check($c[0]['source_order_key'] === 'ORD-1' && $c[0]['source_line_key'] === 'P-100|O-200', 'coupang source identity');

// --- Naver synthetic fixture (with option code) ---
$naverHeaders = ['상품주문번호','주문번호','상품번호','옵션정보','옵션관리코드','판매자 상품코드','수량','수취인명','수취인연락처','우편번호','기본배송지','상세배송지','배송메세지','배송비 묶음번호','개인통관고유부호'];
$naverRows = [
    $naverHeaders,
    ['N-1','NO-1','N-100','옵션A','OC-300','SELL-1','3','이영희','01011112222','03111','서울 종로','1층','','BUN-1',''],
    ['N-2','NO-2','N-101','옵션B','','SELL-2','1','박민수','01033334444','03111','서울 종로','2층','','BUN-2',''],
];
$n = $mp::parse_naver($naverRows);
check(is_array($n) && !isset($n['error']), 'naver parse ok');
check(count($n) === 2, 'naver 2 rows');
check($n[0]['external_option_key'] === 'OC-300', 'naver option code key');
check($n[1]['external_option_key'] === substr(hash('sha256', '옵션B'), 0, 24), 'naver no-code -> option hash key');
check($n[0]['quantity'] === 3 && $n[0]['address1'] === '서울 종로' && $n[0]['address2'] === '1층', 'naver fields');

// --- to_standard_rows with quantity_multiplier ---
$resolved = [
    ['marketplace'=>'coupang','external_product_id'=>'P-100','external_option_key'=>'O-200','quantity'=>2,'recipient'=>'홍길동','phone'=>'01012345678','postcode'=>'63503','address1'=>'제주 서귀포시','address2'=>'','message'=>'','source_order_key'=>'ORD-1','resolution'=>['status'=>'AUTO_MATCHED','woo_variation_id'=>24691,'quantity_multiplier'=>2]],
    ['marketplace'=>'coupang','external_product_id'=>'P-101','external_option_key'=>'O-201','quantity'=>1,'recipient'=>'김철수','phone'=>'01087654321','postcode'=>'04524','address1'=>'서울 중구','address2'=>'','message'=>'','source_order_key'=>'ORD-2','resolution'=>['status'=>'AUTO_MATCHED','woo_variation_id'=>24692,'quantity_multiplier'=>1]],
];
$std = $mp::to_standard_rows($resolved);
check($std[0][0] === '주문코드', 'standard header');
check($std[1][0] === 'H24691' && $std[1][1] === '4', 'quantity_multiplier 2x applied (2*2=4)');
check($std[2][0] === 'H24692' && $std[2][1] === '1', 'multiplier 1x');

echo "PASS: marketplace bulk parser\n";
