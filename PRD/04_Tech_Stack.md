# 04. Tech Stack

## Runtime

- Node.js 20+
- TypeScript
- Docker Compose
- n8n self-hosted
- SQLite
- Playwright
- Gemini Flash API
- WordPress + WooCommerce REST API

## SQLite 선택 이유

상품 200개 이하, 공급처 5~6개, 최신 데이터만 유지하는 구조에서는 SQLite로 충분하다.

## Gemini Flash 선택 이유

상품명 파싱은 짧은 텍스트 구조화 작업이므로 Gemini Flash가 비용과 속도 측면에서 적합하다.

## Qwen 2.5B

로컬 실행 가능성은 있으나 한국어 농산물/식품 옵션 파싱 정확도 검증 전까지 실전 기본값으로 사용하지 않는다.
