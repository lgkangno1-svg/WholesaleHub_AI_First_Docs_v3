# 08. Product Normalization

## 문제

공급처마다 같은 상품을 서로 다른 이름으로 표기한다.

예:

```txt
미백 찰옥수수 특품 30개
국산 찰옥수수 미백 30입
찰옥수수 특품 1망
```

## 정규화 결과 예시

```json
{
  "normalized_name": "미백 찰옥수수",
  "grade": "특품",
  "origin": "국내산",
  "quantity": 30,
  "unit": "개",
  "weight_value": null,
  "weight_unit": null,
  "option_key": "국내산|특품|30개",
  "confidence": 0.93
}
```

## 우선순위

1. `product_mapping` 캐시 조회
2. 룰 기반 숫자/중량/단위 추출
3. Gemini Flash 파싱
4. 관리자 승인
5. 승인된 결과를 캐시에 저장

## 비교 기준

동일 비교 그룹은 다음이 같아야 한다.

```txt
normalized_name
grade
origin
quantity + unit
weight_value + weight_unit
option_key
```
