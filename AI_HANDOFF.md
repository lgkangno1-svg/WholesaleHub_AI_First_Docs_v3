# AI_HANDOFF

1. 현재 프로젝트 목표
- DailyFood + walldob2b 전체 옵션을 상품군/옵션 후보로 만들고, WooCommerce 고객 UX와 운영 리포트를 안전하게 개선.
- 축산물/정육/육류 상품은 자동화 대상에서 제외.

2. 현재까지 완료된 핵심 작업
- DailyFood htmlview 전체 파싱, walldob2b 엑셀 다운로드 파싱.
- product_group/option plan, WooCommerce sync dry-run/execute CLI 구현.
- 기존 WooCommerce variation 가격 업데이트 누적 196건 실행 및 GET 검증 완료.
- 축산물 제외 룰 적용.
- safe 신규 variable product를 draft 상태로 73개 생성, 신규 variation 193개 생성.
- 공개 상태 신규 상품 생성 0개 검증.
- 신규 add_variation 대상은 현재 0건.

3. 최신 commit hash
- 최신 커밋: COMMIT_AFTER_THIS_TASK

4. 현재 branch
- main

5. 수정된 주요 파일
- /home/tnfwod/projects/wholesalehub/src/reports/woocommerce-product-sync-execute.ts
- /home/tnfwod/projects/wholesalehub/src/reports/woocommerce-product-sync-plan.ts
- /home/tnfwod/projects/wholesalehub/src/reports/woocommerce-product-sync-plan-cli.ts
- /home/tnfwod/projects/wholesalehub/src/reports/woocommerce-product-sync-plan-files.ts
- /home/tnfwod/projects/wholesalehub/tests/woocommerce-product-sync-plan.test.ts
- /home/tnfwod/projects/wholesalehub/AI_HANDOFF.md

6. 최신 데이터 수치
- DailyFood 옵션 수: 448
- walldob2b 옵션 수: 195
- 축산물 제외 옵션 수: 14
- product_group 수: 135
- option 후보 수: 446
- safe add_variation 실행 가능 수: 0
- safe 신규 draft/private 생성 row 수: 193
- safe 신규 draft product 생성 수: 73
- 신규 variation 생성 수: 193
- 공개 상태 신규 상품 수: 0
- 실패 수: 0

7. 최근 실행한 명령어
- npm run check
- node dist/reports/product-group-plan-cli.js --db data/wholesalehub.sqlite
- node dist/reports/woocommerce-product-sync-plan-cli.js --mode all
- node dist/reports/woocommerce-product-sync-plan-cli.js --mode all --execute --limit 193 --confirm SYNC_WOOCOMMERCE_PRODUCTS
- docker exec avocadoss-wp php -l /var/www/html/wp-content/plugins/avocadoss-performance/avocadoss-multi-variation-cart.php
- node /tmp/verify_created.js

8. 최근 통과한 check 결과
- npm run check 통과: 29 test files / 72 tests passed.
- PHP syntax check 통과.

9. 최신 리포트 파일 위치
- reports/woocommerce-sync-plan.json
- reports/woocommerce-sync-summary.json
- reports/woocommerce-sync-execute-log.json
- reports/woocommerce-draft-create-verification.json
- reports/excluded-products.csv
- reports/existing-livestock-products-review.csv

10. 실제 WooCommerce에 반영된 작업
- 신규 draft variable product 73개 생성.
- 신규 draft product의 variation 193개 생성.
- 공개 상품 생성 없음.
- 이번 작업에서 가격 업데이트 없음, 기존 상품명/설명/이미지/재고 변경 없음.

11. 아직 절대 하면 안 되는 작업
- 공개 상태 신규 상품 생성 금지.
- WooCommerce 상품 삭제/숨김 처리 금지.
- 기존 상품명/옵션명/설명/이미지 수정 금지.
- 기존 재고 변경 금지.
- review_needed/blocked 실행 금지.
- 축산물 제외 대상 실행 금지.
- 주문/결제/예치금/자동주문 금지.
- AdminPlus 자동주문 금지.
- 고객 화면에 supplier/source/raw cost/original URL 노출 금지.

12. 다음 AI가 바로 해야 할 작업
- draft 신규 상품 73개를 관리자에서 검수할 수 있는 human report 생성.
- draft 상품 공개 전 카테고리/이미지/설명/옵션명 검수 절차 설계.
- 생성된 draft 상품 중 노출 제외/병합 필요 항목 검토.

13. 주의사항
- .env/API key/로그인 정보 출력 금지.
- reports/는 gitignore 유지.
- 신규 상품은 draft 상태로만 생성됨.
- Windows 경로가 아니라 Mini PC /home/tnfwod/projects/wholesalehub 기준으로 작업.
