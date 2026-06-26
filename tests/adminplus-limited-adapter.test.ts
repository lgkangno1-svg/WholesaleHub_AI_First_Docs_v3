import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  AdminPlusDailyLimitError,
  AdminPlusForbiddenUrlError,
  AdminPlusLimitedAdapter,
  type AdminPlusPageCollector,
  AdminPlusUrlPolicy,
  JsonFileAdminPlusRunGate,
  loadAdminPlusSitesConfig,
} from "../packages/supplier-adapters/src/index.js"

const site = {
  supplierId: "market-a",
  supplierName: "마켓 A",
  enabled: true,
  listUrls: ["https://shop.example.com/products"],
  allowedHosts: ["shop.example.com", "cdn.example.com"],
  allowedPathPrefixes: ["/products"],
  forbiddenPathPatterns: ["/cart", "/order", "/checkout", "/payment"],
  collectOnly: ["product_name", "option_text", "price", "stock_status", "product_url"],
  selectors: {
    row: ".product",
    productName: ".name",
    optionText: ".option",
    price: ".price",
    stockStatus: ".stock",
    productUrl: "a.name",
  },
  maxPages: 2,
} as const

class FixedPageCollector implements AdminPlusPageCollector {
  calls = 0

  async collect(): Promise<
    readonly {
      readonly productName: string
      readonly optionText: string | null
      readonly price: number
      readonly stockStatus: "in_stock"
      readonly productUrl: string
    }[]
  > {
    this.calls += 1
    return [
      {
        productName: "미백 찰옥수수",
        optionText: "특품 30개",
        price: 10_000,
        stockStatus: "in_stock",
        productUrl: "https://shop.example.com/products/1",
      },
    ]
  }
}

describe("loadAdminPlusSitesConfig", () => {
  it("loads multiple sites with the fixed collect_only contract and 11:00 schedule", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "adminplus-config-"))
    const configPath = join(directory, "sites.yml")
    await writeFile(
      configPath,
      `
schedule:
  timezone: Asia/Seoul
  cron: "0 11 * * *"
  max_runs_per_day: 1
sites:
  - supplier_id: market-a
    supplier_name: 마켓 A
    enabled: true
    list_urls: ["https://shop.example.com/products"]
    allowed_hosts: ["shop.example.com", "cdn.example.com"]
    allowed_path_prefixes: ["/products"]
    forbidden_path_patterns: ["/cart", "/order", "/checkout", "/payment"]
    collect_only: [product_name, option_text, price, stock_status, product_url]
    selectors:
      row: ".product"
      product_name: ".name"
      option_text: ".option"
      price: ".price"
      stock_status: ".stock"
      product_url: "a.name"
    max_pages: 2
`,
      "utf8",
    )

    // When
    const config = await loadAdminPlusSitesConfig(configPath)

    // Then
    expect(config.schedule).toEqual({
      timezone: "Asia/Seoul",
      cron: "0 11 * * *",
      maxRunsPerDay: 1,
    })
    expect(config.sites).toHaveLength(1)
    expect(config.sites[0]?.collectOnly).toEqual([
      "product_name",
      "option_text",
      "price",
      "stock_status",
      "product_url",
    ])
  })
})

describe("AdminPlusUrlPolicy", () => {
  it.each([
    "http://shop.example.com/products",
    "https://evil.example/products",
    "https://shop.example.com/cart",
    "https://shop.example.com/order/1",
    "https://user:password@shop.example.com/products",
  ])("blocks forbidden navigation to %s", (url) => {
    // Given
    const policy = new AdminPlusUrlPolicy(site)

    // When
    const access = (): void => policy.assertNavigationAllowed(url)

    // Then
    expect(access).toThrow(AdminPlusForbiddenUrlError)
  })
})

describe("AdminPlusLimitedAdapter", () => {
  it("collects only the approved fields and blocks a second run on the same day", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "adminplus-gate-"))
    const collector = new FixedPageCollector()
    const adapter = new AdminPlusLimitedAdapter(
      site,
      collector,
      new JsonFileAdminPlusRunGate(join(directory, "runs.json")),
    )
    const date = "2026-06-26"

    // When
    const first = await adapter.collect(date)
    const second = adapter.collect(date)

    // Then
    expect(first).toEqual([
      {
        productName: "미백 찰옥수수",
        optionText: "특품 30개",
        price: 10_000,
        stockStatus: "in_stock",
        productUrl: "https://shop.example.com/products/1",
      },
    ])
    await expect(second).rejects.toThrow(AdminPlusDailyLimitError)
    expect(collector.calls).toBe(1)
  })
})
