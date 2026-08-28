# AGENTS.md

Codex, OpenCode, Antigravity 및 기타 AI/개발자가 WholesaleHub 프로젝트를 구현할 때 반드시 지켜야 할 공통 지침입니다.

## 작업 시작 전 필수 읽기 순서

1. `PROJECT_NORTH_STAR.md` — 최상위 제품/개발/개선 기준
2. `AGENTS.md` — 공통 실행 규칙
3. `AI_HANDOFF.md` — 현재 운영 상태와 최근 변경
4. 작업과 직접 관련된 `PRD/`, `OPERATIONS.md`, 테스트 및 최근 PR

이전 대화나 기억을 최신 코드 상태로 가정하지 말고, 항상 GitHub `main`과 관련 파일/최근 PR을 먼저 확인합니다.

## 절대 원칙

- 고객 화면에는 공급처 정보, 원가, 최저 공급처, 가격 비교 결과를 노출하지 않습니다.
- AdminPlus 계열 자동주문은 명시적 승인 없이 구현하지 않습니다.
- AdminPlus 계열 가격 수집은 현재 정책상 매일 오전 11시 1회로 제한합니다.
- 거래처 제공 Google Sheet, Excel, CSV 링크가 있으면 이를 최우선 데이터 소스로 사용합니다.
- Playwright는 최후의 수단입니다.
- 숨겨진 API 분석, 토큰 분석, CAPTCHA 우회, 차단 우회는 구현하지 않습니다.
- 상품 상세 설명, 이미지, 리뷰, 디자인 요소를 복제하지 않습니다.
- 상품명 정규화는 AI를 사용할 수 있으나, 매핑 캐시에 이미 존재하는 상품명은 AI 호출 없이 재사용합니다.
- Qwen 2.5B 로컬 모델은 평가/실험용으로만 둡니다.
- 실제 주문/결제/환불/세금 발행은 QA에서 실행하지 않습니다.
- `.env`, API key, bot token, 비밀번호를 출력하거나 커밋하지 않습니다.
- 작업 전 backup/rollback 지점을 확보하고, 관련 테스트와 실제 smoke 검증 없이 완료로 보고하지 않습니다.

## 문서 유지 규칙

- 기능 구현/버그 수정 후 현재 상태는 `AI_HANDOFF.md`에 반영합니다.
- 제품 목표, 운영 정책, 자동화 범위, 보안 경계, 개발/배포 기준이 바뀌면 **같은 PR에서 `PROJECT_NORTH_STAR.md`도 업데이트**합니다.
- 단순 구현 세부사항이 North Star를 바꾸지 않으면 `PROJECT_NORTH_STAR.md`를 불필요하게 수정하지 않습니다.

## 권장 구현 스택

- Node.js + TypeScript
- SQLite
- Playwright
- n8n
- WooCommerce REST API
- AI parsing/normalization APIs where deterministic parsing is insufficient
