<?php
declare(strict_types=1);

define('ABSPATH', '/tmp/');
define('HOUR_IN_SECONDS', 3600);
define('WP_CONTENT_DIR', '/tmp');
function add_action(...$args): void {}
function wp_next_scheduled(...$args) { return false; }
function wp_schedule_event(...$args): void {}
function get_option(...$args) { return []; }
function update_option(...$args): void {}

require __DIR__ . '/../wordpress/mu-plugins/wholesalehub-catalog-watchdog.php';

function check(bool $condition, string $name): void
{
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$name}\n");
        exit(1);
    }
    echo "PASS: {$name}\n";
}

$tz = new DateTimeZone('Asia/Seoul');
$healthyNow = new DateTimeImmutable('2026-08-28T15:00:00+09:00');
$healthy = wholesalehub_catalog_watchdog_evaluate([
    'dailyfood' => ['complete' => true, 'generatedAt' => '2026-08-28T11:10:00+09:00'],
    'walldob2b' => ['complete' => true, 'generatedAt' => '2026-08-28T14:40:00+09:00'],
], $healthyNow);
check($healthy['health'] === 'healthy', 'same-day DailyFood and fresh Walldo are healthy');

$missingDaily = wholesalehub_catalog_watchdog_evaluate([
    'walldob2b' => ['complete' => true, 'generatedAt' => '2026-08-28T14:40:00+09:00'],
], $healthyNow);
check(in_array('dailyfood_snapshot_missing', $missingDaily['reasons'], true), 'missing DailyFood snapshot warns');

$staleDaily = wholesalehub_catalog_watchdog_evaluate([
    'dailyfood' => ['complete' => true, 'generatedAt' => '2026-08-27T11:10:00+09:00'],
    'walldob2b' => ['complete' => true, 'generatedAt' => '2026-08-28T14:40:00+09:00'],
], $healthyNow);
check(
    in_array('dailyfood_same_day_snapshot_missing_after_13', $staleDaily['reasons'], true),
    'after 13 KST DailyFood must be same-day'
);

$beforeDailyDeadline = new DateTimeImmutable('2026-08-28T09:00:00+09:00');
$previousDailyAllowed = wholesalehub_catalog_watchdog_evaluate([
    'dailyfood' => ['complete' => true, 'generatedAt' => '2026-08-27T11:10:00+09:00'],
    'walldob2b' => ['complete' => true, 'generatedAt' => '2026-08-27T21:10:00+09:00'],
], $beforeDailyDeadline);
check($previousDailyAllowed['health'] === 'healthy', 'before 13 KST previous-day DailyFood is allowed');

$staleWalldo = wholesalehub_catalog_watchdog_evaluate([
    'dailyfood' => ['complete' => true, 'generatedAt' => '2026-08-28T11:10:00+09:00'],
    'walldob2b' => ['complete' => true, 'generatedAt' => '2026-08-27T20:00:00+09:00'],
], $healthyNow);
check(
    in_array('walldob2b_snapshot_over_14h', $staleWalldo['reasons'], true),
    'Walldo older than 14h warns'
);

$incomplete = wholesalehub_catalog_watchdog_evaluate([
    'dailyfood' => ['complete' => false, 'generatedAt' => '2026-08-28T11:10:00+09:00'],
    'walldob2b' => ['complete' => true, 'generatedAt' => '2026-08-28T14:40:00+09:00'],
], $healthyNow);
check(in_array('dailyfood_snapshot_incomplete', $incomplete['reasons'], true), 'incomplete snapshot warns');

check(wholesalehub_catalog_watchdog_parse_time('not-a-date') === null, 'invalid timestamp is rejected');
check(wholesalehub_catalog_watchdog_parse_time('2026-08-28T11:00:00+09:00') instanceof DateTimeImmutable, 'valid timestamp parses');

echo "PASS: WholesaleHub catalog watchdog\n";
