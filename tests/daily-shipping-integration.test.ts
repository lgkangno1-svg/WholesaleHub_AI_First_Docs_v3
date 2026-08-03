import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

function parseShippingPolicy(rawText, collectedAt = new Date().toISOString()) {
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

function shippingAmount(policy, quantity) {
  if (policy.shipping_validation_status !== "valid") return null
  if (policy.shipping_policy_type === "free") return 0
  if (policy.shipping_policy_type === "fixed") return policy.shipping_base_fee
  const tier = policy.shipping_tiers.find(
    (item) => quantity >= item.min_qty && quantity < item.max_qty_exclusive,
  )
  if (tier) return tier.fee
  if (policy.shipping_policy_type === "quantity_tiered" && policy.shipping_tiers.length === 1) {
    return Math.ceil(quantity / policy.shipping_tiers[0].max_qty_exclusive) * policy.shipping_base_fee
  }
  return null
}

describe("Daily Renewal Crawler & Option Normalization", () => {
  it("preserves black mango watermelon 1통, 2통, 3통, 4통 count labels and prevents 망 misrecognition", () => {
    const options = [
      "블랙망고수박 1통",
      "블랙망고수박 2통",
      "블랙망고수박 3통",
      "블랙망고수박 4통",
    ]

    for (let i = 0; i < options.length; i++) {
      const spec = sourceSpecFields(options[i])
      expect(spec.sourceCountLabel).toBe(`${i + 1}통`)
      expect(spec.sourcePackageLabel).toBe("")
    }
  })

  it("recognizes standalone '망' as packaging while ignoring '망고'", () => {
    const specMango = sourceSpecFields("생 망고 1kg")
    expect(specMango.sourcePackageLabel).toBe("")

    const specNet = sourceSpecFields("양파 15kg 1망")
    expect(specNet.sourcePackageLabel).toBe("망")
  })
})

describe("Shipping Policy Metadata Parsing", () => {
  it("correctly parses free shipping policy", () => {
    const policy = parseShippingPolicy("무료배송")
    expect(policy.shipping_policy_type).toBe("free")
    expect(policy.shipping_base_fee).toBe(0)
    expect(policy.shipping_validation_status).toBe("valid")
  })

  it("correctly parses fixed shipping policy with Jeju and Remote surcharges", () => {
    const policy = parseShippingPolicy("3,000원 (제주 3,000원 추가 / 도서산간 5,000원 추가)")
    expect(policy.shipping_policy_type).toBe("fixed")
    expect(policy.shipping_base_fee).toBe(3000)
    expect(policy.shipping_jeju_extra_fee).toBe(3000)
    expect(policy.shipping_remote_extra_fee).toBe(5000)
    expect(policy.shipping_validation_status).toBe("valid")
  })

  it("correctly parses quantity_tiered shipping policy", () => {
    const text = "1개 이상 ~ 3개 미만 3,000원 / 3개 이상 ~ 6개 미만 6,000원 (수량별배송비)"
    const policy = parseShippingPolicy(text)
    expect(policy.shipping_policy_type).toBe("quantity_tiered")
    expect(policy.shipping_base_fee).toBe(3000)
    expect(policy.shipping_tiers).toHaveLength(2)
    expect(policy.shipping_tiers[0]).toEqual({ min_qty: 1, max_qty_exclusive: 3, fee: 3000 })
    expect(policy.shipping_tiers[1]).toEqual({ min_qty: 3, max_qty_exclusive: 6, fee: 6000 })
    expect(policy.shipping_validation_status).toBe("valid")
  })

  it("returns review_required for empty or ambiguous shipping policy", () => {
    const policyEmpty = parseShippingPolicy("")
    expect(policyEmpty.shipping_policy_type).toBe("unknown")
    expect(policyEmpty.shipping_validation_status).toBe("review_required")
  })

  it("parses every distinct live raw pattern family", () => {
    expect(parseShippingPolicy("무료자세히 무료 제주도 : 5,000원도서산간 : 5,000원")).toMatchObject({
      shipping_policy_type: "free",
      shipping_jeju_extra_fee: 5000,
      shipping_remote_extra_fee: 5000,
    })
    expect(parseShippingPolicy("1,900원\n제주도 : 5,000원 추가\n도서산간 : 5,000원 추가")).toMatchObject({
      shipping_policy_type: "fixed",
      shipping_base_fee: 1900,
    })
    expect(parseShippingPolicy("수량별배송비자세히 0개 이상 ~ 6개 미만 4,000원 제주도 : 5,000원도서산간 : 5,000원")).toMatchObject({
      shipping_policy_type: "quantity_tiered",
      shipping_base_fee: 4000,
      shipping_tiers: [{ min_qty: 0, max_qty_exclusive: 6, fee: 4000 }],
    })
  })

  it("charges the tier boundary and repeated single-range fee without trusting frontend input", () => {
    const policy = parseShippingPolicy("0개 이상 ~ 5개 미만 3,000원")
    expect(shippingAmount(policy, 4)).toBe(3000)
    expect(shippingAmount(policy, 5)).toBe(3000)
    expect(shippingAmount(policy, 6)).toBe(6000)
    expect(shippingAmount({ ...policy, shipping_validation_status: "review_required" }, 1)).toBeNull()
  })

  it("keeps same-policy groups together and different products, policies, and lanes separate", () => {
    const keys = [
      "dailyfood|product-a|policy-1",
      "dailyfood|product-a|policy-1",
      "dailyfood|product-a|policy-2",
      "dailyfood|product-b|policy-1",
      "walldob2b|product-a|policy-1",
    ]
    expect(new Set(keys).size).toBe(4)
  })

  it("syntax-checks the actual collector and asserts server-side safety and order snapshot wiring", () => {
    const collector = "scripts/supplier-catalog/collect-dailyfood-catalog.mjs"
    expect(spawnSync(process.execPath, ["--check", collector]).status).toBe(0)
    const plan = readFileSync("scripts/supplier-catalog/build-catalog-plan.mjs", "utf8")
    const plugin = readFileSync(
      "wordpress/plugins/wholesalehub-supplier-lanes/wholesalehub-supplier-lanes.php",
      "utf8",
    )
    const approval = readFileSync(
      "wordpress/plugins/wholesalehub-supplier-lanes/includes/class-wholesalehub-supplier-lane-approval.php",
      "utf8",
    )
    expect(plan).toContain("salePrice(sourceCost)")
    expect(plugin).toContain("validate_cart_shipping_policies")
    expect(plugin).toContain("wholesalehub_shipping_review_required")
    expect(plugin).toContain("actual_applied_amount")
    expect(plugin).toContain("shipping_group_actual_amount")
    expect(plugin).toContain("$cart_item_key === $first_cart_item_key")
    expect(plugin).not.toContain("$base_fee > 0 ? $base_fee : 3000.0")
    expect(approval).toContain("배송비 {$shipping}")
    expect(plugin).toContain("'single-offer'")
    expect(plugin).toContain("'single-supplier'")
    expect(plugin).toContain("'multi-supplier'")
  })
})
