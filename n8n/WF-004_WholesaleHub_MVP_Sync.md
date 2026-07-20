# WF-004 WholesaleHub MVP Sync

실제 활성 워크플로 `WholesaleHub MVP Sync`(`jVFfCJtfEax1GeDQ`)의 운영 기준이다.

## 일정과 성공 조건

- 매일 09:00, 15:00, 21:00 KST에 실행한다.
- SSH 단계 뒤의 `Validate MVP Sync Result` 노드는 표준 출력 마지막 구간에서 `WHOLESALEHUB_RESULT_JSON`을 읽는다.
- `status=completed`, `exit_code=0`, `step=completed`가 모두 충족되어야 다음 단계로 진행한다.
- 완료 표식이 없거나 JSON이 잘못되었거나 중간 단계에서 종료되면 n8n 실행을 실패 처리한다.

## 기본 안전 모드

기본 실행은 기존 공개 옵션의 가격과 검증된 썸네일만 동기화한다. 다음 변경은 환경 변수를 명시적으로 `1`로 설정하지 않는 한 실행하지 않는다.

- 상품·옵션 강제 삭제: `WHOLESALEHUB_ALLOW_DESTRUCTIVE_SYNC`
- 재고 및 공개 상태 변경: `WHOLESALEHUB_ALLOW_STOCK_VISIBILITY_SYNC`
- 새 옵션 및 임시 상품 생성: `WHOLESALEHUB_ALLOW_DRAFT_CREATE`
- 상세 설명 변경: `WHOLESALEHUB_ALLOW_DESCRIPTION_SYNC`

기존 상품 카테고리는 수동 관리 항목이다. 예약 셸과 n8n은 기존 상품의 카테고리를 변경하지 않으며, 환경변수로 자동 분류를 다시 활성화할 수 없다. 신규 상품은 텔레그램 승인 화면에서 사용자가 유효한 카테고리를 선택한 뒤에만 공개한다.

삭제 또는 재고·공개 상태 변경을 켜면 강화된 destructive preflight 기준을 적용한다. 일반 preflight도 공급사 수집 수량, WooCommerce 상품·옵션 수, 수집 실패 사유를 쓰기 작업 전에 검증한다.

## 썸네일 무결성

각 공개 상품의 대표 이미지는 다음 조건을 모두 검사한다.

- 이미지 메타데이터 및 첨부파일 존재
- 실제 GET 응답이 이미지이고 1 KiB 이상
- 서로 다른 상품이 같은 첨부파일 ID를 공유하지 않음
- 서로 다른 상품의 다운로드 이미지 SHA-256이 같지 않음
- 복구 이미지는 공급사 ID와 원본 상품 ID가 유일하게 일치하는 경우만 사용

검증 또는 복구가 하나라도 실패하면 전체 실행을 실패 처리한다.

## 가격 무결성

자동 가격 변경은 다음 조건을 모두 충족할 때만 실행한다.

- supplier/source product/source option 메타가 모두 일치하는 `hard_meta` 매칭
- 공급 옵션명이 WooCommerce 옵션명과 등급 및 규격까지 일치
- 이전에 검증 저장한 `_wholesalehub_supplier_price` 기준값 존재
- 현재 공급가가 기준값과 실제로 달라짐
- 새 판매가가 공급가 구간별 마진 공식과 정확히 일치
- 같은 variation을 가리키는 다른 source 행이 없음

`중/대/특/특대/왕특/소` 등 등급 토큰은 수량과 함께 옵션 식별키에 포함한다. 위 조건 중 하나라도 충족하지 않으면 `mvp-price-preflight`가 전체 가격 쓰기를 시작 전에 차단한다. 가격 전용 실행은 검증되지 않은 soft match의 source 메타를 덮어쓰지 않는다.

## 무변경 점검

`WHOLESALEHUB_DRY_RUN=1 bash scripts/n8n-mvp-sync.sh`은 build, 크롤링, 계획 preflight, 엄격 썸네일 감사까지만 수행하며 WooCommerce 쓰기 작업은 하지 않는다.

## 원복

워크플로 업데이트 도구는 적용 직전 JSON을 `reports/n8n-mvp-sync-workflow-backup.json`에 저장한다. 원복 시 같은 도구에 `--restore <backup-path> --apply`를 전달한다.
