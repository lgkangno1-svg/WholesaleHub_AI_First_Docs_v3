# 14. Playwright Framework

## 목적

Playwright는 최후 수단이다. 특히 AdminPlus 계열은 가격 수집만 제한적으로 수행한다.

## 구조

```txt
packages/supplier-adapters/
  base/
    SupplierAdapter.ts
    types.ts
  google-sheet/
    DailyFoodGoogleSheetAdapter.ts
  excel-csv/
    ExcelCsvLinkAdapter.ts
  public-html/
    PublicHtmlAdapter.ts
  adminplus/
    AdminPlusLimitedAdapter.ts
```

## Base Adapter Interface

```ts
export interface SupplierAdapter {
  supplierId: string;
  sourceType: string;
  collect(): Promise<RawProduct[]>;
}
```

## AdminPlusLimitedAdapter 제약

- `collect()`는 상품 목록/가격만 반환한다.
- 주문/장바구니/결제 관련 메서드는 존재하지 않는다.
- URL allowlist를 사용한다.
- 금지 URL 접근 시 즉시 throw한다.
