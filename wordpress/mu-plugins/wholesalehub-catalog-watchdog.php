<?php
/**
 * WholesaleHub supplier catalog freshness watchdog.
 *
 * Provides a second, independent notification path for the failure mode where the
 * external supplier-catalog scheduler never starts and therefore cannot send its
 * own failure Telegram message. It only reads published supplier snapshots and
 * stores a small dedupe option; it never mutates products, orders, prices or stock.
 */

defined('ABSPATH') || exit;

const WHOLESALEHUB_CATALOG_WATCHDOG_HOOK = 'wholesalehub_catalog_watchdog_hourly';
const WHOLESALEHUB_CATALOG_WATCHDOG_OPTION = 'wholesalehub_catalog_watchdog_state_v1';

function wholesalehub_catalog_watchdog_schedule(): void
{
    if (!wp_next_scheduled(WHOLESALEHUB_CATALOG_WATCHDOG_HOOK)) {
        wp_schedule_event(time() + 300, 'hourly', WHOLESALEHUB_CATALOG_WATCHDOG_HOOK);
    }
}
add_action('init', 'wholesalehub_catalog_watchdog_schedule', 30);

/**
 * Return the minimum acceptable Walldo snapshot timestamp for the active
 * 11:00 / 18:00 KST collection schedule. Each scheduled run gets a two-hour
 * grace period before the watchdog requires it, matching the DailyFood guard.
 */
function wholesalehub_catalog_watchdog_walldo_expected_after(DateTimeImmutable $nowKst): DateTimeImmutable
{
    $tz = new DateTimeZone('Asia/Seoul');
    $date = $nowKst->format('Y-m-d');
    $hour = (int) $nowKst->format('H');

    if ($hour >= 20) {
        return new DateTimeImmutable($date . ' 18:00:00', $tz);
    }

    if ($hour >= 13) {
        return new DateTimeImmutable($date . ' 11:00:00', $tz);
    }

    return new DateTimeImmutable($nowKst->modify('-1 day')->format('Y-m-d') . ' 18:00:00', $tz);
}

function wholesalehub_catalog_watchdog_walldo_stale_reason(DateTimeImmutable $nowKst): string
{
    $hour = (int) $nowKst->format('H');
    if ($hour >= 20) {
        return 'walldob2b_expected_18_snapshot_missing_after_20';
    }
    if ($hour >= 13) {
        return 'walldob2b_expected_11_snapshot_missing_after_13';
    }
    return 'walldob2b_previous_18_snapshot_missing_before_13';
}

/**
 * Pure freshness evaluation used by runtime and standalone tests.
 *
 * @param array{dailyfood?:array<string,mixed>,walldob2b?:array<string,mixed>} $snapshots
 * @return array{health:string,reasons:string[],fingerprint:string}
 */
function wholesalehub_catalog_watchdog_evaluate(array $snapshots, DateTimeImmutable $nowKst): array
{
    $reasons = [];
    $daily = is_array($snapshots['dailyfood'] ?? null) ? $snapshots['dailyfood'] : [];
    $walldo = is_array($snapshots['walldob2b'] ?? null) ? $snapshots['walldob2b'] : [];

    foreach (['dailyfood' => $daily, 'walldob2b' => $walldo] as $supplier => $snapshot) {
        if ($snapshot === []) {
            $reasons[] = $supplier . '_snapshot_missing';
            continue;
        }
        if (($snapshot['complete'] ?? false) !== true) {
            $reasons[] = $supplier . '_snapshot_incomplete';
        }
        $generated = wholesalehub_catalog_watchdog_parse_time($snapshot['generatedAt'] ?? null);
        if ($generated === null) {
            $reasons[] = $supplier . '_generated_at_invalid';
            continue;
        }
        $generatedKst = $generated->setTimezone(new DateTimeZone('Asia/Seoul'));
        $age = $nowKst->getTimestamp() - $generatedKst->getTimestamp();
        if ($age < -300) {
            $reasons[] = $supplier . '_generated_in_future';
            continue;
        }
        if ($supplier === 'dailyfood') {
            // DailyFood's authoritative full crawl is expected around 11 KST.
            // Give it until 13 KST, then require a same-calendar-day snapshot.
            if ((int) $nowKst->format('H') >= 13 && $generatedKst->format('Y-m-d') !== $nowKst->format('Y-m-d')) {
                $reasons[] = 'dailyfood_same_day_snapshot_missing_after_13';
            } elseif ($age > 30 * HOUR_IN_SECONDS) {
                $reasons[] = 'dailyfood_snapshot_over_30h';
            }
        } else {
            // Walldo is scheduled at 11:00 and 18:00 KST. An absolute 14-hour
            // threshold falsely alarms every morning because 18:00 -> 08:00+
            // naturally exceeds 14 hours. Require the latest scheduled window
            // only after a two-hour grace period instead.
            $expectedAfter = wholesalehub_catalog_watchdog_walldo_expected_after($nowKst);
            if ($generatedKst < $expectedAfter) {
                $reasons[] = wholesalehub_catalog_watchdog_walldo_stale_reason($nowKst);
            }
        }
    }

    sort($reasons);
    return [
        'health' => $reasons === [] ? 'healthy' : 'warning',
        'reasons' => $reasons,
        'fingerprint' => hash('sha256', implode('|', $reasons)),
    ];
}

function wholesalehub_catalog_watchdog_parse_time($value): ?DateTimeImmutable
{
    if (!is_string($value) || trim($value) === '') {
        return null;
    }
    try {
        return new DateTimeImmutable($value);
    } catch (Throwable $error) {
        unset($error);
        return null;
    }
}

/** @return array<string,mixed> */
function wholesalehub_catalog_watchdog_read_snapshot(string $filename): array
{
    $path = WP_CONTENT_DIR . '/uploads/wholesalehub/' . $filename;
    if (!is_readable($path)) {
        return [];
    }
    $decoded = json_decode((string) file_get_contents($path), true);
    return is_array($decoded) ? $decoded : [];
}

function wholesalehub_catalog_watchdog_run(bool $force = false): array
{
    $now = new DateTimeImmutable('now', new DateTimeZone('Asia/Seoul'));
    $evaluation = wholesalehub_catalog_watchdog_evaluate([
        'dailyfood' => wholesalehub_catalog_watchdog_read_snapshot('dailyfood-catalog-snapshot.json'),
        'walldob2b' => wholesalehub_catalog_watchdog_read_snapshot('walldob2b-catalog-snapshot.json'),
    ], $now);

    $previous = get_option(WHOLESALEHUB_CATALOG_WATCHDOG_OPTION, []);
    $previous = is_array($previous) ? $previous : [];
    $previousHealth = (string) ($previous['health'] ?? 'unknown');
    $previousFingerprint = (string) ($previous['fingerprint'] ?? '');

    if ($evaluation['health'] === 'warning') {
        $shouldNotify = $force || $previousHealth !== 'warning' || $previousFingerprint !== $evaluation['fingerprint'];
        if ($shouldNotify && function_exists('avocadoss_send_telegram_message')) {
            $reasonText = implode(', ', $evaluation['reasons']);
            avocadoss_send_telegram_message(
                '⚠️ 도매Hub 공급사 카탈로그 감시: 최신 스냅샷 상태가 비정상입니다. '
                . '크롤링/n8n 스케줄과 reports/runtime 상태를 확인해주세요. 이유=' . $reasonText
                . ' | 기준=DailyFood 11:00, Walldo 11:00/18:00 KST(각 2시간 유예)'
            );
        }
    } elseif ($previousHealth === 'warning' && function_exists('avocadoss_send_telegram_message')) {
        avocadoss_send_telegram_message('✅ 도매Hub 공급사 카탈로그 감시: 스냅샷 신선도가 정상으로 복구되었습니다.');
    }

    update_option(WHOLESALEHUB_CATALOG_WATCHDOG_OPTION, [
        'health' => $evaluation['health'],
        'fingerprint' => $evaluation['fingerprint'],
        'reasons' => $evaluation['reasons'],
        'checked_at' => $now->format(DATE_ATOM),
    ], false);

    return $evaluation;
}
add_action(WHOLESALEHUB_CATALOG_WATCHDOG_HOOK, 'wholesalehub_catalog_watchdog_run');

if (defined('WP_CLI') && WP_CLI && class_exists('WP_CLI')) {
    WP_CLI::add_command('avocadoss catalog-watchdog', static function (array $args, array $assocArgs): void {
        unset($args);
        $result = wholesalehub_catalog_watchdog_run(isset($assocArgs['force']));
        WP_CLI::log((string) wp_json_encode($result, JSON_UNESCAPED_UNICODE));
        if ($result['health'] === 'healthy') {
            WP_CLI::success('WholesaleHub catalog snapshots are fresh.');
        } else {
            WP_CLI::warning('WholesaleHub catalog snapshot warning: ' . implode(', ', $result['reasons']));
        }
    });
}
