import { describe, expect, it } from "vitest"
import {
  findWalldob2bCandidatesFromWooProducts,
  parseWalldob2bDetailHtml,
} from "../src/adapters/walldob2b/walldob2b-adapter.js"

describe("walldob2b read-only adapter", () => {
  it("finds WooCommerce products imported from walldob2b", () => {
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
    ])
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
