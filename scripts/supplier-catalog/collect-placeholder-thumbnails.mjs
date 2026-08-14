import { readFile, writeFile } from "node:fs/promises"
import { chromium } from "playwright-core"
import { safeCatalogImageUrl } from "../../dist/reports/catalog-thumbnail.js"
import { extractWalldob2bThumbnail } from "../../dist/reports/product-thumbnail-integrity.js"

const inputPath = valueAfter("--input")
const outputPath = valueAfter("--output")
if (!inputPath || !outputPath) {
  throw new Error("--input and --output are required")
}

const input = JSON.parse(await readFile(inputPath, "utf8"))
const targets = Array.isArray(input.rows) ? input.rows : []
if (targets.length === 0) throw new Error("placeholder target list is empty")
for (const target of targets) {
  if (
    target.supplier_id !== "walldob2b" ||
    !Number.isSafeInteger(Number(target.woo_parent_id)) ||
    !String(target.source_product_id ?? "").trim()
  ) {
    throw new Error("invalid placeholder target")
  }
}

const browser = await chromium.connectOverCDP("http://localhost:3000")
const context = browser.contexts()[0]
if (!context) throw new Error("authenticated browser context is unavailable")

try {
  const entries = []
  const errors = []
  for (let offset = 0; offset < targets.length; offset += 3) {
    const batch = targets.slice(offset, offset + 3)
    const settled = await Promise.all(
      batch.map(async (target) => {
        const page = await context.newPage()
        const sourceProductId = String(target.source_product_id).trim()
        try {
          const sourcePageUrl = `https://walldob2b.com/shop/item.php?it_id=${encodeURIComponent(sourceProductId)}`
          const response = await page.goto(sourcePageUrl, {
            waitUntil: "domcontentloaded",
            timeout: 30_000,
          })
          if ((response?.status() ?? 500) >= 400) {
            throw new Error(`source page rejected: HTTP ${response?.status() ?? 0}`)
          }
          await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {})
          const imageUrl = safeCatalogImageUrl(
            extractWalldob2bThumbnail(await page.content(), sourceProductId),
          )
          if (!imageUrl) throw new Error("representative image not found")
          return {
            product_id: Number(target.woo_parent_id),
            supplier_id: "walldob2b",
            source_product_id: sourceProductId,
            expected_previous_thumbnail_id: Number(target.thumbnail_id),
            image_url: imageUrl,
          }
        } catch (error) {
          return {
            error: {
              product_id: Number(target.woo_parent_id),
              supplier_id: "walldob2b",
              source_product_id: sourceProductId,
              expected_previous_thumbnail_id: Number(target.thumbnail_id),
              issue: error instanceof Error ? error.message : String(error),
            },
          }
        } finally {
          await page.close()
        }
      }),
    )
    entries.push(...settled.filter((row) => !("error" in row)))
    errors.push(...settled.flatMap((row) => ("error" in row ? [row.error] : [])))
  }
  const output = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    products: entries,
    errors,
  }
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 })
  console.log(
    JSON.stringify({ targets: targets.length, collected: entries.length, failed: errors.length }),
  )
} finally {
  await browser.close()
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag)
  return index < 0 ? "" : (process.argv[index + 1] ?? "")
}
