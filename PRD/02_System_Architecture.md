# 02. System Architecture

## 전체 구조

```txt
[Supplier Sources]
  ├─ Google Sheet: DailyFood
  ├─ Excel/CSV Links
  ├─ Public HTML shops
  └─ AdminPlus limited crawl at 11:00 only

        ↓

[n8n Scheduler + Orchestrator]

        ↓

[Supplier Adapter Layer]
  ├─ GoogleSheetAdapter
  ├─ ExcelCsvLinkAdapter
  ├─ ManualUploadAdapter
  ├─ PublicHtmlAdapter
  └─ AdminPlusLimitedAdapter

        ↓

[SQLite]
  ├─ suppliers
  ├─ supplier_price_files
  ├─ raw_products
  ├─ product_mapping
  ├─ normalized_products
  ├─ compare_products
  └─ sync_logs

        ↓

[AI Normalization]
  ├─ Mapping Cache first
  ├─ Gemini Flash parser
  └─ Admin approval if uncertain

        ↓

[Price Engine]

        ↓

[WooCommerce Sync]

        ↓

[hub.avocadoss.co.kr]
```

## 설계 원칙

- 공급처별 수집 방식은 Adapter로 분리한다.
- 수집 데이터는 원본과 정규화 데이터를 분리한다.
- 최신 데이터만 사용한다.
- 고객에게 공급처 정보는 숨긴다.
- AdminPlus는 제한적 정책을 강제한다.
