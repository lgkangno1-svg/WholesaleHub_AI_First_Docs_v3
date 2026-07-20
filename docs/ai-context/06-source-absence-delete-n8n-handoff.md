# Source Absence Delete + n8n Handoff

## 목적

DailyFood/월억 최신 source plan에 없는 일반 상품/옵션이 hub에 계속 남는 문제를 막기 위해, n8n 자동 실행에 source absence delete 단계를 추가했다.

대표 문제 사례:

- [긴급특가!!!] 쥬스용 토마토가 DailyFood/월억 양쪽에 없는데 hub에 남아 있었음.
- 수동 전수 정리 후 쥬스용 토마토 잔존 0개 확인.

## 이번에 추가한 코드

- src/reports/mvp-source-absence-delete-cli.ts
- package.json script 추가
  - mvp:delete-source-absent
- scripts/n8n-mvp-sync.sh에 자동 실행 단계 추가

n8n 실행 순서 중 추가된 위치:

`ash
node dist/reports/mvp-sync-plan-cli.js
node dist/reports/mvp-sync-execute-cli.js --execute --confirm  EXECUTE_MVP_SYNC_EXISTING_VARIATIONS_ONLY
node dist/reports/mvp-source-absence-delete-cli.js --execute --confirm DELETE_SOURCE_ABSENT_NON_GROUPBUY_PRODUCTS
node dist/reports/hide-unsold-public-variations-cli.js --execute --confirm HIDE_UNSOLD_PUBLIC_VARIATIONS
`

## 삭제 기준

삭제 대상:

- eports/mvp-sync-plan.json의 최신 source plan에 없는 WooCommerce product/variation
- DailyFood/월억 대상 일반 상품
- 공동구매가 아닌 상품

삭제 제외:

- 공동구매 카테고리 상품
- plan 실패 시 전체 삭제 중단
- DailyFood 직접 사이트 option 수가 400개 미만이면 중단
- walldo option 수가 180개 미만이면 중단
- create_draft_product_candidate, dd_variation_candidate row는 유지 판단에 쓰지 않음

## 안전장치

CLI 실행에는 반드시 아래 confirm 필요:

`ash
--execute --confirm DELETE_SOURCE_ABSENT_NON_GROUPBUY_PRODUCTS
`

삭제 전 검증:

- mvp:plan이 성공해야 함
- DailyFood direct site crawl 정상이어야 함
- walldo 최신 수집 정상이어야 함
- plan row가 비어 있으면 중단

## 리포트

생성/갱신 위치:

- eports/source-absence-delete-summary.json
- eports/source-absence-delete-report.csv
- eports/source-absence-delete-final-summary.md

## 수동 실행 명령

`ash
cd /home/tnfwod/projects/wholesalehub
npm run mvp:plan
npm run mvp:delete-source-absent -- --execute --confirm DELETE_SOURCE_ABSENT_NON_GROUPBUY_PRODUCTS
npm run mvp:qa
`

## 현재 검증 결과

마지막 확인 기준:

- DailyFood option count: 453
- walldo option count: 211
- 쥬스용 토마토 잔존: 0
- 최종 상품 수: 86
- 최종 카테고리: 공동구매 32, 농산물 53, 가공식품 1
- 축산물 카테고리: 삭제 완료
- 수산물 카테고리: 삭제 완료
- 축산물/수산물 메뉴: 삭제 완료
- 
pm run check: 통과
- 새 CLI 재실행 결과: deletedProducts 0, deletedVariations 0, 멱등성 확인

## 주의사항

- n8n 워크플로우 자체 API/credential은 이번 작업에서 건드리지 않았다.
- 기존 미커밋 변경이 있었다.
  - AI_HANDOFF.md
  - scripts/n8n-mvp-sync.sh
  - src/reports/hide-unsold-public-variations-cli.ts
  - src/reports/mvp-delete-unsold-cli.ts
  - .bak-* 파일들
- 이번 변경만 별도 커밋하려면 다음 파일 위주로 확인해야 한다.
  - src/reports/mvp-source-absence-delete-cli.ts
  - package.json
  - scripts/n8n-mvp-sync.sh
- 단, scripts/n8n-mvp-sync.sh에는 이전 작업자의 변경도 섞여 있으므로 커밋 전 diff를 반드시 확인한다.
- secret, API key, credential 값은 문서/로그/커밋에 절대 남기지 않는다.

## 다음 작업자 확인 순서

1. 이 문서 읽기
2. docs/ai-context/02-rules.md 확인
3. git diff -- scripts/n8n-mvp-sync.sh package.json src/reports/mvp-source-absence-delete-cli.ts 확인
4. 
pm run check 재확인
5. 필요 시 n8n 수동 실행 테스트
