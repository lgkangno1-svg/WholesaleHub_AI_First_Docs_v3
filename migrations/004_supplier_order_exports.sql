BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS supplier_order_export_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    started_at TEXT NOT NULL,
    sent_at TEXT,
    status TEXT NOT NULL,
    telegram_message_id TEXT,
    file_name TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS supplier_order_export_items (
    batch_id INTEGER NOT NULL,
    woo_order_id INTEGER NOT NULL,
    woo_order_item_id INTEGER NOT NULL,
    source_snapshot_id INTEGER NOT NULL,
    supplier_id TEXT NOT NULL,
    exported_at TEXT NOT NULL,
    FOREIGN KEY (batch_id) REFERENCES supplier_order_export_batches(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_order_export_item
ON supplier_order_export_items(woo_order_item_id, supplier_id);

CREATE INDEX IF NOT EXISTS ix_supplier_order_export_batch_status
ON supplier_order_export_batches(supplier_id, status, sent_at);

COMMIT;
