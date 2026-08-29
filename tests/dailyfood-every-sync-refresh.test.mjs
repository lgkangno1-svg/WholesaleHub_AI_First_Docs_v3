#!/usr/bin/env node

import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const shell = await readFile("scripts/n8n-supplier-catalog-sync.sh", "utf8")

assert.match(shell, /start_step dailyfood_collect/u)
assert.match(
  shell,
  /run_with_timeout "\$CRAWLER_TIMEOUT" node scripts\/supplier-catalog\/collect-dailyfood-catalog\.mjs/u,
)
assert.doesNotMatch(shell, /dailyfood_same_day_snapshot/u)
assert.doesNotMatch(shell, /verify_reusable_dailyfood_snapshot/u)
assert.doesNotMatch(shell, /revalidate-catalog-images\.mjs[\s\S]*dailyfood-catalog-snapshot/u)
assert.match(shell, /Daily 수집 매회 최신/u)

const scheduleGate = shell.match(
  /if \[ "\$RUN_HOUR" != "11" \][\s\S]*?schedule_not_due[\s\S]*?fi/u,
)
assert.ok(scheduleGate, "configured schedule gate must remain present")

const dailyCollectIndex = shell.indexOf("start_step dailyfood_collect")
const walldoCollectIndex = shell.indexOf("start_step walldob2b_collect")
assert.ok(dailyCollectIndex > 0, "DailyFood collection step must exist")
assert.ok(
  walldoCollectIndex > dailyCollectIndex,
  "DailyFood must refresh before Walldo/grouping/Woo sync",
)

console.log("DAILYFOOD_EVERY_SYNC_REFRESH_POLICY_OK")
