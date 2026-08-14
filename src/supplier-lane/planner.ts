import { createHash } from "node:crypto"
import type { P2Supplier, SupplierSnapshotGate } from "../reports/supplier-snapshot-v2.js"
import { laneForSupplier, sanitizePublicOptionLabel } from "./model.js"

export type LaneOfferState = {
  readonly id: number
  readonly supplierId: P2Supplier
  readonly sourceProductId: string
  readonly sourceOptionId: string
  readonly wooParentId: number
  readonly wooVariationId: number | null
  readonly publicOptionLabel: string
  readonly hardSpecFingerprint: string
  readonly sourceCost: number
  readonly stockStatus: string
  readonly approvalStatus: "pending" | "approved" | "rejected"
  readonly lifecycleStatus: "active" | "unavailable" | "retired" | "terminal"
  readonly missingCompleteCount: number
}

export type SnapshotLaneOption = {
  readonly supplierId: P2Supplier
  readonly sourceProductId: string
  readonly sourceOptionId: string
  readonly atomicSupplierSkuId: string
  readonly optionLabel: string
  readonly hardSpecFingerprint: string
  readonly sourceCost: number
  readonly shippingCost: number
  readonly stockStatus: string
}

export type LanePlanAction =
  | {
      readonly kind: "update_exact"
      readonly offerId: number
      readonly wooVariationId: number
      readonly priceChanged: boolean
      readonly stockChanged: boolean
    }
  | { readonly kind: "collect_pending"; readonly option: SnapshotLaneOption }
  | {
      readonly kind: "pending_replacement"
      readonly offerId: number
      readonly option: SnapshotLaneOption
    }
  | { readonly kind: "mark_missing"; readonly offerId: number; readonly missingCount: number }
  | { readonly kind: "mark_unavailable"; readonly offerId: number }

export type SupplierLanePlan = {
  readonly supplier: P2Supplier
  readonly laneCode: "A" | "B"
  readonly mutationAuthority: boolean
  readonly actions: readonly LanePlanAction[]
  readonly counts: {
    readonly checked: number
    readonly exactPriceUpdatesPlanned: number
    readonly exactStockUpdatesPlanned: number
    readonly pendingNewOptions: number
    readonly unavailableOffers: number
    readonly crossSupplierMatches: 0
    readonly winnerSelections: 0
    readonly parentTrashWrites: 0
  }
  readonly planHash: string
}

export type ProjectionParentLink = {
  readonly id: number
  readonly wooParentId: number
  readonly supplierId: P2Supplier
  readonly laneCode: "A" | "B"
  readonly sourceProductId: string
  readonly status: "pending" | "approved" | "rejected" | "terminal"
}

export type ProjectionExistingOffer = Pick<
  LaneOfferState,
  "id" | "supplierId" | "sourceProductId" | "sourceOptionId" | "wooVariationId" | "lifecycleStatus"
>

export type ApprovedParentProjectionAction =
  | {
      readonly kind: "preserve_variation"
      readonly parentLinkId: number
      readonly offerId: number
      readonly wooParentId: number
      readonly wooVariationId: number
      readonly supplierId: P2Supplier
      readonly laneCode: "A" | "B"
      readonly sourceProductId: string
      readonly sourceOptionId: string
    }
  | {
      readonly kind: "create_pending_offer"
      readonly parentLinkId: number
      readonly wooParentId: number
      readonly supplierId: P2Supplier
      readonly laneCode: "A" | "B"
      readonly sourceProductId: string
      readonly sourceOptionId: string
      readonly publicOptionLabel: string
      readonly approvalStatus: "pending"
      readonly wooVariationStatus: "private"
      readonly autoPublish: false
    }
  | {
      readonly kind: "keep_pending_offer"
      readonly parentLinkId: number
      readonly offerId: number
      readonly wooParentId: number
      readonly supplierId: P2Supplier
      readonly laneCode: "A" | "B"
      readonly sourceProductId: string
      readonly sourceOptionId: string
    }

export type ApprovedParentProjectionPlan = {
  readonly mutationAuthority: false
  readonly parentMetaPlans: readonly {
    readonly wooParentId: number
    readonly key: "_wh_supplier_lane_mode"
    readonly value: "1"
  }[]
  readonly actions: readonly ApprovedParentProjectionAction[]
  readonly counts: {
    readonly approvedParentLinks: number
    readonly preservedVariations: number
    readonly pendingPrivateOffers: number
    readonly terminalExcluded: number
    readonly crossSupplierMatches: 0
    readonly winnerSelections: 0
    readonly wooWrites: 0
    readonly dbWrites: 0
  }
}

export function planSupplierLane(input: {
  readonly supplier: P2Supplier
  readonly gate: SupplierSnapshotGate
  readonly existing: readonly LaneOfferState[]
  readonly incoming: readonly SnapshotLaneOption[]
}): SupplierLanePlan {
  const existing = input.existing.filter((offer) => offer.supplierId === input.supplier)
  const incoming = input.incoming.filter((option) => option.supplierId === input.supplier)
  const actions: LanePlanAction[] = []
  if (input.gate.mutationAllowed) {
    const seen = new Set<string>()
    for (const option of incoming) {
      const key = exactKey(option)
      seen.add(key)
      const offer = existing.find((candidate) => exactKey(candidate) === key)
      if (offer === undefined) {
        actions.push({
          kind: "collect_pending",
          option: { ...option, optionLabel: sanitizePublicOptionLabel(option.optionLabel) },
        })
      } else if (offer.hardSpecFingerprint !== option.hardSpecFingerprint) {
        actions.push({ kind: "pending_replacement", offerId: offer.id, option })
      } else if (
        offer.approvalStatus === "approved" &&
        offer.lifecycleStatus === "active" &&
        offer.wooVariationId !== null
      ) {
        const priceChanged = offer.sourceCost !== option.sourceCost
        const stockChanged = offer.stockStatus !== option.stockStatus
        if (priceChanged || stockChanged) {
          actions.push({
            kind: "update_exact",
            offerId: offer.id,
            wooVariationId: offer.wooVariationId,
            priceChanged,
            stockChanged,
          })
        }
      }
    }
    for (const offer of existing) {
      if (
        offer.lifecycleStatus !== "active" ||
        seen.has(exactKey(offer)) ||
        offer.approvalStatus === "rejected"
      ) {
        continue
      }
      const missingCount = offer.missingCompleteCount + 1
      actions.push(
        missingCount >= 2
          ? { kind: "mark_unavailable", offerId: offer.id }
          : { kind: "mark_missing", offerId: offer.id, missingCount },
      )
    }
  }
  const counts = {
    checked: incoming.length,
    exactPriceUpdatesPlanned: actions.filter(
      (action) => action.kind === "update_exact" && action.priceChanged,
    ).length,
    exactStockUpdatesPlanned: actions.filter(
      (action) => action.kind === "update_exact" && action.stockChanged,
    ).length,
    pendingNewOptions: actions.filter(
      (action) => action.kind === "collect_pending" || action.kind === "pending_replacement",
    ).length,
    unavailableOffers: actions.filter((action) => action.kind === "mark_unavailable").length,
    crossSupplierMatches: 0 as const,
    winnerSelections: 0 as const,
    parentTrashWrites: 0 as const,
  }
  const canonical = {
    supplier: input.supplier,
    laneCode: laneForSupplier(input.supplier),
    mutationAuthority: input.gate.mutationAllowed,
    actions,
    counts,
  }
  return {
    ...canonical,
    planHash: createHash("sha256").update(stableJson(canonical)).digest("hex"),
  }
}

export function planApprovedParentProjection(input: {
  readonly parentLinks: readonly ProjectionParentLink[]
  readonly existingOffers: readonly ProjectionExistingOffer[]
  readonly incoming: readonly SnapshotLaneOption[]
}): ApprovedParentProjectionPlan {
  const approved = input.parentLinks.filter((link) => link.status === "approved")
  const actions: ApprovedParentProjectionAction[] = []
  let terminalExcluded = 0
  for (const link of approved) {
    const options = input.incoming.filter(
      (option) =>
        option.supplierId === link.supplierId && option.sourceProductId === link.sourceProductId,
    )
    for (const option of options) {
      const existing = input.existingOffers.find(
        (offer) =>
          offer.supplierId === option.supplierId &&
          offer.sourceProductId === option.sourceProductId &&
          offer.sourceOptionId === option.sourceOptionId,
      )
      if (existing?.lifecycleStatus === "terminal") {
        terminalExcluded += 1
        continue
      }
      if (existing?.wooVariationId != null) {
        actions.push({
          kind: "preserve_variation",
          parentLinkId: link.id,
          offerId: existing.id,
          wooParentId: link.wooParentId,
          wooVariationId: existing.wooVariationId,
          supplierId: link.supplierId,
          laneCode: link.laneCode,
          sourceProductId: option.sourceProductId,
          sourceOptionId: option.sourceOptionId,
        })
        continue
      }
      if (existing !== undefined) {
        actions.push({
          kind: "keep_pending_offer",
          parentLinkId: link.id,
          offerId: existing.id,
          wooParentId: link.wooParentId,
          supplierId: link.supplierId,
          laneCode: link.laneCode,
          sourceProductId: option.sourceProductId,
          sourceOptionId: option.sourceOptionId,
        })
        continue
      }
      actions.push({
        kind: "create_pending_offer",
        parentLinkId: link.id,
        wooParentId: link.wooParentId,
        supplierId: link.supplierId,
        laneCode: link.laneCode,
        sourceProductId: option.sourceProductId,
        sourceOptionId: option.sourceOptionId,
        publicOptionLabel: sanitizePublicOptionLabel(option.optionLabel),
        approvalStatus: "pending",
        wooVariationStatus: "private",
        autoPublish: false,
      })
    }
  }
  const parentMetaPlans = [...new Set(approved.map((link) => link.wooParentId))].map(
    (wooParentId) => ({
      wooParentId,
      key: "_wh_supplier_lane_mode" as const,
      value: "1" as const,
    }),
  )
  return {
    mutationAuthority: false,
    parentMetaPlans,
    actions,
    counts: {
      approvedParentLinks: approved.length,
      preservedVariations: actions.filter((action) => action.kind === "preserve_variation").length,
      pendingPrivateOffers: actions.filter((action) => action.kind === "create_pending_offer")
        .length,
      terminalExcluded,
      crossSupplierMatches: 0,
      winnerSelections: 0,
      wooWrites: 0,
      dbWrites: 0,
    },
  }
}

function exactKey(
  value:
    | Pick<LaneOfferState, "supplierId" | "sourceProductId" | "sourceOptionId">
    | Pick<SnapshotLaneOption, "supplierId" | "sourceProductId" | "sourceOptionId">,
): string {
  return `${value.supplierId}\u0000${value.sourceProductId}\u0000${value.sourceOptionId}`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}
