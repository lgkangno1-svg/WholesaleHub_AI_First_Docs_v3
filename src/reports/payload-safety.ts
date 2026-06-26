export const FORBIDDEN_WOOCOMMERCE_PAYLOAD_FIELDS = [
  "supplier_id",
  "supplier_name",
  "source_url",
  "raw_cost",
  "forwardFilled",
  "cheapest_supplier_id",
  "compare_key",
  "normalized_name",
  "option_key",
] as const

export type PayloadSafetyResult = {
  readonly safe: boolean
  readonly forbiddenFieldHits: readonly string[]
}

export function inspectWooCommercePayloadSafety(payload: unknown): PayloadSafetyResult {
  const forbiddenFields = new Set<string>(FORBIDDEN_WOOCOMMERCE_PAYLOAD_FIELDS)
  const forbiddenFieldHits: string[] = []
  walkPayload(payload, "$", forbiddenFields, forbiddenFieldHits)
  return {
    safe: forbiddenFieldHits.length === 0,
    forbiddenFieldHits,
  }
}

function walkPayload(
  value: unknown,
  path: string,
  forbiddenFields: ReadonlySet<string>,
  hits: string[],
): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      walkPayload(item, `${path}[${index}]`, forbiddenFields, hits)
    }
    return
  }
  if (value === null || typeof value !== "object") {
    return
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`
    if (forbiddenFields.has(key)) {
      hits.push(childPath)
    }
    walkPayload(child, childPath, forbiddenFields, hits)
  }
}
