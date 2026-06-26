# Future: 충전금(예치금) 기반 주문/결제

- 선충전 후 주문하는 구조를 별도 Phase로 다룬다.
- 주문 시 고객 충전금 잔액을 확인한다.
- 잔액이 충분한 경우에만 주문 가능 상태로 진행한다.
- 주문 확정 시 ledger에 차감 기록을 남긴다.
- 잔액 부족 시 주문 차단 또는 충전 안내를 제공한다.
- 관리자 화면에서 충전, 차감, 환불 내역을 조회한다.
- 모든 잔액 변경은 ledger append-only 방식으로 기록한다.
- 실제 PG, 입금 확인, 환불 자동화는 후순위다.
- 공급처 자동주문과는 분리 설계한다.

# 19. Roadmap

## Phase 1 MVP

- SQLite schema
- Supplier config
- DailyFood Google Sheet 수집
- Excel/CSV link adapter
- 상품명 정규화
- 최저가 계산
- WooCommerce dry-run

## Phase 2 Admin

- 매핑 승인 화면
- 공급처 상태 화면
- 수동 수집 버튼
- WooCommerce 동기화 로그

## Phase 3 WooCommerce Live

- 실제 상품 가격/재고 업데이트
- 마진 룰 적용
- 상품 매칭 안정화

## Phase 4 AdminPlus Limited

- 오전 11시 1회 가격 수집
- 제한 필드만 수집
- 보안 감지 시 중단

## Phase 5 Future Auto Order

- AdminPlus 제외
- API/엑셀/허가된 공급처부터 검토
- 예치금 부족 알림
- 송장 수집
