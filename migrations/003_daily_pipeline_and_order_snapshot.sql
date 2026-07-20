-- Isolated Daily pipeline state and Woo source-trace extensions.
-- No WooCommerce core tables are changed by this migration.

CREATE TABLE IF NOT EXISTS supplier_collection_runs (
  collection_run_id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  expected_product_count INTEGER NOT NULL,
  collected_product_count INTEGER NOT NULL,
  atomic_option_count INTEGER NOT NULL,
  incomplete INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  summary_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_collection_products (
  supplier_id TEXT NOT NULL,
  source_product_id TEXT NOT NULL,
  original_title TEXT NOT NULL,
  detail_title TEXT NOT NULL DEFAULT '',
  collection_status TEXT NOT NULL CHECK (
    collection_status IN (
      'active', 'missing_options', 'price_unavailable',
      'source_mismatch', 'incomplete'
    )
  ),
  option_count INTEGER NOT NULL,
  detail_url TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  last_seen_collection_run_id TEXT NOT NULL
    REFERENCES supplier_collection_runs(collection_run_id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (supplier_id, source_product_id)
);

CREATE TABLE IF NOT EXISTS sync_stage_checkpoints (
  pipeline_run_id TEXT NOT NULL,
  stage_name TEXT NOT NULL CHECK (
    stage_name IN (
      'collect_products', 'fetch_details', 'parse_options', 'normalize',
      'validate_prices', 'sync_comparison', 'create_woo_drafts',
      'link_variations', 'notify'
    )
  ),
  stage_status TEXT NOT NULL CHECK (
    stage_status IN ('started', 'completed', 'incomplete', 'failed')
  ),
  artifact_path TEXT,
  result_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (pipeline_run_id, stage_name)
);

ALTER TABLE woo_order_item_source_snapshots
  ADD COLUMN woo_product_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE woo_order_item_source_snapshots
  ADD COLUMN woo_variation_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE woo_order_item_source_snapshots
  ADD COLUMN supplier_original_product_title TEXT NOT NULL DEFAULT '';
ALTER TABLE woo_order_item_source_snapshots
  ADD COLUMN supplier_original_option_name TEXT NOT NULL DEFAULT '';
ALTER TABLE woo_order_item_source_snapshots
  ADD COLUMN source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE woo_order_item_source_snapshots
  ADD COLUMN quantity REAL NOT NULL DEFAULT 1;
ALTER TABLE woo_order_item_source_snapshots
  ADD COLUMN snapshot_status TEXT NOT NULL DEFAULT 'mapped'
    CHECK (snapshot_status = 'mapped');

CREATE TABLE IF NOT EXISTS woo_order_item_source_unmapped (
  woo_order_item_id INTEGER PRIMARY KEY,
  woo_order_id INTEGER NOT NULL,
  woo_product_id INTEGER NOT NULL,
  woo_variation_id INTEGER NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  snapshot_status TEXT NOT NULL DEFAULT 'source_unmapped'
    CHECK (snapshot_status = 'source_unmapped'),
  reason TEXT NOT NULL,
  selected_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS woo_order_item_source_unmapped_order
  ON woo_order_item_source_unmapped(woo_order_id, woo_order_item_id);

