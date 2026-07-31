const sourceProductRules = [
  {
    supplierId: "dailyfood",
    sourceProductId: "10001569",
    reason: "terminal_excluded",
  },
]

export function sourceProductExclusionReason(supplierId, sourceProductId) {
  const matched = sourceProductRules.find(
    (rule) =>
      rule.supplierId === String(supplierId ?? "") &&
      rule.sourceProductId === String(sourceProductId ?? ""),
  )
  return matched?.reason ?? null
}

export function sourceProductExclusions(supplierId) {
  return sourceProductRules
    .filter((rule) => rule.supplierId === String(supplierId ?? ""))
    .map((rule) => ({ ...rule }))
}
