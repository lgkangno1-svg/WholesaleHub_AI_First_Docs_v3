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
  readonly regular_price: string
  readonly sale_price: ""
  readonly stock_status: "instock" | "outofstock"
  readonly manage_stock: false
}

export type WooCommerceDryRunOperation = {
  readonly mode: "dry-run"
  readonly productId: number | null
  readonly payload: WooCommerceUpdatePayload
}
