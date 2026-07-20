import { describe, expect, it } from "vitest"
import {
  extractWalldob2bThumbnail,
  coreProductName,
  duplicateFingerprintGroups,
  normalizeProductName,
  selectSourceThumbnail,
  snapshotCandidates,
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
      { supplierId: "dailyfood", sourceProductId: "1", productName: "사과", imageUrl: "https://x/1.jpg" },
      { supplierId: "dailyfood", sourceProductId: "2", productName: "사과", imageUrl: "https://x/2.jpg" },
    ]
    expect(selectSourceThumbnail({ supplierId: "dailyfood", sourceProductId: "1", productName: "사과", candidates })?.imageUrl).toBe("https://x/1.jpg")
    expect(selectSourceThumbnail({ supplierId: "dailyfood", sourceProductId: "", productName: "사과", candidates })).toBeNull()
  })

  it("extracts source ids and image urls from saved crawl rows", () => {
    const rows = snapshotCandidates([{ supplierId: "dailyfood", originalProductName: "  사과  ", rawJson: JSON.stringify({ sourceProductId: "P1", imageUrl: "https://x/p1.jpg" }) } as never])
    expect(rows).toEqual([{ supplierId: "dailyfood", sourceProductId: "P1", productName: "  사과  ", imageUrl: "https://x/p1.jpg" }])
    expect(normalizeProductName(rows[0]?.productName ?? "")).toBe("사과")
  })

  it("allows only a unique core-name match when schedule and promotion text changed", () => {
    const candidates = [
      { supplierId: "dailyfood", sourceProductId: "1", productName: "★초특가 청사과 (7월 20일 예약발송)", imageUrl: "https://x/1.jpg" },
      { supplierId: "walldob2b", sourceProductId: "2", productName: "[5월말~6월초 첫출고] 홍감자", imageUrl: "" },
    ]
    expect(coreProductName("★초특가 홍감자★")).toBe("홍감자")
    expect(selectSourceThumbnail({ supplierId: "dailyfood", sourceProductId: "", productName: "★초특가 청사과", candidates })?.sourceProductId).toBe("1")
    expect(selectSourceThumbnail({ supplierId: "dailyfood", sourceProductId: "", productName: "★초특가 홍감자★", candidates })?.sourceProductId).toBe("2")
  })

  it("finds products that share an attachment or identical downloaded bytes", () => {
    expect(duplicateFingerprintGroups([
      { productId: 3, fingerprint: "same" },
      { productId: 1, fingerprint: "same" },
      { productId: 2, fingerprint: "different" },
      { productId: 1, fingerprint: "same" },
    ])).toEqual([[1, 3]])
  })
})
