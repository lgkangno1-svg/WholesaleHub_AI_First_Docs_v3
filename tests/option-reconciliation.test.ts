// biome-ignore-all lint/suspicious/noExplicitAny: ky test doubles intentionally implement only the response methods exercised by each case.
import { DatabaseSync } from "node:sqlite"
import ky from "ky"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { reconcileParentProductOptions } from "../src/reports/linked-offer-price-sync-cli.js"

vi.mock("ky", () => {
  return {
    default: {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    },
  }
})

describe("reconcileParentProductOptions", () => {
  let db: DatabaseSync

  beforeEach(() => {
    vi.clearAllMocks()
    db = new DatabaseSync(":memory:")
    db.exec(`
      CREATE TABLE IF NOT EXISTS supplier_products (
        supplier_product_id TEXT PRIMARY KEY,
        supplier_id TEXT NOT NULL,
        source_product_id TEXT NOT NULL,
        original_title TEXT
      );
      CREATE TABLE IF NOT EXISTS supplier_options (
        supplier_option_id TEXT PRIMARY KEY,
        supplier_product_id TEXT NOT NULL,
        source_option_id TEXT NOT NULL,
        original_option_name TEXT
      );
      CREATE TABLE IF NOT EXISTS atomic_supplier_skus (
        atomic_sku_id TEXT PRIMARY KEY,
        supplier_product_id TEXT NOT NULL,
        supplier_option_id TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS normalized_offers (
        normalized_offer_id TEXT PRIMARY KEY,
        atomic_sku_id TEXT NOT NULL,
        product_family TEXT,
        variety TEXT,
        product_type TEXT,
        peach_skin_type TEXT,
        cultivation_method TEXT,
        quality_grade TEXT,
        usage_grade TEXT,
        size_label TEXT,
        size_min REAL,
        size_max REAL,
        size_unit TEXT,
        weight REAL,
        weight_basis TEXT,
        option_unit TEXT,
        count_value REAL,
        origin TEXT,
        processing TEXT,
        packaging TEXT,
        package_type TEXT,
        status TEXT NOT NULL,
        final_cost INTEGER NOT NULL,
        shipping_fee INTEGER NOT NULL,
        sold_out_flag INTEGER NOT NULL,
        promotion_flag INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS canonical_variant_offers (
        canonical_variant_id TEXT NOT NULL,
        normalized_offer_id TEXT NOT NULL,
        PRIMARY KEY (canonical_variant_id, normalized_offer_id)
      );
      CREATE TABLE IF NOT EXISTS woo_variation_offer_links (
        woo_variation_id INTEGER NOT NULL PRIMARY KEY,
        woo_product_id INTEGER NOT NULL,
        canonical_variant_id TEXT NOT NULL,
        selected_offer_id TEXT NOT NULL,
        linked_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS woo_variation_replacements (
        old_variation_id INTEGER NOT NULL,
        new_variation_id INTEGER NOT NULL,
        woo_product_id INTEGER NOT NULL,
        replaced_at TEXT NOT NULL,
        PRIMARY KEY (old_variation_id, new_variation_id)
      );
      CREATE TABLE IF NOT EXISTS sync_stage_checkpoints (
        pipeline_run_id TEXT NOT NULL,
        stage_name TEXT NOT NULL,
        stage_status TEXT NOT NULL,
        artifact_path TEXT,
        result_json TEXT,
        error_message TEXT,
        started_at TEXT,
        completed_at TEXT,
        PRIMARY KEY (pipeline_run_id, stage_name)
      );
    `)
  })

  it("handles Apple Juice 30p to 50p replaced option correctly", async () => {
    // 1. Seed DB for Apple Juice (DailyFood)
    db.prepare(`
      INSERT INTO supplier_products (supplier_product_id, supplier_id, source_product_id, original_title)
      VALUES ('sp_apple', 'dailyfood', '18671', '사과즙')
    `).run()

    // Old 30p option (inactive)
    db.prepare(`
      INSERT INTO supplier_options (supplier_option_id, supplier_product_id, source_option_id, original_option_name)
      VALUES ('so_30', 'sp_apple', '30p', '사과즙 30팩')
    `).run()
    db.prepare(`
      INSERT INTO atomic_supplier_skus (atomic_sku_id, supplier_product_id, supplier_option_id, status)
      VALUES ('ask_30', 'sp_apple', 'so_30', 'active')
    `).run()
    db.prepare(`
      INSERT INTO normalized_offers (normalized_offer_id, atomic_sku_id, product_family, count_value, option_unit, status, final_cost, shipping_fee, sold_out_flag, promotion_flag)
      VALUES ('no_30', 'ask_30', '사과즙', 30.0, '팩', 'inactive', 10000, 2500, 0, 0)
    `).run()
    db.prepare(`
      INSERT INTO canonical_variant_offers (canonical_variant_id, normalized_offer_id)
      VALUES ('cv_30', 'no_30')
    `).run()

    // New 50p option (active)
    db.prepare(`
      INSERT INTO supplier_options (supplier_option_id, supplier_product_id, source_option_id, original_option_name)
      VALUES ('so_50', 'sp_apple', '50p', '사과즙 50팩')
    `).run()
    db.prepare(`
      INSERT INTO atomic_supplier_skus (atomic_sku_id, supplier_product_id, supplier_option_id, status)
      VALUES ('ask_50', 'sp_apple', 'so_50', 'active')
    `).run()
    db.prepare(`
      INSERT INTO normalized_offers (normalized_offer_id, atomic_sku_id, product_family, count_value, option_unit, status, final_cost, shipping_fee, sold_out_flag, promotion_flag)
      VALUES ('no_50', 'ask_50', '사과즙', 50.0, '팩', 'active', 15000, 2500, 0, 0)
    `).run()
    db.prepare(`
      INSERT INTO canonical_variant_offers (canonical_variant_id, normalized_offer_id)
      VALUES ('cv_50', 'no_50')
    `).run()

    // Authoritative link (Woo variation 18672 linked to 30p)
    db.prepare(`
      INSERT INTO woo_variation_offer_links (woo_variation_id, woo_product_id, canonical_variant_id, selected_offer_id, linked_at)
      VALUES (18672, 18671, 'cv_30', 'no_30', '2026-07-20T12:00:00.000Z')
    `).run()

    // Seed completed checkpoints
    const checkpoints = ["collect_products", "fetch_details", "parse_options"]
    for (const c of checkpoints) {
      db.prepare(`
        INSERT INTO sync_stage_checkpoints (pipeline_run_id, stage_name, stage_status, completed_at)
        VALUES ('daily-test-run', ?, 'completed', '2026-07-20T12:01:00.000Z')
      `).run(c)
    }

    // WooCommerce Mocks
    const mockVariations = [
      {
        id: 18672,
        status: "publish",
        price: "13500",
        attributes: [{ name: "규격", option: "사과즙 30팩" }],
      },
    ]
    const mockParentProduct = {
      id: 18671,
      attributes: [{ name: "규격", variation: true, options: ["사과즙 30팩"] }],
    }
    const mockCreatedVariation = {
      id: 18676,
      status: "publish",
    }

    vi.spyOn(ky, "get").mockImplementation((url: any) => {
      return {
        json: async () => {
          if (url.includes("/variations/18676")) return { id: 18676, regular_price: "19500" }
          if (url.includes("/variations")) return mockVariations
          return mockParentProduct
        },
      } as any
    })
    const spyPut = vi.spyOn(ky, "put").mockImplementation(() => ({ json: async () => ({}) }) as any)
    const spyPost = vi
      .spyOn(ky, "post")
      .mockImplementation(() => ({ json: async () => mockCreatedVariation }) as any)

    // 2. Run dry run (execute = false)
    const dailySnapshot = {
      createdAt: "2026-07-20T12:04:54.494Z",
      collection: {
        schemaVersion: "supplier-snapshot-v2" as const,
        pipelineRunId: "daily-test-run",
        authVerified: true as const,
        paginationComplete: true as const,
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
          price: 15000,
          shippingFee: 2500,
          stockStatus: "in_stock",
          productUrl: "",
          rawJson: '{"sourceProductId":"18671","sourceOptionId":"50p"}',
        },
      ],
    }
    const walldoSnapshot = { createdAt: "2026-07-20T12:04:54.494Z", products: [] }

    const dryStats = await reconcileParentProductOptions(
      db,
      {},
      "https://example.com",
      false,
      dailySnapshot,
      walldoSnapshot,
    )

    expect(dryStats.parentProductsCount).toBe(1)
    expect(dryStats.newVariationsCount).toBe(1)
    expect(dryStats.retiredVariationsCount).toBe(1)
    expect(dryStats.replacedCount).toBe(1)
    expect(spyPut).not.toHaveBeenCalled()
    expect(spyPost).not.toHaveBeenCalled()

    // 3. Run execution (execute = true)
    const runStats = await reconcileParentProductOptions(
      db,
      {},
      "https://example.com",
      true,
      dailySnapshot,
      walldoSnapshot,
    )

    expect(runStats.newVariationsCount).toBe(1)
    expect(runStats.retiredVariationsCount).toBe(1)
    expect(runStats.replacedCount).toBe(1)
    expect(spyPut).toHaveBeenCalledWith(
      expect.stringContaining("/variations/18672"),
      expect.objectContaining({
        json: { status: "private", stock_status: "outofstock" },
      }),
    )
    expect(spyPost).toHaveBeenCalledWith(
      expect.stringContaining("/products/18671/variations"),
      expect.objectContaining({
        json: expect.objectContaining({ regular_price: "19500" }),
      }),
    )

    // Verify DB states after execution
    const newLink = db
      .prepare(`SELECT * FROM woo_variation_offer_links WHERE woo_variation_id = 18676`)
      .get() as any
    expect(newLink).toBeDefined()
    expect(newLink.selected_offer_id).toBe("no_50")

    const replacement = db
      .prepare(`SELECT * FROM woo_variation_replacements WHERE old_variation_id = 18672`)
      .get() as any
    expect(replacement).toBeDefined()
    expect(replacement.new_variation_id).toBe(18676)
  })

  it("handles multi-supplier active backup correctly", async () => {
    // Seed DB for a product mapped to both dailyfood and walldo
    db.prepare(`
      INSERT INTO supplier_products (supplier_product_id, supplier_id, source_product_id, original_title)
      VALUES ('sp_df', 'dailyfood', '999', '테스트 상품')
    `).run()
    db.prepare(`
      INSERT INTO supplier_products (supplier_product_id, supplier_id, source_product_id, original_title)
      VALUES ('sp_wd', 'walldob2b', '999', '테스트 상품')
    `).run()

    // DailyFood option (disappeared)
    db.prepare(`
      INSERT INTO supplier_options (supplier_option_id, supplier_product_id, source_option_id, original_option_name)
      VALUES ('so_df', 'sp_df', 'opt_1', '옵션1')
    `).run()
    db.prepare(`
      INSERT INTO atomic_supplier_skus (atomic_sku_id, supplier_product_id, supplier_option_id, status)
      VALUES ('ask_df', 'sp_df', 'so_df', 'active')
    `).run()
    db.prepare(`
      INSERT INTO normalized_offers (normalized_offer_id, atomic_sku_id, product_family, count_value, status, final_cost, shipping_fee, sold_out_flag, promotion_flag)
      VALUES ('no_df', 'ask_df', '테스트', 1, 'inactive', 10000, 0, 0, 0)
    `).run()
    db.prepare(`
      INSERT INTO canonical_variant_offers (canonical_variant_id, normalized_offer_id)
      VALUES ('cv_1', 'no_df')
    `).run()

    // Walldo option (active backup)
    db.prepare(`
      INSERT INTO supplier_options (supplier_option_id, supplier_product_id, source_option_id, original_option_name)
      VALUES ('so_wd', 'sp_wd', 'opt_1', '옵션1')
    `).run()
    db.prepare(`
      INSERT INTO atomic_supplier_skus (atomic_sku_id, supplier_product_id, supplier_option_id, status)
      VALUES ('ask_wd', 'sp_wd', 'so_wd', 'active')
    `).run()
    db.prepare(`
      INSERT INTO normalized_offers (normalized_offer_id, atomic_sku_id, product_family, count_value, status, final_cost, shipping_fee, sold_out_flag, promotion_flag)
      VALUES ('no_wd', 'ask_wd', '테스트', 1, 'active', 12000, 0, 0, 0)
    `).run()
    db.prepare(`
      INSERT INTO canonical_variant_offers (canonical_variant_id, normalized_offer_id)
      VALUES ('cv_1', 'no_wd')
    `).run()

    // Woo variation linked to dailyfood offer
    db.prepare(`
      INSERT INTO woo_variation_offer_links (woo_variation_id, woo_product_id, canonical_variant_id, selected_offer_id, linked_at)
      VALUES (555, 999, 'cv_1', 'no_df', '2026-07-20T12:00:00.000Z')
    `).run()

    // Seed completed checkpoints
    const checkpoints = ["collect_products", "fetch_details", "parse_options"]
    for (const c of checkpoints) {
      db.prepare(`
        INSERT INTO sync_stage_checkpoints (pipeline_run_id, stage_name, stage_status, completed_at)
        VALUES ('daily-test-run', ?, 'completed', '2026-07-20T12:01:00.000Z')
      `).run(c)
    }

    // WooCommerce mocks: variation is publish
    vi.spyOn(ky, "get").mockImplementation(
      () =>
        ({
          json: async () => [
            {
              id: 555,
              status: "publish",
              price: "12000",
              attributes: [{ name: "규격", option: "옵션1" }],
            },
          ],
        }) as any,
    )
    const spyPut = vi.spyOn(ky, "put").mockImplementation(() => ({ json: async () => ({}) }) as any)

    // dailyfood snapshot is complete but does NOT contain option 1 anymore.
    // walldob2b snapshot is complete and DOES contain option 1.
    const dailySnapshot = {
      createdAt: "2026-07-20T12:04:54.494Z",
      collection: {
        schemaVersion: "supplier-snapshot-v2" as const,
        pipelineRunId: "daily-test-run",
        authVerified: true as const,
        paginationComplete: true as const,
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
          price: 10000,
          shippingFee: 0,
          stockStatus: "in_stock",
          productUrl: "",
          rawJson: '{"sourceProductId":"unrelated","sourceOptionId":"unrelated"}',
        },
      ],
    }
    const walldoSnapshot = {
      createdAt: "2026-07-20T12:04:54.494Z",
      collection: {
        schemaVersion: "supplier-snapshot-v2" as const,
        pipelineRunId: "daily-test-run",
        authVerified: true as const,
        paginationComplete: true as const,
        detailFetchFailureCount: 0,
        parseFailureCount: 0,
        expectedProductCount: 1,
        collectedProductCount: 1,
        minimumExpectedProductCount: 1,
        countWithinExpectedRange: true,
      },
      products: [
        {
          supplierId: "walldob2b",
          price: 12000,
          shippingFee: 0,
          stockStatus: "in_stock",
          productUrl: "",
          rawJson: '{"sourceProductId":"999","sourceOptionId":"opt_1"}',
        },
      ],
    }

    const runStats = await reconcileParentProductOptions(
      db,
      {},
      "https://example.com",
      true,
      dailySnapshot,
      walldoSnapshot,
    )

    // Expected: variation 555 should NOT be retired, because Walldo has it active.
    // Instead, it should be retained through backup.
    expect(runStats.retiredVariationsCount).toBe(0)
    expect(runStats.retainedThroughBackup).toBe(1)
    expect(spyPut).not.toHaveBeenCalled()

    // Authoritative link should be updated to Walldo offer
    const link = db
      .prepare(`SELECT * FROM woo_variation_offer_links WHERE woo_variation_id = 555`)
      .get() as any
    expect(link.selected_offer_id).toBe("no_wd")
  })
})
