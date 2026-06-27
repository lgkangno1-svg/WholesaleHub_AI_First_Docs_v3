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

const SUPPLIER_ID = "walldob2b"
const BASE_URL = "https://walldob2b.com"

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
  await ky.post(`${BASE_URL}/bbs/login_check.php`, {
    body: new URLSearchParams({
      mb_id: login.username,
      mb_password: login.password,
      url: BASE_URL,
    }),
    hooks: { afterResponse: [(_request, _options, response) => storeCookies(cookieJar, response)] },
    timeout: 30_000,
    retry: { limit: 1 },
  })
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
    stockStatus: option.soldOut ? "out_of_stock" : "unknown",
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
  const matches = [...html.matchAll(/<option[^>]*>(.*?)<\/option>/gis)]
  return matches
    .map((match) => stripTags(match[1] ?? ""))
    .filter((value) => value.length > 0 && value !== "선택")
    .map((value) => {
      const optionMatch = /(.+?)\s*\+\s*([0-9,]+)\s*원/u.exec(value)
      const name = optionMatch?.[1]?.trim() ?? value
      const priceDelta = optionMatch?.[2] === undefined ? 0 : parseMoney(optionMatch[2])
      return { name, priceDelta, soldOut: /품절|sold\s*out/iu.test(value) }
    })
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
    if (pair !== undefined) {
      cookieJar.set(pair.split("=")[0] ?? pair, pair)
    }
  }
}
