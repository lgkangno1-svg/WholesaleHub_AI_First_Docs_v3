PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS price_sync_runs (
  run_id TEXT PRIMARY KEY,
  scheduled_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial_success', 'failed', 'no_change')),
  current_stage TEXT NOT NULL,
  checked_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0,
  applied_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  held_count INTEGER NOT NULL DEFAULT 0,
  baseline_created_count INTEGER NOT NULL DEFAULT 0,
  telegram_status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS price_sync_candidates (
  candidate_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES price_sync_runs(run_id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL,
  supplier_product_id TEXT,
  supplier_option_id TEXT,
  atomic_supplier_sku_id TEXT,
  selected_offer_id TEXT,
  woo_product_id INTEGER,
  woo_variation_id INTEGER,
  original_product_name TEXT NOT NULL DEFAULT '',
  original_option_name TEXT NOT NULL DEFAULT '',
  previous_supplier_cost INTEGER,
  observed_supplier_cost INTEGER,
  current_woo_price INTEGER,
  calculated_woo_price INTEGER,
  classification TEXT NOT NULL CHECK (
    classification IN (
      'ready_to_apply', 'no_change', 'missing_baseline', 'match_uncertain',
      'source_unverified', 'fetch_failed', 'invalid_price', 'sold_out',
      'promotion_excluded', 'source_conflict'
    )
  ),
  reason TEXT NOT NULL,
  source_url TEXT,
  source_hash TEXT,
  observed_at TEXT NOT NULL,
  UNIQUE(run_id, supplier_id, woo_variation_id, selected_offer_id, supplier_option_id)
);

CREATE INDEX IF NOT EXISTS price_sync_candidates_run
  ON price_sync_candidates(run_id, classification);

CREATE TABLE IF NOT EXISTS price_sync_results (
  result_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES price_sync_runs(run_id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL REFERENCES price_sync_candidates(candidate_id) ON DELETE CASCADE,
  woo_product_id INTEGER NOT NULL,
  woo_variation_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied', 'apply_failed', 'no_change', 'held')),
  old_woo_price INTEGER,
  new_woo_price INTEGER,
  verified_woo_price INTEGER,
  applied_at TEXT,
  error_message TEXT,
  UNIQUE(run_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS price_sync_issues (
  issue_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES price_sync_runs(run_id) ON DELETE CASCADE,
  candidate_id INTEGER REFERENCES price_sync_candidates(candidate_id) ON DELETE CASCADE,
  issue_type TEXT NOT NULL,
  supplier_id TEXT,
  woo_product_id INTEGER,
  woo_variation_id INTEGER,
  original_product_name TEXT NOT NULL DEFAULT '',
  original_option_name TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE(run_id, candidate_id, issue_type)
);

CREATE INDEX IF NOT EXISTS price_sync_issues_unresolved
  ON price_sync_issues(issue_type, resolved_at);

CREATE TABLE IF NOT EXISTS price_sync_price_history (
  history_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES price_sync_runs(run_id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL,
  atomic_supplier_sku_id TEXT,
  selected_offer_id TEXT,
  woo_product_id INTEGER NOT NULL,
  woo_variation_id INTEGER NOT NULL,
  old_supplier_cost INTEGER,
  new_supplier_cost INTEGER NOT NULL,
  old_woo_price INTEGER,
  new_woo_price INTEGER,
  pricing_rule_version TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  applied_at TEXT,
  source_hash TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('baseline_created', 'price_changed')),
  UNIQUE(run_id, woo_variation_id, selected_offer_id, event_type)
);
