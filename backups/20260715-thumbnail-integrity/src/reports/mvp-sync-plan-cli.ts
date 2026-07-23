import { mkdir, readFile, writeFile } from "node:fs/promises"
import { collectDailyFoodDirectSiteProducts } from "../adapters/dailyfood/dailyfood-direct-site.js"
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
  const failures: string[] = []
  const missing = missingMvpCredentialKeys(process.env)
  if (missing.length > 0) failures.push(`missing credentials: ${missing.join(", ")}`)

  const dailyFoodProducts = await collectDailyFood(failures)
  const walldob2bProducts = missing.length > 0 ? [] : await collectWalldob2b(failures)
  const wooProducts = missing.length > 0 ? [] : await collectWoo(failures)

  if (dailyFoodProducts.length < 350 || dailyFoodProducts.length > 700) {
    failures.push(`dailyfood option count out of expected range: ${dailyFoodProducts.length}`)
  }
  if (walldob2bProducts.length < 180 || walldob2bProducts.length > 240) {
    failures.push(`walldob2b option count out of expected range: ${walldob2bProducts.length}`)
  }
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
}

async function collectDailyFood(failures: string[]): Promise<readonly CollectedProduct[]> {
  const snapshotPath = "reports/snapshots/dailyfood-latest-success.json"
  try {
    const products = filterDailyFoodVisibleSiteProducts(
      await collectDailyFoodDirectSiteProducts({
        username: process.env["DAILYFOOD_USERNAME"] ?? process.env["WALLDOB2B_USERNAME"] ?? "",
        password: process.env["DAILYFOOD_PASSWORD"] ?? process.env["WALLDOB2B_PASSWORD"] ?? "",
        browserEndpoint: process.env["ADMINPLUS_BROWSER_ENDPOINT"] ?? "http://localhost:3000",
      }),
    )
    await mkdir("reports/snapshots", { recursive: true })
    await writeFile(
      snapshotPath,
      `${JSON.stringify({ createdAt: new Date().toISOString(), products }, null, 2)}\n`,
      "utf8",
    )
    return products
  } catch (error) {
    failures.push(`dailyfood direct-site collection failed: ${message(error)}`)
    return []
  }
}

async function collectWalldob2b(failures: string[]): Promise<readonly CollectedProduct[]> {
  try {
    const html = await fetchWalldob2bProductExcel({
      username: process.env["WALLDOB2B_USERNAME"] ?? "",
      password: process.env["WALLDOB2B_PASSWORD"] ?? "",
    })
    return filterDailyFoodVisibleSiteProducts(parseWalldob2bProductExcelHtml(html, 10_000).products)
  } catch (error) {
    failures.push(`walldob2b collection failed: ${message(error)}`)
    return []
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
