import { DatabaseSync } from "node:sqlite"
import { existsSync } from "node:fs"
import { syncSpecMappingForOffer, ensureSpecMappingSchema } from "../supplier-lane/spec-repository.js"

export function runOptionASpecSync(dbPath: string = "data/wholesalehub.sqlite") {
  if (!existsSync(dbPath)) {
    return {
      totalOptions: 0,
      ruleAutoAnalyzed: 0,
      aiAnalyzed: 0,
      autoApproved: 0,
      reviewRequired: 0,
      excluded: 0,
      optionAAppliedProducts: 0,
      legacyUIMaintainedProducts: 0,
      aiCredentialStatus: "AI_RUNTIME_NOT_CONFIGURED",
    }
  }

  const database = new DatabaseSync(dbPath)
  ensureSpecMappingSchema(database)

  const hasOffersTable = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='supplier_lane_offers'").get()
  if (!hasOffersTable) {
    return {
      totalOptions: 0,
      ruleAutoAnalyzed: 0,
      aiAnalyzed: 0,
      autoApproved: 0,
      reviewRequired: 0,
      excluded: 0,
      optionAAppliedProducts: 0,
      legacyUIMaintainedProducts: 0,
      aiCredentialStatus: "AI_RUNTIME_NOT_CONFIGURED",
    }
  }

  const offers = (database
    .prepare(
      `SELECT woo_variation_id, woo_parent_id, public_offer_key, option_label_raw
       FROM supplier_lane_offers
       WHERE woo_variation_id IS NOT NULL AND approval_status = 'approved' AND lifecycle_status = 'active'`,
    )
    .all() as unknown) as readonly {
    woo_variation_id: number
    woo_parent_id: number
    public_offer_key: string
    option_label_raw: string
  }[]

  const now = new Date().toISOString()
  let ruleAutoAnalyzed = 0
  const aiAnalyzed = 0
  let autoApproved = 0
  let reviewRequired = 0
  let excluded = 0

  for (const offer of offers) {
    const row = syncSpecMappingForOffer(database, offer, now)
    ruleAutoAnalyzed++
    if (row.status === "auto_approved" || row.status === "manual_approved") {
      autoApproved++
    } else if (row.status === "review_required") {
      reviewRequired++
    } else if (row.status === "excluded") {
      excluded++
    }
  }

  const parentRows = (database
    .prepare(
      `SELECT DISTINCT woo_parent_id FROM supplier_lane_spec_mappings`,
    )
    .all() as unknown) as readonly { woo_parent_id: number }[]

  let optionAAppliedProducts = 0
  let legacyUIMaintainedProducts = 0

  for (const parent of parentRows) {
    const approvedCount = database
      .prepare(
        `SELECT COUNT(*) as count FROM supplier_lane_spec_mappings
         WHERE woo_parent_id = ? AND status IN ('auto_approved', 'manual_approved')`,
      )
      .get(parent.woo_parent_id) as { count: number }

    if (approvedCount && approvedCount.count > 0) {
      optionAAppliedProducts++
    } else {
      legacyUIMaintainedProducts++
    }
  }

  const env = process.env
  const aiCredentialStatus =
    env["GEMINI_API_KEY"] || env["OPENROUTER_API_KEY"]
      ? "CONFIGURED"
      : "AI_RUNTIME_NOT_CONFIGURED"

  return {
    totalOptions: offers.length,
    ruleAutoAnalyzed,
    aiAnalyzed,
    autoApproved,
    reviewRequired,
    excluded,
    optionAAppliedProducts,
    legacyUIMaintainedProducts,
    aiCredentialStatus,
  }
}

if (process.argv[1]?.endsWith("option-a-spec-sync-cli.js")) {
  const res = runOptionASpecSync()
  console.log(JSON.stringify(res, null, 2))
}
