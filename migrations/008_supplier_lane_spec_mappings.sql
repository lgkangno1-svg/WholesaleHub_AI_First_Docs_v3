PRAGMA foreign_keys = ON;

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

CREATE INDEX IF NOT EXISTS supplier_lane_spec_mappings_parent_status
  ON supplier_lane_spec_mappings(woo_parent_id, status);

CREATE INDEX IF NOT EXISTS supplier_lane_spec_mappings_public_offer_key
  ON supplier_lane_spec_mappings(public_offer_key);
