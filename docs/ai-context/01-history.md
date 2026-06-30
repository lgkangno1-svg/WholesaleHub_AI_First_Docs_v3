# 작업 이력

## MVP 흐름
- MVP 1: DailyFood + walldob2b 수집, WooCommerce 기존 상품/variation 조회, sync plan 생성.
- MVP 2: 기존 variation 가격/공급처/품절 상태 동기화 실행. 총 87개 성공.
- MVP 3: safe variation 추가와 draft/private 신규 상품 생성. add_variation 61개, draft/private 상품 11개, 신규 variation 125개.
- MVP 4: 고객 화면 QA. supplier/cost/source 노출 0, 중복 옵션/장바구니 문제 수정.
- MVP 5: 운영 명령어, n8n 자동화, handoff 문서, 발주 리포트/엑셀 기반 구축.

## n8n 자동화
- Workflow: `WholesaleHub MVP Sync`.
- 스케줄: 09:00 / 15:00 / 21:00 Asia/Seoul.
- SSH 명령: `cd /home/tnfwod/projects/wholesalehub && bash scripts/n8n-mvp-sync.sh`.
- 자동화에는 공급처 수집, WooCommerce sync, QA, 리포트 export, 발주 엑셀/이메일 흐름이 연결되어 있었다.

## 발주 엑셀/이메일
- 월억/데일리 양식 기반 발주 엑셀 생성 기능을 만들었다.
- Gmail OAuth로 09:00 발주 엑셀 이메일 테스트를 진행했다.
- 실제 WooCommerce 주문 생성 없이 fixture 주문으로 테스트하는 흐름도 만들었다.

## 상품 재구축 시도
- 사용자가 WooCommerce 상품을 직접 삭제한 뒤 DailyFood/월억 데이터를 기반으로 public 상품 재등록을 시도했다.
- 수산물 제외, 마진 규칙, 같은 상품군 variable product 묶기, 이미지 필수 생성 정책이 적용되었다.
- 이후 정책이 바뀌어 이미지 크롤링/첨부는 금지되고 상세 설명 텍스트만 수집해야 한다.

## 현재 꼬인 문제
- 이전 시도에서 이미지 복구/첨부 작업이 오래 걸리고 중단되었다.
- 현재 핵심은 이미지 크롤링이 아니라 DailyFood/월억의 실제 판매 옵션/가격 전체 대조와 마진 규칙 검증이다.
- 누락 상품 예: 마카다미아, 부사사과, 흑찰옥수수 등은 일부 발견된 사례일 뿐 전체 전수 비교가 필요하다.
- n8n 자동화가 최신 정책을 따르는지 다시 확인해야 한다.
