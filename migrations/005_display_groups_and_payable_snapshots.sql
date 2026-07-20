BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS display_groups (
    display_group_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    representative_woo_product_id INTEGER NOT NULL,
    match_rule_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS display_group_canonical_products (
    display_group_id TEXT NOT NULL REFERENCES display_groups(display_group_id),
    canonical_product_id TEXT NOT NULL REFERENCES canonical_products(canonical_product_id),
    match_reason TEXT NOT NULL,
    approved_at TEXT NOT NULL,
    PRIMARY KEY (display_group_id, canonical_product_id)
);

CREATE TABLE IF NOT EXISTS display_group_woo_products (
    display_group_id TEXT NOT NULL REFERENCES display_groups(display_group_id),
    woo_product_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('representative', 'duplicate')),
    redirect_to_woo_product_id INTEGER,
    linked_at TEXT NOT NULL,
    PRIMARY KEY (display_group_id, woo_product_id)
);

ALTER TABLE woo_order_item_source_snapshots ADD COLUMN unit_payable_snapshot INTEGER;
ALTER TABLE woo_order_item_source_snapshots ADD COLUMN line_payable_snapshot INTEGER;
ALTER TABLE woo_order_item_source_snapshots ADD COLUMN shipping_included_snapshot INTEGER;

COMMIT;
