import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import ky from "ky"
import { z } from "zod"
import type { WooProductSyncPlanRow } from "./woocommerce-product-sync-plan.js"

const VariationSchema = z.object({ id: z.number().int(), price: z.string().nullable().optional() })
const ProductAttributeSchema = z.object({
  id: z.number().int().optional(),
  name: z.string(),
  visible: z.boolean().optional(),
  variation: z.boolean().optional(),
  options: z.array(z.string()).optional(),
})
const ProductSchema = z.object({
  id: z.number().int(),
  name: z.string().optional(),
  type: z.string(),
  status: z.string(),
  attributes: z.array(ProductAttributeSchema).optional(),
})

type Client = { readonly baseUrl: string; readonly headers: Record<string, string> }

export type WooProductSyncExecuteOptions = {
  readonly baseUrl: string
  readonly consumerKey: string
  readonly consumerSecret: string
  readonly limit: number
  readonly outputPath: string
}

export type WooProductSyncExecuteEntry = {
  readonly action: "update_variation_price" | "add_variation" | "create_new_variable_product"
  readonly product_id: number
  readonly variation_id: number | null
  readonly option_display_name: string
  readonly before_price: number | null
  readonly after_price: number | null
  readonly expected_price: number
  readonly status: "updated" | "created" | "no_op" | "failed"
  readonly error_message: string | null
}

export type WooProductSyncExecuteLog = {
  readonly mode: "execute"
  readonly requestedAt: string
  readonly attemptedCount: number
  readonly updatedCount: number
  readonly createdCount: number
  readonly productCreatedCount: number
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
  for (const row of executableRows)
    keyCounts.set(variationKey(row), (keyCounts.get(variationKey(row)) ?? 0) + 1)
  return executableRows.filter((row) => keyCounts.get(variationKey(row)) === 1).slice(0, limit)
}

export function selectExecutableSafeCatalogRows(
  rows: readonly WooProductSyncPlanRow[],
  limit: number,
): readonly WooProductSyncPlanRow[] {
  const safeRows = rows.filter(isExecutableSafeCatalogRow)
  const duplicateKeys = duplicateCatalogKeys(safeRows)
  return safeRows.filter((row) => !duplicateKeys.has(catalogKey(row))).slice(0, limit)
}

function duplicateCatalogKeys(rows: readonly WooProductSyncPlanRow[]): ReadonlySet<string> {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(catalogKey(row), (counts.get(catalogKey(row)) ?? 0) + 1)
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key))
}

function catalogKey(row: WooProductSyncPlanRow): string {
  return `${row.action}:${row.product_group_key}:${row.normalized_option_key}:${clean(row.option_display_name)}`
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

function isExecutableSafeCatalogRow(row: WooProductSyncPlanRow): boolean {
  if (row.safety_status !== "safe") return false
  if (row.selected_price < 1000) return false
  if (row.display_product_name.trim().length === 0 || row.option_display_name.trim().length === 0)
    return false
  if (row.action === "add_variation") return row.matched_woocommerce_product_id !== null
  return row.action === "create_new_variable_product" && row.mode === "create-new"
}

export async function executeWooProductSyncPriceUpdates(
  rows: readonly WooProductSyncPlanRow[],
  options: WooProductSyncExecuteOptions,
): Promise<WooProductSyncExecuteLog> {
  const selectedRows = selectExecutableSyncRows(rows, options.limit)
  const client = wooClient(options)
  const entries: WooProductSyncExecuteEntry[] = []
  for (const row of selectedRows) {
    const entry = await executePriceUpdate(row, client)
    entries.push(entry)
    if (entry.status === "failed") break
  }
  return writeAndReturnLog(options.outputPath, entries)
}

export async function executeWooProductSyncSafeCatalogChanges(
  rows: readonly WooProductSyncPlanRow[],
  options: WooProductSyncExecuteOptions,
): Promise<WooProductSyncExecuteLog> {
  const selectedRows = selectExecutableSafeCatalogRows(rows, options.limit)
  const client = wooClient(options)
  const entries: WooProductSyncExecuteEntry[] = []
  for (const row of selectedRows.filter((item) => item.action === "add_variation")) {
    const entry = await executeAddVariation(row, client)
    entries.push(entry)
    if (entry.status === "failed") return writeAndReturnLog(options.outputPath, entries)
  }
  const createGroups = groupCreateRows(selectedRows)
  for (const groupRows of createGroups) {
    const groupEntries = await executeCreateVariableProduct(groupRows, client)
    entries.push(...groupEntries)
    if (groupEntries.some((entry) => entry.status === "failed")) break
  }
  return writeAndReturnLog(options.outputPath, entries)
}

function groupCreateRows(
  rows: readonly WooProductSyncPlanRow[],
): readonly (readonly WooProductSyncPlanRow[])[] {
  const groups = new Map<string, WooProductSyncPlanRow[]>()
  for (const row of rows.filter((item) => item.action === "create_new_variable_product")) {
    groups.set(row.product_group_key, [...(groups.get(row.product_group_key) ?? []), row])
  }
  return [...groups.values()]
}

function wooClient(options: WooProductSyncExecuteOptions): Client {
  return {
    baseUrl: options.baseUrl.replace(/\/$/u, ""),
    headers: {
      Authorization: `Basic ${Buffer.from(`${options.consumerKey}:${options.consumerSecret}`).toString("base64")}`,
    },
  }
}

async function executePriceUpdate(
  row: WooProductSyncPlanRow,
  client: Client,
): Promise<WooProductSyncExecuteEntry> {
  const ids = requiredIds(row)
  try {
    const before = await fetchVariationPrice(client, ids.productId, ids.variationId)
    if (before === row.selected_price) return toPriceEntry(row, before, before, "no_op", null)
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
    if (after !== row.selected_price)
      return toPriceEntry(row, before, after, "failed", "after price did not match expected price")
    return toPriceEntry(row, before, after, "updated", null)
  } catch (error) {
    return toPriceEntry(
      row,
      null,
      null,
      "failed",
      error instanceof Error ? error.message : String(error),
    )
  }
}

async function executeAddVariation(
  row: WooProductSyncPlanRow,
  client: Client,
): Promise<WooProductSyncExecuteEntry> {
  try {
    if (row.matched_woocommerce_product_id === null) throw new Error("missing product_id")
    const product = await fetchProduct(client, row.matched_woocommerce_product_id)
    if (product.type !== "variable") throw new Error("target product is not variable")
    const attribute = variationAttribute(product)
    if (attribute === null) throw new Error("target product has no variation attribute")
    await ensureVariationOption(client, product, attribute, row.option_display_name)
    const variation = await createVariation(client, product.id, attribute.name, row)
    return toCreatedEntry("add_variation", product.id, variation.id, row, null)
  } catch (error) {
    return toCreatedEntry(
      "add_variation",
      row.matched_woocommerce_product_id ?? 0,
      null,
      row,
      error,
    )
  }
}

async function executeCreateVariableProduct(
  rows: readonly WooProductSyncPlanRow[],
  client: Client,
): Promise<readonly WooProductSyncExecuteEntry[]> {
  const first = rows[0]
  if (first === undefined) return []
  try {
    const product = ProductSchema.parse(
      await ky
        .post(`${client.baseUrl}/wp-json/wc/v3/products`, {
          headers: client.headers,
          json: {
            name: first.display_product_name,
            type: "variable",
            status: "draft",
            description: "도매허브 판매 후보 상품입니다. 운영자 검수 후 공개하세요.",
            attributes: [
              {
                name: "옵션",
                visible: true,
                variation: true,
                options: rows.map((row) => row.option_display_name),
              },
            ],
            meta_data: [{ key: "_wholesalehub_product_group_key", value: first.product_group_key }],
          },
          timeout: 30_000,
          retry: { limit: 0 },
        })
        .json(),
    )
    if (product.status !== "draft" && product.status !== "private")
      throw new Error("created product is public")
    const entries: WooProductSyncExecuteEntry[] = []
    for (const row of rows) {
      const variation = await createVariation(client, product.id, "옵션", row)
      entries.push(
        toCreatedEntry("create_new_variable_product", product.id, variation.id, row, null),
      )
    }
    return entries
  } catch (error) {
    return [toCreatedEntry("create_new_variable_product", 0, null, first, error)]
  }
}

async function createVariation(
  client: Client,
  productId: number,
  attributeName: string,
  row: WooProductSyncPlanRow,
): Promise<z.infer<typeof VariationSchema>> {
  return VariationSchema.parse(
    await ky
      .post(`${client.baseUrl}/wp-json/wc/v3/products/${productId}/variations`, {
        headers: client.headers,
        json: {
          regular_price: String(row.selected_price),
          attributes: [{ name: attributeName, option: row.option_display_name }],
          meta_data: [
            { key: "_wholesalehub_supplier_id", value: row.selected_supplier_id },
            {
              key: "_wholesalehub_source_product_id",
              value: row.selected_supplier_original_product_name,
            },
            {
              key: "_wholesalehub_source_option_id",
              value: row.selected_supplier_original_option_name ?? row.option_display_name,
            },
            {
              key: "_wholesalehub_original_product_name",
              value: row.selected_supplier_original_product_name,
            },
            {
              key: "_wholesalehub_original_option_name",
              value: row.selected_supplier_original_option_name ?? "",
            },
            { key: "_wholesalehub_product_group_key", value: row.product_group_key },
            { key: "_wholesalehub_normalized_option_key", value: row.normalized_option_key },
          ],
        },
        timeout: 30_000,
        retry: { limit: 0 },
      })
      .json(),
  )
}

async function fetchProduct(
  client: Client,
  productId: number,
): Promise<z.infer<typeof ProductSchema>> {
  return ProductSchema.parse(
    await ky
      .get(`${client.baseUrl}/wp-json/wc/v3/products/${productId}`, {
        headers: client.headers,
        timeout: 30_000,
        retry: { limit: 0 },
      })
      .json(),
  )
}

function variationAttribute(
  product: z.infer<typeof ProductSchema>,
): z.infer<typeof ProductAttributeSchema> | null {
  return product.attributes?.find((attribute) => attribute.variation === true) ?? null
}

async function ensureVariationOption(
  client: Client,
  product: z.infer<typeof ProductSchema>,
  attribute: z.infer<typeof ProductAttributeSchema>,
  optionName: string,
): Promise<void> {
  const options = attribute.options ?? []
  if (options.includes(optionName)) return
  await ky.put(`${client.baseUrl}/wp-json/wc/v3/products/${product.id}`, {
    headers: client.headers,
    json: {
      attributes: (product.attributes ?? []).map((item) =>
        item.name === attribute.name
          ? {
              id: item.id ?? 0,
              name: item.name,
              visible: item.visible ?? true,
              variation: true,
              options: [...options, optionName],
            }
          : item,
      ),
    },
    timeout: 30_000,
    retry: { limit: 0 },
  })
}

async function fetchVariationPrice(
  client: Client,
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

function toPriceEntry(
  row: WooProductSyncPlanRow,
  beforePrice: number | null,
  afterPrice: number | null,
  status: WooProductSyncExecuteEntry["status"],
  errorMessage: string | null,
): WooProductSyncExecuteEntry {
  const ids = requiredIds(row)
  return {
    action: "update_variation_price",
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

function toCreatedEntry(
  action: "add_variation" | "create_new_variable_product",
  productId: number,
  variationId: number | null,
  row: WooProductSyncPlanRow,
  error: unknown,
): WooProductSyncExecuteEntry {
  return {
    action,
    product_id: productId,
    variation_id: variationId,
    option_display_name: row.option_display_name,
    before_price: null,
    after_price: error === null ? row.selected_price : null,
    expected_price: row.selected_price,
    status: error === null ? "created" : "failed",
    error_message: error === null ? null : error instanceof Error ? error.message : String(error),
  }
}

async function writeAndReturnLog(
  path: string,
  entries: readonly WooProductSyncExecuteEntry[],
): Promise<WooProductSyncExecuteLog> {
  const log = {
    mode: "execute" as const,
    requestedAt: new Date().toISOString(),
    attemptedCount: entries.length,
    updatedCount: entries.filter((entry) => entry.status === "updated").length,
    createdCount: entries.filter((entry) => entry.status === "created").length,
    productCreatedCount: new Set(
      entries
        .filter(
          (entry) => entry.action === "create_new_variable_product" && entry.status === "created",
        )
        .map((entry) => entry.product_id),
    ).size,
    noOpCount: entries.filter((entry) => entry.status === "no_op").length,
    failedCount: entries.filter((entry) => entry.status === "failed").length,
    entries,
  }
  await writeExecuteLog(path, log)
  return log
}

async function writeExecuteLog(path: string, log: WooProductSyncExecuteLog): Promise<void> {
  const target = resolve(path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(log, null, 2)}\n`, "utf8")
}

function clean(value: string): string {
  return value.replace(/[^가-힣a-zA-Z0-9.]/gu, "").toLowerCase()
}
