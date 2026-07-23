PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS woo_variation_replacements (
  old_variation_id INTEGER NOT NULL,
  new_variation_id INTEGER NOT NULL,
  woo_product_id INTEGER NOT NULL,
  replaced_at TEXT NOT NULL,
  PRIMARY KEY (old_variation_id, new_variation_id)
);
