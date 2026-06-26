export type WooCommerceSyncCandidate = {
  readonly compareKey: string
  readonly normalizedName: string
  readonly optionKey: string
  readonly price: number
  readonly stockStatus: string | null
  readonly supplierId?: string
  readonly supplierName?: string
  readonly sourceUrl?: string
  readonly rawCost?: number
  readonly productUrl?: string | null
}

export type WooCommerceUpdatePayload = {
  readonly name: string
  readonly regular_price: string
  readonly sale_price: ""
  readonly stock_status: "instock" | "outofstock"
  readonly manage_stock: false
  readonly meta_data: readonly [
    {
      readonly key: "_wholesalehub_compare_key"
      readonly value: string
    },
  ]
}

export type WooCommerceDryRunOperation = {
  readonly mode: "dry-run"
  readonly lookupKey: string
  readonly payload: WooCommerceUpdatePayload
}
