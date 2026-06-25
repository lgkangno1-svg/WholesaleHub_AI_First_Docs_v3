# 13. n8n Workflows

## WF-001 DailyFood Google Sheet Sync

```txt
Schedule Trigger
→ HTTP Request CSV export
→ Parse CSV
→ Normalize Column Names
→ SQLite upsert
→ Product Normalization
→ Price Engine
→ WooCommerce Sync
```

권장 주기: 하루 3~4회 또는 운영자 지정 주기.

## WF-002 Excel/CSV Link Supplier Sync

```txt
Schedule Trigger
→ Supplier Config Load
→ HTTP Request file
→ Detect file type
→ Parse XLSX/CSV
→ Column Mapping
→ SQLite 저장
```

## WF-003 AdminPlus Limited Price Crawl

```txt
Cron Trigger 0 11 * * *
→ Check supplier enabled
→ Run Playwright limited crawler
→ Validate result
→ SQLite 저장
→ Normalize
→ Price Engine
```

## WF-004 Product Normalization Batch

```txt
Read unmapped raw_products
→ Check product_mapping
→ Gemini Flash
→ Save mapping as pending/approved
```

## WF-005 WooCommerce Sync

```txt
Read compare_products
→ Apply margin rule
→ WooCommerce REST API update
→ Log
```
