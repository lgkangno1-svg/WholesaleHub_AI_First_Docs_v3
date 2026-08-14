<?php
declare(strict_types=1);

define('ABSPATH', '/tmp/');

final class WC_Product_Variable {}

$GLOBALS['candidate_ids'] = [];
$GLOBALS['candidate_names'] = [];
function get_posts(array $args): array { return $GLOBALS['candidate_ids']; }
function wc_get_product(int $id): ?WC_Product_Variable { return new WC_Product_Variable(); }
function get_post_meta(...$args): string { return ''; }
function get_the_title(int $id): string { return $GLOBALS['candidate_names'][$id] ?? ''; }

final class CandidateGateWpdb {
    public string $prefix = 'wp_';
    public function prepare(string $query, ...$args): string { return $query; }
    public function get_var(string $query) { return null; }
}
$wpdb = new CandidateGateWpdb();

require __DIR__ . '/../wordpress/plugins/wholesalehub-supplier-lanes/includes/class-wholesalehub-supplier-lane-approval.php';

function check(bool $condition, string $name): void {
    if (!$condition) { fwrite(STDERR, "FAIL: {$name}\n"); exit(1); }
    echo "PASS: {$name}\n";
}

$class = new ReflectionClass(WholesaleHub_Supplier_Lane_Approval::class);
$family = $class->getMethod('product_family');
$family->setAccessible(true);
$rank = $class->getMethod('rank_candidates');
$rank->setAccessible(true);

$samples = [
    ['세척 청사과 2kg내 (14과내외/가정용) 실중량', '가정용 청사과 소과', true],
    ['세척 청사과 3kg 21과내외 (박스무게포함)', '청사과', true],
    ['초특가 미백찰옥수수(특품)', '미백 찰옥수수', true],
    ['미흑찰/흑찰옥수수 특품 40개입', '특품 흑찰옥수수', true],
    ['제주 가정용 미니단호박', '제주산 밤호박(보우짱)', true],
    ['초특가 미백찰옥수수(특품)', '특품 흑찰옥수수', true],
    ['미흑찰/흑찰옥수수 특품 40개입', '미백 찰옥수수', true],
    ['초특가 차돌복숭아 (랜덤과/로얄과)', '황도복숭아', true],
    ['초특가 차돌복숭아 (랜덤과/로얄과)', '말랑이 백도복숭아', true],
    ['초특가 세척 청사과(랜덤과/실중량)', '초특가 부사 사과(가정용)', true],
    ['제주 가정용 미니단호박', '제주 블랙망고수박', false],
    ['제주 가정용 미니단호박', '가정용 성주참외', false],
    ['제주 가정용 미니단호박', '제주 하우스감귤 (박스포함)', false],
    ['완숙 토마토 혼합과 5kg', '흑수박', false],
    ['흑찰옥수수 단기 행사가! (30개입)', '홍감자', false],
    ['초특가 미니족발 500g', '가정용 청사과 소과', true],
    ['집집마다 두루마리 휴지 30롤x3팩', '청사과', true],
    ['구운란(대란) 30구 세트', '미백 찰옥수수', true],
    ['초특가 히카마(멕시코 감자)', '홍감자', true],
    ['제주 가정용 미니단호박', '수제수박쥬스(땡모반)/수박100%착즙', false],
];
foreach ($samples as [$source, $target, $expected]) {
    $sourceFamily = $family->invoke(null, $source);
    $targetFamily = $family->invoke(null, $target);
    $allowed = $sourceFamily === 'unknown' || $targetFamily === 'unknown' || $sourceFamily === $targetFamily;
    check($allowed === $expected, "family gate: {$source} -> {$target}");
}

function candidates(ReflectionMethod $rank, string $source, array $names, string $requestKind = 'product'): array {
    $GLOBALS['candidate_ids'] = array_keys($names);
    $GLOBALS['candidate_names'] = $names;
    return $rank->invoke(null, [
        'original_product_name' => $source, 'request_kind' => $requestKind, 'payload_json' => '{}', 'lane_code' => 'B',
        'source_product_id' => 'source', 'supplier_id' => 'walldob2b',
    ], 25);
}

$pumpkin = candidates($rank, '제주 가정용 미니단호박', [
    20943 => '제주산 밤호박(보우짱)', 20912 => '제주 블랙망고수박',
    20418 => '가정용 성주참외', 20917 => '제주 하우스감귤 (박스포함)',
]);
check(array_column($pumpkin, 'id') === [20943], '#16 excludes watermelon, melon, and citrus candidates');
check(candidates($rank, '초특가 차돌복숭아', [1 => '황도복숭아', 2 => '제주 블랙망고수박']) === [['id' => 1, 'name' => '황도복숭아', 'score' => 0]], 'peach positive and negative candidates');
check(candidates($rank, '세척 청사과', [1 => '가정용 청사과', 2 => '홍감자']) === [['id' => 1, 'name' => '가정용 청사과', 'score' => 1 / 3]], 'apple positive and negative candidates');
check(candidates($rank, '초특가 미니족발', [1 => '가정용 청사과']) !== [], 'unknown source preserves existing ranking');
check(candidates($rank, '제주 가정용 미니단호박', [1 => '제주 블랙망고수박']) === [], 'zero candidates is normal');
check(candidates($rank, '제주 가정용 미니단호박', [1 => '제주 특가 선물세트']) === [], 'product known source excludes unknown target');
check(candidates($rank, '제주 가정용 미니단호박', [1 => '제주 블랙망고수박'], 'option') !== [], 'option request preserves existing ranking');

echo "PASS: product candidate family gate scenarios\n";
