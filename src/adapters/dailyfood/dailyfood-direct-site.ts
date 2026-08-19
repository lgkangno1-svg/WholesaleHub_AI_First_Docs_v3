import { chromium, type Page } from "playwright-core"
import { z } from "zod"
import type { CollectedProduct } from "../../domain/product.js"

const DAILYFOOD_SUPPLIER_ID = "dailyfood"
const DAILYFOOD_BASE_URL = "https://dailyfood.adminplus.co.kr"
const DAILYFOOD_LIST_URL = `${DAILYFOOD_BASE_URL}/partner/?mod=product&actpage=prt.list`

const DirectSiteOptionSchema = z.object({
  sourceProductId: z.string(),
  sourceOptionId: z.string(),
  sourceProductName: z.string(),
  optionName: z.string(),
  price: z.number().finite().nonnegative(),
  stockStatus: z.enum(["in_stock", "out_of_stock", "unknown"]),
  imageUrl: z.string().default(""),
  pageNo: z.number().int().nonnegative().default(0),
  raw: z.record(z.string(), z.unknown()).default({}),
})
const DirectSiteProductSchema = z.object({
  sourceProductId: z.string(),
  productName: z.string(),
  pageNo: z.number().int().nonnegative().default(0),
  imageUrl: z.string().default(""),
  detailImageUrls: z.array(z.string()).default([]),
  options: z.array(DirectSiteOptionSchema),
  raw: z.record(z.string(), z.unknown()).default({}),
})
const DirectSiteResultSchema = z.object({
  crawledAt: z.string(),
  products: z.array(DirectSiteProductSchema),
  errors: z.array(z.string()).default([]),
  paginationComplete: z.boolean(),
  listedProductCount: z.number().int().nonnegative(),
  detailFetchedProductCount: z.number().int().nonnegative(),
  missingOptionsCount: z.number().int().nonnegative(),
  expectedProductCount: z.number().int().nonnegative(),
  collectedProductCount: z.number().int().nonnegative(),
  incomplete: z.boolean(),
  attempts: z.number().int().nonnegative(),
})

export type DailyFoodDirectSiteOption = z.infer<typeof DirectSiteOptionSchema>
export type DailyFoodDirectSiteProduct = z.infer<typeof DirectSiteProductSchema>
export type DailyFoodDirectSiteResult = z.infer<typeof DirectSiteResultSchema>

export type DailyFoodDirectSiteOptions = {
  username: string
  password: string
  browserEndpoint?: string
  maxPages?: number
}

export async function crawlDailyFoodDirectSite(
  options: DailyFoodDirectSiteOptions,
): Promise<DailyFoodDirectSiteResult> {
  if (options.username.length === 0) throw new Error("missing dailyfood username")
  if (options.password.length === 0) throw new Error("missing dailyfood password")
  const browser = await connectBrowser(options.browserEndpoint ?? "http://localhost:3000")
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext())
    const page = context.pages()[0] ?? (await context.newPage())
    await page.goto(DAILYFOOD_LIST_URL, { waitUntil: "domcontentloaded", timeout: 60_000 })
    await ensureLoggedIn(page, options.username, options.password)
    const result = await page.evaluate(
      ({ script, args }) => new Function("args", `return (${script})(args)`)(args),
      {
        script: CRAWL_DAILYFOOD_IN_BROWSER,
        args: { baseUrl: DAILYFOOD_BASE_URL, maxPages: options.maxPages ?? 50 },
      },
    )
    return DirectSiteResultSchema.parse(result)
  } finally {
    await browser.close()
  }
}

export async function collectDailyFoodDirectSiteProducts(
  options: DailyFoodDirectSiteOptions,
): Promise<readonly CollectedProduct[]> {
  const result = await crawlDailyFoodDirectSite(options)
  return collectDailyFoodProducts(result)
}

export async function collectDailyFoodDirectSiteSnapshot(
  options: DailyFoodDirectSiteOptions,
): Promise<{
  readonly products: readonly CollectedProduct[]
  readonly result: DailyFoodDirectSiteResult
}> {
  const result = await crawlDailyFoodDirectSite(options)
  return { products: collectDailyFoodProducts(result), result }
}

function collectDailyFoodProducts(result: DailyFoodDirectSiteResult): readonly CollectedProduct[] {
  const products: CollectedProduct[] = []
  for (const product of result.products) {
    for (const option of product.options) {
      products.push({
        supplierId: DAILYFOOD_SUPPLIER_ID,
        sourceType: "website",
        originalProductName: product.productName,
        originalOptionName: option.optionName,
        price: option.price,
        shippingFee: 0,
        stockStatus: option.stockStatus,
        productUrl: `${DAILYFOOD_BASE_URL}/partner/?mod=product&actpage=prt.grp.detail.pop&pcode=${encodeURIComponent(product.sourceProductId)}`,
        rawJson: JSON.stringify({
          source: "dailyfood_direct_site",
          sourceProductId: product.sourceProductId,
          sourceOptionId: option.sourceOptionId,
          sourceProductName: option.sourceProductName,
          sourceOptionName: option.optionName,
          pageNo: product.pageNo,
          imageUrl: option.imageUrl || product.imageUrl,
          raw: option.raw,
        }),
      })
    }
  }
  return products
}

async function connectBrowser(endpoint: string) {
  try {
    return await chromium.connectOverCDP(endpoint)
  } catch (error) {
    if (endpoint === "http://localhost:3000") throw error
    return await chromium.connectOverCDP("http://localhost:3000")
  }
}

async function ensureLoggedIn(page: Page, username: string, password: string): Promise<void> {
  if (page.url().includes("actpage=prt.list") && !(await hasLoginFields(page))) return
  const idSelector = await firstExistingSelector(page, [
    "input[name='admid']",
    "input[name='id']",
    "input[name='uid']",
    "input[name='user_id']",
    "input[name='userid']",
    "input[name='mb_id']",
    "input[type='text']",
  ])
  const passwordSelector = await firstExistingSelector(page, [
    "input[name='admpwd']",
    "input[name='pw']",
    "input[name='password']",
    "input[name='user_pw']",
    "input[name='passwd']",
    "input[type='password']",
  ])
  if (idSelector === undefined || passwordSelector === undefined) {
    await page.goto(DAILYFOOD_LIST_URL, { waitUntil: "networkidle", timeout: 60_000 })
    return
  }
  await page.fill(idSelector, username)
  await page.fill(passwordSelector, password)
  const submitSelector = await firstExistingSelector(page, [
    ".login-btn",
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('???')",
    "a:has-text('???')",
  ])
  if (submitSelector !== undefined) await page.click(submitSelector)
  else await page.keyboard.press("Enter")
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => undefined)
  await page.goto(DAILYFOOD_LIST_URL, { waitUntil: "domcontentloaded", timeout: 60_000 })
  if (!page.url().includes("actpage=prt.list") || (await hasLoginFields(page))) {
    throw new Error("dailyfood login verification failed")
  }
}

async function hasLoginFields(page: Page): Promise<boolean> {
  return (await page.locator("input[type='password']").count()) > 0
}

async function firstExistingSelector(
  page: Page,
  selectors: readonly string[],
): Promise<string | undefined> {
  for (const selector of selectors) {
    if ((await page.locator(selector).count()) > 0) return selector
  }
  return undefined
}

const CRAWL_DAILYFOOD_IN_BROWSER = `async ({ baseUrl, maxPages }) => {
  const crawledAt = new Date().toISOString();
  const errors = [];
  const products = [];
  const strip = (value) => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\\s+/g, ' ').trim();
  const priceOf = (value) => { const n = Number(strip(value).replace(/[^0-9]/g, '')); return Number.isFinite(n) ? n : 0; };
  const absoluteUrl = (value) => {
    const text = strip(value);
    if (!text) return '';
    try { return new URL(text, baseUrl).toString(); } catch { return text; }
  };
  const productIdOf = (row, fallback) => strip(row['pcode'] ?? row['code'] ?? row['product_code'] ?? row['pid'] ?? row['no'] ?? fallback);
  const productNameOf = (row) => strip(row['pname'] ?? row['product_name'] ?? row['name'] ?? row['title'] ?? row['subject']);
  const imageOf = (row) => absoluteUrl(row['img'] ?? row['image'] ?? row['thumb'] ?? row['thumbnail'] ?? row['file1'] ?? row['picture']);
  const stockOf = (text) => {
    if (/\\uD488\\uC808|\\uB9C8\\uAC10|\\uD310\\uB9E4\\uC911\\uC9C0|sold\\s*out/i.test(text)) return 'out_of_stock';
    if (/\\uC790\\uC728|\\uBB34\\uD55C|\\uAC00\\uB2A5|\\uC6D0/.test(text)) return 'in_stock';
    return 'unknown';
  };
  async function fetchText(url) {
    const response = await fetch(url, { credentials: 'include' });
    return await response.text();
  }
  function rowsFromListText(text, pageNo) {
    const xmlDoc = new DOMParser().parseFromString(text, 'text/xml');
    const blocks = [...xmlDoc.querySelectorAll('data')].map((node) => node.textContent || '').filter(Boolean);
    const htmlBlocks = blocks;
    return htmlBlocks.map((html, index) => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const onclick = html.match(/prtView\\(["']([^"']+)/)?.[1] || '';
      const sourceProductId = strip(onclick || String(pageNo) + '-' + String(index));
      const productName = strip(doc.querySelector('.pname')?.textContent || '');
      const imageUrl = absoluteUrl(doc.querySelector('img')?.getAttribute('src') || '');
      return { sourceProductId, productName, imageUrl, raw: { html } };
    }).filter((row) => row.sourceProductId && row.productName);
  }
  function optionsFromDetail(productId, productName, pageNo, imageUrl, html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const options = [];
    for (const tr of [...doc.querySelectorAll('tr')]) {
      const cells = [...tr.querySelectorAll('td,th')].map((cell) => strip(cell.textContent));
      const joined = cells.join(' ');
      const priceCell = cells.find((cell) => /[0-9][0-9,]*\\s*(?:\\uC6D0|$)/u.test(cell));
      const price = priceOf(priceCell ?? '');
      if (!Number.isFinite(price) || price <= 0 || price > 1000000) continue;
      const optionName = strip(cells[0] ?? '');
      if (!optionName || /\\uC0C1\\uD488\\uBA85|\\uD0DD\\uBC30\\uC0AC|\\uC81C\\uD488\\uC124\\uBA85|\\uBC30\\uC1A1\\uBE44|\\uD310\\uB9E4\\uAC00|\\uC635\\uC158|\\uCD9C\\uACE0\\uC9C0/.test(optionName)) continue;
      const optionId = productId === optionName ? productId : productId + ':' + optionName;
      options.push({
        sourceProductId: productId,
        sourceOptionId: optionId,
        sourceProductName: productName,
        optionName,
        price,
        stockStatus: stockOf(joined),
        imageUrl,
        pageNo,
        raw: { cells },
      });
    }
    if (options.length === 0) {
      const bodyText = strip(doc.body?.textContent ?? html);
      const match = bodyText.match(/[0-9][0-9,]*\\s*(?:\\uC6D0|$)/u);
      const price = priceOf(match?.[0] ?? '');
      if (price > 0) {
        options.push({
          sourceProductId: productId,
          sourceOptionId: productId,
          sourceProductName: productName,
          optionName: productName,
          price,
          stockStatus: stockOf(bodyText),
          imageUrl,
          pageNo,
          raw: { bodyText },
        });
      }
    }
    return options;
  }
  function detailImagesFromHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...new Set(
      [...doc.querySelectorAll('img')]
        .map((image) => absoluteUrl(image.getAttribute('src') || image.getAttribute('data-src') || ''))
        .filter(Boolean)
    )];
  }
  let paginationComplete = false;
  for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
    const url = baseUrl + '/partner/?mod=product/json&actpage=prt.list.proc&page=' + pageNo + '&order=&by=&searchval=';
    const rows = rowsFromListText(await fetchText(url), pageNo);
    if (rows.length === 0) {
      paginationComplete = true;
      break;
    }
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const sourceProductId = row.sourceProductId;
      const productName = row.productName;
      const imageUrl = row.imageUrl;
      try {
        const detailUrl = baseUrl + '/partner/?mod=product&actpage=prt.grp.detail.pop&pcode=' + encodeURIComponent(sourceProductId);
        const detailHtml = await fetchText(detailUrl);
        const options = optionsFromDetail(sourceProductId, productName, pageNo, imageUrl, detailHtml);
        const detailImageUrls = detailImagesFromHtml(detailHtml);
        products.push({ sourceProductId, productName, pageNo, imageUrl, detailImageUrls, options, raw: row });
      } catch (error) {
        errors.push(productName + ': ' + (error instanceof Error ? error.message : String(error)));
      }
    }
  }
  return {
    crawledAt,
    products,
    errors,
    paginationComplete,
    listedProductCount: products.length + errors.length,
    detailFetchedProductCount: products.length,
    missingOptionsCount: products.filter((product) => product.options.length === 0).length,
    expectedProductCount: products.length + errors.length,
    collectedProductCount: products.length,
    incomplete: !paginationComplete || errors.length > 0,
    attempts: 1,
  };
}`
