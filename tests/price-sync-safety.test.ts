import { DatabaseSync } from "node:sqlite"
import ky from "ky"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  applyCandidate,
  assertSchema,
  type Candidate,
  classifyLinks,
  getSpecFingerprint,
  isSupplierSnapshotComplete,
  parseArgs,
} from "../src/reports/linked-offer-price-sync-cli.js"

vi.mock("ky", () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
  },
}))

const candidate: Candidate = {
  supplierId: "dailyfood",
  supplierProductId: "product-1",
  supplierOptionId: "option-50",
  atomicSkuId: "sku-50",
  selectedOfferId: "offer-50",
  wooProductId: 100,
  wooVariationId: 101,
  originalProductName: "apple juice",
  originalOptionName: "50 packs",
  previousSupplierCost: 10_000,
  observedSupplierCost: 12_000,
  currentWooPrice: 15_000,
  calculatedWooPrice: 18_000,
  classification: "ready_to_apply",
  reason: "test",
  sourceUrl: "https://supplier.invalid/product-1",
  sourceHash: "hash",
  observedAt: "2026-07-23T00:00:00.000Z",
}

describe("exact option identity", () => {
  it.each([
    [
      { count_value: 10, option_unit: "개입" },
      { count_value: 10, option_unit: "팩" },
    ],
    [
      { count_value: 10, option_unit: "팩" },
      { count_value: 10, option_unit: "송이" },
    ],
    [
      { count_value: 30, option_unit: "팩" },
      { count_value: 50, option_unit: "팩" },
    ],
    [
      { size_min: 8, size_max: 10, size_unit: "과" },
      { size_min: 11, size_max: 13, size_unit: "과" },
    ],
    [
      { size_label: "특대", quality_grade: "상" },
      { size_label: "대", quality_grade: "상" },
    ],
    [
      { product_family: "옥수수", variety: "흑찰" },
      { product_family: "옥수수", variety: "백찰" },
    ],
    [
      { weight: 5, weight_basis: "box" },
      { weight: 10, weight_basis: "box" },
    ],
  ])("does not collapse distinct specifications", (left, right) => {
    expect(getSpecFingerprint(left)).not.toBe(getSpecFingerprint(right))
  })

  it("is stable for the same normalized specification", () => {
    expect(
      getSpecFingerprint({
        product_family: " APPLE JUICE ",
        count_value: 50,
        option_unit: "PACK",
        package_type: "BOX",
      }),
    ).toBe(
      getSpecFingerprint({
        product_family: "apple juice",
        count_value: 50,
        option_unit: "pack",
        package_type: "box",
      }),
    )
  })
})

describe("snapshot completeness fail-closed policy", () => {
  const runId = "daily-snapshot-test"
  let db: DatabaseSync
  let snapshot: NonNullable<Parameters<typeof isSupplierSnapshotComplete>[2]>

  beforeEach(() => {
    db = new DatabaseSync(":memory:")
    db.exec(`
      CREATE TABLE sync_stage_checkpoints (
        pipeline_run_id TEXT NOT NULL,
        stage_name TEXT NOT NULL,
        stage_status TEXT NOT NULL,
        PRIMARY KEY (pipeline_run_id, stage_name)
      );
    `)
    for (const stage of ["collect_products", "fetch_details", "parse_options"]) {
      db.prepare("INSERT INTO sync_stage_checkpoints VALUES (?, ?, 'completed')").run(runId, stage)
    }
    snapshot = {
      createdAt: "2026-07-23T00:00:00.000Z",
      collection: {
        schemaVersion: "supplier-snapshot-v2",
        pipelineRunId: runId,
        authVerified: true,
        paginationComplete: true,
        detailFetchFailureCount: 0,
        parseFailureCount: 0,
        expectedProductCount: 1,
        collectedProductCount: 1,
        minimumExpectedProductCount: 1,
        countWithinExpectedRange: true,
      },
      products: [
        {
          supplierId: "dailyfood",
          originalProductName: "product",
          originalOptionName: "option",
          price: 10_000,
          shippingFee: 0,
          stockStatus: "in_stock",
          productUrl: "",
          rawJson: '{"sourceProductId":"p1","sourceOptionId":"o1"}',
        },
      ],
    }
  })

  it("accepts only a fully attested snapshot", () => {
    expect(isSupplierSnapshotComplete(db, "dailyfood", snapshot)).toBe(true)
  })

  it.each([
    ["expired login", { authVerified: false }],
    ["pagination incomplete", { paginationComplete: false }],
    ["detail fetch failed", { detailFetchFailureCount: 1 }],
    ["count dropped", { expectedProductCount: 2 }],
    ["row count mismatch", { collectedProductCount: 2 }],
    ["unknown schema", { schemaVersion: "supplier-snapshot-v1" }],
  ])("rejects %s", (_name, override) => {
    Object.assign(snapshot.collection ?? {}, override)
    expect(isSupplierSnapshotComplete(db, "dailyfood", snapshot)).toBe(false)
  })

  it("rejects a failed checkpoint and malformed snapshot", () => {
    db.prepare(
      "UPDATE sync_stage_checkpoints SET stage_status='failed' WHERE stage_name='fetch_details'",
    ).run()
    expect(isSupplierSnapshotComplete(db, "dailyfood", snapshot)).toBe(false)
    expect(isSupplierSnapshotComplete(db, "dailyfood", null)).toBe(false)
  })
})

describe("dry-run schema and incomplete snapshot safety", () => {
  it("fails clearly when the read-only database schema is outdated", () => {
    const db = new DatabaseSync(":memory:")
    db.exec("CREATE TABLE woo_variation_offer_links (id INTEGER)")
    expect(() => assertSchema(db)).toThrow("price sync schema is missing required tables")
  })

  it("holds an observed price when snapshot completeness is not attested", () => {
    const rows = classifyLinks(
      [
        {
          woo_product_id: 100,
          woo_variation_id: 101,
          canonical_variant_id: "cv",
          selected_offer_id: "offer",
          atomic_sku_id: "sku",
          supplier_id: "dailyfood",
          supplier_product_id: "sp",
          supplier_option_id: "so",
          source_product_id: "p1",
          source_option_id: "o1",
          original_title: "product",
          original_option_name: "option",
          detail_url: null,
          stored_final_cost: 10_000,
          normalized_status: "active",
          promotion_flag: 0,
          sold_out_flag: 0,
          atomic_status: "active",
          history_final_cost: 10_000,
        },
      ],
      new Map([
        [
          "dailyfood|p1|o1",
          {
            supplierId: "dailyfood",
            sourceProductId: "p1",
            sourceOptionId: "o1",
            originalProductName: "product",
            originalOptionName: "option",
            price: 12_000,
            shippingFee: 0,
            stockStatus: "in_stock",
            productUrl: "",
            sourceHash: "hash",
            observedAt: "2026-07-23T00:00:00.000Z",
          },
        ],
      ]),
      [
        {
          id: 100,
          variations: [{ id: 101, price: "15000", status: "publish" }],
        },
      ] as Parameters<typeof classifyLinks>[2],
      false,
      false,
      false,
      true,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.classification).toBe("source_unverified")
    expect(rows[0]?.reason).toContain("completeness")
  })
})

describe("Woo price write verification and rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env["WOOCOMMERCE_BASE_URL"] = "https://woo.invalid"
    process.env["WOOCOMMERCE_CONSUMER_KEY"] = "key"
    process.env["WOOCOMMERCE_CONSUMER_SECRET"] = "secret"
  })

  it("accepts a write only after matching read-back", async () => {
    vi.mocked(ky.put).mockResolvedValue({} as never)
    vi.mocked(ky.get).mockReturnValue({
      json: async () => ({ regular_price: "18000" }),
    } as never)
    await expect(applyCandidate(candidate)).resolves.toEqual({
      ok: true,
      verifiedPrice: 18_000,
    })
    expect(ky.put).toHaveBeenCalledTimes(1)
    expect(ky.get).toHaveBeenCalledTimes(1)
  })

  it("retries mismatched read-back and verifies rollback", async () => {
    vi.mocked(ky.put).mockResolvedValue({} as never)
    vi.mocked(ky.get)
      .mockReturnValueOnce({ json: async () => ({ regular_price: "17000" }) } as never)
      .mockReturnValueOnce({ json: async () => ({ regular_price: "17000" }) } as never)
      .mockReturnValueOnce({ json: async () => ({ regular_price: "15000" }) } as never)
    const result = await applyCandidate(candidate)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("rollback verified")
    expect(ky.put).toHaveBeenCalledTimes(3)
    expect(ky.get).toHaveBeenCalledTimes(3)
  })

  it("marks a rollback read-back mismatch for manual intervention", async () => {
    vi.mocked(ky.put).mockResolvedValue({} as never)
    vi.mocked(ky.get)
      .mockReturnValueOnce({ json: async () => ({ regular_price: "17000" }) } as never)
      .mockReturnValueOnce({ json: async () => ({ regular_price: "17000" }) } as never)
      .mockReturnValueOnce({ json: async () => ({ regular_price: "16000" }) } as never)
    const result = await applyCandidate(candidate)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("rollback read-back mismatch")
      expect(result.error).toContain("manual intervention required")
    }
  })

  it("reports a failed rollback read-back as rollback failure", async () => {
    vi.mocked(ky.put).mockResolvedValue({} as never)
    vi.mocked(ky.get)
      .mockReturnValueOnce({ json: async () => ({ regular_price: "17000" }) } as never)
      .mockReturnValueOnce({ json: async () => ({ regular_price: "17000" }) } as never)
      .mockReturnValueOnce({
        json: async () => {
          throw new Error("read-back timeout")
        },
      } as never)
    const result = await applyCandidate(candidate)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("rollback failed")
      expect(result.error).toContain("read-back timeout")
    }
  })

  it.each([
    "timeout",
    "HTTP 429",
    "HTTP 500",
  ])("reports %s and a rollback failure for manual intervention", async (message) => {
    vi.mocked(ky.put).mockRejectedValue(new Error(message))
    const result = await applyCandidate(candidate)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain(message)
      expect(result.error).toContain("rollback failed")
    }
    expect(ky.put).toHaveBeenCalledTimes(3)
  })

  it("does not let one failed variation prevent a later independent success", async () => {
    vi.mocked(ky.put)
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce({} as never)
    vi.mocked(ky.get)
      .mockReturnValueOnce({ json: async () => ({ regular_price: "15000" }) } as never)
      .mockReturnValueOnce({ json: async () => ({ regular_price: "19000" }) } as never)

    const first = await applyCandidate(candidate)
    const second = await applyCandidate({
      ...candidate,
      wooVariationId: 102,
      calculatedWooPrice: 19_000,
    })

    expect(first.ok).toBe(false)
    expect(second).toEqual({ ok: true, verifiedPrice: 19_000 })
  })
})

describe("destructive operation gates", () => {
  it("allows read-only previews without confirmation", () => {
    expect(parseArgs(["--reconcile-options"]).reconcileOptions).toBe(true)
    expect(parseArgs(["--trash-missing-products"]).trashMissingProducts).toBe(true)
  })

  it("requires exact confirmation tokens when executing", () => {
    expect(() => parseArgs(["--execute", "--reconcile-options"])).toThrow(
      "RECONCILE_VERIFIED_WOO_VARIATIONS",
    )
    expect(() => parseArgs(["--execute", "--trash-missing-products"])).toThrow(
      "TRASH_VERIFIED_SOURCE_ABSENT_PRODUCTS",
    )
  })
})
