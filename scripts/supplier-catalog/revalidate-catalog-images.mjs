import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { chromium } from "playwright-core"
import { validateSourceImageCandidates } from "../../dist/reports/product-thumbnail-integrity.js"

for (const line of (await readFile(".env", "utf8")).split(/\r?\n/u)) {
  const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line)
  if (match?.[1] && process.env[match[1]] === undefined) {
    process.env[match[1]] = match[2] ?? ""
  }
}

const path = process.argv[2] ?? "reports/rebuild/dailyfood-catalog-snapshot.json"
const snapshot = JSON.parse(await readFile(path, "utf8"))
const reportDirectory = dirname(path)
const syncResult = await readJson(join(reportDirectory, "catalog-sync-result.json"), {})
const retryStatePath = join(reportDirectory, "source-image-retry-state.json")
const retryState = await readJson(retryStatePath, { products: {} })
const requiredKeys = new Set(
  (syncResult.image_retry_required_products ?? []).map(productKey).filter(Boolean),
)
const unavailableRows = new Map(
  (syncResult.source_image_unavailable_products ?? [])
    .map((row) => [productKey(row), row])
    .filter(([key]) => Boolean(key)),
)
const now = new Date()
const retryProducts = (snapshot.products ?? []).filter((product) => {
  if (
    product.image_validation_status === "valid" &&
    String(product.source_image_url ?? "").length > 0
  ) {
    delete retryState.products[productKey(product)]
    return false
  }
  const key = productKey(product)
  if (requiredKeys.has(key) || !unavailableRows.has(key)) return true
  const policy = retryState.products[key] ?? unavailableRows.get(key)
  const recheckAfter = Date.parse(policy?.next_check_at ?? policy?.recheck_after ?? "")
  return !Number.isFinite(recheckAfter) || recheckAfter <= now.getTime()
})
const missingCandidateProducts = retryProducts.filter(
  (product) =>
    (!Array.isArray(product.source_image_urls) || product.source_image_urls.length === 0) &&
    !product.source_image_url &&
    !product.imageUrl,
)
const discoveredImages =
  missingCandidateProducts.length > 0
    ? await discoverDailyListImages(
        missingCandidateProducts.map((product) => String(product.sourceProductId)),
      )
    : new Map()
let retried = 0
let recovered = 0
for (const product of retryProducts) {
  const key = productKey(product)
  retried += 1
  const candidates = [
    ...(Array.isArray(product.source_image_urls) ? product.source_image_urls : []),
    product.source_image_url ?? product.imageUrl ?? "",
    ...(discoveredImages.get(String(product.sourceProductId)) ?? []),
  ].filter(Boolean)
  if (candidates.length === 0) {
    scheduleUnavailableRecheck(retryState, key, now)
    continue
  }
  const image = await validateSourceImageCandidates(candidates, {
    sourceType: "dailyfood_actual_product",
    expectedHosts: ["dailyfood.adminplus.co.kr", "cdn.yourlove.co.kr"],
  })
  Object.assign(product, image, { imageUrl: image.source_image_url })
  if (image.image_validation_status === "valid") {
    recovered += 1
    delete retryState.products[key]
  } else if (unavailableRows.has(key)) {
    scheduleUnavailableRecheck(retryState, key, now)
  }
}
snapshot.imageRevalidatedAt = new Date().toISOString()
snapshot.counts = {
  ...(snapshot.counts ?? {}),
  withImages: (snapshot.products ?? []).filter(
    (product) => product.image_validation_status === "valid",
  ).length,
  missingImages: (snapshot.products ?? []).filter(
    (product) => product.image_validation_status !== "valid",
  ).length,
  imageRetried: retried,
  imageRecovered: recovered,
  imageRetrySkippedUnavailable:
    unavailableRows.size -
    retryProducts.filter((product) => unavailableRows.has(productKey(product))).length,
  imageCandidatesDiscovered: discoveredImages.size,
}
await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`)
retryState.updated_at = now.toISOString()
await writeFile(retryStatePath, `${JSON.stringify(retryState, null, 2)}\n`)
console.log(JSON.stringify({ path, retried, recovered }))

function productKey(product) {
  const supplierId = String(product.supplier_id ?? product.supplierId ?? "dailyfood")
  const sourceProductId = String(product.source_product_id ?? product.sourceProductId ?? "")
  return sourceProductId ? `${supplierId}|${sourceProductId}` : ""
}

function scheduleUnavailableRecheck(state, key, checkedAt) {
  if (!key) return
  state.products[key] = {
    status: "unavailable",
    last_checked_at: checkedAt.toISOString(),
    next_check_at: new Date(checkedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT") return fallback
    throw error
  }
}

async function discoverDailyListImages(sourceProductIds) {
  const wanted = new Set(sourceProductIds)
  const browserEndpoint = (
    process.env.ADMINPLUS_BROWSER_ENDPOINT ?? "http://localhost:3000"
  ).replace("://browserless:", "://localhost:")
  const browser = await chromium.connectOverCDP(browserEndpoint)
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext())
    const page = context.pages()[0] ?? (await context.newPage())
    const baseUrl = "https://dailyfood.adminplus.co.kr"
    await page.goto(`${baseUrl}/partner/?mod=product&actpage=prt.list`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    })
    if ((await page.locator("input[type=password]").count()) > 0) {
      await page
        .locator("input[name=admid],input[name=id],input[name=uid],input[type=text]")
        .first()
        .fill(process.env.DAILYFOOD_USERNAME ?? process.env.WALLDOB2B_USERNAME ?? "")
      await page
        .locator("input[name=admpwd],input[name=pw],input[name=password],input[type=password]")
        .first()
        .fill(process.env.DAILYFOOD_PASSWORD ?? process.env.WALLDOB2B_PASSWORD ?? "")
      const submit = page.locator(".login-btn,button[type=submit],input[type=submit]").first()
      if ((await submit.count()) > 0) await submit.click()
      else await page.keyboard.press("Enter")
      await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {})
    }
    const rows = await page.evaluate(
      async ({ baseUrl, wantedIds }) => {
        const wantedSet = new Set(wantedIds)
        const output = []
        for (let pageNo = 1; pageNo <= 50; pageNo += 1) {
          const response = await fetch(
            `${baseUrl}/partner/?mod=product/json&actpage=prt.list.proc&page=${pageNo}&order=&by=&searchval=`,
            { credentials: "include" },
          )
          if (!response.ok) break
          const xml = new DOMParser().parseFromString(await response.text(), "text/xml")
          const blocks = [...xml.querySelectorAll("data")]
            .map((node) => node.textContent ?? "")
            .filter(Boolean)
          if (blocks.length === 0) break
          for (const html of blocks) {
            const sourceProductId =
              /prtView\s*\(\s*["']([^"']+)["']/iu.exec(html)?.[1]?.trim() ?? ""
            if (!wantedSet.has(sourceProductId)) continue
            const document = new DOMParser().parseFromString(html, "text/html")
            const urls = [...document.querySelectorAll("img")]
              .map(
                (image) =>
                  image.getAttribute("data-original") ||
                  image.getAttribute("data-src") ||
                  image.getAttribute("src") ||
                  "",
              )
              .filter(Boolean)
            if (urls.length > 0) output.push([sourceProductId, urls])
          }
          if (output.length >= wantedSet.size) break
        }
        return output
      },
      { baseUrl, wantedIds: [...wanted] },
    )
    return new Map(rows)
  } finally {
    await browser.close()
  }
}
