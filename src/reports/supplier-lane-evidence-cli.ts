import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { planLegacyLaneMigration } from "../supplier-lane/migration-planner.js"
import { buildSupplierSnapshotV2 } from "./supplier-snapshot-v2.js"

const output = resolve("artifacts/supplier-lane-checkout")
const pipelineRunId = "supplier-lane-synthetic-v2"
const codeHead = process.argv[2] ?? "unknown"

async function main(): Promise<void> {
  await mkdir(output, { recursive: true })
  const databasePath = resolve(output, "supplier-lane-db-copy.sqlite")
  const migration = await readFile("migrations/007_supplier_lane_checkout.sql", "utf8")
  const database = new DatabaseSync(databasePath)
  database.exec(migration)
  database.exec(migration)
  seed(database)
  const integrity = database.prepare("PRAGMA integrity_check").get() as { integrity_check: string }
  database.close()

  const dailyPath = resolve(output, "synthetic-dailyfood-v2.json")
  const walldoPath = resolve(output, "synthetic-walldob2b-v2.json")
  await writeFile(dailyPath, `${JSON.stringify(snapshot("dailyfood"), null, 2)}\n`, "utf8")
  await writeFile(walldoPath, `${JSON.stringify(snapshot("walldob2b"), null, 2)}\n`, "utf8")

  for (const run of [1, 2]) {
    const resultPath = resolve(output, `db-copy-dry-run-${run}.json`)
    const planPath = resolve(output, `synthetic-plan-${run}.json`)
    execFileSync(
      process.execPath,
      [
        "dist/reports/supplier-lane-sync-cli.js",
        "--mode",
        "no-write",
        "--run-id",
        `supplier-lane-dry-run-${run}`,
        "--pipeline-run-id",
        pipelineRunId,
        "--db-path",
        databasePath,
        "--daily-snapshot",
        dailyPath,
        "--walldo-snapshot",
        walldoPath,
        "--source-git-commit",
        codeHead,
        "--dist-git-commit",
        codeHead,
        "--plan-file",
        planPath,
        "--result-file",
        resultPath,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    )
  }

  const migrationPlan = planLegacyLaneMigration(
    [
      legacy("dailyfood", 501, 1501),
      legacy("walldob2b", 501, 2501),
      { ...legacy("dailyfood", 502, 1502), duplicateVariation: true },
      { ...legacy("walldob2b", null, 2502), orphan: true },
      { ...legacy("dailyfood", 503, 1503), parentStatus: "trash" },
      legacy("cheonbando", 504, 3501),
    ],
    (() => {
      let index = 0
      return () => `opaque-evidence-key-${++index}`
    })(),
  )
  await writeFile(
    resolve(output, "migration-plan.json"),
    `${JSON.stringify({ ...migrationPlan, dbIntegrity: integrity.integrity_check }, null, 2)}\n`,
    "utf8",
  )

  const fixture = `<!doctype html>
<html lang="ko"><body><main class="wh-supplier-lanes">
<article class="product-card"><p class="price">18,900원 ~ 24,000원</p>
<span class="wh-lane-archive-counts">A사 1개 옵션 · B사 1개 옵션</span></article>
<p>주문 후 1~2일 이내 출고 예정</p>
<section class="wh-lane-card"><h2>A사</h2><label for="a">옵션을 선택하세요</label>
<select id="a"><option value="opaque-a">특품 20개 — 20,500원</option></select>
<input type="number" min="1" value="1"><button>장바구니 담기</button></section>
<section class="wh-lane-card"><h2>B사</h2><label for="b">옵션을 선택하세요</label>
<select id="b"><option value="opaque-b">중품 20개 — 18,900원</option></select>
<input type="number" min="1" value="1"><button>장바구니 담기</button></section>
<p>선택한 옵션에 따라 상품이 나누어 배송될 수 있습니다.</p>
</main></body></html>
`
  await writeFile(resolve(output, "ui-screenshot-or-html-fixture.html"), fixture, "utf8")
  const forbidden = [
    "dailyfood",
    "walldob2b",
    "source_product_id",
    "source_option_id",
    "supplier.example",
  ]
  const violations = forbidden.filter((token) => fixture.toLowerCase().includes(token))
  await writeFile(
    resolve(output, "privacy-audit.json"),
    `${JSON.stringify(
      {
        auditedSurface:
          "public HTML fixture, archive summary, Store API extension contract, order/email filters",
        forbiddenTokens: forbidden,
        customerExposureViolations: violations.length,
        violations,
        adminInternalDataVerifiedBy: "supplier-lane-plugin-test.php",
        physicalPackagingControls: "operations_blocker_pending_confirmation",
      },
      null,
      2,
    )}\n`,
    "utf8",
  )

  const first = JSON.parse(await readFile(resolve(output, "db-copy-dry-run-1.json"), "utf8"))
  const second = JSON.parse(await readFile(resolve(output, "db-copy-dry-run-2.json"), "utf8"))
  await writeFile(
    resolve(output, "final-result.json"),
    `${JSON.stringify(
      {
        status: "BLOCKED_BY_DATA_MIGRATION",
        codeHead,
        evidenceKind: "synthetic_fixture_only",
        productionDatabaseCopyAvailable: false,
        blockingReason: "required production DB-copy migration dry-run was unavailable",
        dbIntegrity: integrity.integrity_check,
        dryRun1: first.counts,
        dryRun2: second.counts,
        secondRunNewIntents: second.counts.newIntents,
        productionMutations: 0,
        phpLint: "skipped_php_not_available",
        wooCompatibility: "not_claimed; mock read-back and static plugin contracts only",
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
}

function seed(database: DatabaseSync): void {
  const now = "2026-07-25T00:00:00.000Z"
  const insertLink = database.prepare(
    `INSERT OR IGNORE INTO supplier_lane_parent_links(
      woo_parent_id, supplier_id, lane_code, source_product_id, status,
      approved_by, approved_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'approved', 'evidence', ?, ?, ?)`,
  )
  const insertOffer = database.prepare(
    `INSERT OR IGNORE INTO supplier_lane_offers(
      parent_link_id, supplier_id, lane_code, source_product_id, source_option_id,
      atomic_supplier_sku_id, woo_parent_id, woo_variation_id, public_offer_key,
      public_option_label, option_label_raw, hard_spec_fingerprint, source_cost,
      source_shipping_cost, landed_cost, sale_price, stock_status, approval_status,
      lifecycle_status, last_snapshot_hash, last_complete_run_id, last_seen_at,
      missing_complete_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 501, ?, ?, ?, ?, 'spec-1', 900, 0, 900, ?, 'outofstock',
      'approved', 'active', ?, ?, ?, 0, ?, ?)`,
  )
  for (const [supplier, lane, variation, price] of [
    ["dailyfood", "A", 1501, 20500],
    ["walldob2b", "B", 2501, 18900],
  ] as const) {
    insertLink.run(501, supplier, lane, "product-1", now, now, now)
    const link = database
      .prepare(
        "SELECT id FROM supplier_lane_parent_links WHERE woo_parent_id = 501 AND lane_code = ?",
      )
      .get(lane) as { id: number }
    insertOffer.run(
      link.id,
      supplier,
      lane,
      "product-1",
      "option-1",
      `atomic-${lane}`,
      variation,
      `opaque-${lane}`,
      lane === "A" ? "특품 20개" : "중품 20개",
      lane === "A" ? "특품 20개" : "중품 20개",
      price,
      "a".repeat(64),
      pipelineRunId,
      now,
      now,
      now,
    )
  }
}

function snapshot(supplier: "dailyfood" | "walldob2b") {
  return buildSupplierSnapshotV2({
    supplier,
    pipelineRunId,
    startedAt: "2026-07-25T00:00:00.000Z",
    completedAt: "2026-07-25T00:01:00.000Z",
    crawlStatus: "complete",
    authenticationStatus: "authenticated",
    paginationComplete: true,
    expectedProductCount: 1,
    expectedOptionCount: 1,
    detailRequestCount: 1,
    detailSuccessCount: 1,
    duplicateSourceIdCount: 0,
    parseErrorCount: 0,
    products: [
      {
        supplierId: supplier,
        originalProductName: "public product",
        originalOptionName: supplier === "dailyfood" ? "특품 20개" : "중품 20개",
        price: 1000,
        shippingFee: 0,
        stockStatus: "instock",
        productUrl: "",
        rawJson: JSON.stringify({
          sourceProductId: "product-1",
          sourceOptionId: "option-1",
          hardSpecFingerprint: "spec-1",
        }),
      },
    ],
  })
}

function legacy(supplierId: string, wooParentId: number | null, wooVariationId: number | null) {
  return {
    supplierId,
    sourceProductId: `${supplierId}-product`,
    sourceOptionId: `${supplierId}-option`,
    atomicSupplierSkuId: `${supplierId}-atomic`,
    wooParentId,
    wooVariationId,
    optionLabel: "특품 20개",
    parentStatus: "publish",
    duplicateVariation: false,
    orphan: false,
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
