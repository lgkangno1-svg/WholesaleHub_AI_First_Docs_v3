# AI_HANDOFF

1. 현재 프로젝트 목표
- DailyFood + walldob2b 전체 옵션을 상품군/옵션 후보로 만들고, 안전한 기존 WooCommerce variation 가격만 반영.
- WooCommerce 고객 UX는 구매 흐름 우선으로 개선.

2. 현재까지 완료된 핵심 작업
- DailyFood htmlview 전체 파싱, walldob2b 엑셀 다운로드 파싱.
- product_group/option plan, WooCommerce sync dry-run/execute CLI 구현.
- 기존 variation 가격 업데이트 162건 선행 + 34건 추가 실행 및 GET 검증 완료.
- 확정 장사 기준 23개를 자동 user_answer로 반영.
- 고객 로그인 redirect 개선: 일반 고객 my-account 로그인은 상품 메인/홈, checkout/cart/product redirect는 유지.

3. 최신 commit hash
- 최신 커밋: e997e84
- 이번 handoff 포함 커밋 후 final 보고 참조.

4. 현재 branch
- main

5. 수정된 주요 파일
- /home/tnfwod/avocadoss-wordpress/wp_data/wp-content/plugins/avocadoss-performance/avocadoss-performance.php
- AI_HANDOFF.md

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

7. 최근 실행한 명령어
- docker exec avocadoss-wp php -l /var/www/html/wp-content/plugins/avocadoss-performance/avocadoss-performance.php
- PHP smoke test: woocommerce_login_redirect filter for customer/admin cases.

8. 최근 통과한 check 결과
- PHP syntax check 통과: No syntax errors detected.
- 로그인 redirect smoke test 통과.

9. 최신 리포트 파일 위치
- reports/woocommerce-sync-plan.json
- reports/woocommerce-sync-execute-log.json
- reports/woocommerce-sync-execute-verification.json
- reports/product-group-plan.json
- reports/product-option-plan.json
- reports/parsing-rule-questions.csv
- reports/parsing-rule-application-summary.json

10. 실제 WooCommerce에 반영된 작업
- 기존 WooCommerce variation 가격 업데이트 누적 196건 실행.
- GET 검증 불일치 0건.
- 고객 로그인 redirect 플러그인 코드 적용.
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
- 남은 update_variation_price 23건은 중복/상충 variation 후보 중심이므로 자동 실행하지 말고 매칭/옵션 룰 감사.
- add_variation 36건, createNew 238건은 별도 승인 전까지 dry-run 유지.
- 실제 고객 계정으로 브라우저 로그인 UX를 수동 확인하면 좋음.

13. 주의사항
- .env/API key/로그인 정보 출력 금지.
- reports/는 gitignore 유지.
- 신규 상품 생성: 아직 금지.
- variation 추가: 아직 금지.
- 가격 업데이트 허용 범위: 기존 product_id + 기존 variation_id + action=update_variation_price + safety_status=safe + duplicate 없는 unique variation만.
- Windows 경로가 아니라 Mini PC /home/tnfwod/projects/wholesalehub 기준으로 작업.
