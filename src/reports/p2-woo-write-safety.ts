export type WooVariationState = {
  readonly id: number
  readonly status: string
  readonly sku: string
  readonly regularPrice: string
  readonly attributes: Readonly<Record<string, string>>
  readonly meta: Readonly<Record<string, string>>
}

export type WooVariationCreate = Omit<WooVariationState, "id" | "status"> & {
  readonly status?: "private" | "draft"
}

export type WooWriteClient = {
  readonly listVariations: (
    parentId: number,
    page: number,
    perPage: number,
  ) => Promise<readonly WooVariationState[]>
  readonly createVariation: (
    parentId: number,
    input: WooVariationCreate & { readonly status: "private" | "draft" },
  ) => Promise<WooVariationState>
  readonly updateVariation: (
    parentId: number,
    variationId: number,
    input: Partial<WooVariationState>,
  ) => Promise<WooVariationState>
  readonly getVariation: (parentId: number, variationId: number) => Promise<WooVariationState>
}

export type StagedVariationResult = {
  readonly ok: boolean
  readonly variationId: number | null
  readonly writes: number
  readonly rollbacks: number
  readonly error: string | null
}

export async function listAllWooVariations(
  client: WooWriteClient,
  parentId: number,
  perPage = 100,
): Promise<readonly WooVariationState[]> {
  const rows: WooVariationState[] = []
  for (let page = 1; ; page += 1) {
    const batch = await client.listVariations(parentId, page, perPage)
    rows.push(...batch)
    if (batch.length < perPage) return rows
  }
}

export async function createStagedWooVariation(
  client: WooWriteClient,
  parentId: number,
  expected: WooVariationCreate,
  persistAuthoritativeLink: (variation: WooVariationState) => Promise<void>,
): Promise<StagedVariationResult> {
  let created: WooVariationState | null = null
  let writes = 0
  try {
    created = await retry(() =>
      client.createVariation(parentId, { ...expected, status: "private" }),
    )
    writes += 1
    const privateReadBack = await client.getVariation(parentId, created.id)
    assertVariation(privateReadBack, expected, "private")
    await persistAuthoritativeLink(privateReadBack)
    await retry(() => client.updateVariation(parentId, created?.id ?? 0, { status: "publish" }))
    writes += 1
    const published = await client.getVariation(parentId, created.id)
    assertVariation(published, expected, "publish")
    return { ok: true, variationId: created.id, writes, rollbacks: 0, error: null }
  } catch (error) {
    if (created === null) {
      return {
        ok: false,
        variationId: null,
        writes,
        rollbacks: 0,
        error: message(error),
      }
    }
    try {
      await retry(() => client.updateVariation(parentId, created?.id ?? 0, { status: "private" }))
      writes += 1
      const rolledBack = await client.getVariation(parentId, created.id)
      if (rolledBack.status !== "private") {
        throw new Error(`rollback_read_back_mismatch:${rolledBack.status}`)
      }
      return {
        ok: false,
        variationId: created.id,
        writes,
        rollbacks: 1,
        error: message(error),
      }
    } catch (rollbackError) {
      return {
        ok: false,
        variationId: created.id,
        writes,
        rollbacks: 0,
        error: `${message(error)}; rollback_failed:${message(rollbackError)}`,
      }
    }
  }
}

function assertVariation(
  actual: WooVariationState,
  expected: WooVariationCreate,
  status: "private" | "publish",
): void {
  const mismatches: string[] = []
  if (actual.status !== status) mismatches.push(`status:${actual.status}`)
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
    throw new Error(`woo_read_back_mismatch:${mismatches.join(",")}`)
  }
}

async function retry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
