# AI_HANDOFF

1. 현재 프로젝트 목표
- DailyFood + walldob2b 두 공급처 기준으로 WooCommerce 판매 후보를 안전하게 검수/반영.
- draft 상품은 CSV 승인(review_status=approve) 기반으로만 공개 가능.

2. 현재까지 완료된 핵심 작업
- DailyFood htmlview 전체 파싱, walldob2b 엑셀 다운로드 파싱.
- 축산물 제외 룰 적용.
- 신규 draft variable product 73개와 variation 193개 생성 완료.
- 공개 상태 신규 상품 0개 검증.
- draft 상품 검수 리포트 생성 완료.
- draft 상품 publish approval workflow CLI 추가.

3. 최신 commit hash
- 최신 커밋: final response 참조

4. 현재 branch
- main

5. 수정된 주요 파일
- /home/tnfwod/projects/wholesalehub/package.json
- /home/tnfwod/projects/wholesalehub/src/reports/draft-products-publish-cli.ts
- /home/tnfwod/projects/wholesalehub/AI_HANDOFF.md

6. 최신 데이터 수치
- DailyFood 옵션 수: 448
- walldob2b 옵션 수: 195
- 축산물 제외 옵션 수: 14
- 신규 draft 상품 수: 73
- 신규 variation 수: 193
- 공개 상태 신규 상품 수: 0
- review_status approve 기본 수: 0
- publish dry-run 후보 수: 0
- publish dry-run 제외 수: 73

7. 최근 실행한 명령어
- npm run check
- docker exec avocadoss-wp php -l /var/www/html/wp-content/plugins/avocadoss-performance/avocadoss-multi-variation-cart.php
- node dist/reports/draft-products-publish-cli.js --input /tmp/draft-products-review-approve-sample.csv
- node dist/reports/draft-products-publish-cli.js

8. 최근 통과한 check 결과
- npm run check 통과: 29 test files / 72 tests passed.
- PHP syntax check 통과.

9. 최신 리포트 파일 위치
- reports/draft-products-review.csv
- reports/draft-products-review-summary.md
- reports/draft-products-publish-plan.json
- reports/draft-products-publish-plan.csv
- reports/draft-products-publish-summary.md

10. 실제 WooCommerce에 반영된 작업
- 이번 작업에서는 WooCommerce 상품/가격/재고/공개 상태 변경 없음.
- publish workflow는 dry-run만 실행.

11. 아직 절대 하면 안 되는 작업
- 승인 없는 상품 공개 금지.
- 상품명/옵션명/설명/이미지 수정 금지.
- 가격/재고 변경 금지.
- 신규 상품/variation 추가 생성 금지.
- review_needed/blocked 실행 금지.
- 축산물 제외 대상 실행 금지.
- 주문/결제/예치금/자동주문 금지.
- 고객 화면에 supplier/source/raw cost/original URL 노출 금지.

12. 다음 AI가 바로 해야 할 작업
- 사용자가 reports/draft-products-review.csv의 review_status를 approve로 바꾼 뒤 publish dry-run 재생성.
- 실제 공개는 --execute --confirm PUBLISH_APPROVED_DRAFT_PRODUCTS가 있을 때만 허용.

13. 주의사항
- .env/API key/로그인 정보 출력 금지.
- reports/는 gitignore 유지.
- Windows 경로가 아니라 Mini PC /home/tnfwod/projects/wholesalehub 기준으로 작업.
