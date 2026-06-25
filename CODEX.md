# CODEX.md

Codex는 이 문서를 기준으로 Phase 단위 개발을 수행한다.

## 작업 방식

1. `README.md`와 `AGENTS.md`를 먼저 읽는다.
2. `PRD/` 문서를 순서대로 읽는다.
3. `Tasks/Phase_1_MVP.md`부터 구현한다.
4. 공급처 수집 로직은 반드시 Adapter 패턴으로 구현한다.

## Codex 첫 요청 예시

```txt
이 저장소의 README.md, AGENTS.md, PRD 문서를 읽고 Phase_1_MVP부터 구현해줘.
우선 SQLite schema, supplier config loader, DailyFood Google Sheet adapter, raw_products 저장 로직을 만들어줘.
AdminPlus 자동주문은 구현하지 말고, AdminPlus는 오전 11시 1회 가격 수집 설정만 포함해줘.
```

## 구현 우선순위

1. SQLite schema
2. Supplier config loader
3. DailyFood Google Sheet adapter
4. Excel/CSV link adapter
5. Product normalization cache
6. Gemini parser
7. Lowest price engine
8. WooCommerce sync
9. Admin dashboard read-only MVP
10. AdminPlus limited crawler skeleton
