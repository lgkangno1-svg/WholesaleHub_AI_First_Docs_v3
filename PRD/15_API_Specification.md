# 15. API Specification

## 내부 API

### GET /internal/suppliers

공급처 목록 조회.

### POST /internal/suppliers/:id/sync

특정 공급처 수동 수집 실행.

AdminPlus 계열은 오전 11시 외 수동 실행 시 관리자 확인 플래그가 필요하다.

### GET /internal/raw-products

원본 상품 목록 조회.

### GET /internal/mappings

상품명 매핑 목록 조회.

### PATCH /internal/mappings/:id

관리자 매핑 수정 및 승인.

### GET /internal/compare-products

내부 최저가 결과 조회. 관리자 전용이다.

### POST /internal/woocommerce/sync

WooCommerce 수동 동기화 실행.

## 고객용 API 원칙

고객용 API에는 공급처 관련 필드를 포함하지 않는다.
