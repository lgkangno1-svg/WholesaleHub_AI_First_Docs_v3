import { beforeAll, describe, expect, it } from "vitest"
import { DailyFoodAtomicAdapter } from "../src/atomic-sku/adapters/dailyfood-adapter.js"
import { Walldob2bAtomicAdapter } from "../src/atomic-sku/adapters/walldob2b-adapter.js"
import { collectAtomicSkus } from "../src/atomic-sku/collect.js"
import type { AtomicSupplierSku } from "../src/atomic-sku/types.js"

const live = process.env["RUN_ATOMIC_SKU_LIVE_TESTS"] === "1" ? describe : describe.skip

live("atomic SKU supplier detail live validation", () => {
  let skus: readonly AtomicSupplierSku[] = []

  beforeAll(async () => {
    skus = await collectAtomicSkus({
      adapters: [
        new DailyFoodAtomicAdapter({
          username: process.env["DAILYFOOD_USERNAME"] ?? process.env["WALLDOB2B_USERNAME"] ?? "",
          password: process.env["DAILYFOOD_PASSWORD"] ?? process.env["WALLDOB2B_PASSWORD"] ?? "",
          browserEndpoint: process.env["ADMINPLUS_BROWSER_ENDPOINT"] ?? "http://localhost:3000",
        }),
        new Walldob2bAtomicAdapter({
          username: process.env["WALLDOB2B_USERNAME"] ?? "",
          password: process.env["WALLDOB2B_PASSWORD"] ?? "",
        }),
      ],
      includeProduct: (reference) =>
        /레드\s*루비.*자몽|흑찰.*옥수수|미백\s*찰?.*옥수수|성주.*참외|부사.*사과/u.test(
          reference.originalTitle,
        ),
    })
  }, 180_000)

  it("returns detail-verified, source-identified atomic options", () => {
    expect(skus.length).toBeGreaterThan(0)
    expect(new Set(skus.map((sku) => sku.supplierId)).size).toBeGreaterThanOrEqual(2)
    expect(
      skus.every(
        (sku) =>
          sku.sourceProductId.length > 0 &&
          sku.sourceOptionId.length > 0 &&
          sku.detailVerifiedAt.length > 0,
      ),
    ).toBe(true)
  })

  it("keeps live failures outside fixture regression tests", () => {
    expect(process.env["RUN_ATOMIC_SKU_LIVE_TESTS"]).toBe("1")
  })
})
