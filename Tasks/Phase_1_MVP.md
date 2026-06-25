# Phase 1 MVP Tasks

## 목표

데일리푸드 Google Sheet를 첫 공급처로 연결하고, 최신 가격 수집 → 정규화 → 최저가 계산 → WooCommerce dry-run까지 구현한다.

## Tasks

1. Repository Setup
2. SQLite Schema 적용
3. Supplier Config Loader 구현
4. DailyFood Google Sheet Adapter 구현
5. Raw Products 저장
6. Product Normalization 구현
7. Price Engine 구현
8. WooCommerce Dry-run 구현

## Done Criteria

- DailyFood 데이터가 SQLite에 저장된다.
- 같은 상품명이 mapping cache를 재사용한다.
- compare_products에 최저가 결과가 생성된다.
- WooCommerce update payload에 supplier 정보가 포함되지 않는다.
