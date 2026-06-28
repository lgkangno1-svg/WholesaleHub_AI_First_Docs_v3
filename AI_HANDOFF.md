# AI_HANDOFF

1. 현재 프로젝트 목표
- DailyFood + walldob2b 전체 옵션을 상품군/옵션 후보로 만들고, 안전한 기존 WooCommerce variation 가격만 반영.

2. 현재까지 완료된 핵심 작업
- DailyFood htmlview 전체 파싱, walldob2b 엑셀 다운로드 파싱.
- product_group/option plan, WooCommerce sync dry-run/execute CLI 구현.
- 기존 variation 가격 업데이트 162건 실행 및 GET 검증 완료.
- AI 자동 파싱 + 애매한 기준 질문표 + user_answer 룰 적용 구조 추가.

3. 최신 commit hash
- 최신 커밋: 

4. 현재 branch
- main

5. 수정된 주요 파일
- package.json
- config/parsing-rules.json
- src/reports/parsing-rule-*.ts
- src/reports/woocommerce-product-sync-plan-cli.ts
- tests/parsing-rule-apply.test.ts
- AI_HANDOFF.md

6. 최신 데이터 수치
- DailyFood 옵션 수: 448
- walldob2b 옵션 수: 195
- product_group 수: 146
- option 후보 수: 460
- WooCommerce update 후보 수: 106
- WooCommerce create 후보 수: 354
- add_variation 후보 수: 6
- update_variation_price 후보 수: 2
- no_op 수: 98
- review_needed 수: 353

7. 최근 실행한 명령어
- npm run check
- npm run report:parsing-rule-questions -- --db data/wholesalehub.sqlite --limit 30
- npm run parsing-rules:apply -- --questions reports/parsing-rule-questions.csv --groups reports/product-group-plan.json --options reports/product-option-plan.json
- npm run woocommerce:sync-plan -- --mode all

8. 최근 통과한 check 결과
- npm run check 통과: 29 test files / 71 tests passed.

9. 최신 리포트 파일 위치
- reports/parsing-rule-questions.csv
- reports/parsing-rule-questions.json
- reports/parsing-rule-application-summary.json
- reports/product-group-plan.json
- reports/product-option-plan.json
- reports/woocommerce-sync-plan.json
- reports/woocommerce-sync-execute-log.json
- reports/woocommerce-sync-execute-verification.json

10. 실제 WooCommerce에 반영된 작업
- 기존 WooCommerce variation 가격 업데이트 162건 실행.
- GET 검증 162건 / 불일치 0건.
- 이번 파싱 룰 작업에서는 WooCommerce 변경 없음.

11. 아직 절대 하면 안 되는 작업
- 신규 상품 생성 금지.
- 신규 variation 생성 금지.
- 상품명/옵션명/설명/이미지 수정 금지.
- 재고 변경 금지.
- 주문/결제/예치금/자동주문 금지.
- AdminPlus 자동주문 금지.
- 고객 화면에 supplier/source/raw cost/original URL 노출 금지.

12. 다음 AI가 바로 해야 할 작업
- 사용자가 reports/parsing-rule-questions.csv의 user_answer를 채우면 parsing-rules:apply 재실행.
- review_needed 353건을 줄이기 위해 답변된 룰 기반으로 product_group/option plan 재생성.
- 신규 상품/variation 생성은 별도 승인 전까지 dry-run plan만 유지.

13. 주의사항
- .env/API key/로그인 정보 출력 금지.
- reports/는 gitignore 유지.
- 신규 상품 생성: 아직 금지.
- variation 추가: 아직 금지.
- 가격 업데이트 허용 범위: 기존 product_id + 기존 variation_id + action=update_variation_price + safety_status=safe + unique variation만.
- Windows 경로가 아니라 Mini PC /home/tnfwod/projects/wholesalehub 기준으로 작업.
