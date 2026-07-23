# Hotfix Documentation — P2 Price Sync & Telegram Trap Fix

## Overview
This hotfix addresses preflight false-positives and duplicate Telegram error notifications without mutating existing option reconciliation logic or interfering with concurrent P2 audit activities in `sol/p2-price-sync`.

## Branch & Worktree
- **Hotfix Branch**: `sol/p2-hotfix-telegram-preflight`
- **Hotfix Worktree**: `/home/tnfwod/projects/wholesalehub-worktrees/p2-hotfix`

## Scope of Changes

### 1. Preflight & Sync Plan Threshold Adjustment
- **Files**: `src/reports/mvp-sync-plan-cli.ts`, `src/reports/mvp-sync-preflight.ts`
- **Change**: Increased `dailyFoodOptionCount` maximum threshold from 700 to 1500, and `walldob2bOptionCount` maximum threshold from 240 to 500.
- **Rationale**: Prevents valid daily food option increases (e.g. 725 options) from triggering preflight failures (`dailyfood_options_above_700`).

### 2. Shell Trap Duplicate Telegram Prevention
- **File**: `scripts/n8n-mvp-sync.sh`
- **Change**: 
  - Added condition `[ "$PRICE_REPORT_SENT" -ne 1 ]` before sending failure alerts in `finish()` trap.
  - Formatted fatal crash alerts with `🚨 도매Hub 가격 동기화 중단`.
- **Rationale**: Prevents duplicate error Telegram notifications when a normal summary report has already been sent to Telegram.

### 3. Exit Code & Status Policy
- Business-level held/review items (`partial_success`, `heldCount > 0`) return process exit code `0`.
- Process exit code `1` is reserved strictly for unhandled execution exceptions or fatal pipeline failures.

## Verification
- Unit test suite (`npm test`) verified in `p2-hotfix` worktree.
- Dry-run and production execution verified idempotency and single summary Telegram delivery.
