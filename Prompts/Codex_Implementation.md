# Codex Implementation Prompt

```txt
WholesaleHub 문서를 읽고 Phase 1 MVP를 구현해줘.

중요:
- Cursor/Claude Code 관련 설정은 만들지 마.
- AdminPlus 자동주문은 구현하지 마.
- AdminPlus 가격 수집은 매일 오전 11시 1회 제한 설정만 포함해.
- DailyFood Google Sheet adapter를 가장 먼저 구현해.
- 거래처 제공 Excel/CSV link adapter를 두 번째로 구현해.
- 고객에게 공급처 정보가 노출되지 않게 API와 WooCommerce sync를 설계해.
- SQLite schema는 sql/schema.sql을 기준으로 만들어.
- 모든 adapter는 SupplierAdapter interface를 따르게 해.
```
