<?php
declare(strict_types=1);

define('ABSPATH', '/tmp/');
function add_action(...$args): void {}
function add_filter(...$args): void {}
function check(bool $condition, string $name): void {
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$name}\n");
        exit(1);
    }
    echo "PASS: {$name}\n";
}

require __DIR__ . '/../wordpress/plugins/wholesalehub-supplier-lanes/wholesalehub-supplier-lanes.php';
$parse = [WholesaleHub_Supplier_Lanes::class, 'parse_spec_label'];

$special5 = $parse('특품5kg');
$special5Again = $parse('특품5kg');
$ugly5 = $parse('못난이5kg');
$special10 = $parse('특품10kg');
$special5000 = $parse('특품5000g');
$exact10 = $parse('특품10과');
$range10 = $parse('특품10~12과');
$chilled = $parse('특품5kg 냉장');
$frozen = $parse('특품5kg 냉동');
$domestic = $parse('국내산 특품5kg');
$china = $parse('중국산 특품5kg');
$noGrade5 = $parse('5kg');
$trimmed = $parse('특품5kg 손질');
$untrimmed = $parse('특품5kg 비손질');
$regular = $parse('정품5kg');
$homeUse = $parse('가정용5kg');

check($special5['status'] === 'auto_approved' && $special5Again['status'] === 'auto_approved' && $special5['comparison_group'] === $special5Again['comparison_group'], 'A: 특품5kg vs 특품5kg SAME possible');
check($special5['comparison_group'] !== $ugly5['comparison_group'], 'B: 특품5kg vs 못난이5kg different');
check($special5['comparison_group'] !== $special10['comparison_group'], 'C: 특품5kg vs 특품10kg different');
check($special5000['weight_val'] === 5000.0 && $special5000['comparison_group'] === $special5['comparison_group'], 'D: 특품5000g vs 특품5kg SAME');
check($exact10['status'] === 'auto_approved' && $range10['status'] === 'review_required' && $range10['confidence'] < 0.85 && $exact10['comparison_group'] !== $range10['comparison_group'], 'E: 특품10과 vs 특품10~12과 not auto SAME');
check($chilled['comparison_group'] !== $frozen['comparison_group'], 'F: 특품5kg 냉장 vs 냉동 different');
check($domestic['comparison_group'] !== $china['comparison_group'], 'G: 국내산 vs 중국산 different');
check($special5['comparison_group'] !== $noGrade5['comparison_group'] && $noGrade5['status'] === 'review_required' && $noGrade5['confidence'] < 0.85, 'H: 특품5kg vs 5kg review');
check($trimmed['comparison_group'] !== $untrimmed['comparison_group'] && $untrimmed['processing'] === '비손질', 'processing: 손질 vs 비손질 different');
check($regular['comparison_group'] !== $homeUse['comparison_group'] && $homeUse['grade_size'] === '가정용', 'grade: 정품 vs 가정용 different');

$compare = [WholesaleHub_Supplier_Lanes::class, 'compare_spec_labels'];
check($compare('특품 5kg', '5kg')['verdict'] === 'REVIEW_REQUIRED', 'precedence A: missing grade reviews');
check($compare('특품 5kg', '10kg')['verdict'] === 'DIFFERENT', 'precedence B: weight contradiction wins over missing grade');
check($compare('59과 5.72kg', '5과 155g')['verdict'] === 'DIFFERENT', 'precedence C: known count and weight contradictions differ');
check($compare('냉장 5kg', '5kg')['verdict'] === 'REVIEW_REQUIRED', 'precedence D: one unknown storage reviews');
check($compare('냉장 5kg', '냉동 5kg')['verdict'] === 'DIFFERENT', 'precedence E: storage contradiction differs');
check($compare('특품 5kg', '특품 5kg')['verdict'] === 'SAME', 'precedence F: sufficient identical specs same');
check($compare('10~12과 5kg', '20과 5kg')['verdict'] === 'DIFFERENT', 'precedence G: disjoint count range differs');
check($compare('10~12과 5kg', '10과 5kg')['verdict'] === 'REVIEW_REQUIRED', 'precedence H: overlapping count range reviews');

echo "PASS: option matching minimal scenarios\n";
