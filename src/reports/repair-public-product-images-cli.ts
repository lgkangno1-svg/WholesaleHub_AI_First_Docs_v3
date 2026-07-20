import { execFile } from "node:child_process"
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import ky from "ky"
import { z } from "zod"
import { fetchWalldob2bDetailHtml } from "../adapters/walldob2b/walldob2b-adapter.js"
import type { CollectedProduct } from "../domain/product.js"
import {
  extractWalldob2bThumbnail,
  duplicateFingerprintGroups,
  PLACEHOLDER_IMAGE_ID,
  selectSourceThumbnail,
  sha256,
  snapshotCandidates,
} from "./product-thumbnail-integrity.js"

const CONFIRM = "REPAIR_PUBLIC_PRODUCT_IMAGES"
const LOCK_PATH = "reports/product-image-repair.lock"
const execFileAsync = promisify(execFile)
const ProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  status: z.string(),
  images: z.array(z.object({ id: z.number().int().optional(), src: z.string().optional() })).default([]),
  meta_data: z.array(z.object({ key: z.string(), value: z.unknown() })).default([]),
})
const VariationSchema = z.object({
  id: z.number().int(),
  meta_data: z.array(z.object({ key: z.string(), value: z.unknown() })).default([]),
})
const SnapshotSchema = z.object({
  products: z.array(z.object({
    supplierId: z.string(),
    originalProductName: z.string(),
    rawJson: z.string(),
  }).passthrough()),
})
type Product = z.infer<typeof ProductSchema>
type Variation = z.infer<typeof VariationSchema>
type Prepared = {
  product: Product
  sourceProductId: string
  sourceUrl: string
  bytes: Uint8Array
  hash: string
}
type ImageAudit = {
  brokenProductIds: ReadonlySet<number>
  duplicateAttachmentGroups: readonly (readonly number[])[]
  duplicateContentGroups: readonly (readonly number[])[]
  downloadFailures: readonly { productId: number; issue: string }[]
}

async function main(): Promise<void> {
  await loadDotEnv()
  const execute = process.argv.includes("--execute")
  const strict = process.argv.includes("--strict")
  const confirm = valueAfter("--confirm")
  if (execute && confirm !== CONFIRM) throw new Error(`--confirm "${CONFIRM}" is required`)
  const client = wooClient()
  const products = await fetchProducts(client)
  const beforeAudit = await auditProductImages(products)
  const targets = products.filter((product) => beforeAudit.brokenProductIds.has(product.id))
  const candidates = snapshotCandidates([
    ...(await readSnapshot("reports/snapshots/dailyfood-latest-success.json")),
    ...(await readSnapshot("reports/snapshots/walldob2b-latest-success.json")),
  ])
  const prepared: Prepared[] = []
  const entries: Record<string, unknown>[] = []

  for (const product of targets) {
    try {
      const variations = await fetchVariations(client, product.id)
      const supplierIds = unique(variations.map(variationSupplierId).filter(Boolean))
      if (supplierIds.length !== 1) throw new Error(`expected one supplier, found ${supplierIds.length}`)
      const sourceIds = unique(variations.map(variationSourceProductId).filter(Boolean))
      if (sourceIds.length > 1) throw new Error(`conflicting source product ids: ${sourceIds.length}`)
      const source = selectSourceThumbnail({
        supplierId: supplierIds[0] ?? "",
        sourceProductId: sourceIds[0] ?? "",
        productName: product.name,
        candidates,
      })
      if (source === null) throw new Error("unique supplier source product match not found")
      const sourceUrl = source.supplierId === "walldob2b"
        ? await walldoThumbnail(source.sourceProductId)
        : source.imageUrl
      if (!/^https?:\/\//iu.test(sourceUrl)) throw new Error("source thumbnail url missing")
      const bytes = await downloadImage(sourceUrl)
      prepared.push({ product, sourceProductId: source.sourceProductId, sourceUrl, bytes, hash: sha256(bytes) })
    } catch (error) {
      entries.push(entry(product, "failed", message(error)))
    }
  }

  const duplicateHashes = new Set(
    [...groupBy(prepared, (row) => row.hash).values()]
      .filter((rows) => unique(rows.map((row) => String(row.product.id))).length > 1)
      .map((rows) => rows[0]?.hash ?? ""),
  )
  for (const row of prepared) {
    if (duplicateHashes.has(row.hash)) {
      entries.push(entry(row.product, "failed", "same image bytes resolved for different products"))
      continue
    }
    if (!execute) {
      entries.push(entry(row.product, "dry_run", "", row))
      continue
    }
    try {
      const localPath = await writeTemporaryImage(row)
      const attachmentId = await importAttachment(localPath, row.product)
      await unlink(localPath).catch(() => undefined)
      await ky.put(`${client.baseUrl}/wp-json/wc/v3/products/${row.product.id}`, {
        headers: client.headers,
        json: {
          images: [{ id: attachmentId }],
          meta_data: [
            { key: "_wholesalehub_source_product_id", value: row.sourceProductId },
            { key: "_wholesalehub_source_image_url", value: row.sourceUrl },
            { key: "_wholesalehub_thumbnail_sha256", value: row.hash },
            { key: "_wholesalehub_thumbnail_synced_at", value: new Date().toISOString() },
          ],
        },
        timeout: 60_000,
        retry: { limit: 0 },
      })
      entries.push(entry(row.product, "repaired", "", row, attachmentId))
    } catch (error) {
      entries.push(entry(row.product, "failed", message(error), row))
    }
  }

  const after = execute ? await fetchProducts(client) : products
  const afterAudit = execute ? await auditProductImages(after) : beforeAudit
  const brokenAfter = afterAudit.brokenProductIds.size
  const report = {
    generated_at: new Date().toISOString(),
    execute,
    public_products: products.length,
    broken_before: targets.length,
    repaired: entries.filter((row) => row["status"] === "repaired").length,
    failed: entries.filter((row) => row["status"] === "failed").length,
    broken_after: brokenAfter,
    duplicate_attachment_groups_before: beforeAudit.duplicateAttachmentGroups,
    duplicate_content_groups_before: beforeAudit.duplicateContentGroups,
    duplicate_attachment_groups_after: afterAudit.duplicateAttachmentGroups,
    duplicate_content_groups_after: afterAudit.duplicateContentGroups,
    image_download_failures_after: afterAudit.downloadFailures,
    entries,
  }
  await mkdir("reports", { recursive: true })
  await writeFile("reports/product-image-repair-report.json", `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ ...report, entries: undefined }, null, 2))
  if ((execute || strict) && (report.failed > 0 || brokenAfter > 0)) {
    throw new Error(`thumbnail integrity failed: failed=${report.failed} broken_after=${brokenAfter}`)
  }
}

async function readSnapshot(path: string): Promise<readonly CollectedProduct[]> {
  const parsed = SnapshotSchema.parse(JSON.parse(await readFile(path, "utf8")))
  return parsed.products as unknown as readonly CollectedProduct[]
}

async function fetchProducts(client: ReturnType<typeof wooClient>): Promise<readonly Product[]> {
  const output: Product[] = []
  for (let page = 1; ; page += 1) {
    const rows = z.array(ProductSchema).parse(await ky.get(`${client.baseUrl}/wp-json/wc/v3/products`, {
      headers: client.headers,
      searchParams: { status: "publish", per_page: "100", page: String(page) },
      timeout: 60_000,
      retry: { limit: 1 },
    }).json())
    output.push(...rows)
    if (rows.length < 100) break
  }
  return output
}

async function fetchVariations(client: ReturnType<typeof wooClient>, productId: number): Promise<readonly Variation[]> {
  return z.array(VariationSchema).parse(await ky.get(
    `${client.baseUrl}/wp-json/wc/v3/products/${productId}/variations`,
    { headers: client.headers, searchParams: { status: "any", per_page: "100" }, timeout: 60_000 },
  ).json())
}

function hasMissingImageMetadata(product: Product): boolean {
  const image = product.images[0]
  return image === undefined || image.id === PLACEHOLDER_IMAGE_ID || !(image.src ?? "").startsWith("http")
}

async function auditProductImages(products: readonly Product[]): Promise<ImageAudit> {
  const brokenProductIds = new Set(
    products.filter(hasMissingImageMetadata).map((product) => product.id),
  )
  const duplicateAttachmentGroups = duplicateFingerprintGroups(
    products
      .filter((product) => !hasMissingImageMetadata(product))
      .map((product) => ({ productId: product.id, fingerprint: String(product.images[0]?.id ?? "") })),
  )
  for (const group of duplicateAttachmentGroups) for (const productId of group) brokenProductIds.add(productId)

  const hashes: { productId: number; fingerprint: string }[] = []
  const downloadFailures: { productId: number; issue: string }[] = []
  const downloadable = products.filter((product) => !hasMissingImageMetadata(product))
  const cache = new Map<string, Promise<Uint8Array>>()
  for (let offset = 0; offset < downloadable.length; offset += 8) {
    await Promise.all(downloadable.slice(offset, offset + 8).map(async (product) => {
      const url = product.images[0]?.src ?? ""
      try {
        const pending = cache.get(url) ?? downloadImage(url)
        cache.set(url, pending)
        hashes.push({ productId: product.id, fingerprint: sha256(await pending) })
      } catch (error) {
        brokenProductIds.add(product.id)
        downloadFailures.push({ productId: product.id, issue: message(error) })
      }
    }))
  }
  const duplicateContentGroups = duplicateFingerprintGroups(hashes)
  for (const group of duplicateContentGroups) for (const productId of group) brokenProductIds.add(productId)
  return { brokenProductIds, duplicateAttachmentGroups, duplicateContentGroups, downloadFailures }
}

async function walldoThumbnail(sourceProductId: string): Promise<string> {
  const html = await fetchWalldob2bDetailHtml(sourceProductId, {
    username: env("WALLDOB2B_USERNAME"),
    password: env("WALLDOB2B_PASSWORD"),
  })
  const url = extractWalldob2bThumbnail(html, sourceProductId)
  if (url === null) throw new Error("walldob2b representative image not found")
  return url
}

async function downloadImage(url: string): Promise<Uint8Array> {
  const response = await ky.get(url, { timeout: 60_000, retry: { limit: 2 }, throwHttpErrors: false })
  const contentType = response.headers.get("content-type") ?? ""
  if (response.status >= 400 || !contentType.startsWith("image/")) {
    throw new Error(`image download rejected: status=${response.status} type=${contentType}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length < 1_024) throw new Error(`image download too small: ${bytes.length}`)
  return bytes
}

async function writeTemporaryImage(row: Prepared): Promise<string> {
  const dir = "/tmp/wholesalehub-thumbnail-repair"
  await mkdir(dir, { recursive: true })
  const extension = extensionOf(row.sourceUrl)
  const path = join(dir, `product-${row.product.id}.${extension}`)
  await writeFile(path, row.bytes)
  return path
}

async function importAttachment(localPath: string, product: Product): Promise<number> {
  const extension = localPath.slice(localPath.lastIndexOf("."))
  const containerPath = `/tmp/wholesalehub-thumbnail-${product.id}-${Date.now()}${extension}`
  await execFileAsync("docker", ["cp", localPath, `avocadoss-wp:${containerPath}`])
  try {
    const { stdout } = await execFileAsync("docker", [
      "exec", "avocadoss-wp", "wp", "media", "import", containerPath,
      "--porcelain", "--allow-root", `--title=${product.name}`,
    ])
    const id = Number.parseInt(stdout.trim(), 10)
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("media import returned invalid id")
    return id
  } finally {
    await execFileAsync("docker", ["exec", "avocadoss-wp", "rm", "-f", containerPath]).catch(() => undefined)
  }
}

function variationSupplierId(variation: Variation): string {
  return meta(variation.meta_data, "_wholesalehub_selected_supplier_id") || meta(variation.meta_data, "_supplier_id")
}

function variationSourceProductId(variation: Variation): string {
  return meta(variation.meta_data, "_wholesalehub_source_product_id") || meta(variation.meta_data, "_source_product_id")
}

function meta(rows: readonly { key: string; value: unknown }[], key: string): string {
  const value = rows.find((row) => row.key === key)?.value
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : ""
}

function entry(product: Product, status: string, issue: string, row?: Prepared, attachmentId?: number) {
  return {
    product_id: product.id,
    product_name: product.name,
    previous_image_id: product.images[0]?.id ?? 0,
    source_product_id: row?.sourceProductId ?? "",
    source_image_url: row?.sourceUrl ?? "",
    image_sha256: row?.hash ?? "",
    attachment_id: attachmentId ?? 0,
    status,
    issue,
  }
}

function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) grouped.set(keyOf(row), [...(grouped.get(keyOf(row)) ?? []), row])
  return grouped
}

function unique(values: readonly string[]): string[] { return [...new Set(values)] }
function extensionOf(url: string): string { return /\.png(?:$|\?)/iu.test(url) ? "png" : /\.webp(?:$|\?)/iu.test(url) ? "webp" : "jpg" }
function valueAfter(flag: string): string { const index = process.argv.indexOf(flag); return index < 0 ? "" : process.argv[index + 1] ?? "" }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function wooClient() {
  const token = Buffer.from(`${env("WOOCOMMERCE_CONSUMER_KEY")}:${env("WOOCOMMERCE_CONSUMER_SECRET")}`).toString("base64")
  return { baseUrl: env("WOOCOMMERCE_BASE_URL").replace(/\/$/u, ""), headers: { Authorization: `Basic ${token}` } }
}

async function loadDotEnv(): Promise<void> {
  const text = await readFile(".env", "utf8")
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line)
    if (match?.[1] !== undefined && process.env[match[1]] === undefined) process.env[match[1]] = match[2] ?? ""
  }
}

function env(key: string): string {
  const value = process.env[key]?.trim() ?? ""
  if (value.length === 0) throw new Error(`missing environment variable: ${key}`)
  return value
}

async function run(): Promise<void> {
  await acquireLock()
  try {
    await main()
  } finally {
    await unlink(LOCK_PATH).catch(() => undefined)
  }
}

async function acquireLock(): Promise<void> {
  await mkdir("reports", { recursive: true })
  try {
    const existing = Number.parseInt((await readFile(LOCK_PATH, "utf8")).trim(), 10)
    if (Number.isSafeInteger(existing) && existing > 0) {
      try {
        process.kill(existing, 0)
        throw new Error(`thumbnail repair already running: pid=${existing}`)
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("thumbnail repair already")) throw error
      }
    }
    await unlink(LOCK_PATH).catch(() => undefined)
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
  const handle = await open(LOCK_PATH, "wx")
  await handle.writeFile(`${process.pid}\n`)
  await handle.close()
}

run().catch((error: unknown) => { console.error(message(error)); process.exitCode = 1 })
