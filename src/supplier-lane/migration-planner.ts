import { createHash } from "node:crypto"
import type { P2Supplier } from "../reports/supplier-snapshot-v2.js"
import { createPublicOfferKey, laneForSupplier, sanitizePublicOptionLabel } from "./model.js"

export type LegacyAuthoritativeLink = {
  readonly supplierId: string
  readonly sourceProductId: string
  readonly sourceOptionId: string
  readonly atomicSupplierSkuId: string
  readonly wooParentId: number | null
  readonly wooVariationId: number | null
  readonly optionLabel: string
  readonly parentStatus: string
  readonly duplicateVariation: boolean
  readonly orphan: boolean
}

export type LaneMigrationPlan = {
  readonly parentLinksProposed: number
  readonly laneAOffers: number
  readonly laneBOffers: number
  readonly pendingNewOffers: number
  readonly exactMigratedVariations: number
  readonly duplicateReview: number
  readonly orphanReview: number
  readonly terminalExcluded: number
  readonly customerExposureRisk: number
  readonly expectedDbWrites: number
  readonly expectedWooWrites: number
  readonly rows: readonly {
    readonly supplierId: P2Supplier
    readonly laneCode: "A" | "B"
    readonly sourceProductId: string
    readonly sourceOptionId: string
    readonly wooParentId: number
    readonly wooVariationId: number
    readonly publicOfferKey: string
    readonly publicOptionLabel: string
  }[]
}

export function planLegacyLaneMigration(
  links: readonly LegacyAuthoritativeLink[],
  keyFactory: () => string = createPublicOfferKey,
): LaneMigrationPlan {
  const supported = links.filter(
    (link): link is LegacyAuthoritativeLink & { supplierId: P2Supplier } =>
      link.supplierId === "dailyfood" || link.supplierId === "walldob2b",
  )
  const terminal = supported.filter(
    (link) => link.parentStatus === "trash" || link.parentStatus === "deleted",
  )
  const rows = supported.flatMap((link) => {
    if (
      link.parentStatus === "trash" ||
      link.parentStatus === "deleted" ||
      link.duplicateVariation ||
      link.orphan ||
      link.wooParentId === null ||
      link.wooVariationId === null
    ) {
      return []
    }
    return [
      {
        supplierId: link.supplierId,
        laneCode: laneForSupplier(link.supplierId),
        sourceProductId: link.sourceProductId,
        sourceOptionId: link.sourceOptionId,
        wooParentId: link.wooParentId,
        wooVariationId: link.wooVariationId,
        publicOfferKey: keyFactory(),
        publicOptionLabel: sanitizePublicOptionLabel(link.optionLabel),
      },
    ]
  })
  return {
    parentLinksProposed: new Set(
      rows.map((row) => `${row.wooParentId}\u0000${row.supplierId}\u0000${row.sourceProductId}`),
    ).size,
    laneAOffers: rows.filter((row) => row.laneCode === "A").length,
    laneBOffers: rows.filter((row) => row.laneCode === "B").length,
    pendingNewOffers: supported.filter((link) => link.wooVariationId === null).length,
    exactMigratedVariations: rows.length,
    duplicateReview: supported.filter((link) => link.duplicateVariation).length,
    orphanReview: supported.filter((link) => link.orphan || link.wooParentId === null).length,
    terminalExcluded: terminal.length,
    customerExposureRisk: rows.filter((row) => unsafePublicLabel(row.publicOptionLabel)).length,
    expectedDbWrites:
      rows.length + new Set(rows.map((row) => `${row.wooParentId}:${row.laneCode}`)).size,
    expectedWooWrites: 0,
    rows,
  }
}

export function deterministicOfferKey(link: LegacyAuthoritativeLink): string {
  return createHash("sha256")
    .update(`${link.supplierId}|${link.sourceProductId}|${link.sourceOptionId}`)
    .digest("base64url")
    .slice(0, 32)
}

function unsafePublicLabel(label: string): boolean {
  return /dailyfood|walldob2b|source_(?:product|option)_id|https?:\/\//iu.test(label)
}
