import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

type PlanRow = {
  readonly product_id: number | null
  readonly selected_supplier_id: string
  readonly selected_source_product_id: string
  readonly selected_source_option_id: string
  readonly action: string
  readonly [key: string]: unknown
}

type Plan = {
  readonly summary: Readonly<Record<string, unknown>>
  readonly rows: readonly PlanRow[]
}

async function main(): Promise<void> {
  const inputPath = resolve(argument("--plan") ?? "reports/mvp-sync-plan.json")
  const outputPath = resolve(
    argument("--output") ?? "reports/daily-pipeline/latest/safe-draft-plan.json",
  )
  const database = new DatabaseSync(resolve(argument("--db") ?? "data/wholesalehub.sqlite"))
  try {
    const plan = JSON.parse(await readFile(inputPath, "utf8")) as Plan
    const rows = plan.rows.filter(
      (row) =>
        row.action === "create_draft_product_candidate" &&
        row.product_id === null &&
        row.selected_supplier_id === "dailyfood" &&
        isSafe(database, row),
    )
    await writeFile(
      outputPath,
      `${JSON.stringify(
        {
          summary: { ...plan.summary, source_row_count: plan.rows.length, safe_row_count: rows.length },
          rows,
        },
        null,
        2,
      )}\n`,
      "utf8",
    )
    console.log(JSON.stringify({ safeDraftRowCount: rows.length, outputPath }))
  } finally {
    database.close()
  }
}

function isSafe(database: DatabaseSync, row: PlanRow): boolean {
  const source = database
    .prepare(
      `SELECT collection_status, option_count
       FROM supplier_collection_products
       WHERE supplier_id = ? AND source_product_id = ?`,
    )
    .get(row.selected_supplier_id, row.selected_source_product_id)
  if (
    source === undefined ||
    source["collection_status"] !== "active" ||
    Number(source["option_count"]) < 1
  ) {
    return false
  }
  const selected = database
    .prepare(
      `SELECT
         trace.is_purchasable,
         offer.status,
         offer.canonical_variant_key,
         offer.promotion_flag,
         offer.sold_out_flag,
         queue.review_key
       FROM supplier_products AS product
       JOIN supplier_options AS option_row
         ON option_row.supplier_product_id = product.supplier_product_id
       JOIN atomic_supplier_skus AS sku
         ON sku.supplier_product_id = product.supplier_product_id
        AND sku.supplier_option_id = option_row.supplier_option_id
       JOIN normalized_offers AS offer
         ON offer.atomic_sku_id = sku.atomic_sku_id
       JOIN selected_offer_trace AS trace
         ON trace.selected_offer_id = offer.normalized_offer_id
       LEFT JOIN normalization_review_queue AS queue
         ON queue.canonical_variant_key = offer.canonical_variant_key
        AND queue.review_status = 'pending'
       WHERE product.supplier_id = ?
         AND product.source_product_id = ?
         AND option_row.source_option_id = ?
       LIMIT 1`,
    )
    .get(
      row.selected_supplier_id,
      row.selected_source_product_id,
      row.selected_source_option_id,
    )
  return (
    selected !== undefined &&
    Number(selected["is_purchasable"]) === 1 &&
    selected["status"] === "active" &&
    typeof selected["canonical_variant_key"] === "string" &&
    selected["canonical_variant_key"].length > 0 &&
    Number(selected["promotion_flag"]) === 0 &&
    Number(selected["sold_out_flag"]) === 0 &&
    selected["review_key"] === null
  )
}

function argument(key: string): string | null {
  const index = process.argv.indexOf(key)
  return index < 0 ? null : (process.argv[index + 1] ?? null)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
