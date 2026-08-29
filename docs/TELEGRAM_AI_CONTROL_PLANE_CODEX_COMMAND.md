# Codex command — Telegram AI control plane repair

Use this only after the MiniPC diagnostic report has been generated.

```text
이 저장소의 PROJECT_NORTH_STAR.md, AGENTS.md, AI_HANDOFF.md, docs/TELEGRAM_AI_CONTROL_PLANE_CONTRACT.md, docs/TELEGRAM_AI_CONTROL_PLANE_STATUS_2026-08-29.md, ai/tasks/TELEGRAM_AI_CONTROL_PLANE_REPAIR.md를 먼저 읽어주세요.

그 다음 MiniPC에서 생성된 최신 WholesaleHub-Telegram-Control-Plane-*.txt 진단 결과를 근거로 실제 Telegram 봇 service/source와 OpenCodex runtime을 확인하고, 추측하지 말고 ai/tasks/TELEGRAM_AI_CONTROL_PLANE_REPAIR.md를 끝까지 수행해주세요.

반드시 만족해야 하는 최종 조건은 세 가지입니다.
1) OpenCodex를 통해 Antigravity와 OpenCode Go DeepSeek Flash를 각각 명시적으로 선택·실행할 수 있을 것.
2) Telegram에서 Codex를 선택하면 OpenCodex를 우회하고 로컬에 인증된 직접 Codex CLI/account 사용량을 사용할 것.
3) Telegram 명령으로 /home/tnfwod/projects/wholesalehub의 최신 Git source를 읽고 수정·테스트하고, 승인된 비금전 변경은 저장소의 안전 배포/롤백 경로를 통해 hub.avocadoss.co.kr에 반영하고 public smoke까지 검증할 수 있을 것.

추가 필수 조건:
- 한글 UTF-8 깨짐(???) 완전 해결.
- 선택한 route가 실패하면 다른 모델로 silent fallback 금지.
- Telegram update/callback 중복 실행 방지.
- route/model/provider label을 Telegram 결과에 표시하되 credential은 절대 노출하지 않기.
- Codex bwrap/userns 문제는 실제 service context에서 재현한 뒤 가장 좁은 수정만 적용. 호스트 전체 kernel/sysctl 보안을 무작정 완화하지 않기.
- 작업 전 실제 bot/service 수정 대상 백업.
- 기존 unrelated 변경 보존. git reset --hard, git clean, destructive checkout 금지.
- 실제 주문/결제/공급처 구매/환불/세금 발행은 실행하지 않기.
- 테스트와 acceptance matrix가 모두 PASS하기 전에는 완료라고 보고하지 않기.

가능한 작업은 스스로 계속 진행하고, 사용자만 할 수 있는 로그인/재인증/권한 승인이 필요한 정확한 지점에서만 멈춰주세요.
마지막 보고는 완료 / 검증 / 남은 문제 / 사용자가 해줄 일 네 항목만 간단히 작성해주세요.
```
