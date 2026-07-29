import { describe, expect, it } from "vitest"
import {
  coreProductName,
  duplicateFingerprintGroups,
  extractProductDetailImage,
  extractProductImageCandidates,
  extractWalldob2bThumbnail,
  normalizeProductName,
  selectSourceThumbnail,
  snapshotCandidates,
  validateSourceImageCandidates,
} from "../src/reports/product-thumbnail-integrity.js"

describe("product thumbnail integrity", () => {
  it("selects the 500px Walldo product image, not a logo or tiny thumbnail", () => {
    const html = `
      <img src="/data/common/logo.svg">
      <img src="https://walldob2b.com/data/item/123/thumb-main_80x80.jpg">
      <img src="https://walldob2b.com/data/item/123/thumb-main_500x500.jpg">
    `
    expect(extractWalldob2bThumbnail(html, "123")).toBe(
      "https://walldob2b.com/data/item/123/thumb-main_500x500.jpg",
    )
  })

  it("matches only one exact supplier product and rejects ambiguous names", () => {
    const candidates = [
      {
        supplierId: "dailyfood",
        sourceProductId: "1",
        productName: "사과",
        imageUrl: "https://x/1.jpg",
      },
      {
        supplierId: "dailyfood",
        sourceProductId: "2",
        productName: "사과",
        imageUrl: "https://x/2.jpg",
      },
    ]
    expect(
      selectSourceThumbnail({
        supplierId: "dailyfood",
        sourceProductId: "1",
        productName: "사과",
        candidates,
      })?.imageUrl,
    ).toBe("https://x/1.jpg")
    expect(
      selectSourceThumbnail({
        supplierId: "dailyfood",
        sourceProductId: "",
        productName: "사과",
        candidates,
      }),
    ).toBeNull()
  })

  it("extracts source ids and image urls from saved crawl rows", () => {
    const rows = snapshotCandidates([
      {
        supplierId: "dailyfood",
        originalProductName: "  사과  ",
        rawJson: JSON.stringify({ sourceProductId: "P1", imageUrl: "https://x/p1.jpg" }),
      } as never,
    ])
    expect(rows).toEqual([
      {
        supplierId: "dailyfood",
        sourceProductId: "P1",
        productName: "  사과  ",
        imageUrl: "https://x/p1.jpg",
      },
    ])
    expect(normalizeProductName(rows[0]?.productName ?? "")).toBe("사과")
  })

  it("allows only a unique core-name match when schedule and promotion text changed", () => {
    const candidates = [
      {
        supplierId: "dailyfood",
        sourceProductId: "1",
        productName: "★초특가 청사과 (7월 20일 예약발송)",
        imageUrl: "https://x/1.jpg",
      },
      {
        supplierId: "walldob2b",
        sourceProductId: "2",
        productName: "[5월말~6월초 첫출고] 홍감자",
        imageUrl: "",
      },
    ]
    expect(coreProductName("★초특가 홍감자★")).toBe("홍감자")
    expect(
      selectSourceThumbnail({
        supplierId: "dailyfood",
        sourceProductId: "",
        productName: "★초특가 청사과",
        candidates,
      })?.sourceProductId,
    ).toBe("1")
    expect(
      selectSourceThumbnail({
        supplierId: "dailyfood",
        sourceProductId: "",
        productName: "★초특가 홍감자★",
        candidates,
      })?.sourceProductId,
    ).toBe("2")
  })

  it("finds products that share an attachment or identical downloaded bytes", () => {
    expect(
      duplicateFingerprintGroups([
        { productId: 3, fingerprint: "same" },
        { productId: 1, fingerprint: "same" },
        { productId: 2, fingerprint: "different" },
        { productId: 1, fingerprint: "same" },
      ]),
    ).toEqual([[1, 3]])
  })

  it("extracts detail image following the 5-priority rule hierarchy", () => {
    const htmlWithMain = `<img id="objImg" src="/data/item/100/main.jpg"> <meta property="og:image" content="/data/item/100/og.jpg">`
    expect(extractProductDetailImage(htmlWithMain, "https://dailyfood.adminplus.co.kr")).toBe(
      "https://dailyfood.adminplus.co.kr/data/item/100/main.jpg",
    )

    const htmlWithJsonLd = `<script type="application/ld+json">{"@type": "Product", "image": "https://example.com/jsonld.jpg"}</script>`
    expect(extractProductDetailImage(htmlWithJsonLd, "https://example.com")).toBe(
      "https://example.com/jsonld.jpg",
    )

    const htmlWithOg = `<meta property="og:image" content="//example.com/og_image.jpg">`
    expect(extractProductDetailImage(htmlWithOg, "https://example.com")).toBe(
      "https://example.com/og_image.jpg",
    )

    const htmlWithGallery = `<div class="gallery"><img src="/images/gallery1.png"></div>`
    expect(extractProductDetailImage(htmlWithGallery, "https://example.com")).toBe(
      "https://example.com/images/gallery1.png",
    )

    expect(
      extractProductDetailImage(
        "<div>no images</div>",
        "https://example.com",
        "https://example.com/thumb.jpg",
      ),
    ).toBe("https://example.com/thumb.jpg")
  })

  it("orders main, JSON-LD, og, gallery, and list candidates", () => {
    const html = `
      <img class="gallery" src="/gallery.jpg">
      <meta property="og:image" content="/og.jpg">
      <script type="application/ld+json">{"@type":"Product","image":["/json.jpg"]}</script>
      <img id="objImg" src="/main.jpg">
    `
    expect(
      extractProductImageCandidates(
        html,
        "https://walldob2b.com",
        "https://walldob2b.com/list.jpg",
      ),
    ).toEqual([
      "https://walldob2b.com/main.jpg",
      "https://walldob2b.com/json.jpg",
      "https://walldob2b.com/og.jpg",
      "https://walldob2b.com/gallery.jpg",
      "https://walldob2b.com/list.jpg",
    ])
  })

  it("records dimensions and hash only for a validated 300px image", async () => {
    const bytes = new Uint8Array(24)
    bytes.set([0x89, 0x50, 0x4e, 0x47], 0)
    bytes.set([0, 0, 1, 44, 0, 0, 1, 44], 16)
    const result = await validateSourceImageCandidates(
      ["https://walldob2b.com/data/item/1/main.png"],
      {
        sourceType: "walldob2b_actual_product",
        expectedHosts: ["walldob2b.com"],
        fetchImpl: async () =>
          new Response(bytes, {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
      },
    )
    expect(result.image_validation_status).toBe("valid")
    expect(result.image_width).toBe(300)
    expect(result.image_height).toBe(300)
    expect(result.image_content_hash).toHaveLength(64)
  })

  it("rejects AdminPlus common and undersized images", async () => {
    const bytes = new Uint8Array(24)
    bytes.set([0x89, 0x50, 0x4e, 0x47], 0)
    bytes.set([0, 0, 0, 100, 0, 0, 0, 100], 16)
    const result = await validateSourceImageCandidates(
      [
        "https://dailyfood.adminplus.co.kr/data/common/adminplus-basket.png",
        "https://cdn.yourlove.co.kr/products/small.png",
      ],
      {
        sourceType: "dailyfood_actual_product",
        expectedHosts: ["dailyfood.adminplus.co.kr", "cdn.yourlove.co.kr"],
        fetchImpl: async () =>
          new Response(bytes, {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
      },
    )
    expect(result.image_validation_status).toBe("failed")
    expect(result.source_image_url).toBe("")
  })
})
