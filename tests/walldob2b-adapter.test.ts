import { createServer } from "node:http"
import { describe, expect, it } from "vitest"
import {
  fetchWalldob2bCandidatesFromWooCommerce,
  findWalldob2bCandidatesFromWooProducts,
  parseWalldob2bDetailHtml,
} from "../src/adapters/walldob2b/walldob2b-adapter.js"
import { findWalldob2bCandidatesFromWordPressRows } from "../src/adapters/walldob2b/wordpress-db-candidates.js"

describe("walldob2b read-only adapter", () => {
  it("finds WooCommerce products imported from walldob2b meta and source links", () => {
    // Given
    const products = [
      {
        id: 1158,
        name: "태국 항공직송 생 망고스틴",
        meta_data: [
          { key: "_b2b_source", value: "walldob2b" },
          { key: "_b2b_walldo_it_id", value: "JW000038" },
        ],
      },
      {
        id: 1140,
        name: "[5월말~6월초 첫출고] 홍감자",
        description: "<p>원문 링크: https://walldob2b.com/shop/item.php?it_id=1768387832</p>",
        short_description: "",
        meta_data: [],
      },
    ]

    // When
    const candidates = findWalldob2bCandidatesFromWooProducts(products)

    // Then
    expect(candidates).toEqual([
      {
        wooProductId: 1158,
        productName: "태국 항공직송 생 망고스틴",
        itId: "JW000038",
        sourceUrl: "https://walldob2b.com/shop/item.php?it_id=JW000038",
      },
      {
        wooProductId: 1140,
        productName: "[5월말~6월초 첫출고] 홍감자",
        itId: "1768387832",
        sourceUrl: "https://walldob2b.com/shop/item.php?it_id=1768387832",
      },
    ])
  })

  it("fetches walldob2b candidates from WooCommerce using GET and limit", async () => {
    // Given
    const requestedMethods: string[] = []
    const server = createServer((request, response) => {
      requestedMethods.push(request.method ?? "")
      response.writeHead(200, { "content-type": "application/json" })
      response.end(
        JSON.stringify([WALLDOB_WOO_PRODUCT, WALLDOB_LINKED_PRODUCT, NON_WALLDOB_WOO_PRODUCT]),
      )
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (address === null || typeof address === "string") {
      server.close()
      throw new TypeError("HTTP test server did not expose a TCP address")
    }

    // When
    const candidates = await fetchWalldob2bCandidatesFromWooCommerce({
      baseUrl: `http://127.0.0.1:${address.port}`,
      consumerKey: "ck_test",
      consumerSecret: "cs_test",
      limit: 2,
      maxPages: 1,
    }).finally(() => server.close())

    // Then
    expect(requestedMethods).toEqual(["GET"])
    expect(candidates).toHaveLength(2)
    expect(candidates[0]?.itId).toBe("JW000038")
  })

  it("finds walldob2b candidates from WordPress DB rows", () => {
    // Given
    const rows = [
      {
        productId: 314,
        productName: "무지개망고",
        location: "post_content",
        value: '<a href="https://walldob2b.com/shop/item.php?it_id=manbae_1775904375">원문</a>',
      },
      {
        productId: 314,
        productName: "무지개망고",
        location: "postmeta:_b2b_walldo_it_id",
        value: "manbae_1775904375",
      },
    ]

    // When
    const candidates = findWalldob2bCandidatesFromWordPressRows(rows)

    // Then
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      wooProductId: 314,
      productName: "무지개망고",
      itId: "manbae_1775904375",
    })
  })

  it("parses base price plus option delta as raw product supply price", () => {
    // Given
    const html = `
      <div>판매가격 7,500원</div>
      <select>
        <option>선택</option>
        <option>망고스틴500g&nbsp;&nbsp;+ 0원</option>
        <option>망고스틴5kg(500g*10망)&nbsp;&nbsp;+ 38,500원</option>
      </select>
    `

    // When
    const rows = parseWalldob2bDetailHtml(html, {
      wooProductId: 1158,
      productName: "태국 항공직송 생 망고스틴",
      itId: "JW000038",
      sourceUrl: "https://walldob2b.com/shop/item.php?it_id=JW000038",
    })

    // Then
    expect(rows[1]).toMatchObject({
      supplierId: "walldob2b",
      sourceType: "website",
      originalProductName: "태국 항공직송 생 망고스틴",
      originalOptionName: "망고스틴5kg(500g*10망)",
      price: 46_000,
      stockStatus: "in_stock",
      productUrl: "https://walldob2b.com/shop/item.php?it_id=JW000038",
    })
  })
})

const WALLDOB_WOO_PRODUCT = {
  id: 1158,
  name: "태국 항공직송 생 망고스틴",
  meta_data: [
    { key: "_b2b_source", value: "walldob2b" },
    { key: "_b2b_walldo_it_id", value: "JW000038" },
  ],
} as const

const WALLDOB_LINKED_PRODUCT = {
  id: 1140,
  name: "[5월말~6월초 첫출고] 홍감자",
  description: '<a href="https://walldob2b.com/shop/item.php?it_id=1768387832">원문</a>',
  short_description: "",
  meta_data: [],
} as const

const NON_WALLDOB_WOO_PRODUCT = {
  id: 2000,
  name: "일반 상품",
  meta_data: [{ key: "_b2b_source", value: "dailyfood" }],
} as const
