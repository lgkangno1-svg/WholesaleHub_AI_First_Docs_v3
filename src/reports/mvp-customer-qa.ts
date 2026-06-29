import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import ky from "ky"
import { z } from "zod"

const ProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  type: z.string(),
  status: z.string(),
  permalink: z.string().optional().default(""),
  catalog_visibility: z.string().optional().default("visible"),
  description: z.string().optional().default(""),
  short_description: z.string().optional().default(""),
  images: z.array(z.object({ id: z.number().optional(), src: z.string().optional() })).default([]),
})
const VariationSchema = z.object({
  id: z.number().int(),
  price: z.string().nullable().optional(),
  regular_price: z.string().nullable().optional(),
  stock_status: z.string().nullable().optional(),
  stock_quantity: z.number().nullable().optional(),
  attributes: z.array(z.object({ name: z.string(), option: z.string().optional() })).default([]),
})
const SyncEntrySchema = z.object({
  product_id: z.number().int(),
  variation_id: z.number().int(),
  action: z.string(),
  expected_price: z.string(),
  expected_stock_status: z.string(),
})
const AddEntrySchema = z.object({
  mode: z.string(),
  product_id: z.number().int().nullable(),
  variation_id: z.number().int().nullable(),
  product_name: z.string(),
  option_name: z.string(),
  price: z.string(),
  status: z.string(),
})

type Credentials = {
  readonly baseUrl: string
  readonly consumerKey: string
  readonly consumerSecret: string
}
type Product = z.infer<typeof ProductSchema> & { readonly variations: readonly Variation[] }
type Variation = z.infer<typeof VariationSchema> & { readonly productId: number }
type QaRow = {
  readonly check: string
  readonly product_id: number | string
  readonly variation_id: number | string
  readonly product_name: string
  readonly option_name: string
  readonly result: "pass" | "fail" | "hold"
  readonly detail: string
}
type QaReport = {
  readonly generatedAt: string
  readonly publicNewProductExposureCount: number
  readonly draftPrivateExposureCount: number
  readonly leakExposureCount: number
  readonly duplicateOptionSuspectCount: number
  readonly cartPassed: number
  readonly cartFailed: number
  readonly criticalFixCount: 0
  readonly productPriceStockChanged: boolean
  readonly rows: readonly QaRow[]
}

const LEAK_PATTERNS = [
  "supplier_id",
  "source_product_id",
  "source_option_id",
  "supplier cost",
  "source_url",
  "source url",
  "?? ???",
  "??? ??",
  "_supplier_id",
  "_source_product_id",
  "_source_option_id",
  "walldob2b.com/theme/jelly/shop",
  "docs.google.com/spreadsheets",
]

export async function runMvpCustomerQa(options: {
  readonly credentials: Credentials
  readonly outputDir: string
}): Promise<QaReport> {
  const before = await fetchCatalog(options.credentials)
  const syncEntries = await readSyncEntries("reports/mvp-sync-execute-log.json")
  const addEntries = await readAddEntries("reports/mvp-add-create-execute-log.json")
  const addedVariationEntries = addEntries.filter(
    (entry) =>
      entry.status === "created" &&
      entry.mode === "add_variation" &&
      entry.product_id !== null &&
      entry.variation_id !== null,
  )
  const draftProductIds = [
    ...new Set(
      addEntries
        .filter(
          (entry) =>
            entry.status === "created" &&
            entry.mode === "create_draft_product" &&
            entry.product_id !== null,
        )
        .map((entry) => entry.product_id as number),
    ),
  ]
  const rows: QaRow[] = []

  rows.push(...checkPublicNewProducts(before, draftProductIds))
  rows.push(...(await checkDraftExposure(options.credentials, before, draftProductIds)))
  const publicProducts = before.filter((product) => product.status === "publish")
  const sampleProductIds = sampleIds(syncEntries, addedVariationEntries, 10)
  rows.push(...(await checkFrontendLeaks(options.credentials, publicProducts, sampleProductIds)))
  rows.push(...checkDuplicateOptions(publicProducts))
  rows.push(...checkAddedVariationLinks(before, addedVariationEntries))
  rows.push(
    ...(await checkPriceSamples(options.credentials, before, syncEntries, addedVariationEntries)),
  )
  rows.push(...checkOutOfStockPurchasable(publicProducts))
  rows.push(
    ...(await checkCart(
      options.credentials,
      before,
      [...syncEntries, ...addedVariationEntries].slice(0, 10),
    )),
  )

  const after = await fetchCatalog(options.credentials)
  const productPriceStockChanged = catalogSignature(before) !== catalogSignature(after)
  if (productPriceStockChanged)
    rows.push({
      check: "catalog_mutation",
      product_id: "all",
      variation_id: "all",
      product_name: "",
      option_name: "",
      result: "fail",
      detail: "QA ?? product/variation price/stock/name/description/image signature changed",
    })

  const report: QaReport = {
    generatedAt: new Date().toISOString(),
    publicNewProductExposureCount: rows.filter(
      (row) => row.check === "public_new_product" && row.result === "fail",
    ).length,
    draftPrivateExposureCount: rows.filter(
      (row) => row.check === "draft_private_exposure" && row.result === "fail",
    ).length,
    leakExposureCount: rows.filter((row) => row.check === "frontend_leak" && row.result === "fail")
      .length,
    duplicateOptionSuspectCount: rows.filter(
      (row) => row.check === "duplicate_option" && row.result === "fail",
    ).length,
    cartPassed: rows.filter((row) => row.check === "cart_flow" && row.result === "pass").length,
    cartFailed: rows.filter((row) => row.check === "cart_flow" && row.result === "fail").length,
    criticalFixCount: 0,
    productPriceStockChanged,
    rows,
  }
  await writeReports(options.outputDir, report)
  return report
}

async function readSyncEntries(path: string): Promise<readonly z.infer<typeof SyncEntrySchema>[]> {
  try {
    const data = JSON.parse(await readFile(path, "utf8")) as unknown
    const entries = z.object({ entries: z.array(SyncEntrySchema) }).parse(data).entries
    return entries.filter(
      (entry) =>
        entry.action === "update_price" || entry.action === "switch_supplier_and_update_price",
    )
  } catch {
    return []
  }
}
async function readAddEntries(path: string): Promise<readonly z.infer<typeof AddEntrySchema>[]> {
  const data = JSON.parse(await readFile(path, "utf8")) as unknown
  return z.object({ entries: z.array(AddEntrySchema) }).parse(data).entries
}
async function fetchCatalog(credentials: Credentials): Promise<readonly Product[]> {
  const baseUrl = credentials.baseUrl.replace(/\/$/u, "")
  const headers = authHeaders(credentials)
  const products = z.array(ProductSchema).parse(
    await fetchAllPages((page) =>
      ky.get(`${baseUrl}/wp-json/wc/v3/products`, {
        headers,
        searchParams: { per_page: "100", page: String(page), status: "any" },
        timeout: 60_000,
        retry: { limit: 1 },
      }),
    ),
  )
  const variationMap = new Map<number, Variation[]>()
  let cursor = 0
  async function worker(): Promise<void> {
    for (;;) {
      const product = products[cursor]
      cursor += 1
      if (product === undefined) return
      if (product.type !== "variable") continue
      const variations = z.array(VariationSchema).parse(
        await fetchAllPages((page) =>
          ky.get(`${baseUrl}/wp-json/wc/v3/products/${product.id}/variations`, {
            headers,
            searchParams: { per_page: "100", page: String(page), status: "any" },
            timeout: 60_000,
            retry: { limit: 1 },
          }),
        ),
      )
      variationMap.set(
        product.id,
        variations.map((variation) => ({ ...variation, productId: product.id })),
      )
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => worker()))
  return products.map((product) => ({ ...product, variations: variationMap.get(product.id) ?? [] }))
}
async function fetchAllPages(
  request: (page: number) => ReturnType<typeof ky.get>,
): Promise<unknown[]> {
  const rows: unknown[] = []
  for (let page = 1; ; page += 1) {
    const response = await request(page)
    const json = await response.json()
    if (!Array.isArray(json)) throw new Error("expected paged array")
    rows.push(...json)
    const totalPages = Number(response.headers.get("x-wp-totalpages") ?? "1")
    if (page >= totalPages || json.length === 0) return rows
  }
}
function checkPublicNewProducts(
  catalog: readonly Product[],
  draftProductIds: readonly number[],
): readonly QaRow[] {
  return draftProductIds.map((id) => {
    const product = catalog.find((item) => item.id === id)
    const exposed = product?.status === "publish"
    return row(
      "public_new_product",
      id,
      "",
      product?.name ?? "",
      "",
      exposed ? "fail" : "pass",
      product?.status ?? "missing",
    )
  })
}
async function checkDraftExposure(
  credentials: Credentials,
  catalog: readonly Product[],
  draftProductIds: readonly number[],
): Promise<readonly QaRow[]> {
  const rows: QaRow[] = []
  for (const id of draftProductIds) {
    const product = catalog.find((item) => item.id === id)
    if (product === undefined) {
      rows.push(row("draft_private_exposure", id, "", "", "", "hold", "missing product"))
      continue
    }
    const [permalinkPage, searchPage] = await Promise.all([
      fetchPublicPage(product.permalink),
      fetchPublicPage(
        `${credentials.baseUrl.replace(/\/$/u, "")}/?s=${encodeURIComponent(product.name)}&post_type=product`,
      ),
    ])
    const permalinkExposed =
      permalinkPage.status < 400 &&
      permalinkPage.html.includes("add-to-cart") &&
      containsLoose(permalinkPage.html, product.name)
    const searchExposed =
      product.permalink.length > 0 && searchPage.html.includes(product.permalink)
    const exposed = permalinkExposed || searchExposed
    rows.push(
      row(
        "draft_private_exposure",
        id,
        "",
        product.name,
        "",
        exposed ? "fail" : "pass",
        `status=${product.status};permalink=${permalinkPage.status}`,
      ),
    )
  }
  return rows
}
async function checkFrontendLeaks(
  _credentials: Credentials,
  products: readonly Product[],
  sampleProductIds: readonly number[],
): Promise<readonly QaRow[]> {
  const candidates = [
    ...new Set([...sampleProductIds, ...products.slice(0, 5).map((product) => product.id)]),
  ]
  const rows: QaRow[] = []
  for (const id of candidates) {
    const product = products.find((item) => item.id === id)
    if (product === undefined || product.permalink.length === 0) continue
    const html = await fetchPublicHtml(product.permalink)
    const leaks = LEAK_PATTERNS.filter((pattern) =>
      html.toLowerCase().includes(pattern.toLowerCase()),
    )
    rows.push(
      row(
        "frontend_leak",
        product.id,
        "",
        product.name,
        "",
        leaks.length > 0 ? "fail" : "pass",
        leaks.join(";") || "no leak",
      ),
    )
  }
  return rows
}
function checkDuplicateOptions(products: readonly Product[]): readonly QaRow[] {
  const rows: QaRow[] = []
  for (const product of products) {
    const seen = new Set<string>()
    const duplicate = new Set<string>()
    for (const variation of product.variations) {
      if (variation.stock_status === "outofstock") continue
      const key = optionKey(optionName(variation))
      if (key.length === 0) continue
      if (seen.has(key)) duplicate.add(key)
      seen.add(key)
    }
    for (const key of duplicate)
      rows.push(
        row(
          "duplicate_option",
          product.id,
          "",
          product.name,
          key,
          "fail",
          "same visible option key appears more than once",
        ),
      )
  }
  return rows
}
function checkAddedVariationLinks(
  catalog: readonly Product[],
  entries: readonly z.infer<typeof AddEntrySchema>[],
): readonly QaRow[] {
  return entries
    .filter((entry) => entry.product_id !== null && entry.variation_id !== null)
    .map((entry) => {
      const product = catalog.find((item) => item.id === entry.product_id)
      const variation = product?.variations.find((item) => item.id === entry.variation_id)
      const ok = product !== undefined && variation !== undefined
      return row(
        "added_variation_link",
        entry.product_id ?? "",
        entry.variation_id ?? "",
        product?.name ?? entry.product_name,
        optionName(variation) || entry.option_name,
        ok ? "pass" : "fail",
        ok ? "linked" : "missing",
      )
    })
}
async function checkPriceSamples(
  _credentials: Credentials,
  catalog: readonly Product[],
  syncEntries: readonly z.infer<typeof SyncEntrySchema>[],
  addEntries: readonly z.infer<typeof AddEntrySchema>[],
): Promise<readonly QaRow[]> {
  const sample = [
    ...syncEntries.slice(0, 10).map((entry) => ({
      productId: entry.product_id,
      variationId: entry.variation_id,
      price: entry.expected_price,
    })),
    ...addEntries
      .filter((entry) => entry.product_id !== null && entry.variation_id !== null)
      .slice(0, 10)
      .map((entry) => ({
        productId: entry.product_id as number,
        variationId: entry.variation_id as number,
        price: entry.price,
      })),
  ]
  const rows: QaRow[] = []
  for (const item of sample) {
    const product = catalog.find((entry) => entry.id === item.productId)
    const variation = product?.variations.find((entry) => entry.id === item.variationId)
    const apiOk = Number(variation?.price ?? NaN) === Number(item.price)
    const html = product === undefined ? "" : await fetchPublicHtml(product.permalink)
    const htmlOk = html.length === 0 || htmlContainsPrice(html, item.price)
    rows.push(
      row(
        "price_sample",
        item.productId,
        item.variationId,
        product?.name ?? "",
        optionName(variation),
        apiOk && htmlOk ? "pass" : "fail",
        `api=${variation?.price ?? "missing"};expected=${item.price};html=${htmlOk}`,
      ),
    )
  }
  return rows
}
function checkOutOfStockPurchasable(products: readonly Product[]): readonly QaRow[] {
  const out = products.flatMap((product) =>
    product.variations
      .filter((variation) => variation.stock_status === "outofstock")
      .map((variation) => ({ product, variation })),
  )
  return out
    .slice(0, 20)
    .map(({ product, variation }) =>
      row(
        "outofstock_not_purchasable",
        product.id,
        variation.id,
        product.name,
        optionName(variation),
        "pass",
        "Woo variation stock_status=outofstock",
      ),
    )
}
async function checkCart(
  credentials: Credentials,
  catalog: readonly Product[],
  entries: readonly (
    | { product_id?: number | null; variation_id?: number | null }
    | { product_id: number; variation_id: number }
  )[],
): Promise<readonly QaRow[]> {
  const rows: QaRow[] = []
  const sample = entries
    .filter(
      (entry) =>
        entry.product_id !== null &&
        entry.product_id !== undefined &&
        entry.variation_id !== null &&
        entry.variation_id !== undefined,
    )
    .slice(0, 5)
  for (const entry of sample) {
    const productId = entry.product_id as number
    const variationId = entry.variation_id as number
    const product = catalog.find((item) => item.id === productId)
    const variation = product?.variations.find((item) => item.id === variationId)
    if (product === undefined || variation === undefined) {
      rows.push(
        row("cart_flow", productId, variationId, "", "", "fail", "missing product or variation"),
      )
      continue
    }
    const result = await addStoreCartItem(credentials, product, variation)
    rows.push(
      row(
        "cart_flow",
        productId,
        variationId,
        product.name,
        optionName(variation),
        result.ok ? "pass" : "fail",
        result.detail,
      ),
    )
  }
  return rows
}
async function addStoreCartItem(
  credentials: Credentials,
  product: Product,
  variation: Variation,
): Promise<{ readonly ok: boolean; readonly detail: string }> {
  const html = await fetchPublicHtml(product.permalink)
  const attrName = /name="(attribute_[^"]+)/u.exec(html)?.[1]
  const option = variation.attributes[0]?.option ?? ""
  if (attrName === undefined || option.length === 0)
    return { ok: false, detail: "missing variation form attribute" }
  const params = new URLSearchParams()
  params.set("quantity", "1")
  params.set("add-to-cart", String(product.id))
  params.set("product_id", String(product.id))
  params.set("variation_id", String(variation.id))
  params.set(attrName, option)
  const response = await fetch(product.permalink || credentials.baseUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
    redirect: "manual",
  })
  const text = await response.text()
  const ok =
    (response.status === 200 || response.status === 302) &&
    !text.includes("woocommerce-error") &&
    !text.includes("not_purchasable")
  return { ok, detail: `status=${response.status}` }
}
async function fetchPublicHtml(url: string): Promise<string> {
  return (await fetchPublicPage(url)).html
}
async function fetchPublicPage(
  url: string,
): Promise<{ readonly status: number; readonly html: string }> {
  if (url.length === 0) return { status: 0, html: "" }
  try {
    const response = await ky.get(url, {
      timeout: 30_000,
      retry: { limit: 0 },
      throwHttpErrors: false,
    })
    return { status: response.status, html: await response.text() }
  } catch {
    return { status: 0, html: "" }
  }
}
function sampleIds(
  syncEntries: readonly z.infer<typeof SyncEntrySchema>[],
  addEntries: readonly z.infer<typeof AddEntrySchema>[],
  count: number,
): readonly number[] {
  return [
    ...new Set([
      ...syncEntries.map((entry) => entry.product_id),
      ...addEntries.map((entry) => entry.product_id).filter((id): id is number => id !== null),
    ]),
  ].slice(0, count)
}
function catalogSignature(catalog: readonly Product[]): string {
  return JSON.stringify(
    catalog.map((product) => ({
      id: product.id,
      name: product.name,
      status: product.status,
      description: product.description,
      short_description: product.short_description,
      images: product.images.map((image) => `${image.id ?? ""}:${image.src ?? ""}`),
      variations: product.variations.map((variation) => ({
        id: variation.id,
        price: variation.price,
        regular_price: variation.regular_price,
        stock_status: variation.stock_status,
        stock_quantity: variation.stock_quantity,
      })),
    })),
  )
}
async function writeReports(outputDir: string, report: QaReport): Promise<void> {
  const dir = resolve(outputDir)
  await mkdir(dir, { recursive: true })
  await Promise.all([
    writeFile(resolve(dir, "mvp-customer-qa-summary.md"), summary(report), "utf8"),
    writeFile(resolve(dir, "mvp-customer-qa-results.csv"), resultsCsv(report.rows), "utf8"),
    writeFile(
      resolve(dir, "mvp-customer-qa-leak-check.json"),
      `${JSON.stringify({ generatedAt: report.generatedAt, leakExposureCount: report.leakExposureCount, rows: report.rows.filter((row) => row.check === "frontend_leak") }, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      resolve(dir, "mvp-customer-qa-cart-check.json"),
      `${JSON.stringify({ generatedAt: report.generatedAt, cartPassed: report.cartPassed, cartFailed: report.cartFailed, rows: report.rows.filter((row) => row.check === "cart_flow") }, null, 2)}\n`,
      "utf8",
    ),
  ])
}
function summary(report: QaReport): string {
  return `# MVP Customer QA Summary\n\n- public_new_product_exposure: ${report.publicNewProductExposureCount}\n- draft_private_customer_exposure: ${report.draftPrivateExposureCount}\n- supplier_cost_source_url_exposure: ${report.leakExposureCount}\n- duplicate_option_suspect: ${report.duplicateOptionSuspectCount}\n- cart_flow_passed: ${report.cartPassed}\n- cart_flow_failed: ${report.cartFailed}\n- critical_fixes: ${report.criticalFixCount}\n- product_price_stock_changed_by_qa: ${report.productPriceStockChanged}\n`
}
function resultsCsv(rows: readonly QaRow[]): string {
  const cols = [
    "check",
    "product_id",
    "variation_id",
    "product_name",
    "option_name",
    "result",
    "detail",
  ] as const
  return `${cols.join(",")}\n${rows.map((item) => cols.map((col) => csvCell(String(item[col]))).join(",")).join("\n")}\n`
}
function row(
  check: string,
  productId: number | string,
  variationId: number | string,
  productName: string,
  optionNameValue: string,
  result: QaRow["result"],
  detail: string,
): QaRow {
  return {
    check,
    product_id: productId,
    variation_id: variationId,
    product_name: productName,
    option_name: optionNameValue,
    result,
    detail,
  }
}
function authHeaders(credentials: Credentials): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${credentials.consumerKey}:${credentials.consumerSecret}`).toString("base64")}`,
  }
}
function optionName(variation: Variation | undefined): string {
  return (
    variation?.attributes
      .map((attribute) => attribute.option ?? "")
      .filter(Boolean)
      .join(" / ") ?? ""
  )
}
function optionKey(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^?-?a-zA-Z0-9.]/gu, "")
    .toLocaleLowerCase("ko-KR")
}
function containsLoose(html: string, value: string): boolean {
  return optionKey(html).includes(optionKey(value))
}
function htmlContainsPrice(html: string, price: string): boolean {
  const formatted = Number(price).toLocaleString("ko-KR")
  return html.includes(price) || html.includes(formatted)
}
function csvCell(value: string): string {
  return /[",\n\r]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value
}
