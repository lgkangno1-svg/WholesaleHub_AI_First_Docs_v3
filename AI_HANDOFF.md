# AI_HANDOFF

1. 현재 프로젝트 목표
- DailyFood + walldob2b 전체 옵션을 상품군/옵션 후보로 만들고, WooCommerce 고객 UX와 운영 리포트를 안전하게 개선.

2. 현재까지 완료된 핵심 작업
- DailyFood htmlview 전체 파싱, walldob2b 엑셀 다운로드 파싱.
- product_group/option plan, WooCommerce sync dry-run/execute CLI 구현.
- 기존 WooCommerce variation 가격 업데이트 누적 196건 실행 및 GET 검증 완료.
- 확정 장사 기준 파싱 룰 자동 적용.
- 고객 로그인 redirect 개선 적용.
- variable product 상세 다중 옵션 장바구니 UI를 드롭다운 선택 → 선택 목록 방식으로 변경.
- 로그인 사용자 상단 메뉴에 장바구니 링크/개수 표시 추가.
- 상품 필터 taxonomy 리포트 생성 CLI 추가.

3. 최신 commit hash
- 최신 커밋: COMMIT_AFTER_THIS_TASK

4. 현재 branch
- main

5. 수정된 주요 파일
- /home/tnfwod/projects/wholesalehub/package.json
- /home/tnfwod/projects/wholesalehub/src/reports/product-filter-taxonomy.ts
- /home/tnfwod/projects/wholesalehub/src/reports/product-filter-taxonomy-files.ts
- /home/tnfwod/projects/wholesalehub/src/reports/product-filter-taxonomy-cli.ts
- /home/tnfwod/projects/wholesalehub/tests/cli.e2e.test.ts
- /home/tnfwod/projects/wholesalehub/AI_HANDOFF.md
- /home/tnfwod/avocadoss-wordpress/wp_data/wp-content/plugins/avocadoss-performance/avocadoss-performance.php
- /home/tnfwod/avocadoss-wordpress/wp_data/wp-content/plugins/avocadoss-performance/avocadoss-multi-variation-cart.php

6. 최신 데이터 수치
- DailyFood 옵션 수: 448
- walldob2b 옵션 수: 195
- product_group 수: 153
- option 후보 수: 460
- WooCommerce update 후보 수: 222
- WooCommerce create 후보 수: 238
- add_variation 후보 수: 36
- update_variation_price 후보 수: 23
- no_op 수: 163
- sync review_needed 수: 0
- product item filter 수: 153
- main category 수: 3
- attribute filter kind 수: 5

7. 최근 실행한 명령어
- npm run report:product-filter-taxonomy
- npm run check
- docker exec avocadoss-wp php -l /var/www/html/wp-content/plugins/avocadoss-performance/avocadoss-performance.php
- docker exec avocadoss-wp php -l /var/www/html/wp-content/plugins/avocadoss-performance/avocadoss-multi-variation-cart.php
- curl product_id 1158 page smoke check

8. 최근 통과한 check 결과
- npm run check 통과: 29 test files / 72 tests passed.
- PHP syntax check 통과.
- product_id 1158 page smoke: variation form + avocadoss-multi-cart markup 확인.

9. 최신 리포트 파일 위치
- reports/product-filter-taxonomy.json
- reports/product-filter-taxonomy.csv
- reports/product-filter-summary.md
- reports/human-product-status-summary.md
- reports/human-product-status-by-group.csv
- reports/human-product-status-by-option.csv
- reports/human-price-update-history.csv
- reports/human-excluded-candidates.csv
- reports/woocommerce-sync-plan.json
- reports/woocommerce-sync-execute-log.json
- reports/woocommerce-sync-execute-verification.json

10. 실제 WooCommerce에 반영된 작업
- 기존 WooCommerce variation 가격 업데이트 누적 196건 실행.
- 이번 작업에서는 상품/가격/재고 데이터 변경 없음.
- 이번 작업에서는 고객 UX 플러그인 코드만 변경.
- 신규 상품 생성 없음, 신규 variation 생성 없음, 재고 변경 없음.

11. 아직 절대 하면 안 되는 작업
- 신규 상품 생성 금지.
- 신규 variation 생성 금지.
- 상품명/옵션명/설명/이미지 수정 금지.
- 재고 변경 금지.
- 주문/결제/예치금/자동주문 금지.
- AdminPlus 자동주문 금지.
- 고객 화면에 supplier/source/raw cost/original URL 노출 금지.

12. 다음 AI가 바로 해야 할 작업
- 실제 로그인 고객 브라우저에서 다중 옵션 선택/중복 선택/수량 +/-/삭제/장바구니 담기 QA.
- 상품 필터 리포트를 보고 상단 노출 필터 기준을 운영자가 확정하면 UI 적용.
- 남은 update_variation_price 23건은 중복/상충 후보이므로 자동 실행 금지.
- add_variation 36건, createNew 238건은 별도 승인 전까지 dry-run 유지.

13. 주의사항
- .env/API key/로그인 정보 출력 금지.
- reports/는 gitignore 유지.
- 신규 상품 생성: 아직 금지.
- variation 추가: 아직 금지.
- 가격 업데이트 허용 범위: 기존 product_id + 기존 variation_id + action=update_variation_price + safety_status=safe + duplicate 없는 unique variation만.
- Windows 경로가 아니라 Mini PC /home/tnfwod/projects/wholesalehub 기준으로 작업.
