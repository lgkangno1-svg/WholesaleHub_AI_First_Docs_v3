import { expect, it } from "vitest"
import { readFileSync } from "node:fs"

const tax = readFileSync(
  "wordpress/plugins/avocadoss-supplier-order-export/includes/class-wholesalehub-monthly-tax-export.php",
  "utf8",
)
const snapshot = readFileSync(
  "wordpress/plugins/avocadoss-supplier-order-export/includes/class-wholesalehub-tax-snapshot.php",
  "utf8",
)
const perf = readFileSync(
  "wordpress/plugins/avocadoss-performance/avocadoss-performance.php",
  "utf8",
)

it("explicit consideration mode gates TAXABLE auto-issue instead of Woo prices_include_tax", () => {
  expect(tax).toContain("_wh_taxable_consideration_mode")
  expect(tax).toContain("VAT_INCLUDED")
  expect(tax).toContain("VAT_EXCLUDED_SEPARATE")
  expect(tax).toContain("UNCONFIRMED")
  expect(tax).toContain("tax-config")
  expect(tax).toContain("set-consideration-mode")
  expect(tax).not.toContain("prices_include_tax")
  expect(tax).not.toContain("woocommerce_tax_rates")
})

it("VAT_INCLUDED splits supply = gross × 100/110 with zero difference", () => {
  expect(tax).toContain("$gross * 100.0 / 110.0")
  expect(tax).toContain("$gross - $supply")
})

it("TAXABLE with unconfirmed amount stays out of HomeTax auto-issue", () => {
  expect(tax).toContain("TAX_AMOUNT_REVIEW_REQUIRED")
  expect(tax).toContain("amount_confirmed")
  expect(tax).toContain("VAT 별도 수취 증거 없음")
})

it("captures business profile fields 업태/종목/세금계산서 이메일", () => {
  expect(perf).toContain("_avo_business_type")
  expect(perf).toContain("_avo_business_item")
  expect(perf).toContain("_avo_tax_email")
  expect(perf).toContain("avo_business_company")
  expect(perf).toContain("업태")
  expect(perf).toContain("종목")
  expect(perf).toContain("세금계산서 이메일")
  expect(perf).toContain("woocommerce_edit_account_form")
  expect(perf).toContain("woocommerce_save_account_details")
})

it("captures immutable business snapshot into order meta at checkout", () => {
  expect(snapshot).toContain("_wh_business_number")
  expect(snapshot).toContain("_wh_business_company")
  expect(snapshot).toContain("_wh_business_representative")
  expect(snapshot).toContain("_wh_business_address")
  expect(snapshot).toContain("_wh_business_type")
  expect(snapshot).toContain("_wh_business_item")
  expect(snapshot).toContain("_wh_business_tax_email")
  expect(snapshot).toContain("_wh_business_snapshot_at")
  expect(snapshot).toContain("woocommerce_checkout_create_order")
})

it("captures immutable tax snapshot into order-item meta at checkout", () => {
  expect(snapshot).toContain("_wh_tax_document_type")
  expect(snapshot).toContain("_wh_tax_classification_source")
  expect(snapshot).toContain("_wh_tax_consideration_mode")
  expect(snapshot).toContain("_wh_tax_supply_amount")
  expect(snapshot).toContain("_wh_tax_vat_amount")
  expect(snapshot).toContain("_wh_tax_gross_amount")
  expect(snapshot).toContain("_wh_tax_captured_at")
  expect(snapshot).toContain("woocommerce_checkout_create_order_line_item")
})

it("captures supply date from the completed fulfillment event, not date_paid", () => {
  expect(snapshot).toContain("woocommerce_order_status_completed")
  expect(snapshot).toContain("_wh_tax_supply_at")
  expect(snapshot).toContain("_wh_tax_supply_source")
  expect(snapshot).toContain("'completed'")
})

it("supply-date fallback chain: item → order → completed proxy → date_paid legacy", () => {
  expect(tax).toContain("SUPPLY_DATE_PROXY")
  expect(tax).toContain("LEGACY_SUPPLY_DATE_FALLBACK")
  expect(tax).toContain("supply_legacy")
  expect(tax).toContain("supply_proxy")
})

it("month boundary uses supply_at day, not payment day", () => {
  expect(tax).toContain("$supply_day < $start_date || $supply_day > $end_date")
})

it("tracks refunds with id/created/order/period/net/vat/gross/type", () => {
  expect(tax).toContain("collect_refunds")
  expect(tax).toContain("refund_id")
  expect(tax).toContain("created_at")
  expect(tax).toContain("original_period")
  expect(tax).toContain("created_period")
  expect(tax).toContain("line_ids")
  expect(tax).toContain("POST_PERIOD_REFUND_REVIEW")
})

it("same-period refund nets; post-period refund never auto-nets", () => {
  expect(tax).toContain("same_period")
  expect(tax).toContain("apply_refunds")
  expect(tax).toContain("자동상계 금지")
  expect(tax).toContain("post_period_refund_count")
})

it("input_hash includes snapshots, refunds, and consideration mode", () => {
  expect(tax).toContain("'rows' => $rows")
  expect(tax).toContain("'refunds' => $refunds")
  expect(tax).toContain("'consideration_mode' => $this->consideration_mode()")
})

it("business profile conflict flags BUSINESS_PROFILE_CONFLICT", () => {
  expect(tax).toContain("BUSINESS_PROFILE_CONFLICT")
  expect(tax).toContain("동일 사업자번호의 상호/대표자/주소 핵심정보 상충")
})

it("classification review excel import supports dry-run and exact variation_id", () => {
  expect(tax).toContain("import-review")
  expect(tax).toContain("import_review_file")
  expect(tax).toContain("dry_run")
  expect(tax).toContain("확정 분류")
  expect(tax).toContain("비고")
})

it("HomeTax row writes business type/item into 공급받는자 업태/종목 columns", () => {
  expect(tax).toContain("$row[15] = $doc['business_type']")
  expect(tax).toContain("$row[16] = $doc['business_item']")
})
