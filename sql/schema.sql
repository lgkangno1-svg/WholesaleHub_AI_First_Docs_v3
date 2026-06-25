PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id TEXT NOT NULL UNIQUE,
  supplier_name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  auto_order_enabled INTEGER NOT NULL DEFAULT 0,
  price_crawling_enabled INTEGER NOT NULL DEFAULT 1,
  schedule_cron TEXT,
  timezone TEXT DEFAULT 'Asia/Seoul',
  config_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS supplier_price_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  file_name TEXT,
  source_url TEXT,
  received_at TEXT DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  row_count INTEGER DEFAULT 0,
  error_message TEXT,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id)
);

CREATE TABLE IF NOT EXISTS raw_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id TEXT NOT NULL,
  source_file_id INTEGER,
  source_type TEXT NOT NULL,
  original_product_name TEXT NOT NULL,
  original_option_name TEXT,
  price INTEGER,
  shipping_fee INTEGER DEFAULT 0,
  stock_status TEXT,
  product_url TEXT,
  collected_at TEXT DEFAULT CURRENT_TIMESTAMP,
  raw_json TEXT,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id),
  FOREIGN KEY (source_file_id) REFERENCES supplier_price_files(id)
);

CREATE INDEX IF NOT EXISTS idx_raw_products_supplier ON raw_products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_raw_products_name ON raw_products(original_product_name);

CREATE TABLE IF NOT EXISTS product_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mapping_key TEXT NOT NULL UNIQUE,
  original_product_name TEXT NOT NULL,
  original_option_name TEXT,
  normalized_name TEXT NOT NULL,
  category TEXT,
  grade TEXT,
  origin TEXT,
  quantity REAL,
  unit TEXT,
  weight_value REAL,
  weight_unit TEXT,
  option_key TEXT NOT NULL,
  is_frozen INTEGER,
  confidence REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  parser_model TEXT,
  parser_reason TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS normalized_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_product_id INTEGER NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  category TEXT,
  grade TEXT,
  origin TEXT,
  quantity REAL,
  unit TEXT,
  weight_value REAL,
  weight_unit TEXT,
  option_key TEXT NOT NULL,
  price INTEGER NOT NULL,
  unit_price REAL,
  stock_status TEXT,
  product_url TEXT,
  mapping_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (raw_product_id) REFERENCES raw_products(id),
  FOREIGN KEY (mapping_id) REFERENCES product_mapping(id)
);

CREATE INDEX IF NOT EXISTS idx_normalized_group ON normalized_products(normalized_name, option_key);

CREATE TABLE IF NOT EXISTS compare_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compare_key TEXT NOT NULL UNIQUE,
  normalized_name TEXT NOT NULL,
  option_key TEXT NOT NULL,
  cheapest_supplier_id TEXT NOT NULL,
  cheapest_raw_product_id INTEGER NOT NULL,
  cheapest_price INTEGER NOT NULL,
  cheapest_unit_price REAL,
  stock_status TEXT,
  product_url TEXT,
  calculated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS woocommerce_sync_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compare_product_id INTEGER,
  woocommerce_product_id INTEGER,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  request_json TEXT,
  response_json TEXT,
  error_message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
