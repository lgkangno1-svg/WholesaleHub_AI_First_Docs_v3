INSERT OR IGNORE INTO suppliers (
  supplier_id,
  supplier_name,
  source_type,
  enabled,
  auto_order_enabled,
  price_crawling_enabled,
  schedule_cron,
  timezone
) VALUES (
  'dailyfood',
  '데일리푸드',
  'google_sheet',
  1,
  0,
  1,
  '0 9,12,15,18 * * *',
  'Asia/Seoul'
);

INSERT OR IGNORE INTO suppliers (
  supplier_id,
  supplier_name,
  source_type,
  enabled,
  auto_order_enabled,
  price_crawling_enabled,
  schedule_cron,
  timezone
) VALUES (
  'adminplus_supplier_example',
  'AdminPlus 공급처 예시',
  'adminplus_limited',
  0,
  0,
  1,
  '0 11 * * *',
  'Asia/Seoul'
);
