import ky from "ky"
import { z } from "zod"

const ReviewRowSchema = z.object({
  product_id: z.number().int().nullable(),
  variation_id: z.number().int().nullable(),
  woocommerce_product_name: z.string().nullable(),
  woocommerce_option_name: z.string().nullable(),
  woocommerce_current_price: z.number().nullable(),
  new_price: z.number().nullable(),
  safety_status: z.enum(["safe", "review_needed", "blocked"]),
})
const ReviewSchema = z.object({ rows: z.array(ReviewRowSchema) })

type ReviewRow = z.infer<typeof ReviewRowSchema>

export type LiveUpdateOptions = {
  readonly baseUrl: string
  readonly consumerKey: string
  readonly consumerSecret: string
  readonly execute: boolean
  readonly limit: number | null
  readonly confirm: string | null
}

export type LiveUpdateLog = {
  readonly mode: "dry-run" | "execute"
  readonly requestedAt: string
  readonly selectedCount: number
  readonly blockedCount: number
  readonly entries: readonly LiveUpdateEntry[]
}

export type LiveUpdateEntry = {
  readonly product_id: number
  readonly variation_id: number
  readonly product_name: string
  readonly option_name: string
  readonly before_price: number | null
  readonly after_price: number
  readonly status: "preview" | "updated"
}

export function parseReviewRows(value: unknown): readonly ReviewRow[] {
  return ReviewSchema.parse(value).rows
}

export async function runWooCommerceLiveUpdate(
  rows: readonly ReviewRow[],
  options: LiveUpdateOptions,
): Promise<LiveUpdateLog> {
  assertExecutionGuards(options)
  const safeRows = rows.filter(isExecutableSafeRow)
  const selected = options.limit === null ? safeRows : safeRows.slice(0, options.limit)
  const entries: LiveUpdateEntry[] = []
  for (const row of selected) {
    const entry = toEntry(row, options.execute ? "updated" : "preview")
    if (options.execute) {
      await updateWooCommercePrice(row, options)
    }
    entries.push(entry)
  }
  return {
    mode: options.execute ? "execute" : "dry-run",
    requestedAt: new Date().toISOString(),
    selectedCount: entries.length,
    blockedCount: rows.filter((row) => row.safety_status === "blocked").length,
    entries,
  }
}

function assertExecutionGuards(options: LiveUpdateOptions): void {
  if (!options.execute) {
    return
  }
  if (options.limit === null || options.limit <= 0) {
    throw new Error("--execute requires --limit")
  }
  if (options.confirm !== "UPDATE_WOOCOMMERCE_PRICES") {
    throw new Error('--execute requires --confirm "UPDATE_WOOCOMMERCE_PRICES"')
  }
}

function isExecutableSafeRow(row: ReviewRow): boolean {
  return (
    row.safety_status === "safe" &&
    row.product_id !== null &&
    row.variation_id !== null &&
    row.new_price !== null
  )
}

function toEntry(row: ReviewRow, status: LiveUpdateEntry["status"]): LiveUpdateEntry {
  if (row.product_id === null || row.variation_id === null || row.new_price === null) {
    throw new Error("safe row is missing product_id, variation_id, or new_price")
  }
  return {
    product_id: row.product_id,
    variation_id: row.variation_id,
    product_name: row.woocommerce_product_name ?? "",
    option_name: row.woocommerce_option_name ?? "",
    before_price: row.woocommerce_current_price,
    after_price: row.new_price,
    status,
  }
}

async function updateWooCommercePrice(row: ReviewRow, options: LiveUpdateOptions): Promise<void> {
  if (row.product_id === null || row.variation_id === null || row.new_price === null) {
    throw new Error("cannot update incomplete row")
  }
  const baseUrl = options.baseUrl.replace(/\/$/u, "")
  await ky.put(
    `${baseUrl}/wp-json/wc/v3/products/${row.product_id}/variations/${row.variation_id}`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${options.consumerKey}:${options.consumerSecret}`).toString("base64")}`,
      },
      json: { regular_price: String(row.new_price) },
      timeout: 30_000,
      retry: { limit: 0 },
    },
  )
}
