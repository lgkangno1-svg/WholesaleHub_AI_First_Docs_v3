import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { pathToFileURL } from "node:url"

type Audit = {
  readonly sourceHashBefore: string
  readonly sourceHashAfter: string
  readonly copyHash: string
  readonly integrityCheck: string
  readonly migrationRuns: 2
  readonly legacyVariationLinksBefore: number
  readonly legacyVariationLinksAfter: number
  readonly variationIdsPreserved: boolean
  readonly supplierRows: Readonly<Record<string, number>>
  readonly duplicateVariationRows: number
  readonly orphanRows: number
  readonly pendingRows: number
  readonly terminalSupplierRowsExcluded: number
}

export async function runSupplierLaneOpsVerify(args: readonly string[]): Promise<number> {
  try {
    const sourcePath = resolve(required(args, "--source-db"))
    const copyPath = resolve(required(args, "--copy-db"))
    const migrationPath = resolve(required(args, "--migration"))
    const outputPath = resolve(required(args, "--out"))
    if (existsSync(copyPath)) throw new Error("copy_db_must_not_exist")

    const sourceHashBefore = await sha256(sourcePath)
    await mkdir(dirname(copyPath), { recursive: true })
    const source = new DatabaseSync(sourcePath, { readOnly: true })
    source.exec(`VACUUM INTO '${copyPath.replaceAll("'", "''")}'`)
    source.close()
    const sourceHashAfter = await sha256(sourcePath)
    if (sourceHashBefore !== sourceHashAfter) throw new Error("source_database_hash_drift")

    const database = new DatabaseSync(copyPath)
    const integrityCheck = stringColumn(database, "PRAGMA integrity_check", "integrity_check")
    if (integrityCheck !== "ok") throw new Error(`copy_integrity_failed:${integrityCheck}`)
    const legacyVariationIds = variationIds(database)
    const migration = await readFile(migrationPath, "utf8")
    database.exec(migration)
    database.exec(migration)
    const legacyVariationIdsAfter = variationIds(database)
    const audit: Audit = {
      sourceHashBefore,
      sourceHashAfter,
      copyHash: await sha256(copyPath),
      integrityCheck,
      migrationRuns: 2,
      legacyVariationLinksBefore: legacyVariationIds.length,
      legacyVariationLinksAfter: legacyVariationIdsAfter.length,
      variationIdsPreserved:
        legacyVariationIds.length === legacyVariationIdsAfter.length &&
        legacyVariationIds.every((id, index) => id === legacyVariationIdsAfter[index]),
      supplierRows: supplierCounts(database),
      duplicateVariationRows: scalar(
        database,
        `SELECT COUNT(*) AS count FROM (
           SELECT woo_variation_id FROM woo_variation_offer_links
           GROUP BY woo_variation_id HAVING COUNT(*) > 1
         )`,
      ),
      orphanRows: scalar(
        database,
        `SELECT COUNT(*) AS count
         FROM woo_variation_offer_links AS link
         LEFT JOIN normalized_offers AS offer
           ON offer.normalized_offer_id = link.selected_offer_id
         WHERE offer.normalized_offer_id IS NULL`,
      ),
      pendingRows: scalar(
        database,
        `SELECT COUNT(*) AS count
         FROM woo_variation_offer_links AS link
         JOIN normalized_offers AS offer
           ON offer.normalized_offer_id = link.selected_offer_id
         WHERE offer.status <> 'active'`,
      ),
      terminalSupplierRowsExcluded: scalar(
        database,
        `SELECT COUNT(*) AS count
         FROM woo_variation_offer_links AS link
         JOIN normalized_offers AS offer ON offer.normalized_offer_id = link.selected_offer_id
         JOIN atomic_supplier_skus AS sku ON sku.atomic_sku_id = offer.atomic_sku_id
         JOIN supplier_products AS product ON product.supplier_product_id = sku.supplier_product_id
         WHERE product.supplier_id NOT IN ('dailyfood', 'walldob2b')`,
      ),
    }
    database.close()
    if (!audit.variationIdsPreserved) throw new Error("legacy_variation_ids_changed")
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8")
    process.stdout.write(`${JSON.stringify(audit)}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${message(error)}\n`)
    return 1
  }
}

function required(args: readonly string[], name: string): string {
  const index = args.indexOf(name)
  const value = index < 0 ? undefined : args[index + 1]
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`)
  return value
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex")
}

function tableExists(database: DatabaseSync, name: string): boolean {
  return (
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  )
}

function variationIds(database: DatabaseSync): readonly number[] {
  if (!tableExists(database, "woo_variation_offer_links")) return []
  return (
    database
      .prepare(
        "SELECT woo_variation_id AS id FROM woo_variation_offer_links ORDER BY woo_variation_id",
      )
      .all() as { id: number }[]
  ).map((row) => Number(row.id))
}

function supplierCounts(database: DatabaseSync): Readonly<Record<string, number>> {
  if (!tableExists(database, "woo_variation_offer_links")) return {}
  const rows = database
    .prepare(
      `SELECT product.supplier_id AS supplier, COUNT(*) AS count
       FROM woo_variation_offer_links AS link
       JOIN normalized_offers AS offer ON offer.normalized_offer_id = link.selected_offer_id
       JOIN atomic_supplier_skus AS sku ON sku.atomic_sku_id = offer.atomic_sku_id
       JOIN supplier_products AS product ON product.supplier_product_id = sku.supplier_product_id
       GROUP BY product.supplier_id ORDER BY product.supplier_id`,
    )
    .all() as { supplier: string; count: number }[]
  return Object.fromEntries(rows.map((row) => [row.supplier, Number(row.count)]))
}

function scalar(database: DatabaseSync, sql: string): number {
  const row = database.prepare(sql).get() as { count: number }
  return Number(row.count)
}

function stringColumn(database: DatabaseSync, sql: string, column: string): string {
  const row = database.prepare(sql).get() as Record<string, unknown>
  return String(row[column] ?? "")
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runSupplierLaneOpsVerify(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
