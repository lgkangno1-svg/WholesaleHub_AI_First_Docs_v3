# 00. Project Overview

## 프로젝트명

WholesaleHub

## 구현 대상

- 고객 쇼핑몰: `hub.avocadoss.co.kr`
- 플랫폼: WordPress + WooCommerce
- 운영 환경: Mini PC + Docker
- 자동화: n8n self-hosted
- 저장소: SQLite
- 데이터 수집: Google Sheets, Excel/CSV 링크, 공개 HTML, 제한적 Playwright
- AI 정규화: Gemini Flash
- 실험 모델: Qwen 2.5B 로컬

## 프로젝트 목적

여러 도매 공급처가 제공하는 가격 정보를 수집하고, 상품명을 AI로 정규화한 뒤, 동일 품목/동일 옵션/동일 중량 기준으로 최저 공급처를 내부적으로 판단한다.

최저 공급처 정보는 고객에게 노출하지 않고, WooCommerce 상품 운영에만 사용한다.

## 핵심 비즈니스 흐름

```txt
공급처 가격표/공개 상품 목록
→ n8n 주기 실행
→ 공급처별 Adapter 수집
→ SQLite raw_products 저장
→ 상품명 정규화
→ 매핑 캐시 저장
→ 최저가 계산
→ WooCommerce 상품 가격/재고 반영
→ 고객 주문
```

## MVP 제외 기능

- 가격 이력 저장
- 가격 차이 표시
- 가격변동 알림
- 카카오 알림톡
- 공급처 신뢰도 점수
- AdminPlus 자동주문
- 고객 화면의 공급처 공개
