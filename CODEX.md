# CODEX.md

Codex는 이 문서를 기준으로 Phase 단위 개발을 수행합니다.

## 작업 방식

1. `PROJECT_NORTH_STAR.md`를 가장 먼저 읽고 제품 목표·안전 경계·개선 우선순위를 확인합니다.
2. `AGENTS.md`와 `AI_HANDOFF.md`를 읽고 현재 운영 상태와 금지사항을 확인합니다.
3. GitHub `main`, 최근 PR/commit, 관련 파일을 확인해 다른 AI/개발자의 최신 변경을 반영합니다.
4. 작업과 직접 관련된 `PRD/` 문서를 읽습니다.
5. 필요한 Phase/Task만 좁게 구현합니다.
6. 공급처 수집 로직은 Adapter 패턴과 정형 데이터 우선 원칙을 유지합니다.
7. 변경된 행동마다 테스트를 추가/수정하고 CI를 확인합니다.
8. 완료 후 `AI_HANDOFF.md`를 갱신합니다. North Star 수준의 정책이 바뀌면 `PROJECT_NORTH_STAR.md`도 같은 PR에서 갱신합니다.

## Codex 첫 요청 예시

```txt
이 저장소의 PROJECT_NORTH_STAR.md, AGENTS.md, AI_HANDOFF.md와 관련 PRD를 먼저 읽고 최신 main 상태를 점검해줘.
기존 변경사항과 회귀 위험을 파악한 뒤 필요한 범위만 수정하고 테스트/CI/배포 검증까지 수행해줘.
실제 주문·결제·환불·세금 발행은 QA에서 실행하지 말고, 공급처 내부 정보는 고객에게 노출하지 마.
```

## 구현 우선순위 판단

고정된 과거 Phase 순서보다 `PROJECT_NORTH_STAR.md`의 현재 실행 우선순위와 개선 평가표를 우선합니다.

특히 다음 순서로 판단합니다.

1. 운영 안전 / 회귀 방지
2. 고객·운영자 시간 절약
3. 자동화 / 관측성 / silent failure 제거
4. 수익성 / AI·API 비용 최적화
5. 보안 / 개인정보
6. 모바일 UX
7. SEO/AEO/GEO/Agentic readiness
8. 유지보수성 / 인수인계
