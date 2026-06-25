# WholesaleHub AI-First Development Docs v3

대상 사이트: `hub.avocadoss.co.kr`  
플랫폼: WordPress + WooCommerce  
운영 환경: Mini PC + Docker + n8n self-hosted + SQLite  
AI 개발 도구: Codex, Antigravity  
제외 도구: Cursor, Claude Code

## v3 핵심 변경사항

1. AdminPlus 계열 공급처는 자동주문 대상에서 제외한다.
2. AdminPlus 계열은 가격 수집만 수행하며, 매일 오전 11시 1회로 제한한다.
3. AdminPlus 계열은 가능하면 공급처 제공 엑셀/CSV/Google Sheet 링크로 대체한다.
4. 데일리푸드는 Google Sheets 공급처로 등록한다.
5. 데일리푸드 Google Sheet:
   - Spreadsheet ID: `1YvIxuhGYhA7PTxu9nH5cUNC8dkfykUSb4C8D77UKlUQ`
   - GID: `860422621`
   - URL: `https://docs.google.com/spreadsheets/d/1YvIxuhGYhA7PTxu9nH5cUNC8dkfykUSb4C8D77UKlUQ/edit?gid=860422621#gid=860422621`
6. 거래처가 제공하는 엑셀/CSV/Google Sheet 링크가 있는 경우, 크롤링보다 해당 방식 수집을 우선한다.
7. 가격 이력 저장, 가격 변동 알림, 가격 차이 표시, 신뢰도 기능, 카카오 알림톡은 MVP에서 제외한다.
8. 고객에게 공급처명, 최저 공급처, 원가, 가격 비교 결과는 절대 노출하지 않는다.

## 읽는 순서

1. `AGENTS.md`
2. `CODEX.md` 또는 `ANTIGRAVITY.md`
3. `PRD/00_Project_Overview.md`
4. `PRD/01_v3_Decisions.md`
5. `PRD/05_Supplier_Data_Collection.md`
6. `PRD/06_DailyFood_GoogleSheet.md`
7. `PRD/07_AdminPlus_Limited_Crawling.md`
8. `Tasks/Phase_1_MVP.md`

## Phase 1 MVP 실행

요구사항:

- Node.js 22.5 이상
- npm

설치 및 검증:

```bash
npm install
npm run check
```

실제 DailyFood CSV export URL을 사용한 dry-run:

```bash
npm run phase1 -- --db data/wholesalehub.sqlite --margin 1500
```

로컬 CSV fixture를 사용한 dry-run:

```bash
npm run phase1 -- \
  --csv tests/fixtures/dailyfood.csv \
  --db data/wholesalehub.sqlite \
  --margin 1500
```

`GEMINI_API_KEY`가 설정되면 룰 기반 파싱으로 확정할 수 없는 상품을 Gemini Flash가
정규화한다. 키가 없으면 룰 기반 결과를 사용하며, 신뢰도가 낮은 매핑은 최저가 비교에서
제외된다.

CLI 출력은 WooCommerce dry-run JSON이며 공급처 ID, 공급처명, 원가, 원본 URL을 포함하지
않는다. 실제 WooCommerce API 업데이트는 Phase 1 범위에 포함되지 않는다.
