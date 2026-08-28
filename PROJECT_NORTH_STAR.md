# WholesaleHub Project North Star

> **Canonical product / engineering / improvement charter**
>
> 이 문서는 도매Hub의 **개발 목적, 제품 기획, 운영 철학, 개선 우선순위, 안전 기준, 완료 기준**을 하나로 묶은 최상위 기준 문서입니다. Codex, OpenCode, Antigravity, 기타 AI/개발자는 기능을 추가하거나 수정하기 전에 반드시 이 문서를 먼저 읽어야 합니다.
>
> **Last updated:** 2026-08-28

---

## 1. 이 문서의 역할

도매Hub는 단순한 상품 크롤러나 WooCommerce 쇼핑몰이 아니라, **여러 공급처의 상품·옵션·가격·배송조건을 안전하게 통합하고 온라인 판매자가 반복적인 사입/주문 업무를 더 적은 시간과 실수로 처리하도록 돕는 B2B 도매 운영 플랫폼**입니다.

개발 중 판단이 애매할 때는 다음 순서로 결정합니다.

1. 실제 운영 안전성과 고객 신뢰를 해치지 않는가?
2. 사용자의 반복 업무를 줄이고 자동화 수준을 높이는가?
3. 고객에게 더 빠르고 명확한 구매/주문 경험을 제공하는가?
4. 매출·마진·운영비·AI/API 비용 측면에서 지속 가능한가?
5. 장애를 조용히 숨기지 않고 관측·알림·복구할 수 있는가?
6. 기존 동작을 깨지 않고 작게 배포·검증·롤백할 수 있는가?

위 원칙에 맞지 않는 기능은 구현이 쉬워도 우선순위를 낮춥니다.

---

## 2. 최종 목표

### 2.1 사업 목표

도매Hub의 최종 목표는 **온라인 판매자가 상품을 찾고, 도매 조건을 확인하고, 주문하고, 주문 이후 문제를 처리하는 전 과정을 한 곳에서 처리하는 운영 플랫폼**이 되는 것입니다.

핵심 가치는 다음과 같습니다.

- 여러 공급처를 직접 돌아다니는 시간을 줄인다.
- 상품/옵션/가격/배송조건의 불일치를 줄인다.
- 반복 주문과 대량 주문을 단순화한다.
- 신규 상품과 가격 변화를 자동으로 발견한다.
- 시스템 이상을 운영자가 먼저 발견하기 전에 자동 감지한다.
- 고객에게는 공급처 내부 구조를 숨기고 일관된 도매Hub 경험을 제공한다.
- 자동화가 늘어날수록 운영자의 수동 확인 횟수와 AI/API 비용은 줄어들어야 한다.

### 2.2 운영 목표

가능한 한 많은 일을 시스템이 스스로 수행해야 합니다.

운영자가 직접 해야 하는 일은 원칙적으로 다음과 같이 **사람 또는 계정 권한이 반드시 필요한 일**로 제한합니다.

- 외부 서비스 로그인/인증/결제수단/계정 승인
- 실제 금전 이동, 세금 발행, 환불 등 고위험 최종 승인
- 공급처와의 실제 계약/정책 결정
- 직접 서버 연결 권한이 없는 AI가 요청하는 1회성 PowerShell/SSH 실행
- 상품 공개 여부 등 사업 판단이 필요한 예외 승인

그 외 진단, 테스트, 문서화, 코드 수정, CI, 안전한 배포 준비, 모니터링 개선은 가능한 한 AI/자동화가 스스로 처리합니다.

---

## 3. 핵심 사용자

### 3.1 주요 고객

- 스마트스토어/쿠팡/오픈마켓 판매자
- 온라인 쇼핑몰 운영자
- 소규모 식품/신선식품 판매 사업자
- 반복적으로 상품을 사입하는 소매/온라인 사업자

### 3.2 고객이 겪는 문제

- 여러 도매처를 반복적으로 확인해야 함
- 같은 상품의 옵션/규격/배송비가 공급처마다 달라 비교가 어려움
- 신규 상품과 품절/가격 변화를 놓치기 쉬움
- 여러 상품을 주문할 때 입력과 관리가 번거로움
- 주문 이후 불량/환불/배송 문제 처리 채널이 분산됨

도매Hub의 UX는 위 문제를 실제로 줄이는 방향이어야 하며, 보기 좋은 화면 자체가 목표가 되어서는 안 됩니다.

---

## 4. 제품 구조의 불변 원칙

### 4.1 Canonical Product → Public Option → Supplier Offer

고객이 보는 상품과 공급처 원본 데이터를 분리합니다.

- **Canonical Product**: 고객에게 보이는 통합 상품
- **Public Option**: 고객이 선택하는 규격/중량/수량/등급 옵션
- **Supplier Offer**: 내부 공급처별 원가/재고/원본 옵션

새 공급처가 발견되어도 기존 공급처 데이터를 덮어쓰지 않고 **append/upsert**합니다.

### 4.2 옵션 동일성은 엄격하게 판단

중량, 개수, 범위, 등급, 크기, 포장수량 등 구매 의미가 달라지는 스펙은 같은 옵션으로 합치지 않습니다.

예:

- `1kg / 2송이`와 `1kg / 2~3수`는 동일 옵션이 아님
- `특상 100~300g`과 `특대 300g 이상`은 동일 옵션이 아님

잘못된 옵션 병합은 가격 오표시보다 더 위험한 데이터 손상으로 취급합니다.

### 4.3 가격은 명시적 데이터만 사용

가격은 공급처가 제공한 숫자/통화/정형 데이터 또는 명확히 검증된 DOM 필드에서만 가져옵니다.

상품명, 중량, 문장 패턴만 보고 가격을 추론하지 않습니다.

---

## 5. 공급처 수집 및 크롤링 원칙

수집 우선순위는 다음과 같습니다.

1. 공급처가 직접 제공하는 Google Sheet / Excel / CSV / 다운로드 파일
2. 안정적인 정형 API/공식 export
3. 일반 HTML 구조
4. Playwright/브라우저 자동화는 대체 수단이 없을 때만

### 5.1 금지

- CAPTCHA 우회
- 차단 우회
- 숨겨진 인증 토큰 탈취/분석
- 공급처 보안 체계를 약화시키는 방식
- 단순 과거 수량을 기준으로 정상 데이터를 오판하는 고정 임계치

### 5.2 신규/사라진 상품 처리

- 신규 상품은 자동 발견한다.
- 신규 공개 상품은 기본적으로 검토/승인 단계를 거친다.
- 공급처에서 한 번 보이지 않았다는 이유로 즉시 삭제/비활성화하지 않는다.
- **last-known-good + 최소 절대 floor + 연속 검증 실패** 같은 다중 안전장치를 사용한다.

### 5.3 Silent failure 금지

정기 수집이 실패하거나 예상된 신규 상품 반영이 되지 않으면 시스템은 조용히 넘어가면 안 됩니다.

최소한 다음을 기록/알림해야 합니다.

- 마지막 정상 수집 시각
- 공급처별 상품/옵션 수
- 직전 정상 대비 증감
- 신규/변경/보류/실패 수
- 실패 단계와 재시도 여부
- 운영자가 행동해야 하는 경우 Telegram 알림

---

## 6. 가격·마진·수익성 원칙

도매Hub는 매출만 늘리는 시스템이 아니라 **적정 마진을 남기면서 자동화 비용과 운영 리스크를 낮추는 시스템**이어야 합니다.

개선 시 항상 확인합니다.

- 공급가 변화가 판매가에 어떻게 반영되는가
- 배송비가 중복 또는 누락되지 않는가
- 옵션별 실제 원가가 보존되는가
- 주문 당시 원가/배송비 snapshot이 이후 변경으로 덮어써지지 않는가
- AI/API 호출이 반복적으로 낭비되지 않는가
- 정규화/매핑 cache로 AI 호출을 줄일 수 있는가

고객 화면에 내부 원가, 최저 공급처, 공급처 실명, source ID를 노출하지 않습니다.

---

## 7. 주문·결제·환불·세금의 안전 경계

금전과 회계 상태를 변경하는 기능은 일반 UI 개선이나 크롤러 수정보다 높은 검증 수준을 요구합니다.

### 7.1 주문

- 주문 당시 상품/옵션/공급원가/배송비 snapshot을 보존한다.
- 공급처별 split이 있어도 고객에게 내부 공급처 구조를 노출하지 않는다.
- 과거 주문 데이터를 현재 카탈로그 업데이트로 변형하지 않는다.

### 7.2 불량/환불 접수

현재 고객 불량/환불 접수는 **요청·증빙·검토 workflow**와 실제 금전 환불을 분리합니다.

실제 환불 자동화가 추가될 경우 반드시 별도로 검증합니다.

- 부분/전체 환불 금액
- 세금
- 배송비 배분
- 쿠폰/할인
- 결제 gateway refund capability
- idempotency
- 재시도
- Woo HPOS 호환성
- 세금계산/홈택스 수정 영향

### 7.3 실제 금전 변경

QA에서는 실제 고객 결제, 실제 공급처 주문, 실제 환불, 실제 세금 발행을 실행하지 않습니다. 테스트용 synthetic 데이터나 sandbox를 사용합니다.

---

## 8. Telegram은 운영 Control Plane이다

Telegram은 단순 알림 채널이 아니라 운영자가 최소한의 조작으로 시스템 상태를 확인하고 필요한 승인/명령을 내리는 control plane으로 발전시킵니다.

필수 품질 기준:

- 명령이 실패하면 원인을 명확하게 응답
- `???` 같은 UTF-8/한글 깨짐 금지
- AI worker(Codex/OpenCode 등) 실행 상태 명확화
- timeout과 retry 정책
- 중복 메시지 방지
- 민감정보/API key/token 출력 금지
- 실패 시 Telegram 자체가 silent failure가 되지 않도록 별도 상태 기록

Codex/OpenCode/Telegram runtime 문제는 **실제 실행 service/source path를 먼저 발견한 뒤 수정**합니다. 추측으로 systemd 설정이나 커널 보안 옵션을 바꾸지 않습니다.

특히 `unprivileged_userns`, `bwrap`, sandbox 설정은 서버 전체 보안에 영향을 줄 수 있으므로 진단 없이 완화하지 않습니다.

---

## 9. AI/모델 사용 원칙

AI는 정확도가 필요한 곳에만 사용하고, deterministic parsing/cache로 대체 가능한 곳에는 사용하지 않습니다.

### 9.1 기본 원칙

- 이미 매핑된 상품명/옵션은 cache 재사용
- 단순 정형 parsing은 코드 우선
- 복잡한 상품명 정규화/판단만 AI 사용
- worker는 필요한 최소 context만 제공
- read-only 진단과 write 작업을 분리
- 고비용 모델은 복잡한 cross-layer 작업에만 사용

### 9.2 모델을 선택할 때의 기준

1. 정확성
2. 회귀 위험
3. 비용
4. latency
5. 도구 실행 안정성

가장 비싼 모델을 쓰는 것이 목표가 아니라 **총 운영비 대비 가장 안정적인 결과**가 목표입니다.

---

## 10. UX / 디자인 원칙

### 10.1 Product-first

첫 화면에서 제품 탐색과 실제 사용 기능이 홍보 문구보다 우선합니다.

SEO/AEO용 긴 설명 때문에 상품이 아래로 밀리면 안 됩니다. 검색/AI용 정보는 metadata, JSON-LD, llms.txt, markdown representation 등을 활용합니다.

### 10.2 Mobile-first

고객 다수가 모바일에서 사용할 수 있으므로 다음을 우선합니다.

- 터치 가능한 충분한 버튼 크기
- 화면을 가리는 floating UI 최소화
- 빠른주문/엑셀주문 등 큰 패널은 접기/펼치기 제공
- 사용자가 선택한 UI 상태는 합리적인 범위에서 기억
- 글자 잘림/좌측 쏠림/overflow 금지

### 10.3 디자인 방향

- clean B2B commerce
- operational clarity
- trustworthy marketplace
- modern commerce dashboard
- 과도한 농장/전통시장/럭셔리 연출 지양

예쁜 UI보다 **찾기 쉽고 주문 실수를 줄이는 UI**를 우선합니다.

---

## 11. SEO · AEO · GEO · Agentic readiness

검색과 AI discoverability는 중요하지만 운영/상품 UX보다 앞서지 않습니다.

### 반드시 지킬 것

- 실제 HTTP status 사용(404를 200으로 위장하지 않음)
- canonical/lang/OG/schema 정확성
- 사람에게 보이지 않는 거짓 SEO 문구 금지
- fake review, fake transaction count, fake seller count 금지
- AI crawler가 읽을 수 있는 llms.txt/markdown/robots 정책 유지
- 내부 검색/checkout/account 등은 적절히 noindex
- Product schema는 WooCommerce와 중복 충돌하지 않도록 단일 ownership

Agent에게 공개되지 않은 도매가, 공급처 이름, 내부 원가를 추론하도록 유도하지 않습니다.

---

## 12. 보안·개인정보 원칙

- `.env`, API key, bot token, 비밀번호 출력 금지
- 로그/진단 report는 credential value를 포함하지 않는다
- customer/order ownership 검증
- IDOR 방지
- 업로드는 MIME/실제 이미지 decode/확장자/크기 검증
- 고객 증빙은 public Media URL로 노출하지 않는다
- 민감한 admin action은 인증/권한/idempotency/audit trail 필요

보안 문제를 편의성 때문에 완화하지 않습니다.

---

## 13. 개발 시작 전 필수 절차

모든 AI/개발자는 이전 대화의 기억을 최신 코드 상태로 가정하면 안 됩니다.

작업 시작 시:

1. GitHub `main` 최신 SHA 확인
2. 관련 파일/최근 PR/최근 commit 확인
3. `PROJECT_NORTH_STAR.md` 읽기
4. `AGENTS.md` 읽기
5. `AI_HANDOFF.md`의 현재 운영 상태 확인
6. Production과 GitHub가 다를 가능성 확인
7. 변경 범위와 rollback 지점 결정

다른 AI나 개발자가 중간에 수정했을 가능성을 항상 전제로 합니다.

---

## 14. 변경 및 배포 원칙

### 14.1 Backup first

운영에 영향을 줄 수 있는 변경 전에는 복구 지점을 만듭니다.

- Git backup branch 또는 명시적 commit
- Production 파일 backup
- DB를 변경한다면 비파괴적 schema migration과 백업

### 14.2 금지 Git 명령

작업 중 기존 변경을 잃을 수 있는 다음 행위를 함부로 실행하지 않습니다.

- `git reset --hard` (배포 전용 clone 제외)
- `git clean`
- `git checkout .`
- `stash apply/pop/drop` 무단 실행
- 기존 작업 삭제

### 14.3 배포 방식

가능하면 다음 순서를 자동화합니다.

**preflight → backup → surgical deploy → syntax/lint → runtime health → public smoke → rollback on failure → deployed SHA 기록**

배포 전용 clone은 `origin/main`으로 강제 동기화해도 되지만 개발 작업 폴더에는 적용하지 않습니다.

---

## 15. 테스트 기준

변경된 행동마다 최소 하나의 검증이 있어야 합니다.

### 저위험 UI

- syntax/lint
- relevant unit/contract test
- mobile/desktop rendering check

### 크롤링/카탈로그

- fixture/parser test
- count/sanity gate
- duplicate/mapping test
- dry-run
- production-safe smoke

### 인증/파일/CS

- 정상 경로
- 권한 없는 사용자
- cross-user
- duplicate/retry
- malicious input
- private direct access

### 결제/환불/세금

- sandbox/synthetic E2E
- idempotency
- partial failure/retry
- immutable snapshot
- no real money movement during QA

“코드가 들어갔다”는 완료가 아닙니다. **실제 동작을 검증해야 완료입니다.**

---

## 16. 개선 우선순위 평가표

새 개선안을 선택할 때 아래 항목으로 평가합니다.

| 기준 | 비중 | 질문 |
|---|---:|---|
| 운영 안전 / 회귀 위험 | 25 | 장애, 잘못된 가격/주문/환불을 줄이는가? |
| 사용자 가치 / 시간 절약 | 20 | 고객 또는 운영자의 반복 작업을 크게 줄이는가? |
| 자동화 / 관측성 | 15 | 사람이 먼저 발견하지 않아도 감지·처리 가능한가? |
| 수익성 / 비용 | 10 | 마진 개선 또는 AI/API/운영비 절감 효과가 있는가? |
| 보안 / 개인정보 | 10 | 보안 경계를 강화하거나 최소한 유지하는가? |
| UX / 모바일 사용성 | 10 | 더 빠르고 실수 없이 사용할 수 있는가? |
| SEO/AEO/GEO/Agentic | 5 | 검색/AI에서 정확히 발견되는가? |
| 유지보수성 | 5 | 다른 AI/개발자가 이해하고 안전하게 이어갈 수 있는가? |

운영 안전 점수가 낮은 기능은 총점이 높아도 배포하지 않습니다.

---

## 17. Definition of Done

기능은 다음이 충족되어야 완료로 봅니다.

- 요구사항이 실제 고객/운영 문제와 연결됨
- 기존 로직을 먼저 감사함
- 최소 변경으로 구현함
- 관련 테스트가 추가/수정됨
- CI가 green
- 비밀정보가 코드/로그에 없음
- Production 배포 전 backup/rollback 경로 확인
- 실제 public/runtime smoke 통과
- 금전/주문 기능이면 synthetic/sandbox 검증
- `AI_HANDOFF.md`에 현재 상태 반영
- 이 문서의 원칙 또는 우선순위가 바뀌었다면 `PROJECT_NORTH_STAR.md`도 같은 PR에서 갱신

---

## 18. 문서 유지 규칙

이 문서는 한 번 만들고 끝내는 문서가 아닙니다.

다음 변경이 생기면 **코드와 같은 PR에서 이 문서도 업데이트**합니다.

- 제품의 최종 목표 변경
- 주요 고객/비즈니스 모델 변경
- 공급처 수집 정책 변경
- 가격/마진 정책 변경
- 주문/결제/환불 자동화 범위 변경
- Telegram/AI control plane 구조 변경
- 보안 경계 변경
- 운영자가 직접 해야 하는 일의 범위 변경
- 개발/배포/검증 기준 변경

단순 버그 수정처럼 North Star 자체가 바뀌지 않는 경우에는 이 문서를 억지로 수정하지 않고 `AI_HANDOFF.md`만 업데이트할 수 있습니다.

---

## 19. 현재 실행 우선순위 — 2026-08-28

현재 우선순위는 다음과 같습니다.

1. **Telegram → Codex/OpenCode 실행 오류 해결**
   - 실제 MiniPC process/systemd/source path 발견
   - UTF-8 깨짐 원인 확인
   - bwrap/user namespace 문제를 보안 완화 없이 정확히 수정
   - OpenCode DeepSeek isolated smoke 통과
   - Telegram 실제 명령 E2E 통과

2. **빠른주문 / 엑셀 대량주문 UI 개선 Production 확인**
   - 접기/펼치기 동작
   - mobile 기본 collapsed
   - desktop 기본 expanded
   - 실제 주문 URL/결제 로직 불변 확인

3. **공급처 카탈로그 자동화 신뢰성**
   - Daily 신규 상품 누락 방지
   - 수집 실패/지연 Telegram 경보
   - watchdog과 last-known-good 검증

4. **운영 가시성**
   - last success / count delta / failure stage를 한 화면 또는 Telegram에서 확인
   - silent failure 제거

5. **검색/AI 발견성의 실운영 확인**
   - Search Console / Bing / Naver 등록
   - sitemap/index baseline 측정
   - 상품 탐색 UX를 해치지 않는 범위에서만 개선

---

## 20. 절대 금지 목록

명시적 승인이 없는 한 다음을 하지 않습니다.

- 실제 공급처 자동 주문/결제
- 실제 고객 환불
- 실제 세금 발행
- 공개 신규 상품의 무검토 대량 publish
- 상품/variation 대량 삭제
- 과거 주문 변경
- 고객 화면에 공급처 실명/원가/source ID 노출
- 비밀키 출력/커밋
- CAPTCHA/보안 우회
- fake review/fake seller count/fake transaction data
- 테스트를 통과시키기 위해 실제 안전장치를 제거

---

## 21. 개발자/AI의 기본 보고 형식

세부 로그를 사용자가 요청하지 않는 한 최종 보고는 짧게 유지합니다.

- **완료**: 실제로 반영한 것
- **검증**: 테스트/CI/Production 확인 결과
- **다음 단계**: 남은 가장 중요한 일
- **사용자가 해줄 일**: 계정/권한/실서버 실행 등 사용자가 직접 해야만 하는 것만

사용자에게 할 일을 넘기기 전에 AI가 스스로 할 수 있는 GitHub 분석, 코드 수정, 테스트, 문서화, PR, CI 확인은 먼저 수행합니다.

---

## 22. 변경 기록

### 2026-08-28 — Initial North Star

- 기존 대화와 현재 운영 상태를 기준으로 도매Hub의 목적·기획·개선 기준을 단일 문서로 통합.
- 자동화 우선, 안전한 카탈로그 통합, 공급처 비공개, mobile-first UX, Telegram control plane, 비용 최적화, SEO/AEO/GEO/Agentic, backup/rollback/testing 기준을 명시.
- 이후 주요 제품/운영 정책 변경 시 코드와 함께 이 문서를 갱신하도록 규칙화.
