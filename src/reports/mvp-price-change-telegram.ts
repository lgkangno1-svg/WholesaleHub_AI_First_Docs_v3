import { createHash } from "node:crypto"

export type PriceChangePlanRow = {
  readonly product_id: number | null
  readonly variation_id: number | null
  readonly woocommerce_product_name: string
  readonly woocommerce_option_name: string
}

export type PriceChangeExecuteEntry = {
  readonly product_id: number
  readonly variation_id: number
  readonly action: string
  readonly before_price: string
  readonly after_price: string | null
  readonly expected_price: string
  readonly status: string
}

export type MvpPriceChangeTelegramReport = {
  readonly report_id: string
  readonly run_at: string
  readonly generated_at: string
  readonly product_count: number
  readonly change_count: number
  readonly changes: readonly {
    readonly product_id: number
    readonly variation_id: number
    readonly product_name: string
    readonly option_name: string
    readonly before_price: number
    readonly after_price: number
    readonly difference: number
  }[]
}

const PRICE_ACTIONS = new Set(["update_price", "switch_supplier_and_update_price"])

export function buildMvpPriceChangeTelegramReport(input: {
  readonly requestedAt: string
  readonly planRows: readonly PriceChangePlanRow[]
  readonly entries: readonly PriceChangeExecuteEntry[]
  readonly generatedAt?: string
}): MvpPriceChangeTelegramReport {
  const namesByTarget = collectNames(input.planRows)
  const changes = input.entries
    .filter((entry) => entry.status === "verified" && PRICE_ACTIONS.has(entry.action))
    .flatMap((entry) => {
      const beforePrice = priceNumber(entry.before_price)
      const afterPrice = priceNumber(entry.after_price)
      const expectedPrice = priceNumber(entry.expected_price)
      if (
        beforePrice === null ||
        afterPrice === null ||
        expectedPrice === null ||
        beforePrice === afterPrice ||
        afterPrice !== expectedPrice
      )
        return []
      const names = namesByTarget.get(targetKey(entry.product_id, entry.variation_id))
      return [
        {
          product_id: entry.product_id,
          variation_id: entry.variation_id,
          product_name: names?.productName ?? `상품 #${entry.product_id}`,
          option_name: names?.optionName ?? `옵션 #${entry.variation_id}`,
          before_price: beforePrice,
          after_price: afterPrice,
          difference: afterPrice - beforePrice,
        },
      ]
    })
    .sort(
      (left, right) => left.product_id - right.product_id || left.variation_id - right.variation_id,
    )
  const fingerprint = JSON.stringify({ requestedAt: input.requestedAt, changes })
  return {
    report_id: createHash("sha256").update(fingerprint).digest("hex"),
    run_at: input.requestedAt,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    product_count: new Set(changes.map((change) => change.product_id)).size,
    change_count: changes.length,
    changes,
  }
}

function collectNames(
  rows: readonly PriceChangePlanRow[],
): ReadonlyMap<string, { readonly productName: string; readonly optionName: string }> {
  const candidates = new Map<string, { productNames: Set<string>; optionNames: Set<string> }>()
  for (const row of rows) {
    if (row.product_id === null || row.variation_id === null) continue
    const key = targetKey(row.product_id, row.variation_id)
    const target = candidates.get(key) ?? { productNames: new Set(), optionNames: new Set() }
    const productName = row.woocommerce_product_name.trim()
    const optionName = row.woocommerce_option_name.trim()
    if (productName.length > 0) target.productNames.add(productName)
    if (optionName.length > 0) target.optionNames.add(optionName)
    candidates.set(key, target)
  }
  return new Map(
    [...candidates].map(([key, names]) => [
      key,
      {
        productName: [...names.productNames].sort()[0] ?? "",
        optionName: [...names.optionNames].sort()[0] ?? "",
      },
    ]),
  )
}

function targetKey(productId: number, variationId: number): string {
  return `${productId}:${variationId}`
}

function priceNumber(value: string | null): number | null {
  if (value === null || value.trim().length === 0) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}
