import { readFile, writeFile } from "node:fs/promises"
import { chromium } from "playwright-core"

const targets = JSON.parse(await readFile("reports/rebuild/qa-targets.json", "utf8"))
const browser = await chromium.connectOverCDP("http://localhost:3000")
const context = await browser.newContext()
const authFile = process.env.WHOLESALEHUB_QA_AUTH_FILE
if (authFile) {
  const auth = JSON.parse(await readFile(authFile, "utf8"))
  await context.addCookies([
    {
      name: auth.name,
      value: auth.value,
      domain: "hub.avocadoss.co.kr",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ])
}
const page = await context.newPage()
const checks = {}

try {
  await emptyCart(context)
  for (const [name, target] of Object.entries({
    aOnly: targets.aOnly,
    bOnly: targets.bOnly,
    ab: targets.ab,
    fiveOptions: targets.fiveOptions,
  })) {
    const response = await page.goto(target.url, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    })
    const visibleText = await page.locator("body").innerText()
    const html = await page.content()
    checks[name] = {
      http: response?.status() ?? 0,
      laneA: await page.locator(".wh-lane-card", { hasText: "A사" }).count(),
      laneB: await page.locator(".wh-lane-card", { hasText: "B사" }).count(),
      optionCount: await page.locator(".wh-lane-card select option:not([value=''])").count(),
      quantityCount: await page.locator(".wh-lane-card input[name=quantity]").count(),
      privacy:
        !/dailyfood|walldob2b|source[_ ]?(?:product|option)|공급가|원가/iu.test(visibleText) &&
        !/_wh_source_product_id|_wh_source_option_id|_wh_internal_supplier_id/iu.test(html),
    }
  }

  await page.goto(targets.ab.url, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  })
  for (const lane of ["A", "B"]) {
    if (lane === "B") {
      await page.goto(targets.ab.url, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      })
    }
    const form = page
      .locator(`.wh-lane-card input[name=wh_lane][value=${lane}]`)
      .locator("xpath=ancestor::form[1]")
    const value =
      lane === "A"
        ? targets.classicCart.laneAPublicOfferKey
        : targets.classicCart.laneBPublicOfferKey
    await form.locator("select").selectOption(value ?? "")
    await Promise.all([
      page.waitForLoadState("domcontentloaded"),
      form.locator("button[type=submit]").click(),
    ])
  }
  await page.goto("https://hub.avocadoss.co.kr/cart/", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  })
  const cartText = await page.locator("body").innerText()
  const classicCartResponse = await context.request.get(
    "https://hub.avocadoss.co.kr/wp-json/wc/store/v1/cart",
  )
  const classicCartBody = await classicCartResponse.json()
  const classicVariationIds = (classicCartBody.items ?? []).map((item) => Number(item.id))
  checks.classicCart = {
    http: classicCartResponse.status(),
    itemCount: classicVariationIds.length,
    laneA: classicVariationIds.includes(targets.classicCart.laneAVariationId),
    laneB: classicVariationIds.includes(targets.classicCart.laneBVariationId),
    privacy:
      !/dailyfood|walldob2b|source[_ ]?(?:product|option)|공급가|원가/iu.test(cartText) &&
      !/dailyfood|walldob2b|source[_ ]?(?:product|option)|공급가|원가/iu.test(
        JSON.stringify(classicCartBody),
      ),
  }

  const cartResponse = await context.request.get(
    "https://hub.avocadoss.co.kr/wp-json/wc/store/v1/cart",
  )
  const cartToken = cartResponse.headers()["cart-token"] ?? ""
  const correct = await context.request.post(
    "https://hub.avocadoss.co.kr/wp-json/wc/store/v1/cart/add-item",
    {
      headers: { "Cart-Token": cartToken, "Content-Type": "application/json" },
      data: {
        id: targets.storeApi.variationId,
        quantity: 1,
        extensions: {
          wholesalehub_supplier_lanes: {
            public_offer_key: targets.storeApi.publicOfferKey,
          },
        },
      },
    },
  )
  const correctBody = await correct.text()
  const wrong = await context.request.post(
    "https://hub.avocadoss.co.kr/wp-json/wc/store/v1/cart/add-item",
    {
      headers: { "Cart-Token": cartToken, "Content-Type": "application/json" },
      data: {
        id: targets.storeApi.variationId,
        quantity: 1,
        extensions: {
          wholesalehub_supplier_lanes: {
            public_offer_key: targets.storeApi.wrongLaneOfferKey,
          },
        },
      },
      failOnStatusCode: false,
    },
  )
  checks.storeApi = {
    getCartHttp: cartResponse.status(),
    addHttp: correct.status(),
    crossLaneHttp: wrong.status(),
    serverPricePresent: correctBody.includes(String(targets.storeApi.salePrice)),
    privacy: !/dailyfood|walldob2b|source[_ ]?(?:product|option)|공급가|원가/iu.test(correctBody),
  }
  checks.passed = Object.entries(checks)
    .filter(([key]) => key !== "passed")
    .every(([, value]) => {
      if (typeof value !== "object" || value === null) return false
      if ("http" in value && value.http !== 200) return false
      if ("privacy" in value && !value.privacy) return false
      return true
    })
  checks.passed =
    checks.passed &&
    checks.aOnly.laneA === 1 &&
    checks.aOnly.laneB === 0 &&
    checks.bOnly.laneA === 0 &&
    checks.bOnly.laneB === 1 &&
    checks.ab.laneA === 1 &&
    checks.ab.laneB === 1 &&
    checks.fiveOptions.optionCount >= 5 &&
    checks.classicCart.laneA &&
    checks.classicCart.laneB &&
    checks.classicCart.itemCount === 2 &&
    checks.storeApi.getCartHttp === 200 &&
    [200, 201].includes(checks.storeApi.addHttp) &&
    checks.storeApi.crossLaneHttp >= 400 &&
    checks.storeApi.crossLaneHttp < 500
  await writeFile("reports/rebuild/qa-result.json", `${JSON.stringify(checks, null, 2)}\n`)
  console.log(JSON.stringify(checks))
  if (!checks.passed) process.exitCode = 1
} finally {
  await emptyCart(context).catch(() => undefined)
  await context.close()
  await browser.close()
}

async function emptyCart(browserContext) {
  const cartResponse = await browserContext.request.get(
    "https://hub.avocadoss.co.kr/wp-json/wc/store/v1/cart",
  )
  const token = cartResponse.headers()["cart-token"] ?? ""
  const body = await cartResponse.json()
  for (const item of body.items ?? []) {
    await browserContext.request.post(
      "https://hub.avocadoss.co.kr/wp-json/wc/store/v1/cart/remove-item",
      {
        headers: { "Cart-Token": token, "Content-Type": "application/json" },
        data: { key: item.key },
      },
    )
  }
}
