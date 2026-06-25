# 16. Exception Handling

## 수집 실패

- 네트워크 실패: 1회 재시도
- CSV 다운로드 실패: supplier_price_files failed 기록
- Google Sheet 권한 실패: 관리자 확인 필요
- AdminPlus 로그인 실패: 즉시 중단
- AdminPlus 보안 경고 감지: 즉시 중단

## 파싱 실패

- 가격 숫자 변환 실패: 행 skip
- 상품명 없음: 행 skip
- 옵션 추출 실패: pending mapping
- AI confidence 낮음: 관리자 승인 필요

## WooCommerce 실패

- 상품 매칭 실패: sync skipped
- API 인증 실패: 전체 중단
- 가격 업데이트 실패: 상품별 로그 기록
