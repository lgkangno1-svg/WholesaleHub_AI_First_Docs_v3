import { createHash } from "node:crypto"
import type { CollectedProduct } from "../domain/product.js"

export const PLACEHOLDER_IMAGE_ID = 2905

export type SourceThumbnail = {
  readonly supplierId: string
  readonly sourceProductId: string
  readonly productName: string
  readonly imageUrl: string
}

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

export function snapshotCandidates(products: readonly CollectedProduct[]): readonly SourceThumbnail[] {
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
    return exactId.length === 1 ? exactId[0] ?? null : null
  }
  const name = normalizeProductName(input.productName)
  const exactName = supplierRows.filter((row) => normalizeProductName(row.productName) === name)
  if (exactName.length === 1) return exactName[0] ?? null
  const coreName = coreProductName(input.productName)
  const supplierCore = supplierRows.filter((row) => coreProductName(row.productName) === coreName)
  if (supplierCore.length === 1) return supplierCore[0] ?? null
  const globalCore = input.candidates.filter((row) => coreProductName(row.productName) === coreName)
  return globalCore.length === 1 ? globalCore[0] ?? null : null
}

export function extractWalldob2bThumbnail(html: string, sourceProductId: string): string | null {
  const prefix = `/data/item/${sourceProductId}/`
  const candidates: { url: string; score: number }[] = []
  for (const match of html.matchAll(/<img\b[^>]*>/giu)) {
    const tag = match[0]
    const raw = tag.match(/(?:data-original|data-src|src)=["']([^"']+)/iu)?.[1] ?? ""
    if (raw.length === 0) continue
    let url: URL
    try {
      url = new URL(raw, "https://walldob2b.com")
    } catch {
      continue
    }
    if (url.hostname !== "walldob2b.com" || !url.pathname.includes(prefix)) continue
    if (/_(?:60x60|80x80|100x100|120x120|150x150)\.(?:jpe?g|png|webp)$/iu.test(url.pathname)) continue
    if (!/\.(?:jpe?g|png|webp)$/iu.test(url.pathname)) continue
    const score = /_500x500\./iu.test(url.pathname) ? 3 : /thumb-/iu.test(url.pathname) ? 2 : 1
    candidates.push({ url: url.toString(), score })
  }
  candidates.sort((left, right) => right.score - left.score)
  return candidates[0]?.url ?? null
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
