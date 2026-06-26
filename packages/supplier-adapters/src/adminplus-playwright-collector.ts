import { chromium, type Locator, type Page } from "playwright-core"
import { AdminPlusUrlPolicy } from "./adminplus-url-policy.js"
import type {
  AdminPlusCollectedProduct,
  AdminPlusPageCollector,
  AdminPlusSiteConfig,
  StockStatus,
} from "./types.js"

const BLOCKED_RESOURCE_TYPES: ReadonlySet<string> = new Set(["image", "media", "font"] as const)

export class AdminPlusSecurityWarningError extends Error {
  readonly name = "AdminPlusSecurityWarningError"

  constructor(readonly supplierId: string) {
    super(`Security warning detected while collecting AdminPlus supplier: ${supplierId}`)
  }
}

export class AdminPlusInvalidPriceError extends Error {
  readonly name = "AdminPlusInvalidPriceError"

  constructor(readonly priceText: string) {
    super(`AdminPlus product price is invalid: ${priceText}`)
  }
}

export type PlaywrightAdminPlusCollectorOptions = {
  readonly browserEndpoint: string
  readonly timeoutMs?: number
  readonly minDelayMs?: number
  readonly maxDelayMs?: number
}

export class PlaywrightAdminPlusPageCollector implements AdminPlusPageCollector {
  private readonly timeoutMs: number

  constructor(private readonly options: PlaywrightAdminPlusCollectorOptions) {
    this.timeoutMs = options.timeoutMs ?? 30_000
  }

  async collect(
    site: AdminPlusSiteConfig,
    signal?: AbortSignal,
  ): Promise<readonly AdminPlusCollectedProduct[]> {
    const browser = await chromium.connectOverCDP(this.options.browserEndpoint, {
      timeout: this.timeoutMs,
    })
    try {
      const context = await browser.newContext(
        site.storageStatePath === undefined ? {} : { storageState: site.storageStatePath },
      )
      try {
        const page = await context.newPage()
        const policy = new AdminPlusUrlPolicy(site)
        await this.installRequestPolicy(page, policy)
        const products: AdminPlusCollectedProduct[] = []
        const listUrls = site.listUrls.slice(0, site.maxPages)
        for (let pageIndex = 0; pageIndex < listUrls.length; pageIndex += 1) {
          const listUrl = listUrls[pageIndex]
          if (listUrl === undefined) {
            continue
          }
          if (pageIndex > 0) {
            await this.delayBetweenPages()
          }
          signal?.throwIfAborted()
          policy.assertNavigationAllowed(listUrl)
          await page.goto(listUrl, {
            waitUntil: "domcontentloaded",
            timeout: this.timeoutMs,
          })
          await this.assertNoSecurityWarning(page, site)
          const rows = page.locator(site.selectors.row)
          await rows.first().waitFor({ state: "visible", timeout: this.timeoutMs })
          const rowCount = await rows.count()
          for (let index = 0; index < rowCount; index += 1) {
            products.push(await this.readProduct(rows.nth(index), site, listUrl, policy))
          }
        }
        return products
      } finally {
        await context.close()
      }
    } finally {
      await browser.close()
    }
  }

  private async installRequestPolicy(page: Page, policy: AdminPlusUrlPolicy): Promise<void> {
    await page.route("**/*", async (route) => {
      const request = route.request()
      try {
        if (request.resourceType() === "document") {
          policy.assertNavigationAllowed(request.url())
        } else {
          policy.assertResourceAllowed(request.url())
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AdminPlusForbiddenUrlError") {
          await route.abort("blockedbyclient")
          return
        }
        throw error
      }
      if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
        await route.abort("blockedbyclient")
        return
      }
      await route.continue()
    })
  }

  private async delayBetweenPages(): Promise<void> {
    const minimum = this.options.minDelayMs ?? 3000
    const maximum = this.options.maxDelayMs ?? 8000
    const delayMs = minimum + Math.floor(Math.random() * (maximum - minimum + 1))
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
  }

  private async assertNoSecurityWarning(page: Page, site: AdminPlusSiteConfig): Promise<void> {
    const selector = site.selectors.securityWarning
    if (selector !== undefined && (await page.locator(selector).isVisible())) {
      throw new AdminPlusSecurityWarningError(site.supplierId)
    }
  }

  private async readProduct(
    row: Locator,
    site: AdminPlusSiteConfig,
    listUrl: string,
    policy: AdminPlusUrlPolicy,
  ): Promise<AdminPlusCollectedProduct> {
    const productName = (await row.locator(site.selectors.productName).innerText()).trim()
    const optionText = (await row.locator(site.selectors.optionText).innerText()).trim()
    const priceText = (await row.locator(site.selectors.price).innerText()).trim()
    const stockText = (await row.locator(site.selectors.stockStatus).innerText()).trim()
    const productHref = await row.locator(site.selectors.productUrl).getAttribute("href")
    const productUrl = productHref === null ? null : new URL(productHref, listUrl).href
    if (productUrl !== null) {
      policy.assertProductUrlAllowed(productUrl)
    }
    return {
      productName,
      optionText: optionText.length === 0 ? null : optionText,
      price: parsePrice(priceText),
      stockStatus: parseStockStatus(stockText, site.outOfStockTexts ?? []),
      productUrl,
    }
  }
}

function parsePrice(priceText: string): number {
  const digits = priceText.replace(/[^\d]/g, "")
  const price = Number(digits)
  if (digits.length === 0 || !Number.isSafeInteger(price) || price <= 0) {
    throw new AdminPlusInvalidPriceError(priceText)
  }
  return price
}

function parseStockStatus(stockText: string, outOfStockTexts: readonly string[]): StockStatus {
  if (stockText.length === 0) {
    return "unknown"
  }
  return outOfStockTexts.some((text) => stockText.includes(text)) ? "out_of_stock" : "in_stock"
}
