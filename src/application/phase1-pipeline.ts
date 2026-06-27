import { createHash } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import { parseDailyFoodCsv } from "../adapters/dailyfood/dailyfood-adapter.js"
import { Phase1Repository } from "../database/phase1-repository.js"
import type {
  CollectedProduct,
  DailyFoodSkippedRowsByReason,
  ProductParser,
  SupplierConfig,
  WooCommerceDryRunPayload,
} from "../domain/product.js"
import { calculateLowestPrices } from "../pricing/price-engine.js"
import { buildWooCommerceDryRunPayloads } from "../woocommerce/dry-run.js"

export type Phase1PipelineInput = {
  readonly database: DatabaseSync
  readonly config: SupplierConfig
  readonly csv: string
  readonly parser: ProductParser
  readonly marginAmount?: number
}

export type CollectedProductsPipelineInput = {
  readonly database: DatabaseSync
  readonly config: SupplierConfig
  readonly products: readonly CollectedProduct[]
  readonly parser: ProductParser
  readonly marginAmount?: number
}

export type Phase1PipelineResult = {
  readonly rawProductCount: number
  readonly normalizedProductCount: number
  readonly compareProductCount: number
  readonly mappingCacheHits: number
  readonly parserCalls: number
  readonly skippedRows: number
  readonly skippedRowsByReason: DailyFoodSkippedRowsByReason
  readonly dryRunPayloads: readonly WooCommerceDryRunPayload[]
}

export async function runPhase1Pipeline(input: Phase1PipelineInput): Promise<Phase1PipelineResult> {
  const parsedCsv = parseDailyFoodCsv(input.csv, input.config)
  const result = await runCollectedProductsPipeline({
    database: input.database,
    config: input.config,
    products: parsedCsv.products,
    parser: input.parser,
    ...(input.marginAmount === undefined ? {} : { marginAmount: input.marginAmount }),
  })
  return {
    ...result,
    skippedRows: parsedCsv.skippedRows,
    skippedRowsByReason: parsedCsv.skippedRowsByReason,
  }
}

export async function runCollectedProductsPipeline(
  input: CollectedProductsPipelineInput,
): Promise<Phase1PipelineResult> {
  const repository = new Phase1Repository(input.database)
  repository.upsertSupplier(input.config)
  const rawProducts = repository.replaceRawProducts(input.config, input.products)
  let mappingCacheHits = 0
  let parserCalls = 0

  for (const raw of rawProducts) {
    const mappingKey = createMappingKey(raw.originalProductName, raw.originalOptionName)
    const cached = repository.findMapping(mappingKey)
    if (cached !== null) {
      mappingCacheHits += 1
      repository.insertNormalized(raw, cached)
      continue
    }
    parserCalls += 1
    const parsed = await input.parser.parse(raw.originalProductName, raw.originalOptionName)
    const mapping = repository.saveMapping(mappingKey, raw, parsed)
    repository.insertNormalized(raw, mapping)
  }

  const compareProducts = calculateLowestPrices(repository.getPriceCandidates())
  repository.replaceCompareProducts(compareProducts)
  const dryRunPayloads = buildWooCommerceDryRunPayloads(compareProducts, input.marginAmount ?? 0)
  return {
    rawProductCount: rawProducts.length,
    normalizedProductCount: rawProducts.length,
    compareProductCount: compareProducts.length,
    mappingCacheHits,
    parserCalls,
    skippedRows: 0,
    skippedRowsByReason: {
      empty_product_name_without_context: 0,
      missing_price: 0,
      invalid_price: 0,
      empty_row: 0,
      etc: 0,
    },
    dryRunPayloads,
  }
}

function createMappingKey(productName: string, optionName: string | null): string {
  return createHash("sha256")
    .update(`${productName.trim()}|${optionName?.trim() ?? ""}`)
    .digest("hex")
}
