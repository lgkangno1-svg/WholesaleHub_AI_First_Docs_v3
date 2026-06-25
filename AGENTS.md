# AGENTS.md

Codex와 Antigravity가 WholesaleHub 프로젝트를 구현할 때 반드시 지켜야 할 공통 지침이다.

## 절대 원칙

- 고객 화면에는 공급처 정보, 원가, 최저 공급처, 가격 비교 결과를 노출하지 않는다.
- AdminPlus 계열 자동주문은 구현하지 않는다.
- AdminPlus 계열 가격 수집은 매일 오전 11시 1회로 제한한다.
- 거래처 제공 Google Sheet, Excel, CSV 링크가 있으면 이를 최우선 데이터 소스로 사용한다.
- Playwright는 최후의 수단이다.
- 숨겨진 API 분석, 토큰 분석, CAPTCHA 우회, 차단 우회는 구현하지 않는다.
- 상품 상세 설명, 이미지, 리뷰, 디자인 요소를 복제하지 않는다.
- 상품명 정규화는 Gemini Flash를 우선 사용한다.
- 매핑 캐시에 이미 존재하는 상품명은 AI 호출 없이 재사용한다.
- Qwen 2.5B 로컬 모델은 평가/실험용으로만 둔다.

## 권장 구현 스택

- Node.js + TypeScript
- SQLite
- Playwright
- n8n
- WooCommerce REST API
- Gemini API
