import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { parse } from "csv-parse/sync"
import ky from "ky"
import { z } from "zod"

const CONFIRM = "TRASH_DUPLICATE_DRAFT_PRIVATE_ONLY"

const MetaSchema = z.object({ key: z.string(), value: z.unknown() })
const AttributeSchema = z.object({ name: z.string(), option: z.string().optional() })
const ProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  type: z.string(),
  status: z.string(),
  permalink: z.string().optional().default(""),
  catalog_visibility: z.string().optional().default("visible"),
  meta_data: z.array(MetaSchema).optional().default([]),
})
const VariationSchema = z.object({
  id: z.number().int(),
  price: z.string().nullable().optional(),
  stock_status: z.string().nullable().optional(),
  stock_quantity: z.number().nullable().optional(),
  attributes: z.array(AttributeSchema).optional().default([]),
  meta_data: z.array(MetaSchema).optional().default([]),
})
const OrderSchema = z.object({
  id: z.number().int(),
  line_items: z.array(z.object({ product_id: z.number().int(), variation_id: z.number().int() })),
})

type ProductBase = z.infer<typeof ProductSchema>
type Variation = z.infer<typeof VariationSchema> & { readonly productId: number }
type Product = ProductBase & { readonly variations: readonly Variation[] }
type Credentials = {
  readonly baseUrl: string
  readonly consumerKey: string
  readonly consumerSecret: string
}
type ReviewRow = {
  readonly productId: number
  readonly productName: string
  readonly status: string
  readonly variationCount: number
  readonly matchedPublishedProductId: number | null
  readonly decision: "trash" | "keep"
  readonly trashed: boolean
  readonly reasons: readonly string[]
}

type Result = {
  readonly generatedAt: string
  readonly beforeDraftPrivateCount: number
  readonly trashedCount: number
  readonly afterDraftPrivateCount: number
  readonly publishedChangedCount: number
  readonly rows: readonly ReviewRow[]
}

async function main(): Promise<void> {
  await loadDotEnv()
  const args = parseArgs(process.argv.slice(2))
  if (!args.execute || args.confirm !== CONFIRM)
    throw new Error(`--execute --confirm "${CONFIRM}" is required`)
  const credentials = {
    baseUrl: readRequiredEnv("WOOCOMMERCE_BASE_URL"),
    consumerKey: readRequiredEnv("WOOCOMMERCE_CONSUMER_KEY"),
    consumerSecret: readRequiredEnv("WOOCOMMERCE_CONSUMER_SECRET"),
  }
  const result = await cleanupDuplicateDrafts(credentials, args.outputDir)
  console.log(
    JSON.stringify(
      {
        beforeDraftPrivateCount: result.beforeDraftPrivateCount,
        trashedCount: result.trashedCount,
        afterDraftPrivateCount: result.afterDraftPrivateCount,
        publishedChangedCount: result.publishedChangedCount,
      },
      null,
      2,
    ),
  )
}

function parseArgs(args: readonly string[]): {
  execute: boolean
  confirm: string
  outputDir: string
} {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    if (key === "--execute") {
      values.set(key, "true")
      continue
    }
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--"))
      throw new Error(`invalid argument: ${key ?? "unknown"}`)
    values.set(key, value)
    index += 1
  }
  return {
    execute: values.get("--execute") === "true",
    confirm: values.get("--confirm") ?? "",
    outputDir: values.get("--out-dir") ?? "reports",
  }
}

async function cleanupDuplicateDrafts(
  credentials: Credentials,
  outputDir: string,
): Promise<Result> {
  const before = await fetchCatalog(credentials)
  const publishedBefore = before.filter((product) => product.status === "publish")
  const draftsBefore = before.filter(
    (product) => product.status === "draft" || product.status === "private",
  )
  const orderLinks = await fetchOrderLinks(credentials)
  const mergeMatches = await loadMergeMatches("reports/draft-vs-existing-merge-plan.csv")
  const client = wooClient(credentials)
  const rows: ReviewRow[] = []

  for (const product of draftsBefore) {
    const review = await reviewDraftProduct(
      credentials,
      product,
      publishedBefore,
      orderLinks,
      mergeMatches,
    )
    if (review.decision !== "trash") {
      rows.push(review)
      continue
    }
    try {
      const trashed = ProductSchema.parse(
        await ky
          .delete(`${client.baseUrl}/wp-json/wc/v3/products/${product.id}`, {
            headers: client.headers,
            searchParams: { force: "false" },
            timeout: 60_000,
            retry: { limit: 0 },
          })
          .json(),
      )
      rows.push({ ...review, trashed: trashed.status === "trash" || trashed.status !== "publish" })
    } catch (error) {
      rows.push({
        ...review,
        decision: "keep",
        trashed: false,
        reasons: [...review.reasons, message(error)],
      })
    }
  }

  const after = await fetchCatalog(credentials)
  const result: Result = {
    generatedAt: new Date().toISOString(),
    beforeDraftPrivateCount: draftsBefore.length,
    trashedCount: rows.filter((row) => row.trashed).length,
    afterDraftPrivateCount: after.filter(
      (product) => product.status === "draft" || product.status === "private",
    ).length,
    publishedChangedCount: changedPublishedCount(
      publishedBefore,
      after.filter((product) => product.status === "publish"),
    ),
    rows,
  }
  await writeReports(outputDir, result)
  return result
}

async function reviewDraftProduct(
  credentials: Credentials,
  draft: Product,
  published: readonly Product[],
  orderLinks: ReadonlySet<string>,
  mergeMatches: ReadonlyMap<number, number>,
): Promise<ReviewRow> {
  const reasons: string[] = []
  const draftOptions = draft.variations.map(optionName).filter((value) => value.length > 0)
  if (draftOptions.length === 0) reasons.push("no_clear_draft_options")
  if (
    orderLinks.has(`p:${draft.id}`) ||
    draft.variations.some((item) => orderLinks.has(`v:${item.id}`))
  )
    reasons.push("has_order_link")
  if (await isPubliclyExposed(credentials, draft)) reasons.push("customer_exposure_suspected")

  const mappedPublishedId = mergeMatches.get(draft.id) ?? null
  const sameGroup = published.filter(
    (item) => item.id === mappedPublishedId || productKey(item.name) === productKey(draft.name),
  )
  if (sameGroup.length === 0) reasons.push("no_same_published_product_group")
  const matched = sameGroup.find((item) => allOptionsExist(draftOptions, item)) ?? null
  if (matched === null) reasons.push("published_options_not_all_present")

  const decision = reasons.length === 0 && matched !== null ? "trash" : "keep"
  return {
    productId: draft.id,
    productName: draft.name,
    status: draft.status,
    variationCount: draft.variations.length,
    matchedPublishedProductId: matched?.id ?? null,
    decision,
    trashed: false,
    reasons,
  }
}

function allOptionsExist(draftOptions: readonly string[], published: Product): boolean {
  const keys = new Set(published.variations.map((item) => optionKey(optionName(item))))
  return draftOptions.length > 0 && draftOptions.every((option) => keys.has(optionKey(option)))
}

async function loadMergeMatches(path: string): Promise<ReadonlyMap<number, number>> {
  try {
    const content = await readFile(path, "utf8")
    const rows = parse(content, { columns: true, skip_empty_lines: true }) as Array<
      Record<string, string>
    >
    const matches = new Map<number, number>()
    for (const row of rows) {
      if (
        row["match_status"] !== "partial_missing_options" &&
        row["match_status"] !== "duplicate_existing_product"
      )
        continue
      const draftId = Number(row["draft_product_id"])
      const publishedId = Number(row["matched_existing_product_id"])
      if (Number.isInteger(draftId) && Number.isInteger(publishedId))
        matches.set(draftId, publishedId)
    }
    return matches
  } catch {
    return new Map<number, number>()
  }
}

async function isPubliclyExposed(_credentials: Credentials, product: Product): Promise<boolean> {
  if (product.status === "publish") return true
  if (product.permalink.length === 0) return false
  try {
    const html = await ky
      .get(product.permalink, {
        timeout: 15_000,
        retry: { limit: 0 },
        headers: { "user-agent": "WholesaleHub QA" },
      })
      .text()
    return html.includes(product.name) && !html.includes("woocommerce-error")
  } catch {
    return false
  }
}

async function fetchCatalog(credentials: Credentials): Promise<readonly Product[]> {
  const client = wooClient(credentials)
  const products = z.array(ProductSchema).parse(
    await fetchAllPages((page) =>
      ky.get(`${client.baseUrl}/wp-json/wc/v3/products`, {
        headers: client.headers,
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
          ky.get(`${client.baseUrl}/wp-json/wc/v3/products/${product.id}/variations`, {
            headers: client.headers,
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

async function fetchOrderLinks(credentials: Credentials): Promise<ReadonlySet<string>> {
  const client = wooClient(credentials)
  const orders = z.array(OrderSchema).parse(
    await fetchAllPages((page) =>
      ky.get(`${client.baseUrl}/wp-json/wc/v3/orders`, {
        headers: client.headers,
        searchParams: { per_page: "100", page: String(page), status: "any" },
        timeout: 60_000,
        retry: { limit: 1 },
      }),
    ),
  )
  const links = new Set<string>()
  for (const order of orders) {
    for (const item of order.line_items) {
      links.add(`p:${item.product_id}`)
      if (item.variation_id > 0) links.add(`v:${item.variation_id}`)
    }
  }
  return links
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

function changedPublishedCount(before: readonly Product[], after: readonly Product[]): number {
  const afterMap = new Map(after.map((product) => [product.id, productSignature(product)]))
  return before.filter((product) => afterMap.get(product.id) !== productSignature(product)).length
}

function productSignature(product: Product): string {
  return JSON.stringify({
    id: product.id,
    name: product.name,
    type: product.type,
    status: product.status,
    visibility: product.catalog_visibility,
    variations: product.variations.map((item) => ({
      id: item.id,
      option: optionName(item),
      price: item.price ?? "",
      stock: item.stock_status ?? "",
      qty: item.stock_quantity ?? null,
    })),
  })
}

function optionName(variation: Variation): string {
  return variation.attributes
    .map((attribute) => attribute.option ?? "")
    .filter(Boolean)
    .join(" / ")
}

function productKey(value: string): string {
  return clean(value)
}

function optionKey(value: string): string {
  const normalized = value.normalize("NFKC")
  const matches = [
    ...normalized.matchAll(/\d+(?:\.\d+)?\s*(?:kg|g|개입|개|팩|봉|박스|망|과|r|센치|cm)/giu),
  ].map((match) => clean(match[0] ?? ""))
  return matches.length > 0 ? matches.join("|") : clean(normalized)
}

function clean(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/&[a-z0-9#]+;/giu, "")
    .replace(/[^가-힣a-zA-Z0-9.]/gu, "")
    .toLocaleLowerCase("ko-KR")
}

function wooClient(credentials: Credentials): {
  readonly baseUrl: string
  readonly headers: Record<string, string>
} {
  return {
    baseUrl: credentials.baseUrl.replace(/\/$/u, ""),
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.consumerKey}:${credentials.consumerSecret}`).toString("base64")}`,
    },
  }
}

async function writeReports(outputDir: string, result: Result): Promise<void> {
  const dir = resolve(outputDir)
  await mkdir(dir, { recursive: true })
  await Promise.all([
    writeFile(
      resolve(dir, "draft-private-duplicate-cleanup.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    ),
    writeFile(resolve(dir, "draft-private-duplicate-cleanup.csv"), cleanupCsv(result.rows), "utf8"),
    writeFile(
      resolve(dir, "draft-private-duplicate-cleanup-summary.md"),
      cleanupSummary(result),
      "utf8",
    ),
  ])
}

function cleanupCsv(rows: readonly ReviewRow[]): string {
  const cols = [
    "product_id",
    "product_name",
    "status",
    "variation_count",
    "matched_published_product_id",
    "decision",
    "trashed",
    "reasons",
  ] as const
  return `${cols.join(",")}\n${rows
    .map((row) =>
      [
        row.productId,
        row.productName,
        row.status,
        row.variationCount,
        row.matchedPublishedProductId ?? "",
        row.decision,
        row.trashed,
        row.reasons.join(";"),
      ]
        .map((value) => csvCell(String(value)))
        .join(","),
    )
    .join("\n")}\n`
}

function cleanupSummary(result: Result): string {
  return `# Draft/Private Duplicate Cleanup Summary\n\n- generated_at: ${result.generatedAt}\n- before_draft_private_count: ${result.beforeDraftPrivateCount}\n- trashed_count: ${result.trashedCount}\n- after_draft_private_count: ${result.afterDraftPrivateCount}\n- published_changed_count: ${result.publishedChangedCount}\n- kept_count: ${result.rows.filter((row) => !row.trashed).length}\n\nOnly draft/private products that matched a published product group, had all options already present in published variations, had no order links, and were not publicly exposed were moved to trash. Published products were not modified.\n`
}

function csvCell(value: string): string {
  return /[",\n\r]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value
}

function readRequiredEnv(key: string): string {
  const value = process.env[key]?.trim()
  if (value === undefined || value.length === 0) throw new Error(`${key} is required`)
  return value
}

async function loadDotEnv(): Promise<void> {
  try {
    const env = await readFile(".env", "utf8")
    for (const line of env.split(/\r?\n/u)) {
      const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line)
      if (match?.[1] !== undefined && process.env[match[1]] === undefined)
        process.env[match[1]] = match[2] ?? ""
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
