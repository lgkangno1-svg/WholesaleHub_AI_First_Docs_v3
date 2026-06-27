import ky from "ky"
import { z } from "zod"
import type { CollectedProduct } from "../../domain/product.js"

const WooProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  meta_data: z.array(z.object({ key: z.string(), value: z.unknown() })).default([]),
})

export type Walldob2bCandidate = {
  readonly wooProductId: number
  readonly productName: string
  readonly itId: string
  readonly sourceUrl: string
}

export type Walldob2bLogin = {
  readonly username: string
  readonly password: string
}

export type Walldob2bWooCommerceOptions = {
  readonly baseUrl: string
  readonly consumerKey: string
  readonly consumerSecret: string
  readonly limit: number
  readonly maxPages?: number
}

const SUPPLIER_ID = "walldob2b"
const BASE_URL = "https://walldob2b.com"

export async function fetchWalldob2bCandidatesFromWooCommerce(
  options: Walldob2bWooCommerceOptions,
): Promise<readonly Walldob2bCandidate[]> {
  const baseUrl = options.baseUrl.replace(/\/$/u, "")
  const headers = {
    Authorization: `Basic ${Buffer.from(`${options.consumerKey}:${options.consumerSecret}`).toString("base64")}`,
  }
  const candidates: Walldob2bCandidate[] = []
  const maxPages = options.maxPages ?? 10
  for (let page = 1; page <= maxPages && candidates.length < options.limit; page += 1) {
    const products = await ky
      .get(`${baseUrl}/wp-json/wc/v3/products`, {
        headers,
        searchParams: { per_page: "100", page: String(page), status: "any" },
        timeout: 30_000,
        retry: { limit: 1 },
      })
      .json()
    const pageCandidates = findWalldob2bCandidatesFromWooProducts(products)
    candidates.push(...pageCandidates)
    if (z.array(WooProductSchema).parse(products).length === 0) {
      break
    }
  }
  return candidates.slice(0, options.limit)
}

export function findWalldob2bCandidatesFromWooProducts(
  products: unknown,
): readonly Walldob2bCandidate[] {
  return z
    .array(WooProductSchema)
    .parse(products)
    .flatMap((product) => {
      const source = findMeta(product.meta_data, "_b2b_source")
      const itId = findMeta(product.meta_data, "_b2b_walldo_it_id")
      return source === SUPPLIER_ID && itId !== null
        ? [
            {
              wooProductId: product.id,
              productName: product.name,
              itId,
              sourceUrl: `${BASE_URL}/shop/item.php?it_id=${encodeURIComponent(itId)}`,
            },
          ]
        : []
    })
}

export async function fetchWalldob2bDetailHtml(
  itId: string,
  login: Walldob2bLogin,
): Promise<string> {
  const cookieJar = new Map<string, string>()
  const response = await ky.post(`${BASE_URL}/bbs/login_check.php`, {
    body: new URLSearchParams({
      mb_id: login.username,
      mb_password: login.password,
      url: `%2Fshop%2Fitem.php%3Fit_id%3D${encodeURIComponent(itId)}`,
    }),
    redirect: "manual",
    throwHttpErrors: false,
    timeout: 30_000,
    retry: { limit: 1 },
  })
  storeCookies(cookieJar, response)
  return ky
    .get(`${BASE_URL}/shop/item.php`, {
      searchParams: { it_id: itId },
      headers: { cookie: [...cookieJar.values()].join("; ") },
      timeout: 30_000,
      retry: { limit: 1 },
    })
    .text()
}

export function parseWalldob2bDetailHtml(
  html: string,
  candidate: Walldob2bCandidate,
): readonly CollectedProduct[] {
  const basePrice = parseBasePrice(html)
  const options = parseOptions(html)
  return options.map((option) => ({
    supplierId: SUPPLIER_ID,
    sourceType: "website",
    originalProductName: candidate.productName,
    originalOptionName: option.name,
    price: basePrice + option.priceDelta,
    shippingFee: 0,
    stockStatus: option.soldOut ? "out_of_stock" : "in_stock",
    productUrl: candidate.sourceUrl,
    rawJson: JSON.stringify({
      wooProductId: candidate.wooProductId,
      walldoItId: candidate.itId,
      basePrice,
      optionPriceDelta: option.priceDelta,
    }),
  }))
}

function parseBasePrice(html: string): number {
  const hiddenPrice = /id=["']it_base_price["'][^>]*value=["']([0-9,]+)["']/iu.exec(html)
  if (hiddenPrice?.[1] !== undefined) {
    return parseMoney(hiddenPrice[1])
  }

  const text = stripTags(html)
  const match = /판매가격\s*([0-9,]+)\s*원/u.exec(text)
  if (match?.[1] === undefined) {
    throw new Error("walldob2b base price not found")
  }
  return parseMoney(match[1])
}

function parseOptions(html: string): readonly {
  readonly name: string
  readonly priceDelta: number
  readonly soldOut: boolean
}[] {
  const matches = [...html.matchAll(/<option([^>]*)>(.*?)<\/option>/gis)]
  return matches
    .map((match) => parseOption(match[1] ?? "", match[2] ?? ""))
    .filter((option) => option !== null)
}

function parseOption(
  attributes: string,
  labelHtml: string,
): {
  readonly name: string
  readonly priceDelta: number
  readonly soldOut: boolean
} | null {
  const label = stripTags(labelHtml)
  if (label.length === 0 || label === "선택") {
    return null
  }

  const value = /value=["']([^"']*)["']/iu.exec(attributes)?.[1] ?? ""
  const [valueName, valueDelta] = value.split(",")
  const optionMatch = /(.+?)\s*\+\s*([0-9,]+)\s*원/u.exec(label)
  const name = valueName?.trim() || optionMatch?.[1]?.trim() || label
  const priceDelta =
    valueDelta === undefined || valueDelta === ""
      ? parseLabelPriceDelta(label)
      : parseMoney(valueDelta)
  return { name, priceDelta, soldOut: /품절|sold\s*out/iu.test(label) }
}

function parseLabelPriceDelta(label: string): number {
  const optionMatch = /\+\s*([0-9,]+)\s*원/u.exec(label)
  return optionMatch?.[1] === undefined ? 0 : parseMoney(optionMatch[1])
}

function findMeta(
  meta: readonly { readonly key: string; readonly value: unknown }[],
  key: string,
): string | null {
  const value = meta.find((item) => item.key === key)?.value
  return typeof value === "string" && value.length > 0 ? value : null
}

function parseMoney(value: string): number {
  return Number.parseInt(value.replace(/[^\d]/gu, ""), 10)
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
}

function storeCookies(cookieJar: Map<string, string>, response: Response): void {
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";")[0]
    const [name, value = ""] = pair?.split("=") ?? []
    if (name !== undefined && name.length > 0 && value.length > 0 && pair !== undefined) {
      cookieJar.set(name, pair)
    }
  }
}
