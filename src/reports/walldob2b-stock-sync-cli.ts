import { mkdir, readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import ky from "ky"
import { z } from "zod"
import {
  fetchWalldob2bDetailHtml,
  parseWalldob2bProductAvailability
} from "../adapters/walldob2b/walldob2b-adapter.js"
import { fetchMvpWooCatalog } from "./mvp-sync-plan.js"

const CONFIRM = "MARK_CONFIRMED_WALLDO_OUTOFSTOCK"
const SUPPLIER_ID = "walldob2b"

type Credentials = {
  readonly baseUrl: string
  readonly consumerKey: string
  readonly consumerSecret: string
}

export type Walldob2bStockTarget = {
  readonly productId: number
  readonly variationId: number
  readonly productName: string
  readonly optionName: string
  readonly sourceProductId: string
  readonly currentStockStatus: string
}

export type Walldob2bStockSyncRow = Walldob2bStockTarget & {
  readonly evidence: readonly string[]
  readonly action: "mark_outofstock" | "already_outofstock" | "available"
}

export function buildWalldob2bStockSyncRows(
  targets: readonly Walldob2bStockTarget[],
  availabilityByProduct: ReadonlyMap<string, parseparseWalldob2bProductAvailability>,
): readonly Walldob2bStockSyncRow[] {
  return targets.map((target) => {
    const availability = availabilityByProduct.get(target.sourceProductId) ?? {
      soldOut: false,
      evidence: [],
    }
    const action = availability.soldOut
      ? target.currentStockStatus === "outofstock"
        ? "already_outofstock"
        : "mark_outofstock"
      : "available"
    return { ...target, evidence: availability.evidence, action }
  })
}

async function main(): Promise<void> {
  await loadDotEnv()
  const options = parseArgs(process.argv.slice(2))
  if (options.execute && options.confirm !== CONFIRM) {
    throw new Error(`--execute --confirm "${CONFIRM}" is required`)
  }
  const credentials = wooCredentials()
  const catalog = await fetchMvpWooCatalog(credentials)
  const targets = collectWalldob2bStockTargets(catalog)
  const sourceProductIds = [...new Set(targets.map((target) => target.sourceProductId))]
  const availabilityByProduct = await fetchAvailability(sourceProductIds)
  const rows = buildWalldob2bStockSyncRows(targets, availabilityByProduct)
  const selected = rows.filter((row) => row.action === "mark_outofstock")
  const executed = options.execute
    ? await markOutOfStock(selected, credentials)
    : { success: 0, failed: 0 }
  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.execute ? "execute" : "dry_run",
    supplierId: SUPPLIER_ID,
    sourceProductCount: sourceProductIds.length,
    targetVariationCount: targets.length,
    explicitUnavailableProductCount: [...availabilityByProduct.values()].filter(
      (availability) => availability.soldOut,
    ).length,
    markOutofstockCount: selected.length,
    alreadyOutofstockCount: rows.filter((row) => row.action === "already_outofstock").length,
    availableCount: rows.filter((row) => row.action === "available").length,
    executionSuccessCount: executed.success,
    executionFailedCount: executed.failed,
    rows,
  }
  await mkdir("reports", { recursive: true })
  await writeFile(
    "reports/walldob2b-stock-sync.json",
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  )
  console.log(
    JSON.stringify({
      mode: report.mode,
      sourceProductCount: report.sourceProductCount,
      targetVariationCount: report.targetVariationCount,
      explicitUnavailableProductCount: report.explicitUnavailableProductCount,
      markOutofstockCount: report.markOutofstockCount,
      alreadyOutofstockCount: report.alreadyOutofstockCount,
      executionSuccessCount: report.executionSuccessCount,
      executionFailedCount: report.executionFailedCount,
    }),
  )
  if (executed.failed > 0) process.exitCode = 1
}

function collectWalldob2bStockTargets(
  catalog: Awaited<ReturnType<typeof fetchMvpWooCatalog>>,
): readonly Walldob2bStockTarget[] {
  const targets: Walldob2bStockTarget[] = []
  for (const product of catalog) {
    if (product.status !== "publish") continue
    const productMeta = new Map(product.meta_data.map((item) => [item.key, item.value]))
    const productSupplierId = stringValue(productMeta.get("_b2b_source"))
    const productSourceProductId =
      stringValue(productMeta.get("_wholesalehub_source_product_id")) ||
      stringValue(productMeta.get("_source_product_id")) ||
      stringValue(productMeta.get("_b2b_walldo_it_id"))
    for (const variation of product.variations) {
      const meta = new Map(variation.meta_data.map((item) => [item.key, item.value]))
      const supplierId =
        stringValue(meta.get("_supplier_id")) ||
        stringValue(meta.get("_wholesalehub_selected_supplier_id")) ||
        stringValue(meta.get("_wholesalehub_supplier_id")) ||
        productSupplierId
      const sourceProductId =
        stringValue(meta.get("_source_product_id")) ||
        stringValue(meta.get("_wholesalehub_source_product_id")) ||
        productSourceProductId
      if (supplierId !== SUPPLIER_ID || sourceProductId.length === 0) continue
      targets.push({
        productId: product.id,
        variationId: variation.id,
        productName: product.name,
        optionName:
          variation.attributes
            .map((attribute) => attribute.option ?? "")
            .filter(Boolean)
            .join(" / ") || "기본",
        sourceProductId,
        currentStockStatus: variation.stock_status ?? "",
      })
    }
  }
  return targets
}

async function fetchAvailability(
  sourceProductIds: readonly string[],
): Promise<ReadonlyMap<string, parseparseWalldob2bProductAvailability>> {
  const login = {
    username: requiredEnv("WALLDOB2B_USERNAME"),
    password: requiredEnv("WALLDOB2B_PASSWORD"),
  }
  const result = new Map<string, parseparseWalldob2bProductAvailability>()
  const queue = [...sourceProductIds]
  const workers = Array.from({ length: Math.min(5, queue.length) }, async () => {
    for (;;) {
      const sourceProductId = queue.shift()
      if (sourceProductId === undefined) return
      const html = await fetchWalldob2bDetailHtml(sourceProductId, login)
      result.set(sourceProductId, parseparseparseWalldob2bProductAvailability(html))
    }
  })
  await Promise.all(workers)
  return result
}

async function markOutOfStock(
  rows: readonly Walldob2bStockSyncRow[],
  credentials: Credentials,
): Promise<{ readonly success: number; readonly failed: number }> {
  const baseUrl = credentials.baseUrl.replace(/\/$/u, "")
  const headers = {
    Authorization: `Basic ${Buffer.from(
      `${credentials.consumerKey}:${credentials.consumerSecret}`,
    ).toString("base64")}`,
  }
  let success = 0
  let failed = 0
  for (const row of rows) {
    try {
      const updated = z
        .object({ id: z.number().int(), stock_status: z.string() })
        .parse(
          await ky
            .put(
              `${baseUrl}/wp-json/wc/v3/products/${row.productId}/variations/${row.variationId}`,
              {
                headers,
                json: { stock_status: "outofstock" },
                timeout: 60_000,
                retry: { limit: 0 },
              },
            )
            .json(),
        )
      if (updated.id === row.variationId && updated.stock_status === "outofstock") success++
      else failed++
    } catch {
      failed++
    }
  }
  return { success, failed }
}

function parseArgs(args: readonly string[]): {
  readonly execute: boolean
  readonly confirm: string
} {
  const execute = args.includes("--execute")
  const confirmIndex = args.indexOf("--confirm")
  return {
    execute,
    confirm: confirmIndex < 0 ? "" : (args[confirmIndex + 1] ?? ""),
  }
}

function wooCredentials(): Credentials {
  return {
    baseUrl: requiredEnv("WOOCOMMERCE_BASE_URL"),
    consumerKey: requiredEnv("WOOCOMMERCE_CONSUMER_KEY"),
    consumerSecret: requiredEnv("WOOCOMMERCE_CONSUMER_SECRET"),
  }
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`${key} is required`)
  return value
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
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

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
