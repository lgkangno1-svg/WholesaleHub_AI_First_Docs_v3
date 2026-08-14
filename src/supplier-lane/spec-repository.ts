import { createHash } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import { parseSpecLabel, type SpecMappingStatus } from "./spec-normalizer.js"

export type SpecMappingRow = {
  readonly id: number
  readonly woo_variation_id: number
  readonly woo_parent_id: number
  readonly public_offer_key: string
  readonly option_label_raw: string
  readonly option_raw_hash: string
  readonly auto_analysis_json: string
  readonly final_spec_json: string
  readonly weight_val: number | null
  readonly weight_unit: string | null
  readonly count_val: number | null
  readonly count_unit: string | null
  readonly grade_size: string | null
  readonly packaging: string | null
  readonly variety: string | null
  readonly origin: string | null
  readonly storage_type: string | null
  readonly comparison_group: string | null
  readonly confidence: number
  readonly status: SpecMappingStatus
  readonly last_analyzed_at: string
  readonly created_at: string
  readonly updated_at: string
}

export function ensureSpecMappingSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS supplier_lane_spec_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      woo_variation_id INTEGER NOT NULL UNIQUE,
      woo_parent_id INTEGER NOT NULL,
      public_offer_key TEXT NOT NULL,
      option_label_raw TEXT NOT NULL,
      option_raw_hash TEXT NOT NULL,
      auto_analysis_json TEXT NOT NULL,
      final_spec_json TEXT NOT NULL,
      weight_val REAL,
      weight_unit TEXT,
      count_val INTEGER,
      count_unit TEXT,
      grade_size TEXT,
      packaging TEXT,
      variety TEXT,
      origin TEXT,
      storage_type TEXT,
      comparison_group TEXT,
      confidence REAL NOT NULL DEFAULT 0.00,
      status TEXT NOT NULL DEFAULT 'review_required'
        CHECK (status IN ('auto_approved', 'review_required', 'manual_approved', 'excluded')),
      last_analyzed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}

export function syncSpecMappingForOffer(
  database: DatabaseSync,
  offer: {
    readonly woo_variation_id: number
    readonly woo_parent_id: number
    readonly public_offer_key: string
    readonly option_label_raw: string
  },
  now: string,
): SpecMappingRow {
  ensureSpecMappingSchema(database)
  const hash = createHash("sha256").update(offer.option_label_raw).digest("hex")
  const existing = database
    .prepare("SELECT * FROM supplier_lane_spec_mappings WHERE woo_variation_id = ?")
    .get(offer.woo_variation_id) as SpecMappingRow | undefined

  if (existing && existing.status === "manual_approved") {
    return existing
  }

  const analysis = parseSpecLabel(offer.option_label_raw)
  const autoJson = JSON.stringify(analysis)
  const finalJson = autoJson

  if (existing) {
    database
      .prepare(
        `UPDATE supplier_lane_spec_mappings SET
          woo_parent_id = ?,
          public_offer_key = ?,
          option_label_raw = ?,
          option_raw_hash = ?,
          auto_analysis_json = ?,
          final_spec_json = ?,
          weight_val = ?,
          weight_unit = ?,
          count_val = ?,
          count_unit = ?,
          grade_size = ?,
          packaging = ?,
          variety = ?,
          origin = ?,
          storage_type = ?,
          comparison_group = ?,
          confidence = ?,
          status = ?,
          last_analyzed_at = ?,
          updated_at = ?
        WHERE woo_variation_id = ?`,
      )
      .run(
        offer.woo_parent_id,
        offer.public_offer_key,
        offer.option_label_raw,
        hash,
        autoJson,
        finalJson,
        analysis.weightVal,
        analysis.weightUnit,
        analysis.countVal,
        analysis.countUnit,
        analysis.gradeSize,
        analysis.packaging,
        analysis.variety,
        analysis.origin,
        analysis.storageType,
        analysis.comparisonGroup,
        analysis.confidence,
        analysis.status,
        now,
        now,
        offer.woo_variation_id,
      )
  } else {
    database
      .prepare(
        `INSERT INTO supplier_lane_spec_mappings (
          woo_variation_id, woo_parent_id, public_offer_key, option_label_raw,
          option_raw_hash, auto_analysis_json, final_spec_json, weight_val, weight_unit,
          count_val, count_unit, grade_size, packaging, variety, origin, storage_type,
          comparison_group, confidence, status, last_analyzed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        offer.woo_variation_id,
        offer.woo_parent_id,
        offer.public_offer_key,
        offer.option_label_raw,
        hash,
        autoJson,
        finalJson,
        analysis.weightVal,
        analysis.weightUnit,
        analysis.countVal,
        analysis.countUnit,
        analysis.gradeSize,
        analysis.packaging,
        analysis.variety,
        analysis.origin,
        analysis.storageType,
        analysis.comparisonGroup,
        analysis.confidence,
        analysis.status,
        now,
        now,
        now,
      )
  }

  return database
    .prepare("SELECT * FROM supplier_lane_spec_mappings WHERE woo_variation_id = ?")
    .get(offer.woo_variation_id) as SpecMappingRow
}
