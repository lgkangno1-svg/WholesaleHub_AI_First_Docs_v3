import { describe, expect, it } from "vitest"

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
})
