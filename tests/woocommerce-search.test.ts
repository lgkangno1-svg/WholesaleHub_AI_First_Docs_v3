import { createServer } from "node:http"
import { describe, expect, it } from "vitest"
import { searchWooCommerceProducts } from "../src/woocommerce/search.js"

describe("searchWooCommerceProducts", () => {
  it("uses only WooCommerce GET endpoints and includes variation candidates", async () => {
    // Given
    const requestedMethods: string[] = []
    const server = createServer((request, response) => {
      requestedMethods.push(request.method ?? "")
      response.writeHead(200, { "content-type": "application/json" })
      response.end(
        JSON.stringify(
          request.url?.startsWith("/wp-json/wc/v3/products/10/variations") === true
            ? [VARIATION_RESPONSE]
            : [PRODUCT_RESPONSE],
        ),
      )
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (address === null || typeof address === "string") {
      server.close()
      throw new TypeError("HTTP test server did not expose a TCP address")
    }

    // When
    const results = await searchWooCommerceProducts({
      baseUrl: `http://127.0.0.1:${address.port}`,
      consumerKey: "ck_test",
      consumerSecret: "cs_test",
      query: "성주참외",
    }).finally(() => server.close())

    // Then
    expect(requestedMethods).toEqual(["GET", "GET"])
    expect(results[0]?.product_id).toBe(10)
    expect(results[0]?.variations[0]?.variation_id).toBe(101)
  })
})

const PRODUCT_RESPONSE = {
  id: 10,
  name: "성주참외",
  sku: "melon",
  status: "publish",
  type: "variable",
  price: "23800",
  stock_status: "instock",
  permalink: "https://shop.example/p/melon",
} as const

const VARIATION_RESPONSE = {
  id: 101,
  sku: "melon-10kg",
  price: "23800",
  stock_status: "instock",
  permalink: "https://shop.example/p/melon?v=101",
} as const
