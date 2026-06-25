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
