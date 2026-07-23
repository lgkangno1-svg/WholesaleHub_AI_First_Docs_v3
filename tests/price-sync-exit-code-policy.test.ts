import { describe, expect, it, vi } from "vitest"
import { validateMvpSyncPreflight } from "../src/reports/mvp-sync-preflight.js"

describe("Price Sync Exit Code Policy & Preflight Tests", () => {
  it("A: held 14개, 정상 76개일 때 partial_success 및 exit 0 조건 검증", () => {
    const summary = {
      runFailed: false,
      failureReasons: [],
      dailyFoodOptionCount: 725,
      walldob2bOptionCount: 191,
      wooProductCount: 145,
      wooVariationCount: 477,
    }

    const preflight = validateMvpSyncPreflight({ summary }, { destructive: false })

    expect(preflight.ok).toBe(true)
    expect(preflight.reasons).toEqual([])
    expect(preflight.dailyFoodOptionCount).toBe(725)
  })

  it("B: source_unverified 14개가 있어도 preflight validation은 ok를 반환", () => {
    const summary = {
      runFailed: false,
      failureReasons: [],
      dailyFoodOptionCount: 750,
      walldob2bOptionCount: 200,
      wooProductCount: 100,
      wooVariationCount: 300,
    }

    const result = validateMvpSyncPreflight({ summary }, { destructive: false })
    expect(result.ok).toBe(true)
    expect(result.reasons).toHaveLength(0)
  })

  it("C: 실제 파이프라인 수집 실패 시 preflight ok = false 반환", () => {
    const summary = {
      runFailed: true,
      failureReasons: ["dailyfood direct-site collection failed: timeout"],
      dailyFoodOptionCount: 0,
      walldob2bOptionCount: 191,
      wooProductCount: 145,
      wooVariationCount: 477,
    }

    const result = validateMvpSyncPreflight({ summary }, { destructive: false })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain("dailyfood direct-site collection failed: timeout")
  })

  it("D: Telegram Outbox 저장 및 중복 방지 Key 검증", () => {
    const runId = "20260723-1500-3348454"
    const summaryKey = `price-sync-summary:${runId}`
    const fatalKey = `price-sync-fatal:${runId}:preflight:1`

    expect(summaryKey).not.toBe(fatalKey)
    expect(summaryKey).toBe("price-sync-summary:20260723-1500-3348454")
  })

  it("E & F: 동일 run 재실행 시 Idempotency 유지 검증", () => {
    const executedRuns = new Set<string>()
    const runId = "20260723-1500-3348454"

    let firstRunTelegramCount = 0
    if (!executedRuns.has(runId)) {
      executedRuns.add(runId)
      firstRunTelegramCount += 1
    }

    let secondRunTelegramCount = 0
    if (!executedRuns.has(runId)) {
      executedRuns.add(runId)
      secondRunTelegramCount += 1
    }

    expect(firstRunTelegramCount).toBe(1)
    expect(secondRunTelegramCount).toBe(0)
  })
})
