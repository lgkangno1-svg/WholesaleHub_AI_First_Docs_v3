# 07. AdminPlus Limited Crawling

## 정책

AdminPlus 계열 공급처는 자동주문을 구현하지 않는다. 가격 수집이 꼭 필요한 경우 하루 1회, 오전 11시에만 실행한다.

## 목적

- 공급처 가격 확인
- 상품명/옵션/가격/재고 상태 수집
- 내부 최저가 계산에만 사용

## 금지

- 자동주문
- 장바구니 자동 입력
- 결제/예치금 자동 처리
- 숨겨진 API 분석
- 토큰 분석
- CAPTCHA 우회
- 차단 우회
- 상세 HTML/이미지/리뷰 수집

## 스케줄

```yaml
schedule:
  timezone: Asia/Seoul
  run_at: "11:00"
  frequency: daily
  max_runs_per_day: 1
```

n8n Cron 표현 예시:

```txt
0 11 * * *
```

## 수집 필드

```txt
product_name
option_text
price
stock_status
product_url
```

## 안전 장치

- concurrency: 1
- page delay: 3~8초 랜덤
- request timeout: 30초
- max pages per supplier 제한
- 실패 시 재시도 1회까지만
- 로그인 실패 시 즉시 중단
- 차단/보안 경고 페이지 감지 시 즉시 중단
