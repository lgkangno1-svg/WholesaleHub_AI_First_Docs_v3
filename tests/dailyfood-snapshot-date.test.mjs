import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const resolver = path.resolve(here, '../scripts/supplier-catalog/resolve-dailyfood-snapshot-date.mjs');

function resolve(runDate, runHour, secondaryOnly) {
  return execFileSync(process.execPath, [resolver, runDate, String(runHour), String(secondaryOnly)], {
    encoding: 'utf8',
  }).trim();
}

assert.equal(resolve('2026-08-28', 1, 1), '2026-08-27', 'pre-11 KST manual catch-up reuses previous 11 KST snapshot');
assert.equal(resolve('2026-08-28', 10, 1), '2026-08-27', '10 KST manual catch-up still reuses previous snapshot');
assert.equal(resolve('2026-08-28', 11, 1), '2026-08-28', '11 KST and later require same-day snapshot');
assert.equal(resolve('2026-08-28', 18, 1), '2026-08-28', 'evening manual catch-up uses same-day snapshot');
assert.equal(resolve('2026-08-28', 1, 0), '2026-08-28', 'normal scheduled path does not silently reuse previous day');
assert.equal(resolve('2026-03-01', 1, 1), '2026-02-28', 'month boundary is handled');
assert.equal(resolve('2027-01-01', 1, 1), '2026-12-31', 'year boundary is handled');

const invalid = spawnSync(process.execPath, [resolver, '2026-08-28', '25', '1'], { encoding: 'utf8' });
assert.notEqual(invalid.status, 0, 'invalid hour fails closed');

console.log('PASS: DailyFood reusable snapshot date policy');
