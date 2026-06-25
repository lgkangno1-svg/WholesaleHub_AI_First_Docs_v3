# 06. DailyFood Google Sheet Supplier

## 공급처 정보

```yaml
supplier_id: dailyfood
supplier_name: 데일리푸드
source_type: google_sheet
spreadsheet_id: "1YvIxuhGYhA7PTxu9nH5cUNC8dkfykUSb4C8D77UKlUQ"
gid: "860422621"
sheet_url: "https://docs.google.com/spreadsheets/d/1YvIxuhGYhA7PTxu9nH5cUNC8dkfykUSb4C8D77UKlUQ/edit?gid=860422621#gid=860422621"
csv_export_url: "https://docs.google.com/spreadsheets/d/1YvIxuhGYhA7PTxu9nH5cUNC8dkfykUSb4C8D77UKlUQ/export?format=csv&gid=860422621"
playwright_enabled: false
auto_order_enabled: false
```

## 수집 방식

### 공개 CSV Export 가능 시

n8n HTTP Request로 CSV export URL을 호출한다.

```txt
Schedule Trigger
→ HTTP Request CSV export
→ Parse CSV
→ Column Mapping
→ Validate Rows
→ Delete old dailyfood raw_products
→ Insert new raw_products
→ Normalize
→ Price Engine
```

### 비공개 시트인 경우

n8n Google Sheets OAuth 연결을 사용한다.

```txt
Schedule Trigger
→ Google Sheets Node
→ Read Rows
→ Column Mapping
→ SQLite 저장
```

## 컬럼 매핑

시트 구조가 확정되면 실제 컬럼명으로 수정한다.

```yaml
dailyfood:
  product_name_column: "상품명"
  option_column: "규격"
  price_column: "판매가"
  stock_column: "재고"
  memo_column: "비고"
```

## 실패 처리

- CSV 접근 실패: `supplier_price_files.status = failed`
- 컬럼명 불일치: 관리자 확인 필요
- 가격 숫자 파싱 실패: 해당 행 skip + 로그 저장
- 빈 행: skip
