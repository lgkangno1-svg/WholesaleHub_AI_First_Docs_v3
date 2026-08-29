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

$healthyNow = new DateTimeImmutable('2026-08-28T15:00:00+09:00');
$healthy = wholesalehub_catalog_watchdog_evaluate([
    'dailyfood' => ['complete' => true, 'generatedAt' => '2026-08-28T11:10:00+09:00'],
    'walldob2b' => ['complete' => true, 'generatedAt' => '2026-08-28T11:20:00+09:00'],
], $healthyNow);
check($healthy['health'] === 'healthy', 'same-day DailyFood and post-11 Walldo are healthy at 15 KST');

$missingDaily = wholesalehub_catalog_watchdog_evaluate([
    'walldob2b' => ['complete' => true, 'generatedAt' => '2026-08-28T11:20:00+09:00'],
], $healthyNow);
check(in_array('dailyfood_snapshot_missing', $missingDaily['reasons'], true), 'missing DailyFood snapshot warns');

$staleDaily = wholesalehub_catalog_watchdog_evaluate([
    'dailyfood' => ['complete' => true, 'generatedAt' => '2026-08-27T11:10:00+09:00'],
    'walldob2b' => ['complete' => true, 'generatedAt' => '2026-08-28T11:20:00+09:00'],
], $healthyNow);
check(
    in_array('dailyfood_same_day_snapshot_missing_after_13', $staleDaily['reasons'], true),
    'after 13 KST DailyFood must be same-day'
);

$morningNow = new DateTimeImmutable('2026-08-29T08:13:00+09:00');
$normalOvernight = wholesalehub_catalog_watchdog_evaluate([
    'dailyfood' => ['complete' => true, 'generatedAt' => '2026-08-28T11:10:00+09:00'],
    'walldob2b' => ['complete' => true, 'generatedAt' => '2026-08-28T18:05:00+09:00'],
], $morningNow);
check(
    $normalOvernight['health'] === 'healthy',
    'previous-day 18 KST Walldo snapshot stays healthy through the normal overnight gap'
);

$morningTooOld = wholesalehub_catalog_watchdog_evaluate([
    'dailyfood' => ['complete' => true, 'generatedAt' => '2026-08-28T11:10:00+09:00'],
    'walldob2b' => ['complete' => true, 'generatedAt' => '2026-08-28T17:59:00+09:00'],
], $morningNow);
check(
    in_array('walldob2b_previous_18_snapshot_missing_before_13', $morningTooOld['reasons'], true),
    'before 13 KST Walldo must include the previous-day 18 KST run'
);

$afterMorningGrace = new DateTimeImmutable('2026-08-29T13:01:00+09:00');
$missingEleven = wholesalehub_catalog_watchdog_evaluate([
    'dailyfood' => ['complete' => true, 'generatedAt' => '2026-08-29T11:10:00+09:00'],
    'walldob2b' => ['complete' => true, 'generatedAt' => '2026-08-28T18:05:00+09:00'],
], $afterMorningGrace);
check(
    in_array('walldob2b_expected_11_snapshot_missing_after_13', $missingEleven['reasons'], true),
    'after 13 KST Walldo must include the same-day 11 KST run'
);

$beforeEveningGrace = new DateTimeImmutable('2026-08-29T19:59:00+09:00');
$elevenStillAllowed = wholesalehub_catalog_watchdog_evaluate([
    'dailyfood' => ['complete' => true, 'generatedAt' => '2026-08-29T11:10:00+09:00'],
    'walldob2b' => ['complete' => true, 'generatedAt' => '2026-08-29T11:20:00+09:00'],
], $beforeEveningGrace);
check($elevenStillAllowed['health'] === 'healthy', 'same-day 11 KST Walldo is allowed until 20 KST');

$afterEveningGrace = new DateTimeImmutable('2026-08-29T20:01:00+09:00');
$missingEighteen = wholesalehub_catalog_watchdog_evaluate([
    'dailyfood' => ['complete' => true, 'generatedAt' => '2026-08-29T11:10:00+09:00'],
    'walldob2b' => ['complete' => true, 'generatedAt' => '2026-08-29T11:20:00+09:00'],
], $afterEveningGrace);
check(
    in_array('walldob2b_expected_18_snapshot_missing_after_20', $missingEighteen['reasons'], true),
    'after 20 KST Walldo must include the same-day 18 KST run'
);

$healthyEvening = wholesalehub_catalog_watchdog_evaluate([
    'dailyfood' => ['complete' => true, 'generatedAt' => '2026-08-29T11:10:00+09:00'],
    'walldob2b' => ['complete' => true, 'generatedAt' => '2026-08-29T18:12:00+09:00'],
], $afterEveningGrace);
check($healthyEvening['health'] === 'healthy', 'post-18 Walldo snapshot is healthy after 20 KST');

$incomplete = wholesalehub_catalog_watchdog_evaluate([
    'dailyfood' => ['complete' => false, 'generatedAt' => '2026-08-28T11:10:00+09:00'],
    'walldob2b' => ['complete' => true, 'generatedAt' => '2026-08-28T11:20:00+09:00'],
], $healthyNow);
check(in_array('dailyfood_snapshot_incomplete', $incomplete['reasons'], true), 'incomplete snapshot warns');

check(wholesalehub_catalog_watchdog_parse_time('not-a-date') === null, 'invalid timestamp is rejected');
check(wholesalehub_catalog_watchdog_parse_time('2026-08-28T11:00:00+09:00') instanceof DateTimeImmutable, 'valid timestamp parses');

echo "PASS: WholesaleHub catalog watchdog\n";
