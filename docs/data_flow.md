# Data Flow

## DailyFood

```txt
DailyFood Google Sheet
→ n8n HTTP Request CSV Export
→ CSV Parser
→ raw_products
→ product_mapping cache lookup
→ Gemini Flash if needed
→ normalized_products
→ price engine
→ compare_products
→ WooCommerce sync
→ hub.avocadoss.co.kr
```

## AdminPlus Limited

```txt
AdminPlus Supplier
→ daily 11:00 only
→ Limited Playwright Price Collector
→ raw_products
→ normalization
→ price engine
```
