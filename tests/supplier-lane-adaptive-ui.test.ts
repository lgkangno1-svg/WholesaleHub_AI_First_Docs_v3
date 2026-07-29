import { existsSync, readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"

const pluginPath = "wordpress/plugins/wholesalehub-supplier-lanes/wholesalehub-supplier-lanes.php"
const uiScriptPath = "wordpress/plugins/wholesalehub-supplier-lanes/assets/supplier-lanes.js"
const plugin = readFileSync(pluginPath, "utf8")
const uiScript = existsSync(uiScriptPath) ? readFileSync(uiScriptPath, "utf8") : ""

function loadUiApi() {
  const browserWindow: Record<string, unknown> = {}
  const browserDocument = {
    readyState: "loading",
    addEventListener: () => undefined,
  }
  runInNewContext(uiScript, {
    document: browserDocument,
    window: browserWindow,
  })
  return browserWindow.WholesaleHubSupplierLanes as {
    availableValues: (
      offers: Array<Record<string, string>>,
      selection: Record<string, string>,
      dimension: string,
    ) => string[]
    classifyMode: (offers: Array<Record<string, string>>) => string
    matchingOffers: (
      offers: Array<Record<string, string>>,
      selection: Record<string, string>,
      dimensions: string[],
    ) => Array<Record<string, string>>
  }
}

const offers = [
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
  it("ships and enqueues the shared frontend controller", () => {
    expect(uiScript.length).toBeGreaterThan(0)
    expect(plugin).toContain("wp_enqueue_script")
    expect(plugin).toContain("assets/supplier-lanes.js")
  })

  it("classifies one offer, one supplier, and multiple suppliers", () => {
    const api = loadUiApi()
    expect(api.classifyMode([offers[0]])).toBe("single-offer")
    expect(api.classifyMode(offers.slice(0, 2))).toBe("single-supplier")
    expect(api.classifyMode(offers)).toBe("multi-supplier")
  })

  it("requires an exact complete normalized-spec match", () => {
    const api = loadUiApi()
    expect(
      api
        .matchingOffers(offers, { grade: "소", weight: "3000" }, ["grade", "weight"])
        .map((offer) => offer.key),
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

  it("renders adaptive mode and offer identity attributes from PHP", () => {
    for (const fragment of [
      "data-ui-mode",
      "data-variation-id",
      "data-public-offer-key",
      "원하는 규격을 선택하면 구매 가능한 판매조건을 보여드립니다.",
      "현재 선택 가능한 판매조건이 없습니다.",
    ]) {
      expect(plugin).toContain(fragment)
    }
    expect(plugin).not.toContain("$active = ($i === 0) ? ' active' : '';")
  })
})
