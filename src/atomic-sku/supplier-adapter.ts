export type SupplierProductReference = {
  readonly supplierId: string
  readonly sourceProductId: string
  readonly originalTitle: string
  readonly detailUrl: string
  readonly listingStartPrice: number | null
}

export type SupplierDetailOption = {
  readonly sourceOptionId: string
  readonly originalOptionName: string
  readonly optionGroupTitle?: string | null
  readonly actualPrice: number | null
  readonly soldOut: boolean
  readonly structuredAttributes: Readonly<Record<string, string>>
}

export type SupplierProductDetail = SupplierProductReference & {
  readonly detailDescription: string | null
  readonly imageUrl: string | null
  readonly shippingFee: number
  readonly options: readonly SupplierDetailOption[]
  readonly verifiedAt: string
}

export interface SupplierAtomicAdapter {
  readonly supplierId: string
  listProducts(): Promise<readonly SupplierProductReference[]>
  fetchProductDetail(reference: SupplierProductReference): Promise<SupplierProductDetail>
}
