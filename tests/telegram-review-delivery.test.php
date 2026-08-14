<?php
declare(strict_types=1);

define('ABSPATH', '/tmp/');
define('ARRAY_A', 'ARRAY_A');
define('MINUTE_IN_SECONDS', 60);

$GLOBALS['tg_api_results'] = [701, 0, 702];
$GLOBALS['tg_calls'] = [];
$GLOBALS['filters'] = [];
$GLOBALS['options'] = [
    'avocadoss_telegram_chat_id' => 'test-chat',
    'avocadoss_telegram_allowed_user_id' => 'test-user',
    'avocadoss_telegram_bot_token' => '123456:unit-test-token',
];

function add_action(...$args): void {}
function remove_action(...$args): void {}
function add_filter($tag, $callback, ...$args): void { $GLOBALS['filters'][$tag][] = $callback; }
function apply_filters($tag, $value, ...$args) {
    foreach ($GLOBALS['filters'][$tag] ?? [] as $callback) {
        $value = $callback($value, ...$args);
    }
    return $value;
}
function get_option($key, $default = false) { return $GLOBALS['options'][$key] ?? $default; }
function current_time($type, $gmt = false): string { return '2026-08-09 00:00:00'; }
function sanitize_key($value): string { return preg_replace('/[^a-z0-9_-]/', '', strtolower((string) $value)); }
function sanitize_text_field($value): string { return trim((string) $value); }
function esc_url_raw($value): string { return (string) $value; }
function wp_json_encode($value, $flags = 0): string { return json_encode($value, $flags); }
function wp_generate_password($length = 12, $special = false, $extra = false): string { return str_pad((string) (count($GLOBALS['db']->rows) + 1), $length, 'A'); }
function absint($value): int { return abs((int) $value); }
function get_the_title($id): string { return 'Mock parent #' . $id; }
function get_posts($args): array { return []; }
function wc_get_product($id) { return null; }
function get_post_meta(...$args): string { return ''; }
function update_post_meta(...$args): bool { return true; }
function get_post_type($id): string { return 'product'; }
function get_terms($args): array { return []; }
function is_wp_error($value): bool { return false; }
function wp_salt($scheme = ''): string { return 'test-salt'; }
function get_transient($key) { return false; }
function set_transient(...$args): bool { return true; }
function __return_true(): bool { return true; }
function wp_remote_post($url, array $args): array {
    $GLOBALS['tg_calls'][] = ['url' => $url, 'payload' => $args['body']];
    $next = array_shift($GLOBALS['tg_api_results']);
    return ['code' => 200, 'body' => json_encode($next > 0 ? ['ok' => true, 'result' => ['message_id' => $next]] : ['ok' => false])];
}
function wp_remote_retrieve_response_code(array $response): int { return $response['code']; }
function wp_remote_retrieve_body(array $response): string { return $response['body']; }

final class MockWpdb {
    public string $prefix = 'wp_';
    public int $insert_id = 0;
    public array $rows = [];
    public array $audits = [];
    private array $prepared = [];

    public function prepare($query, ...$args): string { $this->prepared = $args; return $query; }
    public function get_charset_collate(): string { return ''; }
    public function get_row($query, $output = null) {
        if (count($this->prepared) === 4) {
            return in_array('product-success', $this->prepared, true) ? ($this->rows[1] ?? null) : null;
        }
        if (str_contains($query, 'WHERE id=%d')) {
            $id = (int) end($this->prepared);
            return $this->rows[$id] ?? null;
        }
        if (str_contains($query, 'action_token=')) {
            $token = (string) end($this->prepared);
            foreach ($this->rows as $row) if ($row['action_token'] === $token) return $row;
        }
        return null;
    }
    public function get_results($query, $output = null): array { return []; }
    public function get_var($query) { return null; }
    public function insert($table, $data): int {
        if (str_contains($table, 'supplier_lane_audit_history')) { $this->audits[] = $data; $this->insert_id = count($this->audits); return 1; }
        $id = count($this->rows) + 1; $data['id'] = $id; $data['telegram_message_id'] = null; $data['telegram_sent_at'] = null; $this->rows[$id] = $data; $this->insert_id = $id; return 1;
    }
    public function update($table, $data, $where): int {
        $id = (int) ($where['id'] ?? 0); if (!isset($this->rows[$id])) return 0;
        $this->rows[$id] = array_merge($this->rows[$id], $data); return 1;
    }
    public function query($query): int {
        $id = str_contains($query, "SET telegram_sent_at")
            ? (int) $this->prepared[2]
            : (int) end($this->prepared);
        if (!isset($this->rows[$id])) return 0;
        $row = &$this->rows[$id];
        if (str_contains($query, "SET telegram_sent_at")) {
            if ($row['telegram_message_id'] !== null || $row['telegram_sent_at'] !== null) return 0;
            $row['telegram_sent_at'] = '2026-08-09 00:00:00'; return 1;
        }
        if (str_contains($query, "SET status=%s") && str_contains($query, "pending_mapping")) {
            if (!in_array($row['status'], ['pending_mapping', 'pending_option'], true)) return 0;
            $row['status'] = (string) $this->prepared[0]; return 1;
        }
        return 0;
    }
}
$GLOBALS['db'] = new MockWpdb();
$wpdb = $GLOBALS['db'];

$plugin = '/var/www/html/wp-content/plugins/avocadoss-performance';
if (!is_file($plugin . '/avocadoss-performance.php')) {
    fwrite(STDERR, "FAIL: active plugin path unavailable\n"); exit(1);
}
require $plugin . '/avocadoss-performance.php';
require '/var/www/html/wp-content/plugins/wholesalehub-supplier-lanes/includes/class-wholesalehub-supplier-lane-approval.php';
WholesaleHub_Supplier_Lane_Approval::boot();
$reflection = new ReflectionClass(WholesaleHub_Supplier_Lane_Approval::class);
$schema = $reflection->getProperty('schema_ready'); $schema->setAccessible(true); $schema->setValue(true);

function check($condition, string $name): void {
    if (!$condition) { fwrite(STDERR, "FAIL: {$name}\n"); exit(1); }
    echo "PASS: {$name}\n";
}
function stage(string $product): string {
    return WholesaleHub_Supplier_Lane_Approval::stage_product(
        ['displayName' => 'Review product', 'approvalCategories' => [], '_approvalTestMode' => true],
        'A',
        ['supplierId' => 'supplier-a', 'sourceProductId' => $product, 'options' => [['sourceOptionId' => 'opt-1', 'publicOptionLabel' => '1kg', 'salePrice' => 1000]]]
    );
}

check(function_exists('avocadoss_send_telegram_approval_message'), 'loader exposes sender');
check(method_exists(WholesaleHub_Supplier_Lane_Approval::class, 'send_pending_telegram_approval'), 'approval exposes explicit sender');
stage('product-success');
$first = $GLOBALS['db']->rows[1];
check($first['status'] === 'pending_mapping' && $first['telegram_sent_at'] === null && count($GLOBALS['tg_calls']) === 0, 'default off preserves staging without outbound');
check(WholesaleHub_Supplier_Lane_Approval::send_pending_telegram_approval(1) === true, 'explicit sender claims and sends pending request');
$first = $GLOBALS['db']->rows[1];
$firstPayload = $GLOBALS['tg_calls'][0]['payload'];
check(str_contains($firstPayload['text'], 'Review product') && str_contains($firstPayload['reply_markup'], 'slm:'), 'message payload and keyboard');
check($first['status'] === 'pending_mapping' && $first['telegram_sent_at'] !== null, 'pending request is claimed then sent');
check((int) $first['telegram_message_id'] === 701, 'success records message id for awaiting approval');

stage('product-failure');
check(WholesaleHub_Supplier_Lane_Approval::send_pending_telegram_approval(2) === false, 'explicit send failure reports false');
$failure = $GLOBALS['db']->rows[2];
check($failure['telegram_message_id'] === null && $failure['telegram_sent_at'] === null && $failure['status'] === 'pending_mapping', 'failure remains retryable');

$callsBeforeDuplicate = count($GLOBALS['tg_calls']);
stage('product-success');
check(WholesaleHub_Supplier_Lane_Approval::send_pending_telegram_approval(1) === false && count($GLOBALS['tg_calls']) === $callsBeforeDuplicate && count($GLOBALS['db']->rows) === 2, 'duplicate request sends once');

$callback = ['data' => 'slm:' . $first['action_token'] . ':hold', 'from_id' => 'test-user', 'chat_id' => 'test-chat', 'admin' => 'test'];
$result = avocadoss_process_telegram_callback($callback);
check($result['ok'] === true && $GLOBALS['db']->rows[1]['status'] === 'on_hold' && count($GLOBALS['db']->audits) >= 3, 'callback route reaches approval audit handler');
$auditCount = count($GLOBALS['db']->audits);
$duplicate = avocadoss_process_telegram_callback($callback);
check($duplicate['ok'] === true && count($GLOBALS['db']->audits) === $auditCount && $GLOBALS['db']->rows[1]['status'] === 'on_hold', 'duplicate callback causes no mutation');

echo "PASS: 10 Telegram review delivery scenarios\n";
