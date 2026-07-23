# [보고서] hub.avocadoss.co.kr 가격 동기화 완전 복구 작업 현황

이전에 수행하다가 중단된 **hub.avocadoss.co.kr** 가격 동기화 파이프라인 복구 및 완전화 작업(프로젝트 2)에 대한 종합 보고서입니다. 사용자의 지시 사항, 현재까지의 진행 상황, 그리고 태스크 완료를 위해 남은 작업들을 상세히 정리했습니다.

---

## 1. 사용자의 지시 사항 (요구사항)

사용자의 핵심 요구사항은 **DailyFood 및 Walldo 공급처의 가격 변동을 안정적으로 수집하여 WooCommerce 판매가에 안전하게 자동 반영하고, 성공/실패 여부를 Telegram으로 확실하게 보고받는 전체 파이프라인의 완성 및 복구**입니다.

상세 지시 및 제약 사항은 다음과 같습니다:
*   **스케줄 자동화 복구**: 매일 09:00, 15:00, 21:00 KST에 가격 파이프라인이 안정적으로 동작해야 함.
*   **오류 및 예외 케이스 해결**:
    *   `price_preflight`에서 중단되던 문제 해결.
    *   `baseline_missing`, `match_uncertain`, `source_unverified` 등 보류/격리 사유에 대한 근본적인 해결책 마련.
*   **장애 격리 (Isolation)**: DailyFood의 장애가 Walldo 실행에 영향을 주지 않도록 공급처별 독립 수집 및 적용 설계.
*   **예외 복구 메커니즘**:
    *   429 한도 초과(Retry-After 준수, Backoff + Jitter 적용) 및 로그인 세션 만료 시 자동 재로그인/재시도.
    *   이중 실행 및 충돌을 방지하기 위한 Run Lock 제어 및 프로세스 비정상 종료 시 Stale Lock TTL 처리.
    *   단계별 상태를 DB에 기록하고 중단 지점부터 재개하는 Stage Checkpoint 구현.
    *   Woo API 가격 업데이트 실패 또는 불일치 시 1회 재시도 및 자동 롤백(이전 가격 복구) 메커니즘.
*   **레거시 82개 옵션 처리**: 이전 Heuristic 실행으로 보류되어 있던 82개 옵션들을 정확 매칭 데이터와 대조해 최종 동기화 처리하거나 비공개/폐기 분류로 정리.
*   **Telegram 보고 보강**: 성공, 변경 없음, 부분 성공, 실패 등 모든 실행 결과를 Telegram으로 전송하며, 전송 실패 시 outbox에 저장 후 다음 run에서 재전송. n8n 워크플로우 상에서도 실패 경로가 Telegram 노드에 정상적으로 연결되도록 조치.
*   **실패 주입 테스트 (Failure Injection)**: 429, 세션 만료, Woo 타임아웃, Telegram API 오류 등 악조건을 모사하여 작동을 테스트 코드로 증명할 것.
*   **배포 게이트 통과 후 실제 배포**: 전역 락(`flock -w 14400 /tmp/sol-ultra-production-deploy.lock`)을 활용해 `main` 브랜치 통합 및 운영 서버 반영 후 10분 이상 모니터링 및 idempotency(재실행 시 write 0건) 증명.

---

## 2. 현재까지의 진행 상황 (어디까지 진행되었는가?)

현재 작업 브랜치 [sol/p2-price-sync](file:///home/tnfwod/projects/wholesalehub-worktrees/p2-price-sync)는 운영 base commit `94d35f4925a7864de86a146c30d29a005a68dd12`에서 출발하여 2건의 핵심 개발 커밋이 완료된 상태로 보류 중입니다.

*   **DB 마이그레이션 완료**: `migrations/003_price_sync_pipeline.sql`이 운영 DB(`wholesalehub.sqlite`)에 이미 반영되어 `price_sync_*` 관련 신규 테이블 스키마가 성공적으로 생성되었습니다.
*   **1차 가격 업데이트 및 Telegram 알림 성공 (7/20)**:
    *   Walldo 납작복숭아 등의 가격 변동 3건이 실제 WooCommerce 사이트에 안전하게 반영되고 read-back 검증을 통과했습니다.
    *   당시 정상 실행 요약 보고가 Telegram을 통해 성공적으로 전송 완료되었습니다.
*   **2차 확장 지시 대응 추가 커밋 완료 (7/20)**:
    *   사용자의 P2 확장 지시사항([P2_가격동기화_Woo_n8n_Telegram_완전복구.txt](file:///C:/Users/tnfwo/Downloads/SOL_ULTRA_7_실제사이트반영_완성형/P2_가격동기화_Woo_n8n_Telegram_완전복구.txt))을 반영한 두 건의 기능 개선 커밋이 원격 리포지토리에 반영되었습니다.
        1. **bb32aad** (`feat(price-sync): resolve quarantine duplicate match_uncertain and add robust rollback/trashing/checkpointing`):
            *   `match_uncertain` 상태가 중복되어 격리되는 문제 수정.
            *   Woo API 실패 시 안전한 롤백, 트래싱(Trash) 및 Stage Checkpoint 구현 완료.
        2. **1c1f1ad** (`feat: implement option reconciliation with spec fingerprinting, priority matching, and multi-supplier active backup policy`):
            *   규격 핑거프린트(`getSpecFingerprint`)에 기초한 정합성 화해(Reconciliation) 구현.
            *   다중 공급처 액티브 백업 정책(DailyFood 품절 시 Walldo가 active 상태이면 백업 가격으로 매핑을 갱신하고 유지) 구현.
*   **빌드 실패 및 타입스크립트 에러 확인 (7/23)**:
    *   로컬 전체 빌드(`npm run build` / `tsc`) 실행 시 다음과 같은 3건의 TypeScript 컴파일 오류가 발생하여 최종 빌드 단계가 중단되어 있습니다.
        *   `src/atomic-sku/adapters/dailyfood-adapter.ts (Line 50)`: `detailImageUrls` 프로퍼티가 타입 정의 상에 존재하지 않아 컴파일 오류 발생.
        *   `src/atomic-sku/adapters/walldob2b-adapter.ts (Line 4)`: `../../adapters/walldob2b/walldob2b-adapter.js` 모듈에서 `parseWalldob2bProductAvailability` 멤버의 export 누락.
        *   `src/reports/supplier-detail-image-crawl-cli.ts (Line 51)`: `detailImageUrls` 프로퍼티가 타입 정의 상에 존재하지 않아 컴파일 오류 발생.
    *   다만, 빌드를 우회한 개별 Mock 로컬 단위 테스트([tests/option-reconciliation.test.ts](file:///home/tnfwod/projects/wholesalehub-worktrees/p2-price-sync/tests/option-reconciliation.test.ts) 등) 11건은 vitest 상에서 정상 작동 및 통과를 마크하고 있습니다.

---

## 3. 완료를 위해 남은 작업 (어떻게 해야 하는가?)

개발 및 테스트 코드는 작성 완료되어 있으나, 빌드 에러 해결과 실서버에 완전히 반영하고 정상 동작을 관찰하는 마지막 배포 및 검증 단계가 누락되어 있습니다.

1.  **TypeScript 빌드 에러 해결**:
    *   `detailImageUrls` 관련 프로퍼티 타입 미정의 및 `parseWalldob2bProductAvailability` 내보내기 누락 건에 대한 코드를 수정하여 `npm run build`가 완벽히 통과하도록 조치.
2.  **실패 주입 시나리오 검토**: 429 제한, 세션 만료, Woo 타임아웃, Telegram API 오류 등 예외 시나리오가 로컬 테스트에서 정상 동작하는지 세부 코드를 다시 한번 검토.
3.  **레거시 82개 보류 옵션 최종 처리 확인**: 과거 Heuristic 매칭 오류로 보류되었던 82개 옵션들의 정리 상태 확인 및 WooCommerce 제한적 반영.
4.  **n8n 워크플로우 동기화 및 Telegram Outbox 검증**: n8n 워크플로우(ID: `jVFfCJtfEax1GeDQ`) 내 에러 경로를 Telegram으로 정상 인입시키고 Telegram API 실패 시 Outbox에 쌓여 순차적으로 전송되는지 확인.
5.  **운영 main 브랜치 통합 및 실서버 배포**:
    *   전역 배포 락 `/tmp/sol-ultra-production-deploy.lock` 획득.
    *   `sol/p2-price-sync` 브랜치를 `main` 브랜치에 `--no-ff` 머지 및 push.
    *   운영 서버에 변경된 `n8n-mvp-sync.sh` 스크립트 및 CLI 서비스 반영.
6.  **운영 환경 최종 검증 (Smoke Test & Observation)**:
    *   운영 WooCommerce API 호출 및 DB 갱신 이력 관찰.
    *   재실행 시 변경사항이 없을 때 DB 쓰기가 0건으로 끝나는지(idempotency) 점검.
    *   배포 이후 최소 10분 동안 queue/outbox 및 로그에 fatal/error가 발생하지 않는지 실시간 모니터링.

---

### 관련 참조 파일 링크
*   [작업 정의서 (task.md)](file:///c:/Users/tnfwo/Desktop/multi/tasks/price-sync-recovery-20260719/task.md)
*   [작업 진행 기록 (log.md)](file:///c:/Users/tnfwo/Desktop/multi/tasks/price-sync-recovery-20260719/log.md)
*   [현재 컨텍스트 (context.md)](file:///c:/Users/tnfwo/Desktop/multi/tasks/price-sync-recovery-20260719/context.md)
*   [n8n MVP 동기화 쉘 스크립트 (n8n-mvp-sync.sh)](file:///c:/Users/tnfwo/Desktop/multi/tasks/price-sync-recovery-20260719/n8n-mvp-sync.sh)
*   [가격 동기화 코어 CLI (linked-offer-price-sync-cli.ts)](file:///c:/Users/tnfwo/Desktop/multi/tasks/price-sync-recovery-20260719/linked-offer-price-sync-cli.ts)
