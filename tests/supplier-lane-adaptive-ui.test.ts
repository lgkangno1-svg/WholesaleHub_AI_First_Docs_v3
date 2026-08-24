import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"

const uiScriptPath = "wordpress/plugins/wholesalehub-supplier-lanes/assets/supplier-lanes.js"
const uiScript = readFileSync(uiScriptPath, "utf8")

type UiOffer = Record<string, string>

interface SupplierLaneUiApi {
  availableValues: (
    offers: UiOffer[],
    selection: Record<string, string>,
    dimension: string,
  ) => string[]
  classifyMode: (offers: UiOffer[]) => string
  matchingOffers: (
    offers: UiOffer[],
    selection: Record<string, string>,
    dimensions: string[],
  ) => UiOffer[]
}

function loadUiApi(): SupplierLaneUiApi {
  const browserWindow: Record<string, unknown> = {}
  const browserDocument = {
    readyState: "loading",
    addEventListener: () => undefined,
  }
  runInNewContext(uiScript, {
    document: browserDocument,
    window: browserWindow,
  })
  return browserWindow["WholesaleHubSupplierLanes"] as SupplierLaneUiApi
}

const offers: UiOffer[] = [
  {
    lane: "A",
    supplier: "dailyfood",
    grade: "소",
    weight: "1000",
    count: "",
    package: "",
    key: "daily-small-1",
  },
  {
    lane: "A",
    supplier: "dailyfood",
    grade: "소",
    weight: "3000",
    count: "",
    package: "",
    key: "daily-small-3",
  },
  {
    lane: "B",
    supplier: "walldob2b",
    grade: "소",
    weight: "3000",
    count: "",
    package: "",
    key: "wall-small-3",
  },
  {
    lane: "B",
    supplier: "walldob2b",
    grade: "왕특",
    weight: "5000",
    count: "",
    package: "",
    key: "wall-king-5",
  },
]

describe("Supplier Lane adaptive UI contract", () => {
  it("classifies one offer, one supplier, and multiple suppliers", () => {
    const api = loadUiApi()
    const firstOffer = offers[0]
    expect(firstOffer).toBeDefined()
    expect(api.classifyMode(firstOffer ? [firstOffer] : [])).toBe("single-offer")
    expect(api.classifyMode(offers.slice(0, 2))).toBe("single-supplier")
    expect(api.classifyMode(offers)).toBe("multi-supplier")
  })

  it("requires an exact complete normalized-spec match", () => {
    const api = loadUiApi()
    expect(
      api
        .matchingOffers(offers, { grade: "소", weight: "3000" }, ["grade", "weight"])
        .map((offer) => offer["key"]),
    ).toEqual(["daily-small-3", "wall-small-3"])
    expect(api.matchingOffers(offers, { grade: "소" }, ["grade", "weight"])).toEqual([])
    expect(
      api.matchingOffers(offers, { grade: "대", weight: "1000" }, ["grade", "weight"]),
    ).toEqual([])
  })

  it("limits dependent values to combinations compatible with other selections", () => {
    const api = loadUiApi()
    expect(api.availableValues(offers, { grade: "소" }, "weight")).toEqual(["1000", "3000"])
    expect(api.availableValues(offers, { grade: "왕특" }, "weight")).toEqual(["5000"])
    expect(api.availableValues(offers, { weight: "5000" }, "grade")).toEqual(["왕특"])
  })
})
