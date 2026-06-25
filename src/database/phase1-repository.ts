import type { DatabaseSync } from "node:sqlite"
import type {
  CollectedProduct,
  CompareProduct,
  ParsedProduct,
  PriceCandidate,
  ProductMappingRecord,
  RawProductRecord,
  SupplierConfig,
} from "../domain/product.js"
import { NormalizationStore } from "./normalization-store.js"
import { RawProductStore } from "./raw-product-store.js"

export class Phase1Repository {
  private readonly rawProducts: RawProductStore
  private readonly normalization: NormalizationStore

  constructor(database: DatabaseSync) {
    this.rawProducts = new RawProductStore(database)
    this.normalization = new NormalizationStore(database)
  }

  upsertSupplier(config: SupplierConfig): void {
    this.rawProducts.upsertSupplier(config)
  }

  replaceRawProducts(
    config: SupplierConfig,
    products: readonly CollectedProduct[],
  ): readonly RawProductRecord[] {
    return this.rawProducts.replace(config, products)
  }

  findMapping(mappingKey: string): ProductMappingRecord | null {
    return this.normalization.findMapping(mappingKey)
  }

  saveMapping(
    mappingKey: string,
    raw: RawProductRecord,
    parsed: ParsedProduct,
  ): ProductMappingRecord {
    return this.normalization.saveMapping(mappingKey, raw, parsed)
  }

  insertNormalized(raw: RawProductRecord, mapping: ProductMappingRecord): void {
    this.normalization.insertNormalized(raw, mapping)
  }

  getPriceCandidates(): readonly PriceCandidate[] {
    return this.normalization.getPriceCandidates()
  }

  replaceCompareProducts(products: readonly CompareProduct[]): void {
    this.normalization.replaceCompareProducts(products)
  }
}
