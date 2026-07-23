import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import {
  crawlDailyFoodDirectSite,
  type DailyFoodDirectSiteResult,
} from "../adapters/dailyfood/dailyfood-direct-site.js"

const STAGES = ["collect_products", "fetch_details", "parse_options"] as const

async function main(): Promise<void> {
  await loadDotEnv()
  const databasePath = resolve(argument("--db") ?? "data/wholesalehub.sqlite")
  const outputPath = resolve(
    argument("--output") ?? "reports/daily-pipeline/latest/daily-collect.json",
  )
  const runId = argument("--run-id") ?? `daily-${Date.now()}`
  const startedAt = new Date().toISOString()
  await mkdir(dirname(outputPath), { recursive: true })

  const result = await collectOrResume(outputPath)
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8")

  const database = new DatabaseSync(databasePath)
  try {
    database.exec("PRAGMA foreign_keys = ON")
    database.exec("PRAGMA busy_timeout = 5000")
    database.exec("BEGIN IMMEDIATE")
    try {
      persistCollection(database, runId, startedAt, outputPath, result)
      database.exec("COMMIT")
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    }
  } finally {
    database.close()
  }

  console.log(
    JSON.stringify({
      runId,
      expectedProductCount: result.expectedProductCount,
      collectedProductCount: result.collectedProductCount,
      atomicOptionCount: result.products.reduce(
        (sum, product) => sum + product.options.length,
        0,
      ),
      incomplete: result.incomplete,
      missingOptionsCount: result.products.filter(
        (product) => (product as any).collectionStatus === "missing_options",
      ).length,
      sourceMismatchCount: result.products.filter(
        (product) => (product as any).collectionStatus === "source_mismatch",
      ).length,
      outputPath,
    }),
  )
}

async function collectOrResume(outputPath: string): Promise<DailyFoodDirectSiteResult> {
  if (process.argv.includes("--resume")) {
    try {
      return JSON.parse(await readFile(outputPath, "utf8")) as DailyFoodDirectSiteResult
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    }
  }
  return crawlDailyFoodDirectSite({
    username:
      process.env["DAILYFOOD_USERNAME"] ?? process.env["WALLDOB2B_USERNAME"] ?? "",
    password:
      process.env["DAILYFOOD_PASSWORD"] ?? process.env["WALLDOB2B_PASSWORD"] ?? "",
    browserEndpoint: process.env["ADMINPLUS_BROWSER_ENDPOINT"] ?? "http://localhost:3000",
  })
}

function persistCollection(
  database: DatabaseSync,
  runId: string,
  startedAt: string,
  outputPath: string,
  result: DailyFoodDirectSiteResult,
): void {
  const completedAt = new Date().toISOString()
  const atomicOptionCount = result.products.reduce(
    (sum, product) => sum + product.options.length,
    0,
  )
  database
    .prepare(
      `INSERT INTO supplier_collection_runs (
        collection_run_id, supplier_id, expected_product_count, collected_product_count,
        atomic_option_count, incomplete, attempts, started_at, completed_at, summary_json
      ) VALUES (?, 'dailyfood', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      runId,
      result.expectedProductCount,
      result.collectedProductCount,
      atomicOptionCount,
      Number(result.incomplete),
      result.attempts,
      startedAt,
      completedAt,
      JSON.stringify({
        errorCount: result.errors.length,
        missingOptionsCount: result.products.filter(
          (product) => (product as any).collectionStatus === "missing_options",
        ).length,
        sourceMismatchCount: result.products.filter(
          (product) => (product as any).collectionStatus === "source_mismatch",
        ).length,
      }),
    )
  const upsert = database.prepare(
    `INSERT INTO supplier_collection_products (
      supplier_id, source_product_id, original_title, detail_title, collection_status,
      option_count, detail_url, raw_json, last_seen_collection_run_id, updated_at
    ) VALUES ('dailyfood', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(supplier_id, source_product_id) DO UPDATE SET
      original_title=excluded.original_title,
      detail_title=excluded.detail_title,
      collection_status=excluded.collection_status,
      option_count=excluded.option_count,
      detail_url=excluded.detail_url,
      raw_json=excluded.raw_json,
      last_seen_collection_run_id=excluded.last_seen_collection_run_id,
      updated_at=excluded.updated_at`,
  )
  for (const product of result.products) {
    upsert.run(
      product.sourceProductId,
      product.productName,
      (product as any).detailProductName,
      (product as any).collectionStatus,
      product.options.length,
      `https://dailyfood.adminplus.co.kr/partner/?mod=product&actpage=prt.grp.detail.pop&pcode=${encodeURIComponent(product.sourceProductId)}`,
      JSON.stringify(product.raw),
      runId,
      completedAt,
    )
  }
  for (const stage of STAGES) {
    database
      .prepare(
        `INSERT INTO sync_stage_checkpoints (
          pipeline_run_id, stage_name, stage_status, artifact_path, result_json,
          error_message, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(pipeline_run_id, stage_name) DO UPDATE SET
          stage_status=excluded.stage_status,
          artifact_path=excluded.artifact_path,
          result_json=excluded.result_json,
          error_message=NULL,
          completed_at=excluded.completed_at`,
      )
      .run(
        runId,
        stage,
        result.incomplete && stage === "collect_products" ? "incomplete" : "completed",
        outputPath,
        JSON.stringify({
          expectedProductCount: result.expectedProductCount,
          collectedProductCount: result.collectedProductCount,
          atomicOptionCount,
        }),
        startedAt,
        completedAt,
      )
  }
}

function argument(key: string): string | null {
  const index = process.argv.indexOf(key)
  return index < 0 ? null : (process.argv[index + 1] ?? null)
}

async function loadDotEnv(): Promise<void> {
  try {
    const env = await readFile(".env", "utf8")
    for (const line of env.split(/\r?\n/u)) {
      const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line)
      if (match?.[1] !== undefined && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2] ?? ""
      }
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

