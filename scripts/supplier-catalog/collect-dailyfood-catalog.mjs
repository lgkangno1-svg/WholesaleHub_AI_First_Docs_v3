import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import ExcelJS from "exceljs"
import { chromium } from "playwright-core"
import { validateSourceImageCandidates } from "../../dist/reports/product-thumbnail-integrity.js"
import { sourceProductExclusions } from "./catalog-exclusions.mjs"

for (const line of (await readFile(".env", "utf8")).split(/\r?\n/u)) {
  const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line)
  if (match?.[1] && process.env[match[1]] === undefined) {
    process.env[match[1]] = match[2] ?? ""
  }
}

const username = process.env.DAILYFOOD_USERNAME ?? process.env.WALLDOB2B_USERNAME ?? ""
const password = process.env.DAILYFOOD_PASSWORD ?? process.env.WALLDOB2B_PASSWORD ?? ""
const baseUrl = "https://dailyfood.adminplus.co.kr"
const outputDirectory = "reports/rebuild"
const sourceExclusions = sourceProductExclusions("dailyfood")
const excludedSourceProductIds = new Set(sourceExclusions.map((rule) => rule.sourceProductId))
await mkdir(outputDirectory, { recursive: true })
let previousSnapshot = null
try {
  previousSnapshot = JSON.parse(
    await readFile(`${outputDirectory}/dailyfood-catalog-snapshot.json`, "utf8"),
  )
} catch {
  previousSnapshot = null
}
const browser = await chromium.connectOverCDP("http://localhost:3000")

try {
  const context = browser.contexts()[0] ?? (await browser.newContext())
  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto(`${baseUrl}/partner/?mod=product&actpage=prt.list`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  })
  if ((await page.locator("input[type=password]").count()) > 0) {
    await page
      .locator("input[name=admid],input[name=id],input[name=uid],input[type=text]")
      .first()
      .fill(username)
    await page
      .locator("input[name=admpwd],input[name=pw],input[name=password],input[type=password]")
      .first()
      .fill(password)
    const submit = page.locator(".login-btn,button[type=submit],input[type=submit]").first()
    if ((await submit.count()) > 0) await submit.click()
    else await page.keyboard.press("Enter")
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {})
  }
  if ((await page.locator("input[type=password]").count()) > 0) {
    throw new Error("dailyfood login verification failed")
  }

  const exportResponse = await context.request.get(
    `${baseUrl}/partner/?mod=product/excel&actpage=prt.excel.download.proc`,
  )
  if (!exportResponse.ok()) {
    throw new Error(`dailyfood export failed: HTTP ${exportResponse.status()}`)
  }
  const exportPath = `${outputDirectory}/dailyfood-product-export.xlsx`
  await writeFile(exportPath, await exportResponse.body())
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(exportPath)
  const worksheet = workbook.worksheets[0]
  if (!worksheet) throw new Error("dailyfood export worksheet missing")
  const exportRows = []
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    const pcode = cell(row, 14)
    const productName = cell(row, 3)
    const price = money(row.getCell(6).value)
    if (!pcode || !productName || price <= 0) continue
    exportRows.push({
      rowNumber,
      pcode,
      productName,
      price,
      stockStatus: "in_stock",
      shipping: cell(row, 10),
      taxStatus: cell(row, 5),
      origin: cell(row, 8),
      cutoff: cell(row, 13),
    })
  }

  const browserResult = await page.evaluate(
    async ({
      baseUrl,
      pcodes,
      previousFailedPcodes,
      previousOptionImages,
      reuseSuccessfulDetails,
      excludedSourceProductIds,
    }) => {
      const errors = []
      const excludedSourceIdSet = new Set(excludedSourceProductIds)
      let lastRequestAt = 0
      const normalize = (value) =>
        String(value ?? "")
          .replace(/<[^>]*>/gu, " ")
          .replace(/&nbsp;/giu, " ")
          .replace(/\s+/gu, " ")
          .trim()
      const parseMoney = (value) => {
        const digits = normalize(value).replace(/[^0-9]/gu, "")
        return digits ? Number(digits) : 0
      }
      const imageCandidatesFromDocument = (document, fallbacks = []) => {
        const clean = (value) => {
          const raw = String(value ?? "").trim()
          if (!raw || raw.startsWith("data:")) return ""
          try {
            const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw, baseUrl)
            if (
              !["dailyfood.adminplus.co.kr", "cdn.yourlove.co.kr"].includes(
                url.hostname.toLowerCase(),
              )
            ) {
              return ""
            }
            if (
              /(?:logo|banner|icon|placeholder|no[_-]?(?:img|image)|loading|spinner|common|basket)/iu.test(
                `${url.hostname}${url.pathname}`,
              )
            ) {
              return ""
            }
            if (!/\.(?:jpe?g|png|webp)(?:$|\?)/iu.test(url.toString())) return ""
            return url.toString()
          } catch {
            return ""
          }
        }
        const ranked = []
        const add = (value, priority, score = 0) => {
          const url = clean(value)
          if (url) ranked.push({ url, priority, score })
        }
        for (const image of document.querySelectorAll("img")) {
          const source =
            image.getAttribute("data-original") ||
            image.getAttribute("data-src") ||
            image.getAttribute("src") ||
            ""
          const marker = `${image.id} ${image.className}`
          const priority = /(objImg|main_img|product_img|big_img|zoom_img|thumb-main)/iu.test(
            marker,
          )
            ? 1
            : /(gallery|view_img|detail_img|product_detail)/iu.test(marker)
              ? 4
              : 4
          const dimensions = Math.max(
            Number(image.getAttribute("width") ?? 0),
            Number(image.getAttribute("height") ?? 0),
          )
          add(source, priority, dimensions + (/_500x500\.|prtimg/iu.test(source) ? 500 : 0))
        }
        for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            const json = JSON.parse(script.textContent ?? "")
            const records = Array.isArray(json?.["@graph"]) ? json["@graph"] : [json]
            for (const record of records) {
              if (record?.["@type"] !== "Product") continue
              for (const image of Array.isArray(record.image) ? record.image : [record.image]) {
                add(typeof image === "string" ? image : image?.url, 2)
              }
            }
          } catch {}
        }
        add(document.querySelector('meta[property="og:image"],meta[name="og:image"]')?.content, 3)
        for (const fallback of fallbacks) add(fallback, 5)
        ranked.sort((left, right) => left.priority - right.priority || right.score - left.score)
        return [...new Set(ranked.map((candidate) => candidate.url))]
      }
      const descriptionFromDocument = (document) => {
        const node = document.querySelector("tr.product_desc_row td.product_desc, .product_desc")
        if (!node) return ""
        const paragraphs = [...node.querySelectorAll("p")]
        if (paragraphs.length > 0) {
          return paragraphs
            .map((p) => String(p.textContent ?? "").replace(/\s+/gu, " ").trim())
            .filter((line) => line !== "")
            .join("\n")
        }
        return String(node.textContent ?? "").replace(/\s+/gu, " ").trim()
      }
      const fetchText = async (url) => {
        let last = "unknown"
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          const waitMs = Math.max(0, 1_000 - (Date.now() - lastRequestAt))
          if (waitMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, waitMs))
          }
          try {
            const response = await fetch(url, { credentials: "include" })
            lastRequestAt = Date.now()
            const text = await response.text()
            if (response.ok && !/<input[^>]+type=["']password["']/iu.test(text)) {
              return { ok: true, status: response.status, text }
            }
            last = `HTTP ${response.status}`
            if (response.status === 429) {
              const retryAfter = Number(response.headers.get("retry-after") ?? "30")
              await new Promise((resolve) => setTimeout(resolve, Math.max(30, retryAfter) * 1000))
            }
          } catch (error) {
            last = error instanceof Error ? error.message : String(error)
          }
          await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
        }
        return { ok: false, status: 0, text: "", error: last }
      }
      const listGroups = []
      const rawListProductIds = new Set()
      let paginationComplete = false
      for (let pageNo = 1; pageNo <= 50; pageNo += 1) {
        const url =
          `${baseUrl}/partner/?mod=product/json&actpage=prt.list.proc&page=` +
          `${pageNo}&order=&by=&searchval=`
        const response = await fetchText(url)
        if (!response.ok) {
          errors.push({ kind: "list", url, reason: response.error })
          break
        }
        const xml = new DOMParser().parseFromString(response.text, "text/xml")
        const blocks = [...xml.querySelectorAll("data")]
          .map((node) => node.textContent ?? "")
          .filter(Boolean)
        if (blocks.length === 0) {
          paginationComplete = true
          break
        }
        for (const html of blocks) {
          const match = /prtView\s*\(\s*["']([^"']+)["']/iu.exec(html)
          const sourceProductId = match?.[1]?.trim() ?? ""
          const document = new DOMParser().parseFromString(html, "text/html")
          const listName = normalize(document.querySelector(".pname")?.textContent ?? "")
          if (sourceProductId && listName) rawListProductIds.add(sourceProductId)
          if (sourceProductId && listName && !excludedSourceIdSet.has(sourceProductId)) {
            listGroups.push({
              sourceProductId,
              listName,
              listImageUrls: imageCandidatesFromDocument(document),
              pageNo,
            })
          }
        }
      }
      const groups = []
      for (let offset = 0; offset < listGroups.length; offset += 1) {
        const batch = listGroups.slice(offset, offset + 1)
        const settled = await Promise.all(
          batch.map(async (group) => {
            const url =
              `${baseUrl}/partner/?mod=product&actpage=prt.grp.detail.pop&pcode=` +
              encodeURIComponent(group.sourceProductId)
            const response = await fetchText(url)
            if (!response.ok) {
              return {
                error: { kind: "group_detail", url, reason: response.error },
              }
            }
            const document = new DOMParser().parseFromString(response.text, "text/html")
            const rows = [...document.querySelectorAll("tr")]
            const titleRow = rows.find((row) => {
              const heading = normalize(row.querySelector("th")?.textContent ?? "")
              return heading === "제품명" || heading === "상품명"
            })
            const productName =
              normalize(titleRow?.querySelector("td")?.textContent ?? group.listName) ||
              group.listName
            const imageCandidates = imageCandidatesFromDocument(document, group.listImageUrls)
            const options = []
            for (const row of rows) {
              const cells = [...row.querySelectorAll(":scope > td")].map((cell) =>
                normalize(cell.textContent),
              )
              if (cells.length < 3) continue
              const priceCell = cells.find((value) => /￦|원/u.test(value))
              const price = parseMoney(priceCell ?? "")
              const optionName = cells[0] ?? ""
              if (!optionName || price <= 0 || /제품명|상품명/u.test(optionName)) {
                continue
              }
              options.push({
                optionName,
                price,
                stockStatus: /품절|판매중지|재고부족/u.test(cells.join(" "))
                  ? "out_of_stock"
                  : "in_stock",
                shipping: cells.at(-1) ?? "",
              })
            }
            for (const item of document.querySelectorAll(".product_set_item")) {
              const optionName = normalize(item.querySelector(".set_item_name")?.textContent ?? "")
              const price = parseMoney(
                item.querySelector(".set_meta_value.is_price")?.textContent ?? "",
              )
              if (!optionName || price <= 0) continue
              const stockText = [
                ...item.querySelectorAll(
                  ".set_stock_badge, .set_stock_badge img[alt], img.set_stock_badge[alt]",
                ),
              ]
                .map((node) => normalize(node.textContent || node.getAttribute("alt")))
                .join(" ")
              const shipping = [...item.querySelectorAll(".set_delivery_btn, span[class^=msg]")]
                .map((node) => normalize(node.textContent))
                .filter(Boolean)
                .join(" ")
              options.push({
                optionName,
                price,
                stockStatus: /품절|판매중지|재고부족/u.test(stockText)
                  ? "out_of_stock"
                  : "in_stock",
                shipping,
              })
            }

            if (options.length === 0) {
              let singlePrice = 0
              let singleStockStatus = "in_stock"
              let singleShipping = ""
              for (const row of rows) {
                const cells = [...row.querySelectorAll(":scope > td, :scope > th")]
                  .map((cell) => normalize(cell.textContent))
                if (cells.length !== 2) continue
                const label = cells[0]
                const value = cells[1]
                const combined = label + value
                if (/품절|판매중지|재고부족/.test(combined)) singleStockStatus = "out_of_stock"
                if (/배송|택배/.test(label)) {
                  singleShipping = value
                  continue
                }
                if (singlePrice === 0 && /가격|판매가|공급가|소비자가|단가/.test(label)) {
                  const priceMatch =
                    value.match(/(?:[0-9][0-9,]*)\s*(?:￦|₩|원|won|krw)/iu) ||
                    value.match(/(?:￦|₩)\s*[0-9][0-9,]*/u)
                  if (priceMatch) {
                    const num = parseMoney(priceMatch[0])
                    if (num > 0) singlePrice = num
                  }
                }
              }
              if (singlePrice > 0 && productName) {
                options.push({
                  optionName: productName,
                  price: singlePrice,
                  stockStatus: singleStockStatus,
                  shipping: singleShipping,
                })
              }
            }            const unique = []
            const seen = new Set()
            for (const option of options) {
              const key = `${option.optionName}\u0000${option.price}`
              if (!seen.has(key)) {
                seen.add(key)
                unique.push(option)
              }
            }
            return {
              group: {
                ...group,
                productName,
                detailUrl: url,
                imageCandidates,
                sourceDescription: descriptionFromDocument(document),
                options: unique,
              },
            }
          }),
        )
        for (const item of settled) {
          if (item.error) errors.push(item.error)
          else if (item.group) groups.push(item.group)
        }
      }
      const detailStatus = {}
      const retrySet = new Set(previousFailedPcodes)
      const pcodesToFetch = pcodes.filter(
        (pcode) =>
          retrySet.has(pcode) ||
          !reuseSuccessfulDetails ||
          (previousOptionImages[pcode] ?? []).length === 0,
      )
      const pcodesToFetchSet = new Set(pcodesToFetch)
      if (reuseSuccessfulDetails) {
        for (const pcode of pcodes) {
          if (!pcodesToFetchSet.has(pcode)) {
            detailStatus[pcode] = {
              ok: true,
              status: 200,
              url:
                `${baseUrl}/partner/?mod=product&actpage=prt.detail.pop&pcode=` +
                encodeURIComponent(pcode),
              imageCandidates: previousOptionImages[pcode] ?? [],
            }
          }
        }
      }
      for (let offset = 0; offset < pcodesToFetch.length; offset += 1) {
        const batch = pcodesToFetch.slice(offset, offset + 1)
        const settled = await Promise.all(
          batch.map(async (pcode) => {
            const url =
              `${baseUrl}/partner/?mod=product&actpage=prt.detail.pop&pcode=` +
              encodeURIComponent(pcode)
            const response = await fetchText(url)
            return { pcode, url, ...response }
          }),
        )
        for (const item of settled) {
          const parsedDetailDocument = item.ok
            ? new DOMParser().parseFromString(item.text, "text/html")
            : null
          detailStatus[item.pcode] = {
            ok: item.ok,
            status: item.status,
            url: item.url,
            imageCandidates: parsedDetailDocument
              ? imageCandidatesFromDocument(parsedDetailDocument)
              : [],
            sourceDescription: parsedDetailDocument
              ? descriptionFromDocument(parsedDetailDocument)
              : "",
          }
          if (!item.ok) {
            errors.push({
              kind: "product_detail",
              url: item.url,
              reason: item.error,
            })
          }
        }
      }
      return {
        paginationComplete,
        rawListGroupCount: rawListProductIds.size,
        listGroupCount: listGroups.length,
        groups,
        detailStatus,
        errors,
      }
    },
    {
      baseUrl,
      pcodes: exportRows
        .filter((row) => !excludedSourceProductIds.has(row.pcode))
        .map((row) => row.pcode),
      previousFailedPcodes:
        previousSnapshot?.crawlErrors
          ?.filter((error) => error.kind === "product_detail")
          .map((error) => {
            try {
              return new URL(error.url).searchParams.get("pcode") ?? ""
            } catch {
              return ""
            }
          })
          .filter(Boolean) ?? [],
      previousOptionImages: Object.fromEntries(
        (previousSnapshot?.products ?? []).flatMap((product) =>
          (product.options ?? []).map((option) => [
            String(option.sourceOptionId ?? ""),
            Array.isArray(option.source_image_urls)
              ? option.source_image_urls
              : [
                  option.source_image_url || product.source_image_url || product.imageUrl || "",
                ].filter(Boolean),
          ]),
        ),
      ),
      reuseSuccessfulDetails: previousSnapshot?.source?.exportRowCount === exportRows.length,
      excludedSourceProductIds: [...excludedSourceProductIds],
    },
  )

  const eligibleExportRows = exportRows.filter((row) => !excludedSourceProductIds.has(row.pcode))
  const availableRows = new Map(eligibleExportRows.map((row) => [row.pcode, row]))
  const exactIndex = indexRows(
    eligibleExportRows,
    (row) => `${normalize(row.productName)}\u0000${row.price}`,
  )
  const nameIndex = indexRows(eligibleExportRows, (row) => normalize(row.productName))
  const exclusions = sourceExclusions.map((rule) => ({
    supplier: rule.supplierId,
    sourceProductId: rule.sourceProductId,
    sourceOptionId: rule.sourceProductId,
    url:
      `${baseUrl}/partner/?mod=product&actpage=prt.detail.pop&pcode=` +
      encodeURIComponent(rule.sourceProductId),
    reason: rule.reason,
    rule: "source_identity",
  }))
  const products = []
  for (const group of browserResult.groups) {
    if (String(group.productName ?? group.listName).includes("가성비")) {
      exclusions.push({
        supplier: "dailyfood",
        sourceProductId: group.sourceProductId,
        productName: group.productName,
        url: group.detailUrl,
        reason: "terminal_excluded",
        keyword: "가성비",
      })
      continue
    }
    const options = []
    for (const option of group.options) {
      const exactCandidates = unused(
        exactIndex.get(`${normalize(option.optionName)}\u0000${option.price}`) ?? [],
        availableRows,
      )
      const nameCandidates = unused(
        nameIndex.get(normalize(option.optionName)) ?? [],
        availableRows,
      )
      const candidates =
        exactCandidates.length === 1
          ? exactCandidates
          : nameCandidates.length === 1
            ? nameCandidates
            : []
      const matched = candidates[0]
      if (!matched) {
        const rawShippingText = option.shipping || ""
        const shippingPolicy = parseShippingPolicy(rawShippingText)
        options.push({
          sourceOptionId: deterministicOptionId(group.sourceProductId, option.optionName),
          sourceIdType: "deterministic_provider_payload",
          optionName: option.optionName,
          price: option.price,
          stockStatus: option.stockStatus,
          shipping: rawShippingText,
          shipping_policy: shippingPolicy,
          taxStatus: "",
          origin: "",
          cutoff: "",
          detailUrl: group.detailUrl,
          imageCandidates: group.imageCandidates,
        })
        continue
      }
      availableRows.delete(matched.pcode)
      const detail = browserResult.detailStatus[matched.pcode]
      if (!detail?.ok) {
        exclusions.push({
          supplier: "dailyfood",
          sourceProductId: group.sourceProductId,
          sourceOptionId: matched.pcode,
          productName: group.productName,
          url: detail?.url ?? group.detailUrl,
          reason: "individual_detail_fetch_failed",
        })
        continue
      }
        const rawShippingText = option.shipping || matched.shipping || ""
        const shippingPolicy = parseShippingPolicy(rawShippingText)
        options.push({
          sourceOptionId: matched.pcode,
          sourceIdType: "provider_value",
          optionName: option.optionName,
          price: option.price,
          stockStatus: option.stockStatus,
          shipping: rawShippingText,
          shipping_policy: shippingPolicy,
          taxStatus: matched.taxStatus,
          origin: matched.origin,
          cutoff: matched.cutoff,
          detailUrl: detail.url,
          imageCandidates: [...(detail.imageCandidates ?? []), ...(group.imageCandidates ?? [])],
        })
      }
    if (options.length > 0) {
      const imageCandidates = [
        ...(group.imageCandidates ?? []),
        ...options.flatMap((option) => option.imageCandidates ?? []),
      ]
      const image = await validateSourceImageCandidates(imageCandidates, {
        sourceType: "dailyfood_actual_product",
        expectedHosts: ["dailyfood.adminplus.co.kr", "cdn.yourlove.co.kr"],
      })
      products.push({
        supplierId: "dailyfood",
        lane: "A",
        sourceProductId: group.sourceProductId,
        sourceIdType: "authoritative",
        productName: group.productName,
        sourceDescription: String(group.sourceDescription ?? "").trim(),
        detailUrl: group.detailUrl,
        ...image,
        imageUrl: image.source_image_url,
        options,
      })
    } else {
      exclusions.push({
        supplier: "dailyfood",
        sourceProductId: group.sourceProductId,
        productName: group.productName,
        url: group.detailUrl,
        reason: "no_valid_options",
      })
    }
  }
  for (const row of availableRows.values()) {
    if (!row.productName || !row.pcode || !row.price) continue
    if (row.productName.includes("가성비")) {
      exclusions.push({
        supplier: "dailyfood",
        sourceProductId: row.pcode,
        sourceOptionId: row.pcode,
        productName: row.productName,
        url: `${baseUrl}/partner/?mod=product&actpage=prt.detail.pop&pcode=${encodeURIComponent(row.pcode)}`,
        reason: "terminal_excluded",
        keyword: "가성비",
      })
      continue
    }
    const image = await validateSourceImageCandidates(
      browserResult.detailStatus[row.pcode]?.imageCandidates ?? [],
      {
        sourceType: "dailyfood_actual_product",
        expectedHosts: ["dailyfood.adminplus.co.kr", "cdn.yourlove.co.kr"],
      },
    )
    products.push({
      supplierId: "dailyfood",
      lane: "A",
      sourceProductId: row.pcode,
      sourceIdType: "authoritative",
      productName: row.productName,
      sourceDescription: String(
        browserResult.detailStatus[row.pcode]?.sourceDescription ?? "",
      ).trim(),
      detailUrl: `${baseUrl}/partner/?mod=product&actpage=prt.detail.pop&pcode=${encodeURIComponent(row.pcode)}`,
      ...image,
      imageUrl: image.source_image_url,
      options: [
        {
          sourceOptionId: row.pcode,
          sourceIdType: "authoritative",
          optionName: row.productName,
          price: row.price,
          stockStatus: "in_stock",
          shipping: row.shipping,
          shipping_policy: parseShippingPolicy(row.shipping),
          taxStatus: row.taxStatus ?? "",
          origin: row.origin ?? "",
          cutoff: row.cutoff ?? "",
          detailUrl: `${baseUrl}/partner/?mod=product&actpage=prt.detail.pop&pcode=${encodeURIComponent(row.pcode)}`,
          ...image,
          imageUrl: image.source_image_url,
        },
      ],
    })
  }
  const duplicateProductIds = duplicateCount(products.map((product) => product.sourceProductId))
  const duplicateOptionIds = duplicateCount(
    products.flatMap((product) => product.options.map((option) => option.sourceOptionId)),
  )
  const snapshot = {
    schemaVersion: 1,
    supplier: "dailyfood",
    generatedAt: new Date().toISOString(),
    complete:
      browserResult.paginationComplete &&
      browserResult.errors.length === 0 &&
      duplicateProductIds === 0 &&
      duplicateOptionIds === 0,
    source: {
      rawListGroupCount: browserResult.rawListGroupCount,
      listGroupCount: browserResult.listGroupCount,
      exportRowCount: exportRows.length,
      individualDetailSuccessCount: Object.values(browserResult.detailStatus).filter(
        (status) => status.ok,
      ).length,
      individualDetailFailureCount: Object.values(browserResult.detailStatus).filter(
        (status) => !status.ok,
      ).length,
    },
    counts: {
      products: products.length,
      options: products.reduce((sum, product) => sum + product.options.length, 0),
      excluded: exclusions.length,
      authoritative: products.reduce(
        (sum, product) =>
          sum + product.options.filter((option) => option.sourceIdType === "authoritative").length,
        0,
      ),
      productAuthoritative: products.length,
      providerValue: products.reduce(
        (sum, product) =>
          sum + product.options.filter((option) => option.sourceIdType === "provider_value").length,
        0,
      ),
      deterministicProviderPayload: products.reduce(
        (sum, product) =>
          sum +
          product.options.filter(
            (option) => option.sourceIdType === "deterministic_provider_payload",
          ).length,
        0,
      ),
      duplicateProductIds,
      duplicateOptionIds,
      withImages: products.filter((product) => product.image_validation_status === "valid").length,
      missingImages: products.filter((product) => product.image_validation_status !== "valid")
        .length,
      terminalExcluded: exclusions.filter((entry) => entry.reason === "terminal_excluded").length,
    },
    products,
    exclusions,
    crawlErrors: browserResult.errors,
  }
  await writeFile(
    `${outputDirectory}/dailyfood-catalog-snapshot.json`,
    `${JSON.stringify(snapshot, null, 2)}\n`,
  )
  console.log(JSON.stringify({ complete: snapshot.complete, ...snapshot.counts }))
} finally {
  await browser.close()
}

function cell(row, column) {
  const value = row.getCell(column).value
  if (value && typeof value === "object" && "text" in value) {
    return String(value.text ?? "").trim()
  }
  return String(value ?? "").trim()
}

function deterministicOptionId(sourceProductId, providerOptionValue) {
  const providerPayload = JSON.stringify({
    sourceProductId,
    providerOptionValue,
  })
  return `dfp_${createHash("sha256").update(providerPayload).digest("hex")}`
}

function money(value) {
  const digits = String(value ?? "").replace(/[^0-9]/gu, "")
  return digits ? Number(digits) : 0
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, "")
    .replace(/[()[\]{}'"`·•★☆🔥]/gu, "")
    .toLowerCase()
}

function indexRows(rows, keyOf) {
  const map = new Map()
  for (const row of rows) {
    const key = keyOf(row)
    map.set(key, [...(map.get(key) ?? []), row])
  }
  return map
}

function unused(rows, available) {
  return rows.filter((row) => available.has(row.pcode))
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

export function parseShippingPolicy(rawText, collectedAt = new Date().toISOString()) {
  const text = String(rawText ?? "").trim()
  if (!text) {
    return {
      shipping_policy_type: "unknown",
      shipping_base_fee: 0,
      shipping_tiers: [],
      shipping_jeju_extra_fee: 0,
      shipping_remote_extra_fee: 0,
      shipping_raw_text: text,
      shipping_source: "detail",
      shipping_collected_at: collectedAt,
      shipping_validation_status: "review_required",
    }
  }

  let jejuFee = 0
  const jejuMatch = /제주(?:도)?\s*[:\+]?\s*([0-9,]+)\s*원/u.exec(text)
  if (jejuMatch?.[1]) {
    jejuFee = Number(jejuMatch[1].replaceAll(",", ""))
  }

  let remoteFee = 0
  const remoteMatch = /도서산간\s*[:\+]?\s*([0-9,]+)\s*원/u.exec(text)
  if (remoteMatch?.[1]) {
    remoteFee = Number(remoteMatch[1].replaceAll(",", ""))
  }

  const tierMatches = [...text.matchAll(/(\d+)\s*개\s*이상\s*~\s*(\d+)\s*개\s*미만\s*([0-9,]+)\s*원/gu)]
  if (tierMatches.length > 0 || /수량별배송비/u.test(text)) {
    const tiers = tierMatches.map((m) => ({
      min_qty: Number(m[1]),
      max_qty_exclusive: Number(m[2]),
      fee: Number(m[3].replaceAll(",", "")),
    }))

    if (tiers.length > 0) {
      return {
        shipping_policy_type: "quantity_tiered",
        shipping_base_fee: tiers[0].fee,
        shipping_tiers: tiers,
        shipping_jeju_extra_fee: jejuFee,
        shipping_remote_extra_fee: remoteFee,
        shipping_raw_text: text,
        shipping_source: "detail",
        shipping_collected_at: collectedAt,
        shipping_validation_status: "valid",
      }
    }
    if (/수량별배송비/u.test(text)) {
      return {
        shipping_policy_type: "unknown",
        shipping_base_fee: 0,
        shipping_tiers: [],
        shipping_jeju_extra_fee: jejuFee,
        shipping_remote_extra_fee: remoteFee,
        shipping_raw_text: text,
        shipping_source: "detail",
        shipping_collected_at: collectedAt,
        shipping_validation_status: "review_required",
      }
    }
  }

  if (/^무료|^무료배송|[\s\n]무료(?=[\s\n]|$)/u.test(text)) {
    return {
      shipping_policy_type: "free",
      shipping_base_fee: 0,
      shipping_tiers: [],
      shipping_jeju_extra_fee: jejuFee,
      shipping_remote_extra_fee: remoteFee,
      shipping_raw_text: text,
      shipping_source: "detail",
      shipping_collected_at: collectedAt,
      shipping_validation_status: "valid",
    }
  }

  const textWithoutSurcharges = text
    .replace(/제주(?:도)?\s*[:\+]?\s*[0-9,]+\s*원(?:\s*추가)?/gu, "")
    .replace(/도서산간\s*[:\+]?\s*[0-9,]+\s*원(?:\s*추가)?/gu, "")
  const fixedMatch = /(?:￦|배송비\s*)?([1-9][0-9,]*)\s*원/u.exec(textWithoutSurcharges)
  if (fixedMatch?.[1]) {
    const baseFee = Number(fixedMatch[1].replaceAll(",", ""))
    return {
      shipping_policy_type: "fixed",
      shipping_base_fee: baseFee,
      shipping_tiers: [],
      shipping_jeju_extra_fee: jejuFee,
      shipping_remote_extra_fee: remoteFee,
      shipping_raw_text: text,
      shipping_source: "detail",
      shipping_collected_at: collectedAt,
      shipping_validation_status: "valid",
    }
  }

  return {
    shipping_policy_type: "unknown",
    shipping_base_fee: 0,
    shipping_tiers: [],
    shipping_jeju_extra_fee: jejuFee,
    shipping_remote_extra_fee: remoteFee,
    shipping_raw_text: text,
    shipping_source: "detail",
    shipping_collected_at: collectedAt,
    shipping_validation_status: "review_required",
  }
}
