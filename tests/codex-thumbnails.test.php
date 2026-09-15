<?php
define('ABSPATH', '/test/');
$opts = []; $filters = [];
function get_option($key, $default = false) { global $opts; return $opts[$key] ?? $default; }
function wp_json_encode($v, $flags = 0) { return json_encode($v, $flags); }
function wp_attachment_is_image($id) { return $id === 77; }
function add_filter($hook, $fn, $priority = 10, $args = 1) { global $filters; $filters[$hook] = $fn; }
function add_action(...$args) {}
require __DIR__ . '/../wordpress/mu-plugins/wholesalehub-codex-thumbnails.php';
function check($condition) { if (!$condition) { throw new RuntimeException('assertion_failed'); } }
$r = ['id'=>101,'supplier_id'=>'dailyfood','request_kind'=>'product','original_product_name'=>'사과','option_summary'=>'1kg','hard_spec_fingerprint'=>'abc'];
check(!whct_scope($r));
$opts['whct_start_after_id'] = 100;
check(whct_scope($r));
check(!whct_scope(array_merge($r, ['id'=>100])));
check(!whct_scope(array_merge($r, ['supplier_id'=>'fafane'])));
check(!whct_scope(array_merge($r, ['request_kind'=>'option'])));
check(!$filters['wholesalehub_approval_thumbnail_ready'](true, $r));
check($filters['wholesalehub_approval_thumbnail_error']('', $r, 'new') !== '');
check($filters['wholesalehub_approval_thumbnail_error']('', $r, 'map') === '');
$opts['whct_asset_101'] = ['digest'=>whct_digest($r),'attachment'=>77];
check(whct_asset($r) === 77);
check($filters['wholesalehub_approval_thumbnail_ready'](true, $r));
check($filters['wholesalehub_approval_thumbnail_error']('', $r, 'new') === '');
check(!whct_asset(array_merge($r, ['original_product_name'=>'배'])));
check(!whct_asset(array_merge($r, ['option_summary'=>'냉동 2kg'])));
echo "13 thumbnail bridge assertions passed\n";
