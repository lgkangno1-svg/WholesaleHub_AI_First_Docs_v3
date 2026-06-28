import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import ky from "ky"
import { z } from "zod"
import type { WooProductSyncPlanRow } from "./woocommerce-product-sync-plan.js"

const VariationSchema = z.object({ id: z.number().int(), price: z.string().nullable().optional() })

export type WooProductSyncExecuteOptions = {
  readonly baseUrl: string
  readonly consumerKey: string
  readonly consumerSecret: string
  readonly limit: number
  readonly outputPath: string
}

export type WooProductSyncExecuteEntry = {
  readonly product_id: number
  readonly variation_id: number
  readonly option_display_name: string
  readonly before_price: number | null
  readonly after_price: number | null
  readonly expected_price: number
  readonly status: "updated" | "no_op" | "failed"
  readonly error_message: string | null
}

export type WooProductSyncExecuteLog = {
  readonly mode: "execute"
  readonly requestedAt: string
  readonly attemptedCount: number
  readonly updatedCount: number
  readonly noOpCount: number
  readonly failedCount: number
  readonly entries: readonly WooProductSyncExecuteEntry[]
}

export function selectExecutableSyncRows(
  rows: readonly WooProductSyncPlanRow[],
  limit: number,
): readonly WooProductSyncPlanRow[] {
  const executableRows = rows.filter(isExecutablePriceUpdate)
  const keyCounts = new Map<string, number>()
  for (const row of executableRows) {
    const key = variationKey(row)
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1)
  }
  return executableRows.filter((row) => keyCounts.get(variationKey(row)) === 1).slice(0, limit)
}

function variationKey(row: WooProductSyncPlanRow): string {
  return `${row.matched_woocommerce_product_id}:${row.current_woocommerce_variation_id}`
}

function isExecutablePriceUpdate(row: WooProductSyncPlanRow): boolean {
  return (
    row.mode === "update-existing" &&
    row.action === "update_variation_price" &&
    row.safety_status === "safe" &&
    row.matched_woocommerce_product_id !== null &&
    row.current_woocommerce_variation_id !== null
  )
}

export async function executeWooProductSyncPriceUpdates(
  rows: readonly WooProductSyncPlanRow[],
  options: WooProductSyncExecuteOptions,
): Promise<WooProductSyncExecuteLog> {
  const selectedRows = selectExecutableSyncRows(rows, options.limit)
  const client = wooClient(options)
  const entries: WooProductSyncExecuteEntry[] = []
  for (const row of selectedRows) {
    const entry = await executeOne(row, client)
    entries.push(entry)
    if (entry.status === "failed") break
  }
  const log = {
    mode: "execute" as const,
    requestedAt: new Date().toISOString(),
    attemptedCount: entries.length,
    updatedCount: entries.filter((entry) => entry.status === "updated").length,
    noOpCount: entries.filter((entry) => entry.status === "no_op").length,
    failedCount: entries.filter((entry) => entry.status === "failed").length,
    entries,
  }
  await writeExecuteLog(options.outputPath, log)
  return log
}

function wooClient(options: WooProductSyncExecuteOptions): {
  readonly baseUrl: string
  readonly headers: Record<string, string>
} {
  return {
    baseUrl: options.baseUrl.replace(/\/$/u, ""),
    headers: {
      Authorization: `Basic ${Buffer.from(`${options.consumerKey}:${options.consumerSecret}`).toString("base64")}`,
    },
  }
}

async function executeOne(
  row: WooProductSyncPlanRow,
  client: { readonly baseUrl: string; readonly headers: Record<string, string> },
): Promise<WooProductSyncExecuteEntry> {
  const ids = requiredIds(row)
  try {
    const before = await fetchVariationPrice(client, ids.productId, ids.variationId)
    if (before === row.selected_price) {
      return toEntry(row, before, before, "no_op", null)
    }
    await ky.put(
      `${client.baseUrl}/wp-json/wc/v3/products/${ids.productId}/variations/${ids.variationId}`,
      {
        headers: client.headers,
        json: { regular_price: String(row.selected_price) },
        timeout: 30_000,
        retry: { limit: 0 },
      },
    )
    const after = await fetchVariationPrice(client, ids.productId, ids.variationId)
    if (after !== row.selected_price) {
      return toEntry(row, before, after, "failed", "after price did not match expected price")
    }
    return toEntry(row, before, after, "updated", null)
  } catch (error) {
    return toEntry(
      row,
      null,
      null,
      "failed",
      error instanceof Error ? error.message : String(error),
    )
  }
}

async function fetchVariationPrice(
  client: { readonly baseUrl: string; readonly headers: Record<string, string> },
  productId: number,
  variationId: number,
): Promise<number | null> {
  const variation = VariationSchema.parse(
    await ky
      .get(`${client.baseUrl}/wp-json/wc/v3/products/${productId}/variations/${variationId}`, {
        headers: client.headers,
        timeout: 30_000,
        retry: { limit: 0 },
      })
      .json(),
  )
  return variation.price === undefined || variation.price === null || variation.price.length === 0
    ? null
    : Number(variation.price)
}

function requiredIds(row: WooProductSyncPlanRow): {
  readonly productId: number
  readonly variationId: number
} {
  if (
    row.matched_woocommerce_product_id === null ||
    row.current_woocommerce_variation_id === null
  ) {
    throw new Error("missing product_id or variation_id")
  }
  return {
    productId: row.matched_woocommerce_product_id,
    variationId: row.current_woocommerce_variation_id,
  }
}

function toEntry(
  row: WooProductSyncPlanRow,
  beforePrice: number | null,
  afterPrice: number | null,
  status: WooProductSyncExecuteEntry["status"],
  errorMessage: string | null,
): WooProductSyncExecuteEntry {
  const ids = requiredIds(row)
  return {
    product_id: ids.productId,
    variation_id: ids.variationId,
    option_display_name: row.option_display_name,
    before_price: beforePrice,
    after_price: afterPrice,
    expected_price: row.selected_price,
    status,
    error_message: errorMessage,
  }
}

async function writeExecuteLog(path: string, log: WooProductSyncExecuteLog): Promise<void> {
  const target = resolve(path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(log, null, 2)}\n`, "utf8")
}
