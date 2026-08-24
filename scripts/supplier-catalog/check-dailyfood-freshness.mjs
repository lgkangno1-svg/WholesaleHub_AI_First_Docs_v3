import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import ExcelJS from "exceljs"
import { chromium } from "playwright-core"

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
const baselinePath = `${outputDirectory}/dailyfood-freshness-baseline.json`
const reportPath = `${outputDirectory}/dailyfood-freshness.json`
const record = process.argv.includes("--record")

await mkdir(outputDirectory, { recursive: true })

const browser = await chromium.connectOverCDP("http://localhost:3000")
try {
  const context = browser.contexts()[0] ?? (await browser.newContext())
  const page = context.pages()[0] ?? (await context.newPage())

  await page.goto(`${baseUrl}/partner/?mod=product&actpage=prt.list`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  })

  if ((await page.locator("input[type=password]").count()) > 0) {
    if (!username || !password) {
      throw new Error("dailyfood freshness login credentials are not configured")
    }
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
    throw new Error("dailyfood freshness login verification failed")
  }

  const liveList = await page.evaluate(async ({ baseUrl }) => {
    const ids = []
    const records = []
    let paginationComplete = false
    let lastRequestAt = 0

    const normalize = (value) =>
      String(value ?? "")
        .replace(/<[^>]*>/gu, " ")
        .replace(/&nbsp;/giu, " ")
        .replace(/\s+/gu, " ")
        .trim()

    for (let pageNo = 1; pageNo <= 50; pageNo += 1) {
      const waitMs = Math.max(0, 800 - (Date.now() - lastRequestAt))
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
      const url = `${baseUrl}/partner/?mod=product/json&actpage=prt.list.proc&page=${pageNo}&order=&by=&searchval=`
      const response = await fetch(url, { credentials: "include" })
      lastRequestAt = Date.now()
      const text = await response.text()
      if (!response.ok || /<input[^>]+type=["']password["']/iu.test(text)) {
        throw new Error(`dailyfood freshness list failed: HTTP ${response.status}`)
      }
      const xml = new DOMParser().parseFromString(text, "text/xml")
      const blocks = [...xml.querySelectorAll("data")]
        .map((node) => node.textContent ?? "")
        .filter(Boolean)
      if (blocks.length === 0) {
        paginationComplete = true
        break
      }
      for (const html of blocks) {
        const id = /prtView\s*\(\s*["']([^"']+)["']/iu.exec(html)?.[1]?.trim() ?? ""
        if (!id) continue
        const document = new DOMParser().parseFromString(html, "text/html")
        const name = normalize(document.querySelector(".pname")?.textContent ?? "")
        ids.push(id)
        records.push({ id, name, summary: normalize(html).slice(0, 1200) })
      }
    }

    return {
      paginationComplete,
      ids: [...new Set(ids)].sort(),
      records: records.sort((left, right) => left.id.localeCompare(right.id)),
    }
  }, { baseUrl })

  if (!liveList.paginationComplete) {
    throw new Error("dailyfood freshness pagination did not reach an empty page")
  }

  const exportResponse = await context.request.get(
    `${baseUrl}/partner/?mod=product/excel&actpage=prt.excel.download.proc`,
  )
  if (!exportResponse.ok()) {
    throw new Error(`dailyfood freshness export failed: HTTP ${exportResponse.status()}`)
  }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await exportResponse.body())
  const worksheet = workbook.worksheets[0]
  if (!worksheet) throw new Error("dailyfood freshness export worksheet missing")

  const exportRows = []
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    const pcode = cell(row, 14)
    const productName = cell(row, 3)
    const price = money(row.getCell(6).value)
    if (!pcode || !productName || price <= 0) continue
    exportRows.push({ pcode, productName, price })
  }
  exportRows.sort(
    (left, right) => left.pcode.localeCompare(right.pcode) || left.productName.localeCompare(right.productName),
  )

  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ list: liveList.records, exportRows }))
    .digest("hex")

  let baseline = null
  try {
    baseline = JSON.parse(await readFile(baselinePath, "utf8"))
  } catch {
    baseline = null
  }

  const previousIds = new Set(Array.isArray(baseline?.listIds) ? baseline.listIds : [])
  const currentIds = new Set(liveList.ids)
  const addedIds = liveList.ids.filter((id) => !previousIds.has(id))
  const removedIds = [...previousIds].filter((id) => !currentIds.has(id)).sort()
  const changed = !baseline || baseline.fingerprint !== fingerprint
  const now = new Date().toISOString()

  const report = {
    schemaVersion: 1,
    checkedAt: now,
    complete: true,
    changed,
    reason: !baseline ? "baseline_missing" : changed ? "source_fingerprint_changed" : "unchanged",
    liveListProducts: liveList.ids.length,
    exportRows: exportRows.length,
    currentListIds: liveList.ids,
    addedIds,
    removedIds,
    fingerprint,
    baselineFingerprint: baseline?.fingerprint ?? null,
    baselineRecordedAt: baseline?.recordedAt ?? null,
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)

  if (record) {
    const nextBaseline = {
      schemaVersion: 1,
      recordedAt: now,
      fingerprint,
      listIds: liveList.ids,
      liveListProducts: liveList.ids.length,
      exportRows: exportRows.length,
    }
    const tempPath = `${baselinePath}.${process.pid}.tmp`
    await writeFile(tempPath, `${JSON.stringify(nextBaseline, null, 2)}\n`)
    const { rename } = await import("node:fs/promises")
    await rename(tempPath, baselinePath)
  }

  console.log(
    JSON.stringify({
      complete: true,
      changed,
      reason: report.reason,
      liveListProducts: report.liveListProducts,
      exportRows: report.exportRows,
      added: addedIds.length,
      removed: removedIds.length,
      recorded: record,
    }),
  )
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

function money(value) {
  const digits = String(value ?? "").replace(/[^0-9]/gu, "")
  return digits ? Number(digits) : 0
}
