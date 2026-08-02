import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { sourceProductExclusionReason } from "./catalog-exclusions.mjs"

const dryRunTitleIndex = process.argv.indexOf("--dry-run-title")
if (dryRunTitleIndex >= 0) {
  const title = process.argv[dryRunTitleIndex + 1] ?? ""
  const reason = excludedReason(title)
  console.log(JSON.stringify({ title, included: reason === null, reason }))
  process.exit(0)
}

const dryRunSourceIndex = process.argv.indexOf("--dry-run-source-label")
if (dryRunSourceIndex >= 0) {
  const sourceOptionLabel = sourceLabel(process.argv[dryRunSourceIndex + 1] ?? "")
  console.log(JSON.stringify(sourceSpecFields(sourceOptionLabel)))
  process.exit(0)
}

const dryRunSourceProductIndex = process.argv.indexOf("--dry-run-source-product")
if (dryRunSourceProductIndex >= 0) {
  const supplierId = process.argv[dryRunSourceProductIndex + 1] ?? ""
  const sourceProductId = process.argv[dryRunSourceProductIndex + 2] ?? ""
  const reason = sourceProductExclusionReason(supplierId, sourceProductId)
  console.log(
    JSON.stringify({
      supplierId,
      sourceProductId,
      included: reason === null,
      reason,
    }),
  )
  process.exit(0)
}

const directory = "reports/rebuild"
const daily = JSON.parse(await readFile(`${directory}/dailyfood-catalog-snapshot.json`, "utf8"))
const walldo = JSON.parse(await readFile(`${directory}/walldob2b-catalog-snapshot.json`, "utf8"))
const normalizationCache = loadNormalizationCache("data/wholesalehub.sqlite")
if (!daily.complete || !walldo.complete) {
  throw new Error(`snapshot incomplete: dailyfood=${daily.complete}, walldob2b=${walldo.complete}`)
}

const exclusions = [...daily.exclusions, ...walldo.exclusions]
const imageReviews = []
const repeatedImageHashes = repeatedUnrelatedImageHashes([...daily.products, ...walldo.products])
const dailyProducts = eligibleProducts(
  daily.products,
  exclusions,
  imageReviews,
  repeatedImageHashes,
)
const walldoProducts = eligibleProducts(
  walldo.products,
  exclusions,
  imageReviews,
  repeatedImageHashes,
)
const dailyByKey = groupBy(dailyProducts, (product) =>
  canonicalProductKey(
    normalizationCache.get(`dailyfood\u0000${product.productName}`) ?? product.productName,
  ),
)
const walldoByKey = groupBy(walldoProducts, (product) =>
  canonicalProductKey(
    normalizationCache.get(`walldob2b\u0000${product.productName}`) ?? product.productName,
  ),
)
const groups = []
const reviews = [...imageReviews]
const usedDaily = new Set()
const usedWalldo = new Set()
for (const key of [...new Set([...dailyByKey.keys(), ...walldoByKey.keys()])]) {
  const laneA = dailyByKey.get(key) ?? []
  const laneB = walldoByKey.get(key) ?? []
  if (key && laneA.length === 1 && laneB.length === 1) {
    const a = laneA[0]
    const b = laneB[0]
    groups.push(buildGroup(`AB:${key}`, a, b))
    usedDaily.add(a.sourceProductId)
    usedWalldo.add(b.sourceProductId)
  } else if (laneA.length > 0 && laneB.length > 0) {
    reviews.push({
      reason: "ambiguous_same_product",
      canonicalKey: key,
      laneA: laneA.map(reviewProduct),
      laneB: laneB.map(reviewProduct),
    })
  }
}
for (const product of dailyProducts) {
  if (!usedDaily.has(product.sourceProductId)) {
    groups.push(buildGroup(`A:${product.sourceProductId}`, product, null))
  }
}
for (const product of walldoProducts) {
  if (!usedWalldo.has(product.sourceProductId)) {
    groups.push(buildGroup(`B:${product.sourceProductId}`, null, product))
  }
}

const validGroups = []
for (const group of groups) {
  const lanes = {}
  for (const [lane, source] of Object.entries(group.lanes)) {
    const uniqueOptionIds = new Set()
    const options = []
    for (const option of source.options) {
      const sourceOptionLabel = sourceLabel(option.optionName)
      const label = publicOptionLabel(sourceOptionLabel)
      const sourceOptionId = String(option.sourceOptionId)
      if (!label || uniqueOptionIds.has(sourceOptionId)) {
        exclusions.push({
          supplier: source.supplierId,
          sourceProductId: source.sourceProductId,
          sourceOptionId: option.sourceOptionId,
          url: option.detailUrl ?? source.detailUrl,
          reason: !label ? "public_option_label_empty" : "duplicate_source_option_id",
        })
        continue
      }
      uniqueOptionIds.add(sourceOptionId)
      const shippingFee = numericShippingFee(option)
      const sourceCost = numericSourcePrice(option)
      const landedCost = sourceCost + shippingFee
      options.push({
        sourceOptionId,
        sourceIdType: option.sourceIdType,
        ...sourceSpecFields(sourceOptionLabel),
        publicOptionLabel: label,
        sourceCost,
        shippingFee,
        landedCost,
        salePrice: salePrice(landedCost),
        stockStatus: option.stockStatus === "out_of_stock" ? "out_of_stock" : "in_stock",
        snapshotHash: hash({
          supplierId: source.supplierId,
          sourceProductId: source.sourceProductId,
          sourceOptionId: option.sourceOptionId,
          price: sourceCost,
          stockStatus: option.stockStatus,
        }),
        hardSpecFingerprint: hash({
          product: canonicalProductKey(source.productName),
          option: clean(label),
        }),
      })
    }
    if (options.length > 0) {
      lanes[lane] = {
        supplierId: source.supplierId,
        sourceProductId: String(source.sourceProductId),
        sourceIdType: source.sourceIdType,
        source_image_url: source.source_image_url,
        source_image_urls: source.source_image_urls,
        image_source_type: source.image_source_type,
        image_collected_at: source.image_collected_at,
        image_validation_status: source.image_validation_status,
        image_width: source.image_width,
        image_height: source.image_height,
        image_content_hash: source.image_content_hash,
        options,
      }
    }
  }
  if (Object.keys(lanes).length > 0) {
    validGroups.push({ ...group, ...selectGroupImage(lanes), lanes })
  }
}
validGroups.sort((left, right) => left.displayName.localeCompare(right.displayName, "ko-KR"))
const plan = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceSnapshots: {
    dailyfood: daily.generatedAt,
    walldob2b: walldo.generatedAt,
  },
  counts: {
    dailyProducts: dailyProducts.length,
    dailyOptions: dailyProducts.reduce((sum, product) => sum + product.options.length, 0),
    walldoProducts: walldoProducts.length,
    walldoOptions: walldoProducts.reduce((sum, product) => sum + product.options.length, 0),
    productGroups: validGroups.length,
    variations: validGroups.reduce(
      (sum, group) =>
        sum + Object.values(group.lanes).reduce((inner, lane) => inner + lane.options.length, 0),
      0,
    ),
    laneAOnly: validGroups.filter((group) => group.lanes.A && !group.lanes.B).length,
    laneBOnly: validGroups.filter((group) => group.lanes.B && !group.lanes.A).length,
    laneAB: validGroups.filter((group) => group.lanes.A && group.lanes.B).length,
    excluded: exclusions.length,
    review: reviews.length,
    imagesFound: validGroups.filter((group) => group.image_validation_status === "valid").length,
    walldoImages: validGroups.filter(
      (group) => group.image_source_type === "walldob2b_actual_product",
    ).length,
    dailyImages: validGroups.filter(
      (group) => group.image_source_type === "dailyfood_actual_product",
    ).length,
    imageRetryNeeded: validGroups.filter((group) => group.image_validation_status !== "valid")
      .length,
    terminalExcluded: exclusions.filter((entry) => entry.reason === "terminal_excluded").length,
    nectarineExcluded: exclusions.filter((entry) => entry.reason === "nectarine_family_excluded")
      .length,
  },
  groups: validGroups,
  exclusions,
}
await mkdir(directory, { recursive: true })
await writeFile(`${directory}/catalog-rebuild-plan.json`, `${JSON.stringify(plan, null, 2)}\n`)
await writeFile(
  `${directory}/telegram-review-queue.json`,
  `${JSON.stringify({ generatedAt: plan.generatedAt, reviews }, null, 2)}\n`,
)
console.log(JSON.stringify(plan.counts))

function eligibleProducts(products, excluded, imageReviews, repeatedHashes) {
  return products.flatMap((product) => {
    const reason =
      sourceProductExclusionReason(product.supplierId, product.sourceProductId) ??
      excludedReason(product.productName)
    if (reason) {
      excluded.push({
        supplier: product.supplierId,
        sourceProductId: product.sourceProductId,
        url: product.detailUrl,
        reason,
      })
      return []
    }
    const options = product.options.filter((option) => {
      if (option.stockStatus === "out_of_stock") {
        excluded.push({
          supplier: product.supplierId,
          sourceProductId: product.sourceProductId,
          sourceOptionId: option.sourceOptionId,
          url: option.detailUrl ?? product.detailUrl,
          reason: "not_for_sale",
        })
        return false
      }
      if (numericSourcePrice(option) > 0) return true
      excluded.push({
        supplier: product.supplierId,
        sourceProductId: product.sourceProductId,
        sourceOptionId: option.sourceOptionId,
        url: option.detailUrl ?? product.detailUrl,
        reason: "invalid_price",
      })
      return false
    })
    if (options.length === 0) return []
    if (
      product.image_validation_status === "valid" &&
      repeatedHashes.has(product.image_content_hash)
    ) {
      imageReviews.push({
        reason: "repeated_unrelated_image_hash",
        supplier: product.supplierId,
        sourceProductId: product.sourceProductId,
        productName: product.productName,
        image_content_hash: product.image_content_hash,
      })
      return [
        {
          ...product,
          source_image_url: "",
          image_validation_status: "failed",
          image_validation_error: "repeated_unrelated_image_hash",
          image_width: 0,
          image_height: 0,
          image_content_hash: "",
          options,
        },
      ]
    }
    return [{ ...product, options }]
  })
}

function buildGroup(key, laneA, laneB) {
  const source = laneA ?? laneB
  const normalizedName =
    normalizationCache.get(`${source.supplierId}\u0000${source.productName}`) ?? source.productName
  return {
    groupKey: hash(key),
    displayName: displayProductName(normalizedName),
    lanes: {
      ...(laneA ? { A: laneA } : {}),
      ...(laneB ? { B: laneB } : {}),
    },
  }
}

function displayProductName(value) {
  const stripped = String(value ?? "")
    .normalize("NFKC")
    .replace(/\[[^\]]*(?:특가|추천|한정|택배|무료)[^\]]*\]/giu, " ")
    .replace(/[★☆🔥*]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
  return stripped.slice(0, 180) || "상품"
}

function publicOptionLabel(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/dailyfood|walldob2b|source|supplier|공급가|원가/giu, " ")
    .replace(/[A-Za-z0-9_-]{24,}/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 180)
}

function sourceLabel(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 500)
}

function sourceSpecFields(sourceOptionLabel) {
  const size = sourceOptionLabel.match(
    /(왕특과|왕특품|왕특|특대과|특대|특품|특과|꼬마과|꼬마|중대과|중소과|소과|소품|중과|중품|대과|대품|소|중|대|특)/u,
  )
  const weight = sourceOptionLabel.match(/[\d.]+\s*(?:kg|킬로|키로|g|그램)/iu)
  const count = sourceOptionLabel.match(
    /[\d.]+(?:\s*[~\-–]\s*[\d.]+)?\s*(?:개입|개|입|과수?|송이|수|통)(?:\s*(?:내외|전후|이상|이하))?/u,
  )
  const packaging = sourceOptionLabel.match(/(박스포함|박스|팩|봉|(?<![가-힣])망(?![가-힣]))/u)
  return {
    sourceOptionLabel,
    sourceOptionName: sourceOptionLabel,
    sourceSpecNote: sourceOptionLabel.match(/\([^)]*\)/gu)?.join(" ") ?? "",
    sourceSizeLabel: size?.[1] ?? "",
    sourceWeightLabel: weight?.[0] ?? "",
    sourceCountLabel: count?.[0] ?? "",
    sourcePackageLabel: packaging?.[1] ?? "",
  }
}

function canonicalProductKey(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\[[^\]]*\]/gu, " ")
    .replace(/\([^)]*(?:\d|kg|g|개|입|팩|봉|박스|과|통)[^)]*\)/giu, " ")
    .replace(
      /\d+(?:\.\d+)?\s*(?:kg|g|개입|개|팩|봉|박스|망|과|통|마리)\s*(?:내외|이상|이하)?/giu,
      " ",
    )
    .replace(
      /특가|초특가|추천|프리미엄|한정|무료배송|택배|대리발송|산지직송|당일출고|햇|국산|국내산|가성비|유명호텔|맛돌이|해썹/gu,
      " ",
    )
    .replace(/[^가-힣a-z0-9]/gu, "")
}

function excludedReason(value, category = "") {
  const text = clean(value)
  if (/가성비/u.test(value)) return "terminal_excluded"
  if (
    /(천도복숭아|천도|넥타린|nectarine|옐로드림)/iu.test(value) ||
    /(천도복숭아|천도|넥타린|nectarine)/iu.test(category)
  ) {
    return "nectarine_family_excluded"
  }
  if (/천반도/u.test(value)) return "cheonbando"
  if (/terminalexcluded/u.test(text)) return "terminal_excluded"
  return null
}

function selectGroupImage(lanes) {
  const candidates = [lanes.B, lanes.A].filter(
    (lane) => lane?.image_validation_status === "valid" && lane.source_image_url,
  )
  const selected = candidates[0]
  if (!selected) {
    return {
      source_image_url: "",
      source_image_urls: [],
      image_source_type: "",
      image_collected_at: new Date().toISOString(),
      image_validation_status: "missing",
      image_width: 0,
      image_height: 0,
      image_content_hash: "",
    }
  }
  return {
    source_image_url: selected.source_image_url,
    source_image_urls: selected.source_image_urls,
    image_source_type: selected.image_source_type,
    image_collected_at: selected.image_collected_at,
    image_validation_status: selected.image_validation_status,
    image_width: selected.image_width,
    image_height: selected.image_height,
    image_content_hash: selected.image_content_hash,
  }
}

function repeatedUnrelatedImageHashes(products) {
  const keysByHash = new Map()
  for (const product of products) {
    if (product.image_validation_status !== "valid" || !product.image_content_hash) {
      continue
    }
    const keys = keysByHash.get(product.image_content_hash) ?? new Set()
    keys.add(canonicalProductKey(product.productName))
    keysByHash.set(product.image_content_hash, keys)
  }
  return new Set(
    [...keysByHash.entries()]
      .filter(([, keys]) => keys.size > 1)
      .map(([contentHash]) => contentHash),
  )
}

function numericShippingFee(option) {
  if (Number.isFinite(Number(option.shippingFee))) {
    return Math.max(0, Number(option.shippingFee))
  }
  const text = String(option.shipping ?? "")
  if (/무료/u.test(text)) return 0
  const match = /(?:기본\s*)?배송비[^0-9]{0,30}([0-9,]+)\s*원/u.exec(text)
  return match?.[1] ? Number(match[1].replaceAll(",", "")) : 0
}

function numericSourcePrice(option) {
  for (const value of [option.price, option.cost, option.salePrice]) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) return numeric
  }
  return 0
}

function salePrice(cost) {
  if (cost < 10_000) return roundHundred(cost + 1_500)
  if (cost < 20_000) return roundHundred(cost + 2_000)
  if (cost < 30_000) return roundHundred(cost + 3_000)
  return roundHundred(cost + 4_000)
}

function roundHundred(value) {
  return Math.ceil(value / 100) * 100
}

function groupBy(values, keyOf) {
  const map = new Map()
  for (const value of values) {
    const key = keyOf(value)
    map.set(key, [...(map.get(key) ?? []), value])
  }
  return map
}

function reviewProduct(product) {
  return {
    sourceProductId: product.sourceProductId,
    productName: product.productName,
    optionCount: product.options.length,
    detailUrl: product.detailUrl,
  }
}

function clean(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[^가-힣a-zA-Z0-9]/gu, "")
    .toLowerCase()
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function loadNormalizationCache(path) {
  const cache = new Map()
  let database
  try {
    database = new DatabaseSync(path, { readOnly: true })
    const rows = database
      .prepare(
        `SELECT r.supplier_id, r.original_product_name, n.normalized_name
         FROM raw_products r
         JOIN normalized_products n ON n.raw_product_id = r.id
         WHERE r.supplier_id IN (?, ?)
           AND COALESCE(n.normalized_name, '') <> ''
         ORDER BY r.id`,
      )
      .all("dailyfood", "walldob2b")
    for (const row of rows) {
      cache.set(
        `${String(row.supplier_id)}\u0000${String(row.original_product_name)}`,
        String(row.normalized_name),
      )
    }
  } catch {
    return cache
  } finally {
    database?.close()
  }
  return cache
}
