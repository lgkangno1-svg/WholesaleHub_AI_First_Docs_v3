# ANTIGRAVITY.md

Antigravity 사용 시 이 문서를 프로젝트 실행 지침으로 삼습니다.

## 작업 시작 전

1. `PROJECT_NORTH_STAR.md`를 먼저 읽습니다.
2. `AGENTS.md`와 `AI_HANDOFF.md`를 읽습니다.
3. 최신 `main`, 최근 PR/commit, 관련 파일을 확인합니다.
4. 이전 대화나 오래된 handoff만으로 현재 코드를 추정하지 않습니다.

## 목적

Antigravity는 WholesaleHub를 기능 단위로 구현하되, `PROJECT_NORTH_STAR.md`의 제품 목표·안전 기준·개선 우선순위를 최우선으로 따릅니다.

## 절대 지켜야 할 결정사항

- Cursor/Claude Code 관련 파일이나 설정을 만들지 않습니다.
- AdminPlus 계열 자동주문은 명시적 승인 없이 구현하지 않습니다.
- AdminPlus 계열 가격 수집은 현재 정책상 매일 오전 11시 1회로 제한합니다.
- 거래처 제공 Google Sheet/Excel/CSV가 있으면 이를 우선합니다.
- Playwright는 대체 수단이 없을 때만 사용합니다.
- 실제 주문·결제·환불·세금 발행은 QA에서 실행하지 않습니다.
- 공급처 실명/원가/source ID를 고객에게 노출하지 않습니다.
- 비밀정보를 출력하거나 커밋하지 않습니다.
- 작업 전 backup/rollback 지점을 확보하고 관련 테스트를 통과시킵니다.

## 문서 유지

기능 작업 후 `AI_HANDOFF.md`를 갱신합니다. 제품 목표, 운영 정책, 자동화 범위, 보안/배포 기준이 변경되면 같은 PR에서 `PROJECT_NORTH_STAR.md`도 갱신합니다.

## Antigravity 요청 예시

```txt
PROJECT_NORTH_STAR.md, AGENTS.md, AI_HANDOFF.md와 관련 PRD를 먼저 읽고 최신 main을 점검해줘.
현재 구조와 회귀 위험을 파악한 뒤 최소 변경으로 구현하고 테스트/CI까지 확인해줘.
```
