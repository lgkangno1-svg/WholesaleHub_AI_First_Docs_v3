# AI_HANDOFF

1. 현재 프로젝트 목표
- DailyFood + walldob2b 전체 옵션을 상품군/옵션 후보로 만들고, WooCommerce 고객 UX와 운영 리포트를 안전하게 개선.
- 축산물/정육/육류 상품은 자동화 대상에서 제외.

2. 현재까지 완료된 핵심 작업
- DailyFood htmlview 전체 파싱, walldob2b 엑셀 다운로드 파싱.
- product_group/option plan, WooCommerce sync dry-run/execute CLI 구현.
- 기존 WooCommerce variation 가격 업데이트 누적 196건 실행 및 GET 검증 완료.
- 확정 장사 기준 파싱 룰 자동 적용.
- 고객 로그인 redirect 및 다중 옵션 장바구니 UI 적용.
- 상품 필터 taxonomy 리포트 생성 CLI 추가.
- 축산물 제외 룰 적용, 제외 리포트/기존 Woo 축산물 검토 리포트 생성.
- 상품 상세/프론트 상단에 도매허브 브랜드 홈 링크와 장바구니 링크 추가.

3. 최신 commit hash
- 최신 커밋: 68c51a3

4. 현재 branch
- main

5. 수정된 주요 파일
- /home/tnfwod/projects/wholesalehub/AI_HANDOFF.md
- /home/tnfwod/avocadoss-wordpress/wp_data/wp-content/plugins/avocadoss-performance/avocadoss-multi-variation-cart.php

6. 최신 데이터 수치
- DailyFood 옵션 수: 448
- walldob2b 옵션 수: 195
- 축산물 제외 옵션 수: 14
- 축산물 제외 product_group 수: 11
- product_group 수: 135
- option 후보 수: 446
- WooCommerce update 후보 수: 252
- WooCommerce create 후보 수: 194
- add_variation 후보 수: 45
- update_variation_price 후보 수: 41
- no_op 수: 166
- sync review_needed 수: 193
- existing WooCommerce 축산물 의심 상품 수: 3

7. 최근 실행한 명령어
- docker exec avocadoss-wp php -l /var/www/html/wp-content/plugins/avocadoss-performance/avocadoss-multi-variation-cart.php
- curl product page header smoke check
- curl -I https://hub.avocadoss.co.kr/
- curl -I https://hub.avocadoss.co.kr/cart/

8. 최근 통과한 check 결과
- PHP syntax check 통과.
- 직전 npm run check 통과: 29 test files / 72 tests passed.

9. 최신 리포트 파일 위치
- reports/excluded-products.csv
- reports/existing-livestock-products-review.csv
- reports/product-filter-summary.md
- reports/product-filter-taxonomy.json
- reports/human-product-status-summary.md

10. 실제 WooCommerce에 반영된 작업
- 이번 작업에서는 WooCommerce 상품/가격/재고 데이터 변경 없음.
- 프론트 헤더 UI 플러그인 코드만 변경.
- 신규 상품 생성 없음, 신규 variation 생성 없음, 재고 변경 없음.

11. 아직 절대 하면 안 되는 작업
- WooCommerce 상품 삭제/숨김 처리 금지.
- 신규 상품 생성 금지.
- 신규 variation 생성 금지.
- 상품명/옵션명/설명/이미지 수정 금지.
- 가격/재고 변경 금지.
- 주문/결제/예치금/자동주문 금지.
- AdminPlus 자동주문 금지.
- 고객 화면에 supplier/source/raw cost/original URL 노출 금지.

12. 다음 AI가 바로 해야 할 작업
- 실제 브라우저에서 PC/모바일 헤더 시각 QA.
- 장바구니 링크 카운트 fragment 갱신 QA.
- reports/existing-livestock-products-review.csv의 기존 Woo 축산물 의심 상품 운영자 검토.

13. 주의사항
- .env/API key/로그인 정보 출력 금지.
- reports/는 gitignore 유지.
- 축산물/정육/육류는 자동화 대상에서 제외.
- Windows 경로가 아니라 Mini PC /home/tnfwod/projects/wholesalehub 기준으로 작업.
