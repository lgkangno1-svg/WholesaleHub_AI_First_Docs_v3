import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  type AbsenceState,
  evaluateWalldoGate,
  readAbsenceState,
  updateAbsenceState,
  writeAbsenceState,
} from "../src/reports/mvp-source-absence-delete-cli.js"

const HEALTHY = {
  valid: true,
  complete: true,
  duplicateProductIds: 0,
  duplicateOptionIds: 0,
} as const
const VALIDATED_AT = "2026-08-19T00:00:00.000Z"
const FIRST_ABSENT_AT = "2026-08-19T01:00:00.000Z"
const SECOND_ABSENT_AT = "2026-08-19T02:00:00.000Z"

describe("Walldob2b source sanity gate", () => {
  it("passes 24/137 against last-good 28/156", () => {
    const result = evaluateWalldoGate(
      { products: 24, options: 137 },
      { products: 28, options: 156, validatedAt: VALIDATED_AT },
      HEALTHY,
    )

    expect(result.blocked).toBe(false)
    expect(result.ratioProducts).toBeCloseTo(0.857, 3)
    expect(result.ratioOptions).toBeCloseTo(0.878, 3)
    expect(result.reasons).toEqual([])
  })

  it("blocks 8/50 against last-good 24/137", () => {
    const result = evaluateWalldoGate(
      { products: 8, options: 50 },
      { products: 24, options: 137, validatedAt: VALIDATED_AT },
      HEALTHY,
    )

    expect(result.blocked).toBe(true)
    expect(result.ratioProducts).toBeCloseTo(0.333, 3)
    expect(result.reasons).toContain("products_below_last_good_ratio")
  })

  it("blocks 12/95 without last-good because both absolute floors fail", () => {
    const result = evaluateWalldoGate({ products: 12, options: 95 }, null, HEALTHY)

    expect(result.blocked).toBe(true)
    expect(result.reasons).toEqual([
      "products_below_absolute_floor",
      "options_below_absolute_floor",
    ])
  })

  it("passes 35/210 without last-good", () => {
    const result = evaluateWalldoGate({ products: 35, options: 210 }, null, HEALTHY)

    expect(result.blocked).toBe(false)
    expect(result.ratioProducts).toBeNull()
    expect(result.ratioOptions).toBeNull()
  })

  it("blocks incomplete snapshots without changing absence counters", () => {
    const state = onceAbsentState()
    const gate = evaluateWalldoGate(
      { products: 35, options: 210 },
      null,
      { ...HEALTHY, complete: false },
    )
    const update = updateAbsenceState(state, ["p:123"], [], {
      blocked: gate.blocked,
      now: SECOND_ABSENT_AT,
    })

    expect(gate.blocked).toBe(true)
    expect(gate.reasons).toEqual(["complete=false"])
    expect(update.state).toEqual(state)
    expect(update.eligibleKeys.size).toBe(0)
    expect(update.stats).toEqual({ absentOnce: 0, absentConfirmed: 0, resets: 0 })
  })

  it("blocks duplicate product IDs", () => {
    const result = evaluateWalldoGate(
      { products: 35, options: 210 },
      null,
      { ...HEALTHY, duplicateProductIds: 1 },
    )

    expect(result.blocked).toBe(true)
    expect(result.reasons).toEqual(["duplicate_product_ids"])
  })

  it("blocks an invalid snapshot", () => {
    const result = evaluateWalldoGate(null, null, {
      valid: false,
      complete: false,
      duplicateProductIds: 0,
      duplicateOptionIds: 0,
      invalidReason: "snapshot_unparseable",
    })

    expect(result.blocked).toBe(true)
    expect(result.reasons).toEqual(["snapshot_unparseable"])
  })
})

describe("two-consecutive source absence tracking", () => {
  it("does not make an item eligible on its first absence", () => {
    const result = updateAbsenceState(emptyState(), ["p:123"], [], { now: FIRST_ABSENT_AT })

    expect(result.state.absence["p:123"]?.count).toBe(1)
    expect(result.eligibleKeys.size).toBe(0)
    expect(result.stats.absentOnce).toBe(1)
  })

  it("makes an item eligible on its second consecutive absence", () => {
    const result = updateAbsenceState(onceAbsentState(), ["p:123"], [], {
      now: SECOND_ABSENT_AT,
    })

    expect(result.state.absence["p:123"]).toEqual({
      count: 2,
      firstAbsentAt: FIRST_ABSENT_AT,
      lastAbsentAt: SECOND_ABSENT_AT,
    })
    expect(result.eligibleKeys).toEqual(new Set(["p:123"]))
    expect(result.stats.absentConfirmed).toBe(1)
  })

  it("tracks product and variation keys independently", () => {
    const state = onceAbsentState()
    state.absence["v:456"] = {
      count: 1,
      firstAbsentAt: FIRST_ABSENT_AT,
      lastAbsentAt: FIRST_ABSENT_AT,
    }

    const result = updateAbsenceState(state, ["v:456"], ["p:123"], {
      now: SECOND_ABSENT_AT,
    })

    expect(result.state.absence["p:123"]).toBeUndefined()
    expect(result.state.absence["v:456"]?.count).toBe(2)
    expect(result.eligibleKeys).toEqual(new Set(["v:456"]))
  })

  it("resets an absence counter when the item reappears", () => {
    const result = updateAbsenceState(onceAbsentState(), [], ["p:123"], {
      now: SECOND_ABSENT_AT,
    })

    expect(result.state.absence["p:123"]).toBeUndefined()
    expect(result.stats.resets).toBe(1)
  })

  it("does not increment counters during a blocked run", () => {
    const state = onceAbsentState()
    const result = updateAbsenceState(state, ["p:123", "v:456"], [], {
      blocked: true,
      now: SECOND_ABSENT_AT,
    })

    expect(result.state).toEqual(state)
    expect(result.eligibleKeys.size).toBe(0)
  })

  it("round-trips the persistent state file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "walldo-absence-state-"))
    const path = join(directory, "state.json")
    const state: AbsenceState = {
      ...onceAbsentState(),
      lastGood: { products: 28, options: 156, validatedAt: VALIDATED_AT },
      absence: {
        ...onceAbsentState().absence,
        "v:456": {
          count: 2,
          firstAbsentAt: FIRST_ABSENT_AT,
          lastAbsentAt: SECOND_ABSENT_AT,
        },
      },
    }

    try {
      await writeAbsenceState(path, state)
      await expect(readAbsenceState(path)).resolves.toEqual(state)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

function emptyState(): AbsenceState {
  return { schemaVersion: 1, absence: {} }
}

function onceAbsentState(): AbsenceState {
  return {
    schemaVersion: 1,
    absence: {
      "p:123": {
        count: 1,
        firstAbsentAt: FIRST_ABSENT_AT,
        lastAbsentAt: FIRST_ABSENT_AT,
      },
    },
  }
}
