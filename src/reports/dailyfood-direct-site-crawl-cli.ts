import { mkdir, readFile, writeFile } from "node:fs/promises"
import { crawlDailyFoodDirectSite } from "../adapters/dailyfood/dailyfood-direct-site.js"

async function main(): Promise<void> {
  await loadDotEnv()
  const result = await crawlDailyFoodDirectSite({
    username: env("DAILYFOOD_USERNAME", "WALLDOB2B_USERNAME"),
    password: env("DAILYFOOD_PASSWORD", "WALLDOB2B_PASSWORD"),
    browserEndpoint: process.env["ADMINPLUS_BROWSER_ENDPOINT"] ?? "http://localhost:3000",
  })
  await mkdir("reports", { recursive: true })
  const rows = result.products.flatMap((product) =>
    product.options.map((option) => ({
      source_product_id: product.sourceProductId,
      product_name: product.productName,
      source_option_id: option.sourceOptionId,
      option_name: option.optionName,
      price: option.price,
      stock_status: option.stockStatus,
      image_url: option.imageUrl || product.imageUrl,
      page_no: product.pageNo,
    })),
  )
  const summary = {
    crawledAt: result.crawledAt,
    products: result.products.length,
    options: rows.length,
    errors: result.errors.length,
  }
  await writeFile(
    "reports/dailyfood-direct-site-crawl.json",
    `${JSON.stringify(result, null, 2)}\n`,
  )
  await writeFile("reports/dailyfood-direct-site-crawl.csv", toCsv(rows))
  await writeFile(
    "reports/dailyfood-direct-site-crawl-summary.md",
    `# DailyFood Direct Site Crawl\n\n- crawled_at: ${summary.crawledAt}\n- products: ${summary.products}\n- options: ${summary.options}\n- errors: ${summary.errors}\n`,
  )
  console.log(JSON.stringify(summary, null, 2))
}

async function loadDotEnv(): Promise<void> {
  try {
    const text = await readFile(".env", "utf8")
    for (const line of text.split(/\r?\n/u)) {
      const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line)
      if (match?.[1] && process.env[match[1]] === undefined) process.env[match[1]] = match[2] ?? ""
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
}

function env(key: string, fallbackKey?: string): string {
  const value = (
    process.env[key] ??
    (fallbackKey === undefined ? "" : process.env[fallbackKey]) ??
    ""
  ).trim()
  if (!value) throw new Error(`${key} is required`)
  return value
}

function toCsv(rows: readonly Record<string, string | number>[]): string {
  const headers = [
    "source_product_id",
    "product_name",
    "source_option_id",
    "option_name",
    "price",
    "stock_status",
    "image_url",
    "page_no",
  ]
  return `${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n")}\n`
}

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/gu, '""')}"`
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
