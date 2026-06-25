# 05. Supplier Data Collection

## 공급처 수집 우선순위

```txt
1. Google Sheet Adapter
2. Excel/CSV Link Adapter
3. Manual Upload Adapter
4. Official API Adapter
5. Public HTML Adapter
6. AdminPlus Limited Adapter
7. Playwright Fallback
```

## 공급처 분류

### A. Google Sheet 공급처

예: 데일리푸드

- 공급처가 시트를 직접 업데이트
- n8n이 정기적으로 CSV export 또는 Google Sheets API로 읽음
- Playwright 불필요

### B. Excel/CSV 링크 공급처

- 공급처가 가격표 파일 링크 제공
- n8n HTTP Request로 파일 다운로드
- XLSX/CSV 파서로 읽음

### C. Public HTML 공급처

- 로그인 없이 공개된 상품 목록에서 제한 필드만 수집
- 낮은 빈도, 낮은 요청량

### D. AdminPlus Limited 공급처

- 매일 오전 11시 1회 가격만 수집
- 자동주문 금지
- 가능하면 엑셀/시트 방식으로 대체

## 공통 수집 필드

```txt
supplier_id
source_type
original_product_name
original_option_name
price
shipping_fee
stock_status
product_url
collected_at
```
