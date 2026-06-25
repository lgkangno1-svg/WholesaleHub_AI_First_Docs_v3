# 09. Database Design

SQLite를 사용한다. 가격 이력은 저장하지 않고 최신 수집 데이터만 유지한다.

## 주요 테이블

### suppliers

공급처 설정 메타데이터.

### supplier_price_files

Google Sheet, Excel, CSV 등 가격표 수집 기록.

### raw_products

수집된 원본 상품 데이터. 공급처별 최신 데이터만 유지.

### product_mapping

상품명 정규화 캐시 및 관리자 승인 정보.

### normalized_products

정규화된 상품 데이터.

### compare_products

최저 공급처 계산 결과. 고객에게 직접 노출하지 않는다.

### woocommerce_sync_logs

WooCommerce 업데이트 기록.

## 데이터 보존 정책

- `raw_products`: 공급처별 최신 수집분만 유지
- `supplier_price_files`: 최근 90일 보관
- `product_mapping`: 영구 보관
- `compare_products`: 최신 결과만 유지
- `sync_logs`: 최근 180일 보관
