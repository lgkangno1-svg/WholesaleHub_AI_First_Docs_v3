# 월도 판매 종료 상품 정리 (Kelvin)

기준 상품원본: 월도B2B 활성 전체 목록(최신 자동수집 결과와 독립 실시간 조회가 정확하게 일치해야 함).

## 적용 대상
- WordPress `supplier_lane_parent_links`에서 월도 B2B `approved`인 단독 공급처 상품
- 현재 `publish` 상태, 월도 상품번호가 8자리 이상 숫자, 현재 전체 목록에서 누락
- 원본 상세페이지가 정확히 `판매가능한 상품이 아닙니다.` 응답인 경우만
- 동일 원본 수집 회차를 중복 계산하지 않고, 최소 두 회차 연속 누락 증거 필요

## 동작 및 안전장치
- 공급처 수집 오류, 결과 20개 미만, 최신 캐시와 독립 조회 불일치, 9시간 이상 지난 캐시는 전부 중단
- 다른 공급처에 연결된 상품, 비공개/초안, 다른 상품명으로 바뀐 상품, 비정형 ID는 수정 금지
- 회차당 최대 8건, 영구 삭제 금지 (`force=false` → WooCommerce 휴지통)
- WooCommerce에 요청한 뒤 `status=trash`를 반드시 재조회
- 모든 변경 대상과 오류를 `last-run.json`, `reconcile.log`에 기록
- 기존 다른 작업자 Git/WordPress 플러그인/주문 데이터/프로세스는 건드리지 않음

## 실행
- 점검: `./run.sh --dry-run` (수집과 비교만 수행하며 상태 변경하지 않음)
- 실제 정리: `./run.sh --apply`
- MiniPC cron: `55 0,6,12 * * *` (UTC, 정상 공급처 동기화 40분 뒤)
- 다음 실행에도 누락인 경우 누적 확인 2회로 판정
- 개별 복구: WordPress → 상품 → 휴지통 → 복원

## 상태 파일
- `lane-links-latest.json`: WordPress 공급처 연결 정보의 최신 읽기 전용 내보내기
- `confirmations.json`: 별도 수집 회차별 누락 확인 기록
- `last-run.json`: 마지막 실행 결과
