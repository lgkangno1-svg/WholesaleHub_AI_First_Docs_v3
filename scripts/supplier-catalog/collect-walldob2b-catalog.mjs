import { mkdir, readFile, writeFile } from "node:fs/promises"
import { fetchWalldob2bDetailHtml } from "../../dist/adapters/walldob2b/walldob2b-adapter.js"
import {
  fetchWalldob2bProductExcel,
  parseWalldob2bProductExcelHtml,
} from "../../dist/adapters/walldob2b/walldob2b-excel-download.js"
import {
  extractProductImageCandidates,
  validateSourceImageCandidates,
} from "../../dist/reports/product-thumbnail-integrity.js"

for (const line of (await readFile(".env", "utf8")).split(/\r?\n/u)) {
  const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line)
  if (match?.[1] && process.env[match[1]] === undefined) {
    process.env[match[1]] = match[2] ?? ""
  }
}

const username = process.env.WALLDOB2B_USERNAME ?? ""
const password = process.env.WALLDOB2B_PASSWORD ?? ""
const outputDirectory = "reports/rebuild"
await mkdir(outputDirectory, { recursive: true })
const html = await fetchWalldob2bProductExcel({ username, password })
const parsed = parseWalldob2bProductExcelHtml(html, 10_000)
const exclusions = parsed.skippedRows
  .filter((row) => row.reason !== "empty_row")
  .map((row) => ({
    supplier: "walldob2b",
    rowNumber: row.rowNumber,
    reason: row.reason,
  }))
const rawRows = parsed.products.flatMap((product, index) => {
  let raw
  try {
    raw = JSON.parse(product.rawJson)
  } catch {
    exclusions.push({
      supplier: "walldob2b",
      rowNumber: index + 2,
      reason: "invalid_raw_json",
    })
    return []
  }
  const sourceProductId = String(raw.sourceProductId ?? "").trim()
  const sourceOptionId = String(raw.sourceOptionId ?? "").trim()
  if (!sourceProductId || !sourceOptionId) {
    exclusions.push({
      supplier: "walldob2b",
      rowNumber: index + 2,
      reason: !sourceProductId
        ? "authoritative_product_id_missing"
        : "authoritative_option_id_missing",
    })
    return []
  }
  if (String(product.originalProductName ?? "").includes("가성비")) {
    exclusions.push({
      supplier: "walldob2b",
      sourceProductId,
      sourceOptionId,
      url: product.productUrl,
      reason: "terminal_excluded",
      keyword: "가성비",
    })
    return []
  }
  return [
    {
      sourceProductId,
      sourceOptionId,
      productName: product.originalProductName,
      optionName: product.originalOptionName ?? "기본",
      price: product.price,
      stockStatus: product.stockStatus,
      detailUrl: product.productUrl,
      listImageUrl: String(product.imageUrl ?? raw.imageUrl ?? ""),
    },
  ]
})

const duplicateOptionIds = duplicateCount(
  rawRows.map((row) => `${row.sourceProductId}\u0000${row.sourceOptionId}`),
)
if (duplicateOptionIds > 0) {
  const seen = new Set()
  for (const row of rawRows) {
    const key = `${row.sourceProductId}\u0000${row.sourceOptionId}`
    if (seen.has(key)) {
      exclusions.push({
        supplier: "walldob2b",
        sourceProductId: row.sourceProductId,
        sourceOptionId: row.sourceOptionId,
        url: row.detailUrl,
        reason: "duplicate_option_id",
      })
    }
    seen.add(key)
  }
}

const productIds = [...new Set(rawRows.map((row) => row.sourceProductId))]
const details = {}
for (const productId of productIds) {
  const url = `https://walldob2b.com/shop/item.php?it_id=${encodeURIComponent(productId)}`
  let lastReason = "unknown"
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 700))
    try {
      const detailHtml = await fetchWalldob2bDetailHtml(productId, {
        username,
        password,
      })
      const loginPage = /name=["']mb_password["']/iu.test(detailHtml)
      if (!loginPage && detailHtml.length > 0) {
        details[productId] = {
          ok: true,
          status: 200,
          url,
          soldOut: /상품의\s*재고가\s*부족|품절|sold\s*out/iu.test(
            stripTags(detailHtml.replace(/<option\b[^>]*>[\s\S]*?<\/option>/giu, " ")),
          ),
          shippingFee: shippingFee(detailHtml),
          imageCandidates: extractProductImageCandidates(
            detailHtml,
            "https://walldob2b.com",
            rawRows.find((row) => row.sourceProductId === productId)?.listImageUrl ?? null,
            productId,
          ),
          providerOptionValues: [
            ...detailHtml.matchAll(/<option\b[^>]*\bvalue=["']([^"']+)["'][^>]*>/giu),
          ]
            .map((match) => match[1] ?? "")
            .filter(Boolean),
        }
        lastReason = ""
        break
      }
      lastReason = "login_page_returned"
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error)
    }
  }
  if (!details[productId]) {
    details[productId] = {
      ok: false,
      status: 0,
      url,
      reason: lastReason,
      soldOut: false,
      shippingFee: 0,
      providerOptionValues: [],
      imageCandidates: [],
    }
    exclusions.push({
      supplier: "walldob2b",
      sourceProductId: productId,
      url,
      reason: "detail_fetch_failed",
    })
  }
}

const grouped = new Map()
for (const row of rawRows) {
  const detail = details[row.sourceProductId]
  if (!detail?.ok) continue
  const group = grouped.get(row.sourceProductId) ?? {
    supplierId: "walldob2b",
    lane: "B",
    sourceProductId: row.sourceProductId,
    sourceIdType: "authoritative",
    productName: row.productName,
    detailUrl: row.detailUrl,
    imageCandidates: detail.imageCandidates,
    options: [],
  }
  group.options.push({
    sourceOptionId: row.sourceOptionId,
    sourceIdType: "authoritative",
    optionName: row.optionName,
    price: row.price,
    stockStatus: detail.soldOut || row.stockStatus === "out_of_stock" ? "out_of_stock" : "in_stock",
    shippingFee: detail.shippingFee,
    providerOptionValues: detail.providerOptionValues,
    specs: parseSpecs(`${row.productName} ${row.optionName}`),
    detailUrl: detail.url,
  })
  grouped.set(row.sourceProductId, group)
}

const products = []
for (const group of grouped.values()) {
  const image = await validateSourceImageCandidates(group.imageCandidates, {
    sourceType: "walldob2b_actual_product",
    expectedHosts: ["walldob2b.com"],
  })
  products.push({
    ...group,
    ...image,
    imageUrl: image.source_image_url,
  })
}
const snapshot = {
  schemaVersion: 1,
  supplier: "walldob2b",
  generatedAt: new Date().toISOString(),
  complete:
    parsed.totalRows < 10_000 &&
    duplicateOptionIds === 0 &&
    Object.values(details).every((detail) => detail.ok),
  source: {
    exportRowCount: parsed.totalRows,
    detailRequestCount: productIds.length,
    detailSuccessCount: Object.values(details).filter((detail) => detail.ok).length,
    detailFailureCount: Object.values(details).filter((detail) => !detail.ok).length,
  },
  counts: {
    products: products.length,
    options: products.reduce((sum, product) => sum + product.options.length, 0),
    excluded: exclusions.length,
    authoritative: products.reduce((sum, product) => sum + product.options.length, 0),
    duplicateProductIds: duplicateCount(products.map((product) => product.sourceProductId)),
    duplicateOptionIds,
    withImages: products.filter((product) => product.image_validation_status === "valid").length,
    missingImages: products.filter((product) => product.image_validation_status !== "valid").length,
    terminalExcluded: exclusions.filter((entry) => entry.reason === "terminal_excluded").length,
  },
  products,
  exclusions,
}
await writeFile(
  `${outputDirectory}/walldob2b-catalog-snapshot.json`,
  `${JSON.stringify(snapshot, null, 2)}\n`,
)
console.log(JSON.stringify({ complete: snapshot.complete, ...snapshot.counts }))

function shippingFee(detailHtml) {
  const text = stripTags(detailHtml)
  const match = /배송비[^0-9]{0,30}([0-9,]+)\s*원/u.exec(text)
  return match?.[1] ? Number(match[1].replaceAll(",", "")) : 0
}

function parseSpecs(value) {
  const weight = /(\d+(?:\.\d+)?)\s*(kg|g)\b/iu.exec(value)
  const quantity = /(\d+)\s*(개입|개|과|팩|봉|박스|망|통)\b/iu.exec(value)
  return {
    weightValue: weight?.[1] ? Number(weight[1]) : null,
    weightUnit: weight?.[2]?.toLowerCase() ?? null,
    quantity: quantity?.[1] ? Number(quantity[1]) : null,
    quantityUnit: quantity?.[2] ?? null,
  }
}

function stripTags(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/\s+/gu, " ")
    .trim()
}

function duplicateCount(values) {
  const seen = new Set()
  let duplicates = 0
  for (const value of values) {
    if (seen.has(value)) duplicates += 1
    else seen.add(value)
  }
  return duplicates
}
