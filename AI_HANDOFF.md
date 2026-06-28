# AI_HANDOFF

1. 현재 프로젝트 목표
- DailyFood + walldob2b 기준으로 기존 WooCommerce 상품 우선, 신규 draft는 공개하지 않고 중복/흡수 가능성 검수.

2. 현재까지 완료된 핵심 작업
- DailyFood htmlview 448 옵션, walldob2b 엑셀 195 옵션 수집 파이프라인 구축.
- 축산물 제외 룰 적용.
- 기존 variation 가격 업데이트는 검증 완료.
- 신규 draft variable product 73개 / variation 193개 생성 완료, 공개 0개 유지.
- draft vs existing merge 리포트 생성 완료.

3. 최신 commit hash
- 최신 커밋: final response 참조

4. 현재 branch
- main

5. 수정된 주요 파일
- /home/tnfwod/projects/wholesalehub/package.json
- /home/tnfwod/projects/wholesalehub/src/reports/draft-vs-existing-merge-cli.ts
- /home/tnfwod/projects/wholesalehub/AI_HANDOFF.md

6. 최신 데이터 수치
- DailyFood 옵션 수: 448
- walldob2b 옵션 수: 195
- product_group 수: 축산물 제외 후 135
- option 후보 수: 축산물 제외 후 446
- WooCommerce 기존 상품 수: 145
- WooCommerce 기존 variation 수: 596
- draft 상품 수: 73
- draft variation 수: 193
- duplicate_existing_product: 0
- partial_missing_options: 10
- unique_new_product: 63
- review_needed: 0
- add_variation 후보 수: 193

7. 최근 실행한 명령어
- npm run check
- docker exec avocadoss-wp php -l /var/www/html/wp-content/plugins/avocadoss-performance/avocadoss-performance.php
- docker exec avocadoss-wp php -l /var/www/html/wp-content/plugins/avocadoss-performance/avocadoss-multi-variation-cart.php
- npm run report:draft-vs-existing-merge

8. 최근 통과한 check 결과
- npm run check 통과: 29 test files / 72 tests passed.
- PHP syntax check 통과.

9. 최신 리포트 파일 위치
- reports/draft-vs-existing-merge-plan.csv
- reports/draft-vs-existing-merge-summary.md
- reports/draft-products-review.csv
- reports/draft-products-review-summary.md

10. 실제 WooCommerce에 반영된 작업
- 이번 작업에서는 WooCommerce 상품/가격/재고/공개 상태 변경 없음.
- draft 상품 publish/delete/trash 없음.

11. 아직 절대 하면 안 되는 작업
- draft 상품 공개 금지.
- 기존/draft 상품 삭제 금지.
- 상품명/옵션명/설명/이미지 수정 금지.
- 가격/재고 변경 금지.
- variation 생성 금지.
- 신규 상품 생성 금지.
- 주문/결제/예치금/자동주문 금지.
- 고객 화면에 supplier/source/raw cost/original URL 노출 금지.

12. 다음 AI가 바로 해야 할 작업
- draft-vs-existing-merge-plan.csv에서 partial_missing_options 10개를 사람이 검수.
- 기존 상품에 흡수할 옵션만 별도 승인 후 add_variation 실행 계획으로 넘김.
- unique_new_product 63개는 publish하지 말고 계속 보류/검수.

13. 주의사항
- .env/API key/로그인 정보 출력 금지.
- reports/는 gitignore 유지.
- Windows 경로가 아니라 Mini PC /home/tnfwod/projects/wholesalehub 기준으로 작업.
- 가격 업데이트 허용 범위: 사용자가 명시 승인한 기존 variation 가격만.
