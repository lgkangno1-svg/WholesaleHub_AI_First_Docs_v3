PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS supplier_lane_parent_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  woo_parent_id INTEGER NOT NULL,
  supplier_id TEXT NOT NULL CHECK (supplier_id IN ('dailyfood', 'walldob2b')),
  lane_code TEXT NOT NULL CHECK (lane_code IN ('A', 'B')),
  source_product_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'terminal')),
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (woo_parent_id, lane_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_lane_parent_links_active_source
  ON supplier_lane_parent_links(supplier_id, source_product_id)
  WHERE status = 'approved';

CREATE TABLE IF NOT EXISTS supplier_lane_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_link_id INTEGER NOT NULL REFERENCES supplier_lane_parent_links(id),
  supplier_id TEXT NOT NULL CHECK (supplier_id IN ('dailyfood', 'walldob2b')),
  lane_code TEXT NOT NULL CHECK (lane_code IN ('A', 'B')),
  source_product_id TEXT NOT NULL,
  source_option_id TEXT NOT NULL,
  atomic_supplier_sku_id TEXT NOT NULL,
  woo_parent_id INTEGER NOT NULL,
  woo_variation_id INTEGER,
  public_offer_key TEXT NOT NULL,
  public_option_label TEXT NOT NULL,
  option_label_raw TEXT NOT NULL,
  hard_spec_fingerprint TEXT NOT NULL,
  source_cost REAL NOT NULL CHECK (source_cost >= 0),
  source_shipping_cost REAL NOT NULL CHECK (source_shipping_cost >= 0),
  landed_cost REAL NOT NULL CHECK (landed_cost >= 0),
  sale_price REAL NOT NULL CHECK (sale_price >= 0),
  stock_status TEXT NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  lifecycle_status TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'unavailable', 'retired', 'terminal')),
  last_snapshot_hash TEXT NOT NULL,
  last_complete_run_id TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  missing_complete_count INTEGER NOT NULL DEFAULT 0 CHECK (missing_complete_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (supplier_id, source_product_id, source_option_id),
  UNIQUE (public_offer_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_lane_offers_woo_variation
  ON supplier_lane_offers(woo_variation_id)
  WHERE woo_variation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS supplier_lane_offers_parent_projection
  ON supplier_lane_offers(woo_parent_id, lane_code, approval_status, lifecycle_status);

CREATE TABLE IF NOT EXISTS supplier_lane_audit_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('parent_link', 'offer')),
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS supplier_lane_audit_entity
  ON supplier_lane_audit_history(entity_type, entity_id, created_at);
