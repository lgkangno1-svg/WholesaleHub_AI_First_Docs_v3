import { createHash } from "node:crypto"
import type { CollectedProduct } from "../domain/product.js"

export const PLACEHOLDER_IMAGE_ID = 2905

export type SourceThumbnail = {
  readonly supplierId: string
  readonly sourceProductId: string
  readonly productName: string
  readonly imageUrl: string
}

export type SourceImageMetadata = {
  readonly source_image_url: string
  readonly source_image_urls: readonly string[]
  readonly image_source_type: string
  readonly image_collected_at: string
  readonly image_validation_status: "valid" | "failed" | "missing"
  readonly image_width: number
  readonly image_height: number
  readonly image_content_hash: string
  readonly image_validation_error?: string
}

type ValidateSourceImageOptions = {
  readonly sourceType: string
  readonly expectedHosts?: readonly string[]
  readonly minimumWidth?: number
  readonly minimumHeight?: number
  readonly fetchImpl?: typeof fetch
}

const FORBIDDEN_IMAGE_PATTERN =
  /(?:adminplus[_-](?:600|common)|no[_-]?(?:image|img|photo)|placeholder|default[_-]?(?:image|img)|logo|banner|icon|spinner|loading|common|basket|button)/iu

export function normalizeProductName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/&amp;/giu, "&")
    .replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
}

export function coreProductName(value: string): string {
  return normalizeProductName(value)
    .replace(/\[[^\]]*\]|\([^)]*\)/gu, " ")
    .replace(/(?:초특가|긴급특가|단독특가|최저가)/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
}

export function snapshotCandidates(
  products: readonly CollectedProduct[],
): readonly SourceThumbnail[] {
  const found = new Map<string, SourceThumbnail>()
  for (const product of products) {
    const raw = safeJson(product.rawJson)
    const sourceProductId = stringValue(raw["sourceProductId"])
    if (sourceProductId.length === 0) continue
    const imageUrl = stringValue(raw["imageUrl"])
    const row = {
      supplierId: product.supplierId,
      sourceProductId,
      productName: product.originalProductName,
      imageUrl,
    }
    found.set(`${row.supplierId}:${row.sourceProductId}`, row)
  }
  return [...found.values()]
}

export function selectSourceThumbnail(input: {
  readonly supplierId: string
  readonly sourceProductId: string
  readonly productName: string
  readonly candidates: readonly SourceThumbnail[]
}): SourceThumbnail | null {
  const supplierRows = input.candidates.filter((row) => row.supplierId === input.supplierId)
  if (input.sourceProductId.length > 0) {
    const exactId = supplierRows.filter((row) => row.sourceProductId === input.sourceProductId)
    return exactId.length === 1 ? (exactId[0] ?? null) : null
  }
  const name = normalizeProductName(input.productName)
  const exactName = supplierRows.filter((row) => normalizeProductName(row.productName) === name)
  if (exactName.length === 1) return exactName[0] ?? null
  const coreName = coreProductName(input.productName)
  const supplierCore = supplierRows.filter((row) => coreProductName(row.productName) === coreName)
  if (supplierCore.length === 1) return supplierCore[0] ?? null
  const globalCore = input.candidates.filter((row) => coreProductName(row.productName) === coreName)
  return globalCore.length === 1 ? (globalCore[0] ?? null) : null
}

export function extractWalldob2bThumbnail(html: string, sourceProductId: string): string | null {
  return (
    extractProductImageCandidates(html, "https://walldob2b.com", null, sourceProductId)[0] ?? null
  )
}

export function extractProductImageCandidates(
  html: string,
  baseUrl: string,
  listThumbnailUrl: string | null = null,
  sourceProductId: string | null = null,
): readonly string[] {
  const ranked: { url: string; priority: number; score: number }[] = []
  const add = (raw: string | undefined, priority: number, score = 0): void => {
    const url = safeProductImageUrl(raw ?? "", baseUrl)
    if (url === null) return
    if (
      sourceProductId !== null &&
      new URL(url).hostname === "walldob2b.com" &&
      !new URL(url).pathname.includes(`/data/item/${sourceProductId}/`)
    ) {
      return
    }
    ranked.push({ url, priority, score })
  }
  for (const match of html.matchAll(/<img\b[^>]*>/giu)) {
    const tag = match[0]
    const src = tag.match(/(?:data-original|data-src|src)=["']([^"']+)/iu)?.[1]
    const isMain =
      /(?:id|class)=["'][^"']*(?:objImg|main_img|product_img|big_img|zoom_img|thumb-main)[^"']*["']/iu.test(
        tag,
      )
    const isGallery =
      /(?:id|class)=["'][^"']*(?:gallery|view_img|detail_img|product_detail)[^"']*["']/iu.test(tag)
    const score = /_500x500\./iu.test(src ?? "") ? 500 : /thumb-/iu.test(src ?? "") ? 100 : 0
    add(src, isMain ? 1 : isGallery ? 4 : 4, score)
  }
  for (const match of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu,
  )) {
    try {
      const values = jsonLdProductImages(JSON.parse(match[1] ?? ""))
      for (const value of values) add(value, 2)
    } catch {}
  }
  const ogPatterns = [
    /<meta\b[^>]*(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)/giu,
    /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image["']/giu,
  ]
  for (const pattern of ogPatterns) {
    for (const match of html.matchAll(pattern)) add(match[1], 3)
  }
  add(listThumbnailUrl ?? undefined, 5)
  ranked.sort((left, right) => left.priority - right.priority || right.score - left.score)
  return [...new Set(ranked.map((candidate) => candidate.url))]
}

export function extractProductDetailImage(
  html: string,
  baseUrl: string,
  listThumbnailUrl: string | null = null,
): string | null {
  return extractProductImageCandidates(html, baseUrl, listThumbnailUrl)[0] ?? null
}

export async function validateSourceImageCandidates(
  candidates: readonly string[],
  options: ValidateSourceImageOptions,
): Promise<SourceImageMetadata> {
  const normalized = [
    ...new Set(
      candidates.flatMap((value) => {
        const url = safeProductImageUrl(value, value)
        return url === null ? [] : [url]
      }),
    ),
  ]
  if (normalized.length === 0) {
    return emptySourceImageMetadata(options.sourceType, "missing", "no image candidate")
  }
  let lastError = "all image candidates failed validation"
  for (const url of normalized) {
    try {
      const parsed = new URL(url)
      if (
        options.expectedHosts !== undefined &&
        !options.expectedHosts
          .map((host) => host.toLowerCase())
          .includes(parsed.hostname.toLowerCase())
      ) {
        lastError = `unexpected image host: ${parsed.hostname}`
        continue
      }
      const response = await (options.fetchImpl ?? fetch)(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      })
      if (response.status !== 200) {
        lastError = `HTTP ${response.status}`
        continue
      }
      const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? ""
      if (!contentType.startsWith("image/")) {
        lastError = `invalid content-type: ${contentType || "missing"}`
        continue
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length === 0 || bytes.length > 25 * 1024 * 1024) {
        lastError = `invalid image byte size: ${bytes.length}`
        continue
      }
      const dimensions = imageDimensions(bytes)
      if (dimensions === null) {
        lastError = "unsupported or corrupt image bytes"
        continue
      }
      const minimumWidth = options.minimumWidth ?? 300
      const minimumHeight = options.minimumHeight ?? 300
      if (dimensions.width < minimumWidth || dimensions.height < minimumHeight) {
        lastError = `image too small: ${dimensions.width}x${dimensions.height}`
        continue
      }
      return {
        source_image_url: url,
        source_image_urls: normalized,
        image_source_type: options.sourceType,
        image_collected_at: new Date().toISOString(),
        image_validation_status: "valid",
        image_width: dimensions.width,
        image_height: dimensions.height,
        image_content_hash: sha256(bytes),
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  return {
    ...emptySourceImageMetadata(options.sourceType, "failed", lastError),
    source_image_urls: normalized,
  }
}

export function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

export function duplicateFingerprintGroups(
  rows: readonly { productId: number; fingerprint: string }[],
): readonly (readonly number[])[] {
  const grouped = new Map<string, Set<number>>()
  for (const row of rows) {
    if (row.fingerprint.length === 0) continue
    const productIds = grouped.get(row.fingerprint) ?? new Set<number>()
    productIds.add(row.productId)
    grouped.set(row.fingerprint, productIds)
  }
  return [...grouped.values()]
    .map((productIds) => [...productIds].sort((left, right) => left - right))
    .filter((productIds) => productIds.length > 1)
    .sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0))
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : ""
}

function safeProductImageUrl(raw: string, baseUrl: string): string | null {
  const value = raw.trim()
  if (value.length === 0 || value.startsWith("data:")) return null
  try {
    const parsed = new URL(value.startsWith("//") ? `https:${value}` : value, baseUrl)
    const pathname = decodeURIComponent(parsed.pathname).toLowerCase()
    if (
      parsed.protocol !== "https:" ||
      FORBIDDEN_IMAGE_PATTERN.test(`${parsed.hostname}${pathname}`)
    ) {
      return null
    }
    if (/_(?:60x60|80x80|100x100|120x120|150x150)\.(?:jpe?g|png|webp|gif)$/iu.test(pathname)) {
      return null
    }
    if (!/\.(?:jpe?g|png|webp)(?:$|[/?#])/iu.test(parsed.toString())) return null
    return parsed.toString()
  } catch {
    return null
  }
}

function jsonLdProductImages(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap(jsonLdProductImages)
  if (value === null || typeof value !== "object") return []
  const record = value as Record<string, unknown>
  const graph = jsonLdProductImages(record["@graph"])
  const type = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]]
  if (!type.includes("Product")) return graph
  const image = record["image"]
  const values = Array.isArray(image) ? image : [image]
  return [
    ...graph,
    ...values.flatMap((item) => {
      if (typeof item === "string") return [item]
      if (item !== null && typeof item === "object") {
        const url = (item as Record<string, unknown>)["url"]
        return typeof url === "string" ? [url] : []
      }
      return []
    }),
  ]
}

function emptySourceImageMetadata(
  sourceType: string,
  status: "failed" | "missing",
  error: string,
): SourceImageMetadata {
  return {
    source_image_url: "",
    source_image_urls: [],
    image_source_type: sourceType,
    image_collected_at: new Date().toISOString(),
    image_validation_status: status,
    image_width: 0,
    image_height: 0,
    image_content_hash: "",
    image_validation_error: error,
  }
}

function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { width: uint32(bytes, 16), height: uint32(bytes, 20) }
  }
  if (bytes.length >= 30 && text(bytes, 0, 4) === "RIFF" && text(bytes, 8, 4) === "WEBP") {
    const kind = text(bytes, 12, 4)
    if (kind === "VP8X") {
      return {
        width: 1 + uint24le(bytes, 24),
        height: 1 + uint24le(bytes, 27),
      }
    }
    if (kind === "VP8L" && bytes.length >= 25) {
      const bits =
        (bytes[21] ?? 0) |
        ((bytes[22] ?? 0) << 8) |
        ((bytes[23] ?? 0) << 16) |
        ((bytes[24] ?? 0) << 24)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = bytes[offset + 1] ?? 0
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2
        continue
      }
      const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)
      if (length < 2 || offset + length + 2 > bytes.length) return null
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)) {
        return {
          height: ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0),
          width: ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0),
        }
      }
      offset += length + 2
    }
  }
  return null
}

function uint32(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  )
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)
}

function text(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length))
}
