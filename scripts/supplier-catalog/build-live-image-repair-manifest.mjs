import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readdir, readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"

const OUTPUT_PATH = "reports/rebuild/live-product-image-repair-manifest.json"
const BACKUP_SQL_PATH = "backups/20260715-identity-integrity/database-before.sql"
const PLACEHOLDER_ID = 2905
const ALLOWED_IMAGE_HOSTS = new Set(["cdn.yourlove.co.kr", "walldob2b.com"])

const live = readLiveState()
if (live.products.length !== 141 || live.links.length !== 142) {
  throw new Error(`unexpected live target scope: products=${live.products.length} links=${live.links.length}`)
}
if (live.products.some((product) => product.thumbnail_id !== PLACEHOLDER_ID)) {
  throw new Error("live target scope contains a product that no longer uses the expected placeholder")
}

const candidates = new Map()
await addDailySnapshotCandidates(candidates)
await addHistoricalDailyCandidates(candidates)
await addWalldoBackupCandidates(candidates, live.links)
addCurrentMediaCandidates(candidates, live.media_sources)
const detailCandidates = await readDetailCandidates()

const placeholder = await inspectUrl(live.placeholder_url)
if (!placeholder.ok) throw new Error(`cannot fingerprint live placeholder: ${placeholder.issue}`)

const uniqueUrls = [
  ...new Set(
    [...candidates.values()]
      .flat()
      .map((candidate) => candidate.url)
      .filter((url) => isAllowedUrl(url)),
  ),
]
const inspected = new Map()
for (let offset = 0; offset < uniqueUrls.length; offset += 8) {
  const batch = uniqueUrls.slice(offset, offset + 8)
  const rows = await Promise.all(batch.map(async (url) => [url, await inspectUrl(url)]))
  for (const [url, result] of rows) inspected.set(url, result)
}

const linksByParent = groupBy(live.links, (row) => String(row.woo_parent_id))
const products = []
for (const product of live.products) {
  const links = linksByParent.get(String(product.id)) ?? []
  const usable = []
  for (const link of links) {
    const key = sourceKey(link.supplier_id, link.source_product_id)
    for (const candidate of candidates.get(key) ?? []) {
      const image = inspected.get(candidate.url)
      if (!image?.ok || image.hash === placeholder.hash || isFallbackUrl(candidate.url)) continue
      usable.push({ ...candidate, ...image, supplier_id: link.supplier_id, source_product_id: link.source_product_id })
    }
  }
  const selected = selectRepresentative(usable, links.length > 1)
  if (!selected) {
    products.push({
      product_id: product.id,
      product_name: product.name,
      product_url: product.url,
      expected_previous_thumbnail_id: product.thumbnail_id,
      links,
      status: "failed",
      issue: "no validated supplier representative image URL in allowed local sources",
      gallery_urls: [],
    })
    continue
  }

  const galleryPool = []
  for (const link of links) {
    const key = sourceKey(link.supplier_id, link.source_product_id)
    for (const candidate of detailCandidates.get(key) ?? []) {
      if (!isAllowedUrl(candidate.url)) continue
      const image = inspected.get(candidate.url) ?? (await inspectUrl(candidate.url))
      inspected.set(candidate.url, image)
      if (!image.ok || image.hash === placeholder.hash || image.hash === selected.hash) continue
      galleryPool.push({ ...candidate, ...image })
    }
  }
  if (links.length > 1) {
    for (const candidate of usable) {
      if (candidate.hash !== selected.hash) galleryPool.push(candidate)
    }
  }

  products.push({
    product_id: product.id,
    product_name: product.name,
    product_url: product.url,
    expected_previous_thumbnail_id: product.thumbnail_id,
    links,
    status: "prepared",
    featured_url: selected.url,
    featured_sha256: selected.hash,
    featured_width: selected.width,
    featured_height: selected.height,
    featured_bytes: selected.bytes,
    source_kind: selected.kind,
    source_supplier_id: selected.supplier_id,
    source_product_id: selected.source_product_id,
    gallery_urls: uniqueBy(galleryPool, (row) => row.hash)
      .slice(0, 2)
      .map((row) => row.url),
  })
}

const prepared = products.filter((product) => product.status === "prepared")
const failures = products.filter((product) => product.status === "failed")
const manifest = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  target_site: "https://hub.avocadoss.co.kr",
  placeholder_attachment_id: PLACEHOLDER_ID,
  checkpoint_option: "wholesalehub_image_repair_checkpoint_20260727T_image_sync",
  result_option: "wholesalehub_image_repair_result_20260727T_image_sync",
  counts: {
    live_products: live.products.length,
    live_links: live.links.length,
    prepared: prepared.length,
    failed: failures.length,
    distinct_featured_urls: new Set(prepared.map((product) => product.featured_url)).size,
    distinct_featured_hashes: new Set(prepared.map((product) => product.featured_sha256)).size,
    gallery_products: prepared.filter((product) => product.gallery_urls.length > 0).length,
  },
  products,
}
await writeFile(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
console.log(JSON.stringify({ output: OUTPUT_PATH, ...manifest.counts, failed_product_ids: failures.map((row) => row.product_id) }))

function readLiveState() {
  const php = String.raw`
global $wpdb;
$links_table = $wpdb->prefix . "supplier_lane_parent_links";
$links = $wpdb->get_results(
    "SELECT woo_parent_id,supplier_id,lane_code,source_product_id
     FROM {$links_table} ORDER BY woo_parent_id,lane_code",
    ARRAY_A
);
$ids = array_map("intval", array_unique(array_column($links, "woo_parent_id")));
$products = [];
foreach ($ids as $id) {
    $product = wc_get_product($id);
    if (!$product) continue;
    $products[] = [
        "id" => $id,
        "name" => $product->get_name(),
        "url" => get_permalink($id),
        "thumbnail_id" => (int) get_post_thumbnail_id($id),
        "gallery" => (string) get_post_meta($id, "_product_image_gallery", true),
    ];
}
$media = $wpdb->get_results(
    "SELECT p.ID attachment_id, pm.meta_value source_url
     FROM {$wpdb->posts} p
     JOIN {$wpdb->postmeta} pm ON pm.post_id=p.ID
     WHERE p.post_type='attachment' AND pm.meta_key='_source_url'
       AND pm.meta_value LIKE '%walldob2b.com/data/item/%'",
    ARRAY_A
);
echo wp_json_encode([
    "links" => $links,
    "products" => $products,
    "media_sources" => $media,
    "placeholder_url" => wp_get_attachment_url(2905),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
`
  return JSON.parse(
    execFileSync(
      "docker",
      ["exec", "avocadoss-wp", "wp", "--allow-root", "--path=/var/www/html", "eval", php],
      { encoding: "utf8", maxBuffer: 20_000_000 },
    ),
  )
}

async function addDailySnapshotCandidates(output) {
  for (const path of [
    "reports/snapshots/dailyfood-latest-success.json",
    "reports/snapshots/dailyfood-latest-attempt.json",
  ]) {
    const parsed = JSON.parse(await readFile(path, "utf8"))
    for (const product of parsed.products ?? []) {
      let raw = {}
      try {
        raw = JSON.parse(product.rawJson ?? "{}")
      } catch {
        raw = {}
      }
      addCandidate(output, "dailyfood", raw.sourceProductId, raw.imageUrl, "daily_snapshot_list", 400)
    }
  }
}

async function addHistoricalDailyCandidates(output) {
  const files = await jsonFiles("reports")
  for (const path of files) {
    if (
      !/dailyfood|daily-pipeline/iu.test(path) ||
      /order|customer|auth|workflow/iu.test(path) ||
      (await stat(path)).size > 30_000_000
    ) {
      continue
    }
    let parsed
    try {
      parsed = JSON.parse(await readFile(path, "utf8"))
    } catch {
      continue
    }
    visit(parsed, (row) => {
      const sourceProductId = row.sourceProductId ?? row.source_product_id
      const imageUrl = row.imageUrl ?? row.image_url
      addCandidate(output, "dailyfood", sourceProductId, imageUrl, "daily_historical_list", 300)
    })
  }
}

async function addWalldoBackupCandidates(output, links) {
  const sql = await readFile(BACKUP_SQL_PATH, "utf8")
  for (const link of links.filter((row) => row.supplier_id === "walldob2b")) {
    const id = escapeRegex(String(link.source_product_id))
    const pattern = new RegExp(
      `https://walldob2b\\.com/data/item/${id}/[^\\x27\\x22\\s\\\\]+`,
      "gu",
    )
    for (const url of new Set(sql.match(pattern) ?? [])) {
      addCandidate(output, "walldob2b", link.source_product_id, url, "walldob2b_backup_main", 450)
    }
  }
}

function addCurrentMediaCandidates(output, rows) {
  for (const row of rows) {
    const match = /^https:\/\/walldob2b\.com\/data\/item\/([^/]+)\//iu.exec(row.source_url)
    if (match?.[1]) {
      addCandidate(output, "walldob2b", match[1], row.source_url, "walldob2b_media_main", 500)
    }
  }
}

async function readDetailCandidates() {
  const output = new Map()
  const parsed = JSON.parse(await readFile("reports/supplier-detail-images.json", "utf8"))
  for (const row of parsed.rows ?? []) {
    for (const url of row.image_urls ?? []) {
      addCandidate(output, row.source, row.source_id, url, "supplier_detail_gallery", 100)
    }
  }
  return output
}

function addCandidate(output, supplierId, sourceProductId, rawUrl, kind, priority) {
  const id = String(sourceProductId ?? "").trim()
  const url = String(rawUrl ?? "").replace(/&amp;/gu, "&").trim()
  if (!id || !isAllowedUrl(url) || isFallbackUrl(url)) return
  const key = sourceKey(supplierId, id)
  const rows = output.get(key) ?? []
  if (!rows.some((row) => row.url === url)) rows.push({ url, kind, priority })
  output.set(key, rows)
}

async function inspectUrl(url) {
  if (!isAllowedUrl(url) && !url.startsWith("https://hub.avocadoss.co.kr/")) {
    return { ok: false, issue: "host is not allowlisted" }
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(45_000), redirect: "follow" })
    const bytes = Buffer.from(await response.arrayBuffer())
    const contentType = response.headers.get("content-type") ?? ""
    if (!response.ok) return { ok: false, issue: `HTTP ${response.status}` }
    if (!contentType.startsWith("image/") && !hasImageMagic(bytes)) {
      return { ok: false, issue: `not an image: ${contentType}` }
    }
    if (bytes.length < 1_024) return { ok: false, issue: `image too small: ${bytes.length}` }
    const dimensions = imageDimensions(bytes)
    return {
      ok: true,
      hash: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      width: dimensions.width,
      height: dimensions.height,
      content_type: contentType,
    }
  } catch (error) {
    return { ok: false, issue: error instanceof Error ? error.message : String(error) }
  }
}

function selectRepresentative(rows, compareQuality) {
  if (rows.length === 0) return null
  return [...rows].sort((left, right) => {
    if (compareQuality) {
      const area = right.width * right.height - left.width * left.height
      if (area !== 0) return area
      if (right.bytes !== left.bytes) return right.bytes - left.bytes
    }
    if (right.priority !== left.priority) return right.priority - left.priority
    const area = right.width * right.height - left.width * left.height
    if (area !== 0) return area
    return right.bytes - left.bytes
  })[0]
}

function imageDimensions(bytes) {
  if (bytes.length >= 24 && bytes.subarray(1, 4).toString("ascii") === "PNG") {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  if (bytes.length >= 10 && bytes.subarray(0, 3).toString("ascii") === "GIF") {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = bytes[offset + 1]
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2
        continue
      }
      const length = bytes.readUInt16BE(offset + 2)
      if (length < 2) break
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) }
      }
      offset += 2 + length
    }
  }
  return { width: 0, height: 0 }
}

function hasImageMagic(bytes) {
  return (
    (bytes[0] === 0xff && bytes[1] === 0xd8) ||
    bytes.subarray(1, 4).toString("ascii") === "PNG" ||
    bytes.subarray(0, 3).toString("ascii") === "GIF" ||
    bytes.subarray(0, 4).toString("ascii") === "RIFF"
  )
}

function isAllowedUrl(raw) {
  try {
    const url = new URL(String(raw ?? ""))
    return url.protocol === "https:" && ALLOWED_IMAGE_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

function isFallbackUrl(url) {
  return /(?:no[_-]?(?:profile|image|photo)|placeholder|default[_-]?image)/iu.test(url)
}

function visit(value, callback, depth = 0) {
  if (depth > 12 || value === null || value === undefined) return
  if (typeof value === "string") {
    if (value.startsWith("{") || value.startsWith("[")) {
      try {
        visit(JSON.parse(value), callback, depth + 1)
      } catch {
        // Ignore non-JSON strings.
      }
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) visit(item, callback, depth + 1)
    return
  }
  if (typeof value !== "object") return
  callback(value)
  for (const item of Object.values(value)) visit(item, callback, depth + 1)
}

async function jsonFiles(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) output.push(...(await jsonFiles(path)))
    else if (entry.isFile() && entry.name.endsWith(".json")) output.push(path)
  }
  return output
}

function groupBy(rows, keyOf) {
  const grouped = new Map()
  for (const row of rows) grouped.set(keyOf(row), [...(grouped.get(keyOf(row)) ?? []), row])
  return grouped
}

function uniqueBy(rows, keyOf) {
  const output = []
  const seen = new Set()
  for (const row of rows) {
    const key = keyOf(row)
    if (!seen.has(key)) {
      seen.add(key)
      output.push(row)
    }
  }
  return output
}

function sourceKey(supplierId, sourceProductId) {
  return `${supplierId}:${sourceProductId}`
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}
