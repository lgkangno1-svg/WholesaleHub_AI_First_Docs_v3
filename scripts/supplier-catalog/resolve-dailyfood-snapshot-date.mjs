#!/usr/bin/env node

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const [runDate, runHourRaw, secondaryOnlyRaw] = process.argv.slice(2);

if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate || '')) {
  fail(`invalid run date: ${runDate || ''}`);
}

const runHour = Number(runHourRaw);
if (!Number.isInteger(runHour) || runHour < 0 || runHour > 23) {
  fail(`invalid run hour: ${runHourRaw || ''}`);
}

const secondaryOnly = secondaryOnlyRaw === '1';
if (!secondaryOnly || runHour >= 11) {
  process.stdout.write(runDate);
  process.exit(0);
}

const [year, month, day] = runDate.split('-').map(Number);
const utc = new Date(Date.UTC(year, month - 1, day));
utc.setUTCDate(utc.getUTCDate() - 1);
const previousDate = utc.toISOString().slice(0, 10);
process.stdout.write(previousDate);
