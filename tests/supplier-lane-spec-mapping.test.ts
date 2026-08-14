import { DatabaseSync } from "node:sqlite"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { parseSpecLabel, sortOffersBySizeWeight } from "../src/supplier-lane/spec-normalizer.js"
import {
  ensureSpecMappingSchema,
  syncSpecMappingForOffer,
} from "../src/supplier-lane/spec-repository.ts"

const plugin = readFileSync(
  "wordpress/plugins/wholesalehub-supplier-lanes/wholesalehub-supplier-lanes.php",
  "utf8",
)

describe("Option A Spec Normalization & Spec Mapping", () => {
  it("normalizes identical specs from different option labels (e.g. '특품 감자 5kg' and '감자 특 5키로')", () => {
    const spec1 = parseSpecLabel("특품 감자 5kg")
    const spec2 = parseSpecLabel("감자 특 5키로")

    expect(spec1.gradeSize).toBe("특품")
    expect(spec1.weightVal).toBe(5)
    expect(spec1.weightUnit).toBe("kg")

    expect(spec2.gradeSize).toBe("특품")
    expect(spec2.weightVal).toBe(5)
    expect(spec2.weightUnit).toBe("kg")

    expect(spec1.comparisonGroup).toBe(spec2.comparisonGroup)
    expect(spec1.status).toBe("auto_approved")
  })

  it("correctly extracts 500g, 2kg, 20개, 30과, 대과 20입", () => {
    const s500g = parseSpecLabel("신선 딸기 500g")
    expect(s500g.weightVal).toBe(500)
    expect(s500g.weightUnit).toBe("g")

    const s2kg = parseSpecLabel("성주참외 2kg")
    expect(s2kg.weightVal).toBe(2)
    expect(s2kg.weightUnit).toBe("kg")

    const s20cnt = parseSpecLabel("특품 사과 20개입")
    expect(s20cnt.countVal).toBe(20)
    expect(s20cnt.countUnit).toBe("개")

    const s30gwa = parseSpecLabel("무지개망고 30과")
    expect(s30gwa.countVal).toBe(30)
    expect(s30gwa.countUnit).toBe("과")

    const sDaegwa20 = parseSpecLabel("대과 20입 박스")
    expect(sDaegwa20.gradeSize).toBe("대")
    expect(sDaegwa20.countVal).toBe(20)
    expect(sDaegwa20.packaging).toBe("박스")
  })

  it("persists spec mappings in SQLite and preserves manual_approved status", () => {
    const db = new DatabaseSync(":memory:")
    ensureSpecMappingSchema(db)

    const offer = {
      woo_variation_id: 101,
      woo_parent_id: 10,
      public_offer_key: "offer_key_101",
      option_label_raw: "특품 감자 5kg",
    }

    const row1 = syncSpecMappingForOffer(db, offer, "2026-07-28 12:00:00")
    expect(row1.status).toBe("auto_approved")
    expect(row1.comparison_group).toBe("특품 5kg")

    // Mark as manual_approved
    db.prepare("UPDATE supplier_lane_spec_mappings SET status = 'manual_approved', comparison_group = '특품 5kg 수동확정' WHERE woo_variation_id = 101").run()

    // Re-sync should NOT overwrite manual_approved
    const row2 = syncSpecMappingForOffer(
      db,
      { ...offer, option_label_raw: "특품 감자 5kg [수정제목]" },
      "2026-07-28 12:05:00",
    )
    expect(row2.status).toBe("manual_approved")
    expect(row2.comparison_group).toBe("특품 5kg 수동확정")
  })

  it("verifies PHP plugin includes schema 1.2.0, spec_mappings table, and Option A UI rendering", () => {
    expect(plugin).toContain("SCHEMA_VERSION = '1.2.0'")
    expect(plugin).toContain("supplier_lane_spec_mappings")
    expect(plugin).toContain("parse_spec_label")
    expect(plugin).toContain("render_option_a_ui")
    expect(plugin).toContain("원하는 규격을 선택하세요")
    expect(plugin).toContain("상품가격 최저")
    expect(plugin).toContain("wh-spec-mapping")
  })

  it("sorts options strictly by size rank first, then weight ascending, then count, then pack, then label", () => {
    const rawOptions = [
      { label: "왕특10kg" },
      { label: "특10kg" },
      { label: "대10kg" },
      { label: "중10kg" },
      { label: "왕특2kg" },
      { label: "특2kg" },
      { label: "대2kg" },
      { label: "중2kg" },
      { label: "중5kg" },
      { label: "중3kg" },
      { label: "1kg" },
      { label: "500g" },
    ]

    const sorted = [...rawOptions].sort(sortOffersBySizeWeight)
    const sortedLabels = sorted.map((o) => o.label)

    expect(sortedLabels).toEqual([
      "중2kg",
      "중3kg",
      "중5kg",
      "중10kg",
      "대2kg",
      "대10kg",
      "특2kg",
      "특10kg",
      "왕특2kg",
      "왕특10kg",
      "500g",
      "1kg",
    ])
  })
})
