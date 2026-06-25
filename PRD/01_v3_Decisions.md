# 01. v3 Decisions

## 1. AdminPlus 계열 정책

AdminPlus 계열 공급처는 약관 리스크가 있으므로 자동주문을 구현하지 않는다.

가격 수집은 가능하면 공급처 제공 엑셀/CSV/Google Sheet로 대체한다. 대체 수단이 없을 경우에만, **매일 오전 11시 1회 가격 수집**으로 제한한다.

```yaml
adminplus_policy:
  auto_order_enabled: false
  price_crawling_enabled: true
  schedule: "daily 11:00 Asia/Seoul"
  max_runs_per_day: 1
  collect_only:
    - product_name
    - option_text
    - price
    - stock_status
    - product_url
  blocked:
    - hidden_api_reverse_engineering
    - token_analysis
    - captcha_bypass
    - auto_order_macro
    - detail_description_copy
    - image_download
    - review_collection
```

## 2. 데일리푸드 정책

데일리푸드는 Google Sheets 공급처로 등록한다.

```yaml
supplier_id: dailyfood
supplier_name: 데일리푸드
source_type: google_sheet
spreadsheet_id: "1YvIxuhGYhA7PTxu9nH5cUNC8dkfykUSb4C8D77UKlUQ"
gid: "860422621"
url: "https://docs.google.com/spreadsheets/d/1YvIxuhGYhA7PTxu9nH5cUNC8dkfykUSb4C8D77UKlUQ/edit?gid=860422621#gid=860422621"
playwright_enabled: false
auto_order_enabled: false
preferred_adapter: google_sheets_csv_export
```

## 3. 엑셀/CSV 링크 정책

거래처가 가격표 링크를 제공하면 해당 링크를 우선 데이터 소스로 사용한다.

```txt
Google Sheet > Excel/CSV Link > Manual Upload > Public HTML > AdminPlus Limited Playwright
```

## 4. 고객 정보 노출 정책

고객에게 다음 정보는 절대 노출하지 않는다.

- 공급처명
- 공급처 원가
- 최저가 공급처
- 가격 비교 결과
- 내부 매핑 상태
- 수집 시간
- 원본 공급처 URL
