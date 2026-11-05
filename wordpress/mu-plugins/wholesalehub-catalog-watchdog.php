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
    $minute = (int) $nowKst->format('i');
    $clock = $hour * 60 + $minute;
    // Actual catalog audits: 09:20, 14:20 and 19:20 KST.
    // Each run receives a two-hour grace period.
    if ($clock >= 21 * 60 + 20) return new DateTimeImmutable($date . ' 19:00:00', $tz);
    if ($clock >= 16 * 60 + 20) return new DateTimeImmutable($date . ' 14:00:00', $tz);
    if ($clock >= 11 * 60 + 20) return new DateTimeImmutable($date . ' 09:00:00', $tz);
    return new DateTimeImmutable($nowKst->modify('-1 day')->format('Y-m-d') . ' 19:00:00', $tz);
}

function wholesalehub_catalog_watchdog_walldo_stale_reason(DateTimeImmutable $nowKst): string
{
    return 'walldob2b_scheduled_catalog_snapshot_missing';
}

/**
 * Pure freshness evaluation used by runtime and standalone tests.
 *
 * @param array{sanjiro?:array<string,mixed>,walldob2b?:array<string,mixed>} $snapshots
 * @return array{health:string,reasons:string[],fingerprint:string}
 */
function wholesalehub_catalog_watchdog_evaluate(array $snapshots, DateTimeImmutable $nowKst): array
{
    $reasons = [];
    $sanjiro = is_array($snapshots['sanjiro'] ?? null) ? $snapshots['sanjiro'] : [];
    $walldo = is_array($snapshots['walldob2b'] ?? null) ? $snapshots['walldob2b'] : [];

    foreach (['sanjiro' => $sanjiro, 'walldob2b' => $walldo] as $supplier => $snapshot) {
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
        if ($supplier === 'sanjiro') {
            // Sanjiro Excel imports are scheduled every three hours.
            // A five-hour limit allows two hours of collection grace.
            if ($age > 5 * HOUR_IN_SECONDS) {
                $reasons[] = 'sanjiro_snapshot_over_5h';
            }
        } else {
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
        'sanjiro' => wholesalehub_catalog_watchdog_read_snapshot('sanjiro-catalog-snapshot.json'),
        'walldob2b' => wholesalehub_catalog_watchdog_read_snapshot('walldob2b-catalog-snapshot.json'),
    ], $now);

    $previous = get_option(WHOLESALEHUB_CATALOG_WATCHDOG_OPTION, []);
    $previous = is_array($previous) ? $previous : [];
    $previousHealth = (string) ($previous['health'] ?? 'unknown');
    $previousFingerprint = (string) ($previous['fingerprint'] ?? '');
    // Do not alert hourly merely because one stale-snapshot reason changed.
    // Repeat a persistent incident at most once every 12 hours.
    $lastNotifiedAt = (int) ($previous['last_notified_at'] ?? 0);
    $nowEpoch = $now->getTimestamp();

    if ($evaluation['health'] === 'warning') {
        $shouldNotify = $force || $previousHealth !== 'warning'
            || ($lastNotifiedAt > 0 && $nowEpoch - $lastNotifiedAt >= 12 * HOUR_IN_SECONDS);
        if ($shouldNotify && function_exists('avocadoss_send_telegram_message')) {
            $reasonText = implode(', ', $evaluation['reasons']);
            avocadoss_send_telegram_message(
                '⚠️ 도매Hub 공급사 카탈로그 감시: 최신 스냅샷 상태가 비정상입니다. '
                . '크롤링/n8n 스케줄과 reports/runtime 상태를 확인해주세요. 이유=' . $reasonText
                . ' | 기준=산지로 3시간 주기(5시간 이내), Walldo 09:20/14:20/19:20 KST(각 2시간 유예)'
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
        'last_notified_at' => $evaluation['health'] === 'warning'
            ? ($shouldNotify ? $nowEpoch : $lastNotifiedAt) : 0,
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
