<?php
declare(strict_types=1);

define('ABSPATH', '/tmp/');
function add_action(...$args): void {}
function add_filter(...$args): void {}
function remove_action(...$args): void {}
function check(bool $condition, string $name): void {
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$name}\n");
        exit(1);
    }
    echo "PASS: {$name}\n";
}

require __DIR__ . '/../wordpress/plugins/wholesalehub-supplier-lanes/wholesalehub-supplier-lanes.php';
$norm = [WholesaleHub_Supplier_Lanes::class, 'normalize_source_description_linebreaks'];

check($norm("발주마감 오전 8시\n원산지 : 경북") === "발주마감 오전 8시\n원산지 : 경북", 'A: actual LF preserved');
check($norm("a\r\nb\rc") === "a\nb\nc", 'B: CRLF/CR -> LF');
check($norm("a\\nb") === "a\nb", 'C: literal backslash-n -> LF');
check($norm("a\\nb") === "a\nb", 'D: literal backslash-n -> LF (single)');
check($norm("Vietnam\norigin\npacking\nnormal") === "Vietnam\norigin\npacking\nnormal", 'E: english n words preserved');
check($norm("http://x.test/path\\nnext") === "http://x.test/path\nnext", 'F: URL/backslash literal n -> LF');
check($norm("발주마감 오전 8시") === "발주마감 오전 8시", 'G: no linebreak untouched');

echo "PASS: dailyfood description linebreak normalize\n";
