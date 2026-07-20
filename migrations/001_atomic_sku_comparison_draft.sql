-- DRAFT ONLY. DO NOT APPLY TO THE OPERATIONAL DATABASE.
-- SQLite-oriented schema draft for the atomic supplier SKU comparison engine.

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
  UNIQUE (supplier_product_id, supplier_option_id)
);

CREATE TABLE IF NOT EXISTS normalized_offers (
  normalized_offer_id TEXT PRIMARY KEY,
  atomic_sku_id TEXT NOT NULL UNIQUE REFERENCES atomic_supplier_skus(atomic_sku_id),
  product_family TEXT NOT NULL,
  variety TEXT,
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
  promotion_flag INTEGER NOT NULL DEFAULT 0,
  preorder_flag INTEGER NOT NULL DEFAULT 0,
  sold_out_flag INTEGER NOT NULL DEFAULT 0,
  shipping_fee INTEGER NOT NULL,
  final_cost INTEGER NOT NULL,
  confidence REAL NOT NULL,
  confidence_reason TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  category_profile_json TEXT NOT NULL,
  status TEXT NOT NULL,
  canonical_product_key TEXT NOT NULL,
  canonical_variant_key TEXT,
  normalized_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canonical_products (
  canonical_product_id TEXT PRIMARY KEY,
  canonical_product_key TEXT NOT NULL UNIQUE,
  product_family TEXT NOT NULL,
  grade_group TEXT,
  attributes_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canonical_variants (
  canonical_variant_id TEXT PRIMARY KEY,
  canonical_product_id TEXT NOT NULL REFERENCES canonical_products(canonical_product_id),
  canonical_variant_key TEXT NOT NULL UNIQUE,
  specification_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canonical_variant_offers (
  canonical_variant_id TEXT NOT NULL REFERENCES canonical_variants(canonical_variant_id),
  normalized_offer_id TEXT NOT NULL UNIQUE REFERENCES normalized_offers(normalized_offer_id),
  link_status TEXT NOT NULL CHECK (link_status IN ('linked', 'review_needed', 'blocked')),
  rank_position INTEGER,
  is_winner INTEGER NOT NULL DEFAULT 0,
  linked_at TEXT NOT NULL,
  PRIMARY KEY (canonical_variant_id, normalized_offer_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_winner_per_canonical_variant
  ON canonical_variant_offers(canonical_variant_id)
  WHERE is_winner = 1;

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

-- Intended ingestion uses deterministic SHA-256 identifiers and UPSERT:
-- INSERT ... ON CONFLICT(primary_or_unique_key) DO UPDATE SET ...
-- The migration runner is intentionally not included in this dry-run phase.
