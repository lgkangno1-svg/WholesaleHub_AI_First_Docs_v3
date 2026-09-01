<?php

define('ABSPATH', __DIR__ . '/');

$GLOBALS['wh_test_meta'] = [];
$GLOBALS['wh_test_thumb'] = 0;
$GLOBALS['wh_test_content'] = '';
function add_action(...$args) {}
function add_filter(...$args) {}
function get_post_meta($id, $key, $single = false) { return $GLOBALS['wh_test_meta'][$id][$key] ?? ''; }
function get_post_thumbnail_id($id) { return $GLOBALS['wh_test_thumb']; }
function wp_attachment_is_image($id) { return $id > 0; }
function get_post_type($id) { return $id > 0 ? 'product' : ''; }
function get_post_field($field, $id, $context = 'display') { return $field === 'post_content' ? $GLOBALS['wh_test_content'] : ''; }

require dirname(__DIR__) . '/wordpress/mu-plugins/wholesalehub-ai-merchandising.php';

function check($condition, $message) {
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$message}\n");
        exit(1);
    }
}

$first = wh_ai_merchandising_merge_detail_block('공급사 기본 설명', '<section>AI 상세 A</section>');
check(str_contains($first, '공급사 기본 설명'), 'base description is retained');
check(str_contains($first, WH_AI_DETAIL_START), 'managed detail start marker exists');
check(str_contains($first, 'AI 상세 A'), 'AI detail was appended');

$second = wh_ai_merchandising_merge_detail_block($first, '<section>AI 상세 B</section>');
check(!str_contains($second, 'AI 상세 A'), 'old AI block is replaced instead of duplicated');
check(substr_count($second, WH_AI_DETAIL_START) === 1, 'only one managed block remains');
check(str_contains($second, 'AI 상세 B'), 'new AI detail is present');

$GLOBALS['wh_test_meta'][77]['_wh_ai_thumbnail_status'] = 'success';
$GLOBALS['wh_test_meta'][77]['_wh_ai_thumbnail_attachment_id'] = '901';
$GLOBALS['wh_test_thumb'] = 901;
check(wh_ai_merchandising_has_valid_thumbnail(77), 'exact verified AI thumbnail is valid');
$GLOBALS['wh_test_thumb'] = 902;
check(!wh_ai_merchandising_has_valid_thumbnail(77), 'marker cannot protect a different current thumbnail');

$GLOBALS['wh_test_content'] = $second;
$incoming = wh_ai_merchandising_preserve_detail_on_update(
    ['post_content' => '새 공급사 기본 설명'],
    ['ID' => 77]
);
check(str_contains($incoming['post_content'], '새 공급사 기본 설명'), 'incoming base description remains updateable');
check(str_contains($incoming['post_content'], 'AI 상세 B'), 'AI detail survives later catalog content update');

$GLOBALS['wh_ai_merchandising_applying'] = true;
$ownApply = wh_ai_merchandising_preserve_detail_on_update(
    ['post_content' => '우리 적용 내용'],
    ['ID' => 77]
);
unset($GLOBALS['wh_ai_merchandising_applying']);
check($ownApply['post_content'] === '우리 적용 내용', 'own apply can intentionally replace the managed block');

echo "AI_MERCHANDISING_PHP_HELPERS_OK\n";
