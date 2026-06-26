# WF-003 AdminPlus Limited Crawl

## Trigger

```txt
0 11 * * *
```

## 목적

AdminPlus 계열 공급처의 가격만 하루 1회 수집한다.

## Nodes

1. Cron Trigger at 11:00 Asia/Seoul
2. Check supplier enabled
3. Execute AdminPlusLimitedAdapter
4. Validate result
5. Save raw_products
6. Trigger normalization
7. Trigger price engine

## Safety

- No auto order
- No cart
- No payment
- No hidden API
- Stop on security warning

## 구현 파일

- `workflows/WF-003_AdminPlus_Limited_Crawl.json`
- `config/suppliers/adminplus.sites.yml`
- `packages/supplier-adapters/src/adminplus-runner.ts`

## 공급처 추가

`adminplus.sites.yml`의 `sites` 항목을 복사하고 목록 URL, 허용 호스트, CSS selector를
입력한다. 확인이 끝날 때까지 `enabled: false`를 유지한다. 로그인이 필요한 사이트는
사용자가 직접 만든 Playwright storage state 파일 경로만 지정하며 로그인 자동화는 하지 않는다.

예약 실행과 n8n 화면의 수동 실행은 동일한 runner와 일일 실행 기록을 사용한다. 따라서 수동
실행도 공급처별 하루 1회 제한을 우회할 수 없다.
