# HANDOFF_STATE.md

## 1. 현재 HEAD와 branch
- **Branch**: `sol/p2-price-sync`
- **HEAD Commit**: `94d35f4925a7864de86a146c30d29a005a68dd12` ("snapshot: current production state before parallel Sol Ultra projects")

## 2. 미커밋 변경 파일 (Worktree 상태)
- `PROJECT_SCOPE.md` (untracked, P2 작업 수칙)
- `src/reports/linked-offer-price-sync-cli.ts` (untracked, 메인 저장소에서 복사하여 동기화 완료)
- `.env` (untracked, DB 및 WooCommerce API 인증키 정보 포함, 메인 저장소에서 복사)

## 3. 기존 구현 완료 항목
- **SQLite 마이그레이션**: `migrations/003_price_sync_pipeline.sql`가 이미 운영 DB(`wholesalehub.sqlite`)에 적용되어 있으며 `price_sync_*` 테이블 생성 완료.
- **가격 동기화 CLI 구현**: `linked-offer-price-sync-cli.ts`가 구현되어 있으며, 스냅샷 파싱, `woo_variation_offer_links` 기반 정확 매칭, WooCommerce API 호출(1회 실패 시 재시도 포함) 및 SQLite 이력 기록 기능 제공.
- **n8n 자동화 스크립트**: `n8n-mvp-sync.sh`가 구축되어 잠금 파일 제어, 마이그레이션 실행, preflight 검사, WooCommerce 반영, 실패 복구 이메일/텔레그램 발송 처리 수행.
- **n8n 워크플로우**: `WholesaleHub MVP Sync` (ID: `jVFfCJtfEax1GeDQ`)가 활성화되어 매일 09:00, 15:00, 21:00 KST에 주기적으로 트리거됨.

## 4. 아직 미완료인 항목
- **정확 매칭 보류 버그**: `classifyUnlinkedPriceRows`에서 이미 정확 매칭 링크를 가지고 있는 variation을 제외하지 않아 `match_uncertain`("heuristic source differs...") 중복 후보로 등록되고 보류 항목으로 잡히는 현상 해결 필요.
- **공급처별 독립 실행**: DailyFood 크롤링 실패나 장애가 Walldo 실행을 방해하지 않도록 보장하고, 각 공급처별로 상태와 체크포인트를 관리해야 함.
- **진짜 Checkpoint 및 Resume**: 크롤링, preflight, Woo 반영, 텔레그램 전송 단계별 체크포인트를 DB에 기록하고, 중단 시 실패한 지점부터 재개하는 메커니즘 보강.
- **Stale Lock 해제**: 프로세스 비정상 종료 시 잠금 파일이 해제되지 않는 문제 대응 (TTL 기반 만료 처리).
- **Woo 반영 실패 시 복구**: WooCommerce 가격 업데이트 실패(또는 검증 mismatch 지속) 시 이전 가격 스냅샷으로 자동 롤백하는 기능 보완.
- **레거시 82개 옵션 재처리**: 이전 heuristic 실행의 82개 보류 대상을 정확 매칭 데이터와 동기화하여 처리하거나 폐기/비공개 분류로 정리.
- **실패 주입 테스트 코드 작성**: 429 API 한도 초과, 세션 만료, Woo 타임아웃, 텔레그램 전송 실패 상황을 모사하여 테스트 통과 보장.
- **배포 및 관찰**: 구현 코드를 main에 머지하고 운영 서버에 배포한 후 10분 이상 모니터링하여 오류 유무 파악.

## 5. 기존 테스트 결과
- 로컬 vitest 단위 테스트 (`mvp-price-preflight.test.ts`, `mvp-sync-plan-margin.test.ts` 등 136개 케이스) 전부 통과 확인.

## 6. 운영에 이미 반영된 항목
- DB 스키마 및 마이그레이션 운영 반영 완료.
- 이전 작업에서 Walldo 복숭아 옵션 3건 가격 실반영 및 텔레그램 정상 전송 이력 존재.

## 7. 현재 활성 n8n workflow와 schedule
- **Workflow ID**: `jVFfCJtfEax1GeDQ` (WholesaleHub MVP Sync)
- **Active**: `true`
- **Schedule**: 매일 09:00, 15:00, 21:00 KST 트리거.

## 8. 현재 DB/table/run 상태
- **최근 실행건 (`20260720-2100-1840833`)**:
  - 상태: `partial_success`
  - 확인 옵션: 150개, 변경 감지: 0개, 반영 성공: 0개
  - 보류: 89개 (중복 heuristic으로 인한 `match_uncertain` 85개, `source_unverified` 4개)
- **`source_unverified` 원인 분류**:
  - Walldo 납작복숭아(17206, 17207, 17208): 공급처(Walldo) 측에서 해당 상품(ID: 1783920372)을 내려서 최신 스냅샷에 수집되지 않음.
  - DailyFood 사과즙(18672): 스냅샷에는 '사과즙 50팩'만 수집되었으나 링크는 '사과즙 30팩'으로 연결되어 수집 불일치 발생.
