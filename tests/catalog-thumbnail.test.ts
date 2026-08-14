import { describe, expect, it } from "vitest"
import { safeCatalogImageUrl, selectCatalogImageUrl } from "../src/reports/catalog-thumbnail.js"

describe("supplier catalog thumbnail pipeline", () => {
  it("accepts only expected HTTPS image hosts and extensions", () => {
    expect(
      safeCatalogImageUrl("https://walldob2b.com/data/item/123/thumb-main_500x500.jpg?version=2"),
    ).toContain("/data/item/123/")
    expect(
      safeCatalogImageUrl("https://cdn.yourlove.co.kr/dailyfood/img/prtimg/123.png"),
    ).toContain("/dailyfood/img/prtimg/")
    expect(safeCatalogImageUrl("http://walldob2b.com/data/item/123/main.jpg")).toBe("")
    expect(safeCatalogImageUrl("https://example.com/main.jpg")).toBe("")
    expect(safeCatalogImageUrl("https://walldob2b.com/data/item/123/page.html")).toBe("")
  })

  it("uses the explicit image first, then Walldo lane B and Daily lane A", () => {
    const laneA = "https://cdn.yourlove.co.kr/dailyfood/img/prtimg/a.png"
    const laneB = "https://walldob2b.com/data/item/b/main.jpg"
    expect(
      selectCatalogImageUrl({
        imageUrl: "",
        lanes: { A: { imageUrl: laneA }, B: { imageUrl: laneB } },
      }),
    ).toBe(laneB)
    expect(selectCatalogImageUrl({ imageUrl: "", lanes: { A: { imageUrl: laneA } } })).toBe(laneA)
    expect(selectCatalogImageUrl({ imageUrl: "", lanes: { B: { imageUrl: laneB } } })).toBe(laneB)
  })
})
