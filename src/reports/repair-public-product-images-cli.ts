import { execFile } from "node:child_process"
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import ky from "ky"
import { z } from "zod"

const PLACEHOLDER_IMAGE_ID = 2905
const PRODUCT_PER_PAGE = 100
const execFileAsync = promisify(execFile)

const ProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  status: z.string(),
  type: z.string(),
  images: z
    .array(
      z.object({
        id: z.number().int().optional().default(0),
        src: z.string().optional().default(""),
      }),
    )
    .default([]),
  meta_data: z.array(z.object({ key: z.string(), value: z.unknown() })).default([]),
})
const VariationSchema = z.object({
  id: z.number().int(),
  regular_price: z.string().default(""),
  sale_price: z.string().default(""),
  stock_status: z.string().default(""),
  attributes: z
    .array(z.object({ name: z.string().default(""), option: z.string().default("") }))
    .default([]),
})
const ProductsSchema = z.array(ProductSchema)
const VariationsSchema = z.array(VariationSchema)

type Product = z.infer<typeof ProductSchema>
type Credentials = { baseUrl: string; consumerKey: string; consumerSecret: string }
type Snapshot = {
  name: string
  status: string
  variations: Array<{ id: number; regular_price: string; stock_status: string; option: string }>
}
type RepairEntry = {
  product_id: number
  product_name: string
  source_image_url: string
  resolved_image_url?: string
  attachment_id?: number
  status: "repaired" | "skipped" | "ignored" | "failed"
  reason?: string
}

type Summary = {
  generatedAt: string
  publicProductCount: number
  ignoredProductCount: number
  brokenBefore: number
  brokenAfter: number
  repaired: number
  skipped: number
  failed: number
  sampleVerified: number
  immutableChanged: boolean
  skipReasons: Record<string, number>
}

async function main() {
  await loadDotEnv()
  const credentials = {
    baseUrl: env("WOOCOMMERCE_BASE_URL"),
    consumerKey: env("WOOCOMMERCE_CONSUMER_KEY"),
    consumerSecret: env("WOOCOMMERCE_CONSUMER_SECRET"),
  }
  const client = woo(credentials)
  const products = await fetchProducts(client)
  const snapshots = await snapshotProducts(client, products)
  const entries: RepairEntry[] = []
  const targets = products.filter((p) => !isIgnored(p))
  const ignored = products.length - targets.length
  const brokenBefore = await countBroken(targets)
  let repaired = 0
  let failed = 0

  for (const product of targets) {
    if (!(await isBroken(product))) continue
    const source = meta(product, "_wholesalehub_source_image_url")
    if (!source) {
      entries.push({
        product_id: product.id,
        product_name: product.name,
        source_image_url: "",
        status: "skipped",
        reason: "missing source image url",
      })
      continue
    }
    try {
      const resolved = await resolveSourceImageUrl(source)
      if (!resolved) {
        entries.push({
          product_id: product.id,
          product_name: product.name,
          source_image_url: source,
          status: "skipped",
          reason: "source image not found",
        })
        continue
      }
      const localPath = await downloadImage(resolved, product.id)
      const attachmentId = await importAttachment(localPath, product)
      await unlink(localPath).catch(() => undefined)
      await ky.put(`${client.baseUrl}/wp-json/wc/v3/products/${product.id}`, {
        headers: client.headers,
        json: { images: [{ id: attachmentId }] },
        timeout: 60000,
        retry: { limit: 0 },
      })
      entries.push({
        product_id: product.id,
        product_name: product.name,
        source_image_url: source,
        resolved_image_url: resolved,
        attachment_id: attachmentId,
        status: "repaired",
      })
      repaired++
    } catch (error) {
      failed++
      entries.push({
        product_id: product.id,
        product_name: product.name,
        source_image_url: source,
        status: "failed",
        reason: message(error),
      })
    }
  }

  const afterProducts = await fetchProducts(client)
  const afterTargets = afterProducts.filter((p) => !isIgnored(p))
  const brokenAfter = await countBroken(afterTargets)
  const sampleVerified = await verifySamples(afterTargets, 20)
  const immutableChanged = await hasImmutableChanges(client, afterProducts, snapshots)
  const skipReasons = entries
    .filter((e) => e.status === "skipped" || e.status === "failed")
    .reduce<Record<string, number>>((acc, e) => {
      const key = e.reason ?? e.status
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {})
  const summary: Summary = {
    generatedAt: new Date().toISOString(),
    publicProductCount: products.length,
    ignoredProductCount: ignored,
    brokenBefore,
    brokenAfter,
    repaired,
    skipped: entries.filter((e) => e.status === "skipped").length,
    failed,
    sampleVerified,
    immutableChanged,
    skipReasons,
  }
  await writeReports(summary, entries)
  console.log(JSON.stringify(summary, null, 2))
  if (immutableChanged) throw new Error("price/name/status/option snapshot changed")
}

async function fetchProducts(client: ReturnType<typeof woo>) {
  const products: Product[] = []
  for (let page = 1; page <= 30; page++) {
    const rows = ProductsSchema.parse(
      await ky
        .get(`${client.baseUrl}/wp-json/wc/v3/products`, {
          headers: client.headers,
          searchParams: { status: "publish", per_page: PRODUCT_PER_PAGE, page: String(page) },
          timeout: 60000,
          retry: { limit: 1 },
        })
        .json(),
    )
    products.push(...rows)
    if (rows.length < PRODUCT_PER_PAGE) break
  }
  return products
}

async function snapshotProducts(client: ReturnType<typeof woo>, products: Product[]) {
  const out = new Map<number, Snapshot>()
  for (const product of products) {
    out.set(product.id, {
      name: product.name,
      status: product.status,
      variations: await fetchVariationSnapshot(client, product),
    })
  }
  return out
}

async function fetchVariationSnapshot(client: ReturnType<typeof woo>, product: Product) {
  if (product.type !== "variable") return []
  const rows = VariationsSchema.parse(
    await ky
      .get(`${client.baseUrl}/wp-json/wc/v3/products/${product.id}/variations`, {
        headers: client.headers,
        searchParams: { status: "any", per_page: "100" },
        timeout: 60000,
        retry: { limit: 1 },
      })
      .json(),
  )
  return rows.map((v) => ({
    id: v.id,
    regular_price: v.regular_price,
    stock_status: v.stock_status,
    option: v.attributes.map((a) => `${a.name}:${a.option}`).join("|"),
  }))
}

async function hasImmutableChanges(
  client: ReturnType<typeof woo>,
  products: Product[],
  before: Map<number, Snapshot>,
) {
  for (const product of products) {
    const b = before.get(product.id)
    if (!b) continue
    if (b.name !== product.name || b.status !== product.status) return true
    const after = await fetchVariationSnapshot(client, product)
    if (JSON.stringify(after) !== JSON.stringify(b.variations)) return true
  }
  return false
}

function isIgnored(product: Product) {
  return product.name.includes("새조개")
}

async function countBroken(products: Product[]) {
  let count = 0
  for (const product of products) if (await isBroken(product)) count++
  return count
}

async function isBroken(product: Product) {
  const first = product.images[0]
  if (!first?.src) return true
  if (first.id === PLACEHOLDER_IMAGE_ID) return true
  return !(await isImageUrl(first.src))
}

async function verifySamples(products: Product[], limit: number) {
  let ok = 0
  for (const product of products.slice(0, limit)) {
    if (product.images[0]?.src && (await isImageUrl(product.images[0].src))) ok++
  }
  return ok
}

async function resolveSourceImageUrl(source: string) {
  if (await isImageUrl(source)) return source
  const driveId = extractDriveId(source)
  if (!driveId) return null
  const fileUrl = await driveFileUrlIfImage(driveId)
  if (fileUrl) return fileUrl
  const imageId = await findDriveImageFileId(driveId, new Set(), 0)
  return imageId ? driveDownloadUrl(imageId) : null
}

async function driveFileUrlIfImage(id: string) {
  const url = driveDownloadUrl(id)
  return (await isImageUrl(url)) ? url : null
}

const driveCache = new Map<string, string | null>()
async function findDriveImageFileId(
  id: string,
  visited: Set<string>,
  depth: number,
): Promise<string | null> {
  if (driveCache.has(id)) return driveCache.get(id) ?? null
  if (visited.has(id) || depth > 3) return null
  visited.add(id)
  const html = await ky
    .get(`https://drive.google.com/drive/folders/${id}`, { timeout: 30000, retry: { limit: 1 } })
    .text()
  const decoded = `${decodeDriveHtml(html)}\n${decodeDriveEscapes(html)}`
  const imageIds = [
    ...decoded.matchAll(
      /\["([A-Za-z0-9_-]{20,})",\[[^\]]*\],"[^"]*","image\/(?:jpeg|jpg|png|webp|gif)"/gu,
    ),
  ]
    .map((m) => m[1])
    .concat(
      [...decoded.matchAll(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{20,})/gu)].map((m) => m[1]),
    )
  for (const imageId of imageIds) {
    if (imageId && (await driveFileUrlIfImage(imageId))) {
      driveCache.set(id, imageId)
      return imageId
    }
  }
  const folderIds = [
    ...decoded.matchAll(
      /\["([A-Za-z0-9_-]{20,})",\[[^\]]*\],"[^"]*","application\/vnd\.google-apps\.folder"/gu,
    ),
  ]
    .map((m) => m[1])
    .concat(
      [...decoded.matchAll(/drive\.google\.com\/drive\/folders\/([A-Za-z0-9_-]{20,})/gu)].map(
        (m) => m[1],
      ),
    )
    .filter((x): x is string => Boolean(x) && x !== id)
  for (const folderId of [...new Set(folderIds)]) {
    const nested = await findDriveImageFileId(folderId, visited, depth + 1)
    if (nested) {
      driveCache.set(id, nested)
      return nested
    }
  }
  driveCache.set(id, null)
  return null
}

function decodeDriveHtml(html: string) {
  const m = /window\['_DRIVE_ivd'\] = '([^']*)'/u.exec(html)
  return decodeDriveEscapes(m?.[1] ?? html)
}

function decodeDriveEscapes(value: string) {
  return value
    .replace(/\\x([0-9A-Fa-f]{2})/gu, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/\\u003d/gu, "=")
    .replace(/\\\//gu, "/")
}
function extractDriveId(source: string) {
  try {
    const url = new URL(source)
    const q = url.searchParams.get("id")
    if (q) return q
  } catch {
    // Fall through to regex extraction.
  }
  return /\/(?:folders|d)\/([A-Za-z0-9_-]{20,})/u.exec(source)?.[1] ?? null
}

function driveDownloadUrl(id: string) {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1000`
}

async function downloadImage(url: string, productId: number) {
  await mkdir("/tmp/wholesalehub-image-repair", { recursive: true })
  const res = await ky.get(url, { timeout: 60000, retry: { limit: 2 }, throwHttpErrors: false })
  const type = res.headers.get("content-type") ?? ""
  if (res.status >= 400 || !type.startsWith("image/"))
    throw new Error(`download failed ${res.status}`)
  const ext = type.includes("png")
    ? "png"
    : type.includes("webp")
      ? "webp"
      : type.includes("gif")
        ? "gif"
        : "jpg"
  const path = join("/tmp/wholesalehub-image-repair", `product-${productId}.${ext}`)
  await writeFile(path, Buffer.from(await res.arrayBuffer()))
  return path
}

async function importAttachment(localPath: string, product: Product) {
  const containerPath = `/tmp/wholesalehub-image-repair-${product.id}${localPath.slice(localPath.lastIndexOf("."))}`
  await execFileAsync("docker", ["cp", localPath, `avocadoss-wp:${containerPath}`])
  const { stdout } = await execFileAsync("docker", [
    "exec",
    "avocadoss-wp",
    "wp",
    "media",
    "import",
    containerPath,
    "--porcelain",
    "--allow-root",
    `--title=${product.name}`,
  ])
  await execFileAsync("docker", ["exec", "avocadoss-wp", "rm", "-f", containerPath]).catch(
    () => undefined,
  )
  const id = Number.parseInt(stdout.trim(), 10)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("media import failed")
  return id
}

async function isImageUrl(url: string) {
  try {
    const res = await ky.get(url, { timeout: 15000, retry: { limit: 1 }, throwHttpErrors: false })
    return res.status < 400 && (res.headers.get("content-type") ?? "").startsWith("image/")
  } catch {
    return false
  }
}

function meta(product: Product, key: string) {
  const value = product.meta_data.find((m) => m.key === key)?.value
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

async function writeReports(summary: Summary, entries: RepairEntry[]) {
  await mkdir("reports", { recursive: true })
  await writeFile(
    "reports/product-image-repair-report.json",
    `${JSON.stringify({ summary, entries }, null, 2)}\n`,
  )
  const reasons = Object.entries(summary.skipReasons)
    .map(([reason, count]) => `  - ${reason}: ${count}`)
    .join("\n")
  await writeFile(
    "reports/product-image-repair-summary.md",
    `# Product Image Repair Summary\n\n- public_products: ${summary.publicProductCount}\n- ignored_products: ${summary.ignoredProductCount}\n- broken_before: ${summary.brokenBefore}\n- broken_after: ${summary.brokenAfter}\n- repaired: ${summary.repaired}\n- skipped: ${summary.skipped}\n- failed: ${summary.failed}\n- sample_verified: ${summary.sampleVerified}\n- price_option_name_status_changed: ${summary.immutableChanged}\n- skip_reasons:\n${reasons || "  - none: 0"}\n`,
  )
}

function woo(c: Credentials) {
  return {
    baseUrl: c.baseUrl.replace(/\/$/u, ""),
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.consumerKey}:${c.consumerSecret}`).toString("base64")}`,
    },
  }
}

async function loadDotEnv() {
  try {
    const text = await readFile(".env", "utf8")
    for (const line of text.split(/\r?\n/u)) {
      const m = /^([A-Z0-9_]+)=(.*)$/u.exec(line)
      if (m?.[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? ""
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
}

function env(key: string) {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`${key} is required`)
  return value
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

main().catch((error) => {
  console.error(message(error))
  process.exitCode = 1
})
