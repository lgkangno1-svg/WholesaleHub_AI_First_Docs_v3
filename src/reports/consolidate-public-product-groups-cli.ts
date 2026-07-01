import { mkdir, readFile, writeFile } from "node:fs/promises"
import ky from "ky"
import { z } from "zod"
import { classifyHubProductCategory } from "./product-category-classifier.js"

const CONFIRM = "CONSOLIDATE_PUBLIC_PRODUCT_GROUPS"
const PRODUCT_PER_PAGE = 100

const ProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  status: z.string(),
  type: z.string(),
  description: z.string().default(""),
  short_description: z.string().default(""),
  images: z
    .array(z.object({ id: z.number().int().optional(), src: z.string().optional() }))
    .default([]),
  categories: z.array(z.object({ id: z.number().int(), name: z.string() })).default([]),
  attributes: z
    .array(
      z.object({
        id: z.number().int().optional(),
        name: z.string().default(""),
        options: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  meta_data: z.array(z.object({ key: z.string(), value: z.unknown() })).default([]),
})
const VariationSchema = z.object({
  id: z.number().int(),
  regular_price: z.string().default(""),
  stock_status: z.string().default(""),
  manage_stock: z.boolean().default(false),
  stock_quantity: z.number().nullable().optional(),
  attributes: z
    .array(z.object({ name: z.string().default(""), option: z.string().default("") }))
    .default([]),
  meta_data: z.array(z.object({ key: z.string(), value: z.unknown() })).default([]),
})
const CategorySchema = z.object({ id: z.number().int(), name: z.string() })
const ProductsSchema = z.array(ProductSchema)
const VariationsSchema = z.array(VariationSchema)
const CategoriesSchema = z.array(CategorySchema)

type Product = z.infer<typeof ProductSchema>
type Variation = z.infer<typeof VariationSchema>
type Credentials = { baseUrl: string; consumerKey: string; consumerSecret: string }
type WooClient = ReturnType<typeof woo>
type ProductBundle = {
  product: Product
  variations: Variation[]
  groupKey: string
  displayName: string
}
type Row = {
  group_key: string
  canonical_product_id: number
  canonical_name_before: string
  canonical_name_after: string
  merged_product_id: number | ""
  merged_product_name: string | ""
  created_variations: number
  updated_variations: number
  trashed: boolean
  status: "merged" | "kept" | "blocked"
  reason_korean: string
}

async function main(): Promise<void> {
  await loadDotEnv()
  const args = parseArgs(process.argv.slice(2))
  if (!args.execute || args.confirm !== CONFIRM) {
    throw new Error(`--execute --confirm "${CONFIRM}" is required`)
  }
  const credentials = {
    baseUrl: env("WOOCOMMERCE_BASE_URL"),
    consumerKey: env("WOOCOMMERCE_CONSUMER_KEY"),
    consumerSecret: env("WOOCOMMERCE_CONSUMER_SECRET"),
  }
  const client = woo(credentials)
  const beforeProducts = await fetchProducts(client, "publish")
  const categoryIds = await fetchCategoryIds(client)
  const bundles: ProductBundle[] = []
  for (const product of beforeProducts) {
    bundles.push({
      product,
      variations: await fetchVariations(client, product.id),
      ...groupInfo(product.name),
    })
  }
  const seafood = bundles.filter((bundle) => isSeafood(bundle.product.name))
  const groups = mapGroups(bundles.filter((bundle) => !isSeafood(bundle.product.name)))
  const rows: Row[] = []
  let mergedGroups = 0
  let trashedProducts = 0
  let createdVariations = 0
  let updatedVariations = 0

  for (const group of groups) {
    if (group.length < 2) continue
    const canonical = chooseCanonical(group)
    const duplicateProducts = group.filter((bundle) => bundle.product.id !== canonical.product.id)
    const plan = buildVariationPlan(group)
    if (plan.blockedReason) {
      for (const duplicate of duplicateProducts)
        rows.push(blockedRow(canonical, duplicate, plan.blockedReason))
      continue
    }
    const options = plan.variations.map((item) => item.option)
    const categoryId = categoryIds.get(classifyHubProductCategory(canonical.displayName))
    const productPayload: Record<string, unknown> = {
      name: canonical.displayName,
      description: buildDescription(canonical.displayName, options),
      short_description: `${canonical.displayName} 옵션 ${options.length}개`,
      attributes: [{ name: "옵션", visible: true, variation: true, options }],
    }
    if (categoryId !== undefined) productPayload["categories"] = [{ id: categoryId }]
    await updateProduct(client, canonical.product.id, productPayload)
    for (const item of plan.variations) {
      if (item.sourceProductId === canonical.product.id) {
        await updateVariation(client, canonical.product.id, item.sourceVariation.id, {
          attributes: [{ name: "옵션", option: item.option }],
        })
        updatedVariations++
      } else {
        await createVariation(client, canonical.product.id, item.sourceVariation, item.option)
        createdVariations++
      }
    }
    let groupTrashed = 0
    for (const duplicate of duplicateProducts) {
      await trashProduct(client, duplicate.product.id)
      groupTrashed++
      trashedProducts++
      rows.push({
        group_key: canonical.groupKey,
        canonical_product_id: canonical.product.id,
        canonical_name_before: canonical.product.name,
        canonical_name_after: canonical.displayName,
        merged_product_id: duplicate.product.id,
        merged_product_name: duplicate.product.name,
        created_variations: plan.variations.filter(
          (item) => item.sourceProductId === duplicate.product.id,
        ).length,
        updated_variations: 0,
        trashed: true,
        status: "merged",
        reason_korean:
          "같은 상품군으로 판단되어 대표 variable product로 통합 후 중복 상품 휴지통 이동",
      })
    }
    if (groupTrashed > 0) mergedGroups++
  }

  for (const bundle of seafood) {
    rows.push({
      group_key: bundle.groupKey,
      canonical_product_id: bundle.product.id,
      canonical_name_before: bundle.product.name,
      canonical_name_after: bundle.displayName,
      merged_product_id: "",
      merged_product_name: "",
      created_variations: 0,
      updated_variations: 0,
      trashed: false,
      status: "blocked",
      reason_korean: "수산물로 감지됨: 별도 삭제 정책 대상이며 이번 통합에서는 생성/병합하지 않음",
    })
  }

  const afterProducts = await fetchProducts(client, "publish")
  const summary = {
    generatedAt: new Date().toISOString(),
    publicBefore: beforeProducts.length,
    publicAfter: afterProducts.length,
    mergedGroups,
    trashedProducts,
    createdVariations,
    updatedVariations,
    blocked: rows.filter((row) => row.status === "blocked").length,
    seafoodExposure: afterProducts.filter((product) => isSeafood(product.name)).length,
    examples: await exampleStatus(client),
  }
  await writeReports(summary, rows)
  console.log(JSON.stringify(summary, null, 2))
}

function parseArgs(args: readonly string[]) {
  const m = new Map<string, string>()
  for (let i = 0; i < args.length; i++) {
    const k = args[i]
    if (k === "--execute") {
      m.set(k, "true")
      continue
    }
    const v = args[i + 1]
    if (!k || !v || !k.startsWith("--")) throw new Error(`invalid argument: ${k ?? "unknown"}`)
    m.set(k, v)
    i++
  }
  return { execute: m.get("--execute") === "true", confirm: m.get("--confirm") ?? "" }
}

function groupInfo(name: string): { groupKey: string; displayName: string } {
  const normalized = normalizeDisplayName(name)
  if (/체리/u.test(normalized)) return { groupKey: key("체리"), displayName: "체리" }
  if (/천도복숭아.*오월/u.test(normalized))
    return { groupKey: key("천도복숭아 오월화 오월도"), displayName: "천도복숭아 오월화 오월도" }
  if (/^햇\s*홍감자\s*\(/u.test(normalized))
    return { groupKey: key("햇 홍감자 등급"), displayName: "햇 홍감자" }
  if (/참외/u.test(normalized)) return { groupKey: key("참외"), displayName: "참외" }
  if (/흑수박/u.test(normalized)) return { groupKey: key("흑수박"), displayName: "흑수박" }
  if (/애플수박/u.test(normalized)) return { groupKey: key("애플수박"), displayName: "애플수박" }
  const generic = normalizeGenericGroup(normalized)
  return { groupKey: key(generic), displayName: generic }
}

function normalizeDisplayName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[★🔥]/gu, " ")
    .replace(
      /\[[^\]]*(?:행사|긴급|특가|상품|복날|제스프리|5월|개당|박스포함|실중량)[^\]]*\]/gu,
      " ",
    )
    .replace(/\s+/gu, " ")
    .trim()
}

function normalizeGenericGroup(name: string): string {
  return (
    name
      .replace(/\b\d+\s*\.\s*$/gu, " ")
      .replace(/\b\d+\s*\.\s*/gu, " ")
      .replace(
        /\([^)]*(?:특대과|대과|중대과|중과|중소과|소과|혼합과|로얄과|가정용|특|중|대|왕특|실중량|박스포함)[^)]*\)/gu,
        " ",
      )
      .replace(
        /(?:특대과|대과|중대과|중과|중소과|소과|혼합과|로얄과|가정용|특품|실속형|왕특|특|중|대|랜덤과|못난이|혼합)\b/gu,
        " ",
      )
      .replace(
        /\d+(?:\.\d+)?(?:~\d+(?:\.\d+)?)?\s*(?:kg|g|통|개입|개|팩|봉|박스|망|과|입|수)\b/giu,
        " ",
      )
      .replace(/\b(?:시즌오픈|오픈특가|노마진|특가|첫출시|박스포함|실중량)\b/gu, " ")
      .replace(/\s+/gu, " ")
      .trim() || name.trim()
  )
}

function buildVariationPlan(group: readonly ProductBundle[]) {
  const items = group.flatMap((bundle) =>
    bundle.variations.map((variation) => ({
      sourceProductId: bundle.product.id,
      sourceProductName: bundle.product.name,
      sourceVariation: variation,
      option: optionFor(bundle.product.name, variation),
      optionKey: optionKey(optionFor(bundle.product.name, variation)),
    })),
  )
  const seen = new Map<string, (typeof items)[number]>()
  const deduped: typeof items = []
  for (const item of items) {
    const existing = seen.get(item.optionKey)
    if (!existing) {
      seen.set(item.optionKey, item)
      deduped.push(item)
      continue
    }
    if (!sameSellState(existing.sourceVariation, item.sourceVariation)) {
      return { variations: deduped, blockedReason: `동일 옵션 가격/재고 충돌: ${item.option}` }
    }
  }
  return {
    variations: deduped.sort((a, b) => a.option.localeCompare(b.option, "ko-KR")),
    blockedReason: "",
  }
}

function optionFor(productName: string, variation: Variation): string {
  const current =
    variation.attributes
      .map((attr) => attr.option)
      .filter(Boolean)
      .join(" / ") || "기본"
  const descriptor = optionDescriptorFromProduct(productName)
  if (!descriptor) return current
  if (current === "기본") return descriptor
  if (optionKey(current).includes(optionKey(descriptor))) return current
  return `${descriptor} ${current}`.replace(/\s+/gu, " ").trim()
}

function optionDescriptorFromProduct(name: string): string {
  const text = normalizeDisplayName(name)
  const parts = [
    ...text.matchAll(
      /특대과|대과|중대과|중과|중소과|소과|혼합과|로얄과|가정용|특품|실속형|왕특|특|중|대|랜덤과|못난이|혼합/gu,
    ),
    ...text.matchAll(
      /\d+(?:\.\d+)?(?:~\d+(?:\.\d+)?)?\s*(?:kg|g|통|개입|개|팩|봉|박스|망|과|입|수)\b/giu,
    ),
  ].map((match) => match[0])
  return [...new Set(parts)].join(" ").trim()
}

function sameSellState(a: Variation, b: Variation): boolean {
  return Number(a.regular_price) === Number(b.regular_price) && a.stock_status === b.stock_status
}

function mapGroups(bundles: readonly ProductBundle[]): ProductBundle[][] {
  const byKey = new Map<string, ProductBundle[]>()
  for (const bundle of bundles)
    byKey.set(bundle.groupKey, [...(byKey.get(bundle.groupKey) ?? []), bundle])
  return [...byKey.values()].filter((group) => group.length > 1)
}

function chooseCanonical(group: readonly ProductBundle[]): ProductBundle {
  return [...group].sort(
    (a, b) =>
      b.variations.length - a.variations.length ||
      a.product.name.length - b.product.name.length ||
      a.product.id - b.product.id,
  )[0] as ProductBundle
}

async function fetchProducts(client: WooClient, status: string): Promise<Product[]> {
  const products: Product[] = []
  for (let page = 1; page <= 30; page++) {
    const rows = ProductsSchema.parse(
      await ky
        .get(`${client.baseUrl}/wp-json/wc/v3/products`, {
          headers: client.headers,
          searchParams: { status, per_page: String(PRODUCT_PER_PAGE), page: String(page) },
          timeout: 60000,
          retry: { limit: 1 },
        })
        .json(),
    )
    products.push(...rows)
    if (rows.length < PRODUCT_PER_PAGE) break
  }
  return products
}

async function fetchVariations(client: WooClient, productId: number): Promise<Variation[]> {
  const rows = VariationsSchema.parse(
    await ky
      .get(`${client.baseUrl}/wp-json/wc/v3/products/${productId}/variations`, {
        headers: client.headers,
        searchParams: { status: "any", per_page: "100" },
        timeout: 180000,
        retry: { limit: 2 },
      })
      .json(),
  )
  return rows
}

async function updateProduct(
  client: WooClient,
  productId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  await ky.put(`${client.baseUrl}/wp-json/wc/v3/products/${productId}`, {
    headers: client.headers,
    json: payload,
    timeout: 60000,
    retry: { limit: 0 },
  })
}

async function updateVariation(
  client: WooClient,
  productId: number,
  variationId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  await ky.put(`${client.baseUrl}/wp-json/wc/v3/products/${productId}/variations/${variationId}`, {
    headers: client.headers,
    json: payload,
    timeout: 60000,
    retry: { limit: 0 },
  })
}

async function createVariation(
  client: WooClient,
  productId: number,
  source: Variation,
  option: string,
): Promise<void> {
  await ky.post(`${client.baseUrl}/wp-json/wc/v3/products/${productId}/variations`, {
    headers: client.headers,
    json: {
      regular_price: source.regular_price,
      stock_status: source.stock_status,
      manage_stock: source.manage_stock,
      stock_quantity: source.stock_quantity ?? undefined,
      attributes: [{ name: "옵션", option }],
      meta_data: source.meta_data,
    },
    timeout: 60000,
    retry: { limit: 0 },
  })
}

async function trashProduct(client: WooClient, productId: number): Promise<void> {
  await ky.delete(`${client.baseUrl}/wp-json/wc/v3/products/${productId}`, {
    headers: client.headers,
    searchParams: { force: "false" },
    timeout: 60000,
    retry: { limit: 0 },
  })
}

async function fetchCategoryIds(client: WooClient): Promise<Map<string, number>> {
  const rows = CategoriesSchema.parse(
    await ky
      .get(`${client.baseUrl}/wp-json/wc/v3/products/categories`, {
        headers: client.headers,
        searchParams: { per_page: "100" },
        timeout: 180000,
        retry: { limit: 2 },
      })
      .json(),
  )
  return new Map(rows.map((row) => [row.name, row.id]))
}

async function exampleStatus(
  client: WooClient,
): Promise<
  Record<string, { productCount: number; variationCount: number; productNames: string[] }>
> {
  const products = await fetchProducts(client, "publish")
  const examples = ["체리", "천도복숭아", "햇 홍감자", "참외", "흑수박", "애플수박"]
  const out: Record<
    string,
    { productCount: number; variationCount: number; productNames: string[] }
  > = {}
  for (const example of examples) {
    const matched = products.filter((product) => product.name.includes(example))
    let variationCount = 0
    for (const product of matched)
      variationCount += (await fetchVariations(client, product.id)).length
    out[example] = {
      productCount: matched.length,
      variationCount,
      productNames: matched.map((product) => product.name),
    }
  }
  return out
}

function buildDescription(productName: string, options: readonly string[]): string {
  return `<div class="wholesalehub-product-detail"><p>${escapeHtml(productName)}</p><ul>${options.map((option) => `<li>${escapeHtml(option)}</li>`).join("")}</ul></div>`
}

function blockedRow(canonical: ProductBundle, duplicate: ProductBundle, reason: string): Row {
  return {
    group_key: canonical.groupKey,
    canonical_product_id: canonical.product.id,
    canonical_name_before: canonical.product.name,
    canonical_name_after: canonical.displayName,
    merged_product_id: duplicate.product.id,
    merged_product_name: duplicate.product.name,
    created_variations: 0,
    updated_variations: 0,
    trashed: false,
    status: "blocked",
    reason_korean: reason,
  }
}

function isSeafood(name: string): boolean {
  return /새조개|통멍게|멍게|쭈꾸미|주꾸미|오징어|문어|낙지|갈치|고등어|장어|바지락|전복|새우|꽃게|게|홍합|굴|조개|꼬막|미역|다시마|김\b|해물|수산|생선|명태|동태|황태|코다리|가자미|연어|참치|삼치|꽁치|아귀|대구|우럭|광어|도미|멸치|건어물|어묵|젓갈/u.test(
    name,
  )
}

function key(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^가-힣a-zA-Z0-9]/gu, "")
    .toLocaleLowerCase("ko-KR")
}

function optionKey(value: string): string {
  return key(value)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;")
}

async function writeReports(summary: unknown, rows: readonly Row[]): Promise<void> {
  await mkdir("reports", { recursive: true })
  await writeFile(
    "reports/public-product-group-consolidation.json",
    `${JSON.stringify({ summary, rows }, null, 2)}\n`,
  )
  await writeFile("reports/public-product-group-consolidation.csv", toCsv(rows))
  const s = summary as {
    publicBefore: number
    publicAfter: number
    mergedGroups: number
    trashedProducts: number
    blocked: number
    seafoodExposure: number
  }
  await writeFile(
    "reports/public-product-group-consolidation-summary.md",
    [
      "# Public Product Group Consolidation",
      "",
      `- public_before: ${s.publicBefore}`,
      `- public_after: ${s.publicAfter}`,
      `- merged_groups: ${s.mergedGroups}`,
      `- trashed_duplicate_products: ${s.trashedProducts}`,
      `- blocked: ${s.blocked}`,
      `- seafood_exposure: ${s.seafoodExposure}`,
      "- price/stock/order/customer-secret data changed: no",
    ].join("\n"),
  )
}

function toCsv(rows: readonly Row[]): string {
  const header = [
    "group_key",
    "canonical_product_id",
    "canonical_name_before",
    "canonical_name_after",
    "merged_product_id",
    "merged_product_name",
    "created_variations",
    "updated_variations",
    "trashed",
    "status",
    "reason_korean",
  ] as const
  return `${[header, ...rows.map((row) => header.map((field) => row[field]))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n")}\n`
}

function csvCell(value: string | number | boolean): string {
  return `"${String(value).replace(/"/gu, '""')}"`
}

function woo(c: Credentials) {
  return {
    baseUrl: c.baseUrl.replace(/\/$/u, ""),
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.consumerKey}:${c.consumerSecret}`).toString("base64")}`,
    },
  }
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

function env(keyName: string): string {
  const value = process.env[keyName]?.trim()
  if (!value) throw new Error(`${keyName} is required`)
  return value
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

main().catch((error) => {
  console.error(message(error))
  process.exitCode = 1
})
