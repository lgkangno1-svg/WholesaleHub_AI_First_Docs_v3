# 17. Testing

## Unit Test

- 가격 숫자 정제
- 중량/수량 파싱
- option_key 생성
- 최저가 계산
- WooCommerce payload 생성

## Integration Test

- DailyFood CSV export mock
- Excel/CSV link parser
- SQLite 저장
- Gemini parser mock
- WooCommerce mock API

## E2E Test

- DailyFood 수집 → 정규화 → 최저가 계산 → WooCommerce sync dry-run

## AdminPlus 테스트

AdminPlus는 실제 사이트에 반복 테스트하지 않는다.

- fixture HTML 사용
- 하루 1회 제한 로직 테스트
- 금지 URL 접근 차단 테스트
- 주문 관련 메서드 부재 확인
