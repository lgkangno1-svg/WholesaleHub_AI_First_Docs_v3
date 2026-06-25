# ANTIGRAVITY.md

Antigravity 사용 시 이 문서를 프로젝트 실행 지침으로 삼는다.

## 목적

Antigravity는 WholesaleHub를 기능 단위로 구현한다.

## 절대 지켜야 할 결정사항

- Cursor/Claude Code 관련 파일이나 설정을 만들지 않는다.
- AdminPlus 계열 자동주문은 구현하지 않는다.
- AdminPlus 계열 가격 수집은 매일 오전 11시 1회로 제한한다.
- DailyFood는 Google Sheet Adapter로 구현한다.
- 거래처 제공 엑셀/CSV/Google Sheet가 있으면 이를 우선한다.
- Playwright는 수집 허가가 있거나 대체 수단이 없을 때만 사용한다.

## Antigravity 요청 예시

```txt
AGENTS.md와 PRD 문서를 읽고 Supplier Adapter 아키텍처를 구현해줘.
DailyFood Google Sheets adapter를 먼저 만들고, AdminPlus adapter는 오전 11시 1회 제한 설정과 rate limit만 포함한 skeleton으로 만들어줘.
```
