import { createHash } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"
import { evaluateSupplierSnapshotCompleteness } from "./supplier-snapshot-completeness.js"

export const P2_SUPPLIERS = ["dailyfood", "walldob2b"] as const
export type P2Supplier = (typeof P2_SUPPLIERS)[number]

const SnapshotProductSchema = z.object({
  supplierId: z.string().min(1),
  sourceProductId: z.string().min(1).optional(),
  sourceOptionId: z.string().min(1).optional(),
  collectedAt: z.string().datetime({ offset: true }).optional(),
  originalProductName: z.string(),
  originalOptionName: z.string().nullable().optional(),
  price: z.number(),
  shippingFee: z.number().default(0),
  stockStatus: z.string(),
  productUrl: z.string().default(""),
  rawJson: z.string(),
})

export const SupplierSnapshotV2Schema = z.object({
  schemaVersion: z.literal(2),
  pipelineRunId: z.string().min(1),
  supplier: z.enum(P2_SUPPLIERS),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  crawlStatus: z.enum(["complete", "incomplete", "failed"]),
  authenticationStatus: z.enum(["authenticated", "failed"]),
  paginationComplete: z.boolean(),
  expectedProductCount: z.number().int().nonnegative(),
  collectedProductCount: z.number().int().nonnegative(),
  expectedOptionCount: z.number().int().nonnegative(),
  collectedOptionCount: z.number().int().nonnegative(),
  detailRequestCount: z.number().int().nonnegative(),
  detailSuccessCount: z.number().int().nonnegative(),
  detailSuccessRate: z.number().min(0).max(1),
  duplicateSourceIdCount: z.number().int().nonnegative(),
  parseErrorCount: z.number().int().nonnegative(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
  products: z.array(SnapshotProductSchema),
})

export type SupplierSnapshotV2 = z.infer<typeof SupplierSnapshotV2Schema>
export type SupplierSnapshotStatus = "complete" | "incomplete" | "anomalous" | "failed"

export type SupplierSnapshotGate = {
  readonly status: SupplierSnapshotStatus
  readonly reasons: readonly string[]
  readonly mutationAllowed: boolean
  readonly productCount: number
  readonly optionCount: number
  readonly snapshotHash: string | null
}

export type BuildSupplierSnapshotV2Input = {
  readonly supplier: P2Supplier
  readonly pipelineRunId: string
  readonly startedAt: string
  readonly completedAt: string
  readonly crawlStatus: "complete" | "incomplete" | "failed"
  readonly authenticationStatus: "authenticated" | "failed"
  readonly paginationComplete: boolean
  readonly expectedProductCount: number
  readonly expectedOptionCount: number
  readonly detailRequestCount: number
  readonly detailSuccessCount: number
  readonly duplicateSourceIdCount: number
  readonly parseErrorCount: number
  readonly products: SupplierSnapshotV2["products"]
}

export type LegacyCrawlerRow = {
  readonly id: number
  readonly supplier_id: P2Supplier
  readonly source_type: string
  readonly original_product_name: string
  readonly original_option_name: string | null
  readonly price: number
  readonly shipping_fee: number
  readonly stock_status: string
  readonly product_url: string | null
  readonly raw_json: string
}

export type AdaptCrawlerRowsInput = {
  readonly supplier: P2Supplier
  readonly pipelineRunId: string
  readonly startedAt: string
  readonly completedAt: string
  readonly authenticationStatus: "authenticated" | "failed"
  readonly paginationComplete: boolean
  readonly expectedProductCount: number
  readonly expectedOptionCount: number
  readonly detailRequestCount: number
  readonly detailSuccessCount: number
  readonly parseErrorCount: number
  readonly rows: readonly LegacyCrawlerRow[]
}

export type AdaptCrawlerRowsResult = {
  readonly snapshot: SupplierSnapshotV2
  readonly rejectedRows: readonly {
    readonly rowId: number
    readonly reason: "supplier_mismatch" | "raw_json_invalid" | "authoritative_source_ids_missing"
  }[]
}

export type SnapshotGateOptions = {
  readonly expectedPipelineRunId: string | null
  readonly previousCompleteOptionCount: number | null
  readonly absoluteMinimum: number
  readonly bootstrapMaximum: number
  readonly nowMs: number
  readonly maxAgeMs: number
}

export function buildSupplierSnapshotV2(input: BuildSupplierSnapshotV2Input): SupplierSnapshotV2 {
  const collectedProductCount = countCollectedProducts(input.products)
  const collectedOptionCount = input.products.length
  const detailSuccessRate =
    input.detailRequestCount === 0 ? 1 : input.detailSuccessCount / input.detailRequestCount
  const sourceHash = hashCanonical(input.products)
  const withoutSnapshotHash = {
    schemaVersion: 2 as const,
    pipelineRunId: input.pipelineRunId,
    supplier: input.supplier,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    crawlStatus: input.crawlStatus,
    authenticationStatus: input.authenticationStatus,
    paginationComplete: input.paginationComplete,
    expectedProductCount: input.expectedProductCount,
    collectedProductCount,
    expectedOptionCount: input.expectedOptionCount,
    collectedOptionCount,
    detailRequestCount: input.detailRequestCount,
    detailSuccessCount: input.detailSuccessCount,
    detailSuccessRate,
    duplicateSourceIdCount: input.duplicateSourceIdCount,
    parseErrorCount: input.parseErrorCount,
    sourceHash,
    snapshotHash: "",
    products: input.products,
  }
  return SupplierSnapshotV2Schema.parse({
    ...withoutSnapshotHash,
    snapshotHash: hashCanonical(withoutSnapshotHash),
  })
}

export function adaptCrawlerRowsToSupplierSnapshotV2(
  input: AdaptCrawlerRowsInput,
): AdaptCrawlerRowsResult {
  const rejectedRows: AdaptCrawlerRowsResult["rejectedRows"][number][] = []
  const products: SupplierSnapshotV2["products"] = []
  for (const row of input.rows) {
    if (row.supplier_id !== input.supplier) {
      rejectedRows.push({ rowId: row.id, reason: "supplier_mismatch" })
      continue
    }
    let raw: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(row.raw_json)
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("raw_json_not_object")
      }
      raw = parsed as Record<string, unknown>
    } catch {
      rejectedRows.push({ rowId: row.id, reason: "raw_json_invalid" })
      continue
    }
    const sourceProductId = authoritativeId(raw, ["sourceProductId", "source_product_id"])
    const sourceOptionId = authoritativeId(raw, ["sourceOptionId", "source_option_id"])
    if (sourceProductId === null || sourceOptionId === null) {
      rejectedRows.push({ rowId: row.id, reason: "authoritative_source_ids_missing" })
      continue
    }
    products.push({
      supplierId: input.supplier,
      sourceProductId,
      sourceOptionId,
      collectedAt: input.completedAt,
      originalProductName: row.original_product_name,
      originalOptionName: row.original_option_name,
      price: row.price,
      shippingFee: row.shipping_fee,
      stockStatus: row.stock_status,
      productUrl: row.product_url ?? "",
      rawJson: JSON.stringify({ ...raw, sourceProductId, sourceOptionId }),
    })
  }
  const duplicateSourceIdCount =
    products.length -
    new Set(products.map((product) => `${product.sourceProductId}\u0000${product.sourceOptionId}`))
      .size
  const productCount = countCollectedProducts(products)
  const crawlStatus =
    rejectedRows.length === 0 &&
    input.parseErrorCount === 0 &&
    input.authenticationStatus === "authenticated" &&
    input.paginationComplete &&
    productCount === input.expectedProductCount &&
    products.length === input.expectedOptionCount
      ? "complete"
      : "incomplete"
  return {
    snapshot: buildSupplierSnapshotV2({
      supplier: input.supplier,
      pipelineRunId: input.pipelineRunId,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      crawlStatus,
      authenticationStatus: input.authenticationStatus,
      paginationComplete: input.paginationComplete,
      expectedProductCount: input.expectedProductCount,
      expectedOptionCount: input.expectedOptionCount,
      detailRequestCount: input.detailRequestCount,
      detailSuccessCount: input.detailSuccessCount,
      duplicateSourceIdCount,
      parseErrorCount: input.parseErrorCount + rejectedRows.length,
      products,
    }),
    rejectedRows,
  }
}

export async function writeSupplierSnapshotV2Atomic(
  path: string,
  snapshot: SupplierSnapshotV2,
): Promise<void> {
  const parsed = SupplierSnapshotV2Schema.parse(snapshot)
  const verified = evaluateSupplierSnapshotV2(parsed, {
    expectedPipelineRunId: parsed.pipelineRunId,
    previousCompleteOptionCount: null,
    absoluteMinimum: 0,
    bootstrapMaximum: 100_000,
    nowMs: Date.parse(parsed.completedAt),
    maxAgeMs: 30 * 60 * 1000,
  })
  if (
    verified.reasons.includes("source_hash_mismatch") ||
    verified.reasons.includes("snapshot_hash_mismatch")
  ) {
    throw new Error(`Refusing to write invalid snapshot: ${verified.reasons.join(", ")}`)
  }
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  })
  await rename(temporaryPath, path)
}

export async function readSupplierSnapshotV2(path: string): Promise<SupplierSnapshotV2> {
  const raw = await readFile(path, "utf8")
  return SupplierSnapshotV2Schema.parse(JSON.parse(raw))
}

export function evaluateSupplierSnapshotV2(
  snapshot: SupplierSnapshotV2,
  options: SnapshotGateOptions,
): SupplierSnapshotGate {
  const reasons: string[] = []
  const completedAtMs = Date.parse(snapshot.completedAt)
  const computedSourceHash = hashCanonical(snapshot.products)
  const computedSnapshotHash = hashCanonical({ ...snapshot, snapshotHash: "" })

  if (
    options.expectedPipelineRunId !== null &&
    snapshot.pipelineRunId !== options.expectedPipelineRunId
  ) {
    reasons.push("pipeline_run_id_mismatch")
  }
  if (snapshot.crawlStatus === "failed") reasons.push("crawl_failed")
  if (snapshot.crawlStatus !== "complete") reasons.push("crawl_incomplete")
  if (snapshot.authenticationStatus !== "authenticated") {
    reasons.push("authentication_failed")
  }
  if (snapshot.expectedProductCount !== snapshot.collectedProductCount) {
    reasons.push("product_count_mismatch")
  }
  if (snapshot.expectedOptionCount !== snapshot.collectedOptionCount) {
    reasons.push("option_count_mismatch")
  }
  if (snapshot.collectedProductCount !== countCollectedProducts(snapshot.products)) {
    reasons.push("product_rows_mismatch")
  }
  if (snapshot.collectedOptionCount !== snapshot.products.length) {
    reasons.push("option_rows_mismatch")
  }
  if (snapshot.sourceHash !== computedSourceHash) reasons.push("source_hash_mismatch")
  if (snapshot.snapshotHash !== computedSnapshotHash) reasons.push("snapshot_hash_mismatch")

  const completeness = evaluateSupplierSnapshotCompleteness({
    currentCount: snapshot.collectedOptionCount,
    previousSuccessfulCount: options.previousCompleteOptionCount,
    absoluteMinimum: options.absoluteMinimum,
    bootstrapMaximum: options.bootstrapMaximum,
    authVerified: snapshot.authenticationStatus === "authenticated",
    paginationComplete: snapshot.paginationComplete,
    detailRequestCount: snapshot.detailRequestCount,
    detailSuccessCount: snapshot.detailSuccessCount,
    parseFailureCount: snapshot.parseErrorCount,
    schemaInvalidCount: 0,
    duplicateSourceIdCount: snapshot.duplicateSourceIdCount,
    createdAtMs: completedAtMs,
    nowMs: options.nowMs,
    maxAgeMs: options.maxAgeMs,
  })
  for (const reason of completeness.reasons) {
    if (!reasons.includes(reason)) reasons.push(reason)
  }
  if (Math.abs(snapshot.detailSuccessRate - completeness.detailSuccessRate) > 0.000_001) {
    reasons.push("detail_success_rate_mismatch")
  }

  const anomalous = reasons.some((reason) =>
    ["count_drop_anomaly", "count_growth_anomaly"].includes(reason),
  )
  const failed = reasons.includes("crawl_failed")
  const status: SupplierSnapshotStatus =
    reasons.length === 0 ? "complete" : failed ? "failed" : anomalous ? "anomalous" : "incomplete"
  return {
    status,
    reasons,
    mutationAllowed: status === "complete",
    productCount: snapshot.collectedProductCount,
    optionCount: snapshot.collectedOptionCount,
    snapshotHash: snapshot.snapshotHash,
  }
}

function countCollectedProducts(products: SupplierSnapshotV2["products"]): number {
  if (products.every((product) => product.sourceProductId !== undefined)) {
    return new Set(products.map((product) => product.sourceProductId)).size
  }
  return products.length
}

function authoritativeId(raw: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = raw[key]
    if (typeof value === "string" && value.trim().length > 0) return value.trim()
    if (typeof value === "number" && Number.isSafeInteger(value)) return String(value)
  }
  return null
}

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}
