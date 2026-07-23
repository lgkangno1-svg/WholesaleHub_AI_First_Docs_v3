import { mkdir, readFile, writeFile } from "node:fs/promises"
import { collectDailyFoodDirectSiteSnapshot } from "../adapters/dailyfood/dailyfood-direct-site.js"
import {
  fetchWalldob2bProductExcel,
  parseWalldob2bProductExcelHtml,
} from "../adapters/walldob2b/walldob2b-excel-download.js"
import type { CollectedProduct } from "../domain/product.js"
import { filterDailyFoodVisibleSiteProducts } from "./dailyfood-visible-site-filter.js"
import {
  buildMvpSyncPlanReport,
  fetchMvpWooCatalog,
  missingMvpCredentialKeys,
  writeMvpSyncPlanReport,
} from "./mvp-sync-plan.js"

async function main(): Promise<void> {
  await loadDotEnv()
  const pipelineRunId = process.env["WHOLESALEHUB_RUN_ID"] ?? `plan-${Date.now()}`
  const failures: string[] = []
  const missing = missingMvpCredentialKeys(process.env)
  if (missing.length > 0) failures.push(`missing credentials: ${missing.join(", ")}`)

  const dailyFood = await collectDailyFood(failures)
  const walldob2b =
    missing.length > 0 ? failedCollection("walldob2b") : await collectWalldob2b(failures)
  const dailyFoodProducts = dailyFood.products
  const walldob2bProducts = walldob2b.products
  const wooProducts = missing.length > 0 ? [] : await collectWoo(failures)

  if (dailyFoodProducts.length < 400 || dailyFoodProducts.length > 1500) {
    failures.push(`dailyfood option count out of expected range: ${dailyFoodProducts.length}`)
  }
  if (walldob2bProducts.length < 180 || walldob2bProducts.length > 500) {
    failures.push(`walldob2b option count out of expected range: ${walldob2bProducts.length}`)
  }
  await Promise.all([
    writeSupplierSnapshot("dailyfood", pipelineRunId, dailyFood, 400),
    writeSupplierSnapshot("walldob2b", pipelineRunId, walldob2b, 180),
  ])
  if (
    wooProducts.length === 0 ||
    wooProducts.reduce((sum, product) => sum + product.variations.length, 0) === 0
  ) {
    failures.push("woocommerce catalog lookup failed or returned no variations")
  }

  const report = buildMvpSyncPlanReport({
    dailyFoodProducts,
    walldob2bProducts,
    wooProducts,
    failureReasons: failures,
  })
  await writeMvpSyncPlanReport(report)
  console.log(JSON.stringify(report.summary, null, 2))
  if (failures.length > 0) process.exitCode = 2
}

type SupplierCollection = {
  readonly products: readonly CollectedProduct[]
  readonly authVerified: boolean
  readonly paginationComplete: boolean
  readonly detailFetchFailureCount: number
  readonly parseFailureCount: number
}

async function collectDailyFood(failures: string[]): Promise<SupplierCollection> {
  try {
    const snapshot = await collectDailyFoodDirectSiteSnapshot({
      username: process.env["DAILYFOOD_USERNAME"] ?? process.env["WALLDOB2B_USERNAME"] ?? "",
      password: process.env["DAILYFOOD_PASSWORD"] ?? process.env["WALLDOB2B_PASSWORD"] ?? "",
      browserEndpoint: process.env["ADMINPLUS_BROWSER_ENDPOINT"] ?? "http://localhost:3000",
    })
    if (!snapshot.result.paginationComplete) {
      failures.push("dailyfood pagination did not reach a terminal empty page")
    }
    if (snapshot.result.errors.length > 0) {
      failures.push(`dailyfood detail fetch failures: ${snapshot.result.errors.length}`)
    }
    return {
      products: filterDailyFoodVisibleSiteProducts(snapshot.products),
      authVerified: true,
      paginationComplete: snapshot.result.paginationComplete,
      detailFetchFailureCount: snapshot.result.errors.length,
      parseFailureCount: 0,
    }
  } catch (error) {
    failures.push(`dailyfood direct-site collection failed: ${message(error)}`)
    return failedCollection("dailyfood")
  }
}

async function collectWalldob2b(failures: string[]): Promise<SupplierCollection> {
  try {
    const html = await fetchWalldob2bProductExcel({
      username: process.env["WALLDOB2B_USERNAME"] ?? "",
      password: process.env["WALLDOB2B_PASSWORD"] ?? "",
    })
    const parsed = parseWalldob2bProductExcelHtml(html, 10_000)
    const parseFailures = parsed.skippedRows.filter((row) => row.reason !== "empty_row").length
    if (parseFailures > 0) {
      failures.push(`walldob2b parse failures: ${parseFailures}`)
    }
    return {
      products: filterDailyFoodVisibleSiteProducts(parsed.products),
      authVerified: true,
      paginationComplete: parsed.totalRows < 10_000,
      detailFetchFailureCount: 0,
      parseFailureCount: parseFailures,
    }
  } catch (error) {
    failures.push(`walldob2b collection failed: ${message(error)}`)
    return failedCollection("walldob2b")
  }
}

function failedCollection(_supplierId: string): SupplierCollection {
  return {
    products: [],
    authVerified: false,
    paginationComplete: false,
    detailFetchFailureCount: 0,
    parseFailureCount: 0,
  }
}

async function writeSupplierSnapshot(
  supplierId: "dailyfood" | "walldob2b",
  pipelineRunId: string,
  collected: SupplierCollection,
  staticMinimum: number,
): Promise<void> {
  const directory = "reports/snapshots"
  const latestSuccessPath = `${directory}/${supplierId}-latest-success.json`
  const previousCount = await readPreviousSuccessfulCount(latestSuccessPath)
  const minimumExpectedProductCount = Math.max(
    staticMinimum,
    previousCount === null ? staticMinimum : Math.floor(previousCount * 0.8),
  )
  const countWithinExpectedRange =
    collected.products.length >= minimumExpectedProductCount &&
    (supplierId === "dailyfood"
      ? collected.products.length <= 1500
      : collected.products.length <= 500)
  const document = {
    createdAt: new Date().toISOString(),
    collection: {
      schemaVersion: "supplier-snapshot-v2",
      pipelineRunId,
      authVerified: collected.authVerified,
      paginationComplete: collected.paginationComplete,
      detailFetchFailureCount: collected.detailFetchFailureCount,
      parseFailureCount: collected.parseFailureCount,
      expectedProductCount: collected.products.length,
      collectedProductCount: collected.products.length,
      minimumExpectedProductCount,
      countWithinExpectedRange,
    },
    products: collected.products,
  }
  const complete =
    collected.authVerified &&
    collected.paginationComplete &&
    collected.detailFetchFailureCount === 0 &&
    collected.parseFailureCount === 0 &&
    countWithinExpectedRange
  await mkdir(directory, { recursive: true })
  await writeFile(
    `${directory}/${supplierId}-latest-attempt.json`,
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  )
  if (complete) {
    await writeFile(latestSuccessPath, `${JSON.stringify(document, null, 2)}\n`, "utf8")
  }
}

async function readPreviousSuccessfulCount(path: string): Promise<number | null> {
  try {
    const previous = JSON.parse(await readFile(path, "utf8")) as {
      collection?: { collectedProductCount?: unknown }
      products?: unknown[]
    }
    const count = previous.collection?.collectedProductCount
    if (typeof count === "number" && Number.isInteger(count) && count > 0) return count
    return Array.isArray(previous.products) && previous.products.length > 0
      ? previous.products.length
      : null
  } catch {
    return null
  }
}

async function collectWoo(failures: string[]) {
  try {
    return await fetchMvpWooCatalog({
      baseUrl: process.env["WOOCOMMERCE_BASE_URL"] ?? "",
      consumerKey: process.env["WOOCOMMERCE_CONSUMER_KEY"] ?? "",
      consumerSecret: process.env["WOOCOMMERCE_CONSUMER_SECRET"] ?? "",
    })
  } catch (error) {
    failures.push(`woocommerce collection failed: ${message(error)}`)
    return []
  }
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

main().catch((error: unknown) => {
  console.error(message(error))
  process.exitCode = 1
})
