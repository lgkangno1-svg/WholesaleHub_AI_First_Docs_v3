import type {
  StagedVariationResult,
  WooVariationCreate,
  WooVariationState,
  WooWriteClient,
} from "../reports/p2-woo-write-safety.js"
import { createOpaqueSku, publicLaneLabel, type SupplierLaneCode } from "./model.js"

export type LaneVariationInput = {
  readonly lane: SupplierLaneCode
  readonly publicOptionLabel: string
  readonly salePrice: number
  readonly laneOfferId: number
  readonly supplierId: string
  readonly sourceProductId: string
  readonly sourceOptionId: string
  readonly snapshotHash: string
  readonly hardSpecFingerprint: string
}

export type LaneWooClient = WooWriteClient & {
  readonly getParent: (
    parentId: number,
  ) => Promise<{ readonly id: number; readonly status: string }>
}

export async function provisionLaneVariation(
  client: LaneWooClient,
  parentId: number,
  input: LaneVariationInput,
  persistMappingTransaction: (variationId: number) => Promise<void>,
  skuFactory: () => string = createOpaqueSku,
): Promise<StagedVariationResult> {
  const parent = await client.getParent(parentId)
  if (parent.id !== parentId || !["publish", "private"].includes(parent.status)) {
    return {
      ok: false,
      variationId: null,
      writes: 0,
      rollbacks: 0,
      error: `parent_not_eligible:${parent.status}`,
    }
  }
  const expected: WooVariationCreate = {
    sku: skuFactory(),
    regularPrice: input.salePrice.toFixed(2),
    attributes: {
      출고구분: publicLaneLabel(input.lane),
      구매옵션: input.publicOptionLabel,
    },
    meta: {
      _wh_lane_offer_id: String(input.laneOfferId),
      _wh_internal_supplier_id: input.supplierId,
      _wh_source_product_id: input.sourceProductId,
      _wh_source_option_id: input.sourceOptionId,
      _wh_snapshot_hash: input.snapshotHash,
      _wh_hard_spec_fingerprint: input.hardSpecFingerprint,
    },
  }
  let created: WooVariationState | null = null
  try {
    created = await retryPrivate(() =>
      client.createVariation(parentId, { ...expected, status: "private" }),
    )
    const readBack = await client.getVariation(parentId, created.id)
    assertPrivateVariation(readBack, expected)
    await persistMappingTransaction(created.id)
    return { ok: true, variationId: created.id, writes: 1, rollbacks: 0, error: null }
  } catch (error) {
    return {
      ok: false,
      variationId: created?.id ?? null,
      writes: created === null ? 0 : 1,
      rollbacks: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function assertPrivateVariation(actual: WooVariationState, expected: WooVariationCreate): void {
  const mismatches: string[] = []
  if (actual.status !== "private") mismatches.push(`status:${actual.status}`)
  if (actual.sku !== expected.sku) mismatches.push(`sku:${actual.sku}`)
  if (actual.regularPrice !== expected.regularPrice) {
    mismatches.push(`regular_price:${actual.regularPrice}`)
  }
  if (JSON.stringify(actual.attributes) !== JSON.stringify(expected.attributes)) {
    mismatches.push("attributes")
  }
  for (const [key, value] of Object.entries(expected.meta)) {
    if (actual.meta[key] !== value) mismatches.push(`meta:${key}`)
  }
  if (mismatches.length > 0) {
    throw new Error(`woo_private_read_back_mismatch:${mismatches.join(",")}`)
  }
}

async function retryPrivate<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
