# 11. WooCommerce Integration

## 목적

`hub.avocadoss.co.kr` WooCommerce 상품과 내부 최저가 계산 결과를 동기화한다.

## 동기화 대상

- 판매가
- 재고 상태
- 품절 여부
- 내부 메타데이터

## 고객에게 노출하지 않는 메타

- supplier_id
- supplier_name
- source_url
- raw_cost
- cheapest_supplier
- compare_result

## 가격 정책

내부 원가 그대로 판매가로 쓰지 않는다. 별도 마진 룰을 적용할 수 있도록 한다.

```txt
sale_price = cheapest_cost + margin_rule
```

MVP에서는 마진 룰을 설정값으로 둔다.
