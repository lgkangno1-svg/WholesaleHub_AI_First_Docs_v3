-- SQLite schema for the isolated atomic supplier SKU comparison engine.
-- This migration creates new tables only and does not alter WooCommerce tables.

CREATE TABLE IF NOT EXISTS atomic_sync_runs (
  sync_run_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  supplier_count INTEGER NOT NULL,
  atomic_sku_count INTEGER NOT NULL,
  summary_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_products (
  supplier_product_id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  source_product_id TEXT NOT NULL,
  original_title TEXT NOT NULL,
  detail_url TEXT,
  listing_start_price INTEGER,
  detail_description TEXT,
  image_urls_json TEXT NOT NULL DEFAULT '[]',
  detail_verified_at TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  last_seen_sync_run_id TEXT NOT NULL REFERENCES atomic_sync_runs(sync_run_id),
  UNIQUE (supplier_id, source_product_id)
);

CREATE TABLE IF NOT EXISTS supplier_options (
  supplier_option_id TEXT PRIMARY KEY,
  supplier_product_id TEXT NOT NULL REFERENCES supplier_products(supplier_product_id),
  source_option_id TEXT NOT NULL,
  original_option_name TEXT NOT NULL,
  option_price INTEGER NOT NULL,
  shipping_fee INTEGER NOT NULL DEFAULT 0,
  stock_status TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  last_seen_sync_run_id TEXT NOT NULL REFERENCES atomic_sync_runs(sync_run_id),
  UNIQUE (supplier_product_id, source_option_id)
);

CREATE TABLE IF NOT EXISTS atomic_supplier_skus (
  atomic_sku_id TEXT PRIMARY KEY,
  supplier_product_id TEXT NOT NULL REFERENCES supplier_products(supplier_product_id),
  supplier_option_id TEXT NOT NULL REFERENCES supplier_options(supplier_option_id),
  input_fingerprint TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (
    status IN (
      'active', 'promotion', 'preorder', 'sold_out', 'expired',
      'zero_price_invalid', 'review_needed', 'blocked'
    )
  ),
  collected_at TEXT NOT NULL,
  last_seen_sync_run_id TEXT NOT NULL REFERENCES atomic_sync_runs(sync_run_id),
  UNIQUE (supplier_product_id, supplier_option_id)
);

CREATE TABLE IF NOT EXISTS normalized_offers (
  normalized_offer_id TEXT PRIMARY KEY,
  atomic_sku_id TEXT NOT NULL UNIQUE REFERENCES atomic_supplier_skus(atomic_sku_id),
  product_family TEXT NOT NULL,
  variety TEXT,
  product_type TEXT,
  peach_skin_type TEXT NOT NULL DEFAULT 'unknown',
  cultivation_method TEXT,
  processing TEXT,
  quality_grade TEXT,
  usage_grade TEXT,
  size_label TEXT,
  size_min REAL,
  size_max REAL,
  size_unit TEXT,
  weight REAL,
  count_value REAL,
  option_unit TEXT,
  origin TEXT,
  packaging TEXT,
  weight_basis TEXT NOT NULL DEFAULT 'unknown',
  package_type TEXT,
  promotion_flag INTEGER NOT NULL DEFAULT 0,
  preorder_flag INTEGER NOT NULL DEFAULT 0,
  sold_out_flag INTEGER NOT NULL DEFAULT 0,
  shipping_fee INTEGER NOT NULL,
  final_cost INTEGER NOT NULL,
  confidence REAL NOT NULL,
  confidence_reason TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  provenance_candidates_json TEXT NOT NULL,
  spec_conflicts_json TEXT NOT NULL,
  category_profile_json TEXT NOT NULL,
  removed_marketing_terms_json TEXT NOT NULL,
  status_reasons_json TEXT NOT NULL,
  price_anomaly INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  canonical_product_key TEXT NOT NULL,
  canonical_variant_key TEXT,
  normalized_at TEXT NOT NULL,
  last_seen_sync_run_id TEXT NOT NULL REFERENCES atomic_sync_runs(sync_run_id)
);

CREATE TABLE IF NOT EXISTS canonical_products (
  canonical_product_id TEXT PRIMARY KEY,
  canonical_product_key TEXT NOT NULL UNIQUE,
  product_family TEXT NOT NULL,
  grade_group TEXT,
  attributes_json TEXT NOT NULL,
  last_seen_sync_run_id TEXT NOT NULL REFERENCES atomic_sync_runs(sync_run_id)
);

CREATE TABLE IF NOT EXISTS canonical_variants (
  canonical_variant_id TEXT PRIMARY KEY,
  canonical_product_id TEXT NOT NULL REFERENCES canonical_products(canonical_product_id),
  canonical_variant_key TEXT NOT NULL UNIQUE,
  specification_json TEXT NOT NULL,
  last_seen_sync_run_id TEXT NOT NULL REFERENCES atomic_sync_runs(sync_run_id)
);

CREATE TABLE IF NOT EXISTS canonical_variant_offers (
  canonical_variant_id TEXT NOT NULL REFERENCES canonical_variants(canonical_variant_id),
  normalized_offer_id TEXT NOT NULL UNIQUE REFERENCES normalized_offers(normalized_offer_id),
  link_status TEXT NOT NULL CHECK (
    link_status IN ('linked', 'excluded', 'review_needed', 'blocked')
  ),
  rank_position INTEGER,
  is_winner INTEGER NOT NULL DEFAULT 0,
  linked_at TEXT NOT NULL,
  last_seen_sync_run_id TEXT NOT NULL REFERENCES atomic_sync_runs(sync_run_id),
  PRIMARY KEY (canonical_variant_id, normalized_offer_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_winner_per_canonical_variant
  ON canonical_variant_offers(canonical_variant_id)
  WHERE is_winner = 1;

CREATE TABLE IF NOT EXISTS comparison_variant_results (
  canonical_variant_id TEXT PRIMARY KEY REFERENCES canonical_variants(canonical_variant_id),
  comparison_status TEXT NOT NULL CHECK (
    comparison_status IN (
      'multi_supplier_compared', 'single_source', 'separated_by_rule',
      'review_blocked', 'no_active_offer'
    )
  ),
  selection_type TEXT CHECK (
    selection_type IS NULL OR selection_type IN (
      'comparison_winner', 'single_source_offer', 'separated_by_rule'
    )
  ),
  selected_normalized_offer_id TEXT REFERENCES normalized_offers(normalized_offer_id),
  active_supplier_count INTEGER NOT NULL,
  active_offer_count INTEGER NOT NULL,
  backup_count INTEGER NOT NULL,
  cross_supplier_backup_count INTEGER NOT NULL,
  supplier_alternate_offer_count INTEGER NOT NULL,
  is_actually_compared INTEGER NOT NULL DEFAULT 0,
  winner_reason TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  calculated_at TEXT NOT NULL,
  last_seen_sync_run_id TEXT NOT NULL REFERENCES atomic_sync_runs(sync_run_id),
  CHECK (
    selection_type != 'comparison_winner' OR active_supplier_count >= 2
  ),
  CHECK (
    selection_type != 'single_source_offer' OR active_supplier_count = 1
  )
);

CREATE TABLE IF NOT EXISTS normalization_review_queue (
  review_key TEXT PRIMARY KEY,
  product_family TEXT NOT NULL,
  canonical_variant_key TEXT,
  offer_fingerprint TEXT NOT NULL,
  conflict_reason TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  ai_suggestion TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending',
  admin_decision TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_sync_run_id TEXT NOT NULL REFERENCES atomic_sync_runs(sync_run_id),
  UNIQUE (offer_fingerprint, conflict_reason)
);

CREATE TABLE IF NOT EXISTS normalization_rules (
  normalization_rule_id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  product_family TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (
    decision IN ('same_variant', 'separate_variant', 'separate_product', 'exclude', 'missing_spec')
  ),
  match_json TEXT NOT NULL,
  match_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (supplier_id, product_family, match_fingerprint)
);

CREATE TABLE IF NOT EXISTS offer_price_history (
  atomic_sku_id TEXT NOT NULL REFERENCES atomic_supplier_skus(atomic_sku_id),
  observed_at TEXT NOT NULL,
  supplier_price INTEGER NOT NULL,
  shipping_fee INTEGER NOT NULL,
  final_cost INTEGER NOT NULL,
  status TEXT NOT NULL,
  observation_fingerprint TEXT NOT NULL UNIQUE,
  PRIMARY KEY (atomic_sku_id, observed_at)
);

-- Ingestion uses deterministic SHA-256 identifiers and UPSERT.
