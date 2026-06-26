import type { CompareProduct, WooCommerceDryRunPayload } from "../domain/product.js"

export function buildWooCommerceDryRunPayloads(
  products: readonly CompareProduct[],
  marginAmount: number,
): readonly WooCommerceDryRunPayload[] {
  return products.map((product) => ({
    regular_price: String(product.price + marginAmount),
    stock_status: product.stockStatus === "out_of_stock" ? "outofstock" : "instock",
    manage_stock: false,
  }))
}
