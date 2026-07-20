-- Supplier-offer traceability for canonical selections and future order routing.
-- This migration only extends the isolated atomic comparison schema.

ALTER TABLE comparison_variant_results
  ADD COLUMN selected_offer_id TEXT REFERENCES normalized_offers(normalized_offer_id);

UPDATE comparison_variant_results
SET selected_offer_id = selected_normalized_offer_id;

CREATE TRIGGER IF NOT EXISTS comparison_selected_offer_insert_consistency
BEFORE INSERT ON comparison_variant_results
WHEN NOT (NEW.selected_offer_id IS NEW.selected_normalized_offer_id)
BEGIN
  SELECT RAISE(ABORT, 'selected_offer_id must match selected_normalized_offer_id');
END;

CREATE TRIGGER IF NOT EXISTS comparison_selected_offer_update_consistency
BEFORE UPDATE OF selected_offer_id, selected_normalized_offer_id
ON comparison_variant_results
WHEN NOT (NEW.selected_offer_id IS NEW.selected_normalized_offer_id)
BEGIN
  SELECT RAISE(ABORT, 'selected_offer_id must match selected_normalized_offer_id');
END;

CREATE TABLE IF NOT EXISTS woo_variation_offer_links (
  woo_variation_id INTEGER PRIMARY KEY,
  woo_product_id INTEGER NOT NULL,
  canonical_variant_id TEXT NOT NULL,
  selected_offer_id TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  FOREIGN KEY (canonical_variant_id, selected_offer_id)
    REFERENCES canonical_variant_offers(canonical_variant_id, normalized_offer_id)
);

CREATE INDEX IF NOT EXISTS woo_variation_offer_links_product
  ON woo_variation_offer_links(woo_product_id, woo_variation_id);

CREATE TABLE IF NOT EXISTS woo_order_item_source_snapshots (
  woo_order_item_id INTEGER PRIMARY KEY,
  woo_order_id INTEGER NOT NULL,
  canonical_variant_id TEXT NOT NULL REFERENCES canonical_variants(canonical_variant_id),
  selected_offer_id TEXT NOT NULL REFERENCES normalized_offers(normalized_offer_id),
  atomic_supplier_sku_id TEXT NOT NULL REFERENCES atomic_supplier_skus(atomic_sku_id),
  supplier_id TEXT NOT NULL,
  supplier_product_id TEXT NOT NULL REFERENCES supplier_products(supplier_product_id),
  supplier_option_id TEXT NOT NULL REFERENCES supplier_options(supplier_option_id),
  supplier_cost_snapshot INTEGER NOT NULL CHECK (supplier_cost_snapshot >= 0),
  shipping_fee_snapshot INTEGER NOT NULL CHECK (shipping_fee_snapshot >= 0),
  selected_at TEXT NOT NULL,
  FOREIGN KEY (canonical_variant_id, selected_offer_id)
    REFERENCES canonical_variant_offers(canonical_variant_id, normalized_offer_id)
);

CREATE INDEX IF NOT EXISTS woo_order_item_source_snapshots_order_supplier
  ON woo_order_item_source_snapshots(woo_order_id, supplier_id, woo_order_item_id);

CREATE TRIGGER IF NOT EXISTS woo_order_item_source_snapshots_source_consistency
BEFORE INSERT ON woo_order_item_source_snapshots
WHEN NOT EXISTS (
  SELECT 1
  FROM normalized_offers AS offer
  JOIN atomic_supplier_skus AS sku
    ON sku.atomic_sku_id = offer.atomic_sku_id
  JOIN supplier_products AS product
    ON product.supplier_product_id = sku.supplier_product_id
  WHERE offer.normalized_offer_id = NEW.selected_offer_id
    AND sku.atomic_sku_id = NEW.atomic_supplier_sku_id
    AND product.supplier_id = NEW.supplier_id
    AND product.supplier_product_id = NEW.supplier_product_id
    AND sku.supplier_option_id = NEW.supplier_option_id
)
BEGIN
  SELECT RAISE(ABORT, 'order item source snapshot identifiers are inconsistent');
END;

CREATE TRIGGER IF NOT EXISTS woo_order_item_source_snapshots_immutable_update
BEFORE UPDATE ON woo_order_item_source_snapshots
BEGIN
  SELECT RAISE(ABORT, 'order item source snapshot is immutable');
END;

CREATE TRIGGER IF NOT EXISTS woo_order_item_source_snapshots_immutable_delete
BEFORE DELETE ON woo_order_item_source_snapshots
BEGIN
  SELECT RAISE(ABORT, 'order item source snapshot is immutable');
END;

CREATE VIEW IF NOT EXISTS selected_offer_trace AS
SELECT
  result.canonical_variant_id,
  result.comparison_status,
  result.selection_type,
  result.selected_offer_id,
  offer.atomic_sku_id AS atomic_supplier_sku_id,
  product.supplier_id,
  product.supplier_product_id,
  option_row.supplier_option_id,
  product.original_title,
  option_row.original_option_name,
  product.detail_url AS source_url,
  offer.final_cost,
  CASE
    WHEN offer.status = 'active'
      AND sku.status = 'active'
      AND offer.sold_out_flag = 0
      AND option_row.stock_status != 'out_of_stock'
    THEN 1
    ELSE 0
  END AS is_purchasable
FROM comparison_variant_results AS result
LEFT JOIN normalized_offers AS offer
  ON offer.normalized_offer_id = result.selected_offer_id
LEFT JOIN atomic_supplier_skus AS sku
  ON sku.atomic_sku_id = offer.atomic_sku_id
LEFT JOIN supplier_products AS product
  ON product.supplier_product_id = sku.supplier_product_id
LEFT JOIN supplier_options AS option_row
  ON option_row.supplier_option_id = sku.supplier_option_id;
