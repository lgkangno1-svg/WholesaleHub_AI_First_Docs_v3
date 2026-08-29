import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const shell = readFileSync("scripts/operations-health-diagnose.sh", "utf8")
const powershell = readFileSync("scripts/operations-health-diagnose.ps1", "utf8")

describe("WholesaleHub operations health diagnostic", () => {
  it("checks both supplier snapshots using the current schedule policy", () => {
    expect(shell).toContain("dailyfood-catalog-snapshot.json")
    expect(shell).toContain("walldob2b-catalog-snapshot.json")
    expect(shell).toContain("WALLDO_EXPECTED_NOT_BEFORE")
    expect(shell).toContain("EXPECTED_PREVIOUS_18_SNAPSHOT_BEFORE_13")
    expect(shell).toContain("EXPECTED_11_SNAPSHOT_AFTER_13")
    expect(shell).toContain("EXPECTED_18_SNAPSHOT_AFTER_20")
  })

  it("mirrors the real supplier exporter candidate and sent-dedupe rules", () => {
    expect(shell).toContain("ORDER EXPORT SCREENING (READ ONLY, EXPORTER-ALIGNED)")
    expect(shell).toContain("woo_order_item_source_snapshots")
    expect(shell).toContain("supplier_order_export_items")
    expect(shell).toContain("supplier_order_export_batches")
    expect(shell).toContain('s.snapshot_status = \\"mapped\\"')
    expect(shell).toContain('b.status = \\"sent\\"')
    expect(shell).toContain("_wh_source_supplier_id")
    expect(shell).toContain("wc_get_orders")
    expect(shell).toContain("ORDER_SCREEN_TOTAL_PENDING_PRE_0700_ROWS")
    expect(shell).toContain("ORDER_SCREEN_CURRENT_SOURCE_UNMAPPED_ORDERS")
  })

  it("enforces query-only SQLite and never invokes mutating order paths", () => {
    expect(shell).toContain("PRAGMA query_only = ON")
    expect(shell).toContain("NO_MUTATION=YES")
    expect(shell).not.toContain("supplier-order-export --")
    expect(shell).not.toContain("wp avocadoss supplier-order-export")
    expect(shell).not.toContain("wc_create_refund")
    expect(shell).not.toContain("mark_sent(")
    expect(shell).not.toContain("INSERT INTO supplier_order_export")
    expect(shell).not.toContain("UPDATE supplier_order_export")
  })

  it("does not expose customer/order IDs or secret values in its report", () => {
    expect(shell).not.toContain("get_billing_email")
    expect(shell).not.toContain("get_billing_phone")
    expect(shell).not.toContain("get_order_number")
    expect(shell).not.toContain("BOT_TOKEN")
    expect(shell).not.toContain("API_KEY")
  })

  it("provides one Windows wrapper that saves a Desktop report", () => {
    expect(powershell).toContain("operations-health-diagnose.sh")
    expect(powershell).toContain("scp -q")
    expect(powershell).toContain("ssh $SshHost")
    expect(powershell).toContain("Tee-Object -FilePath $report")
    expect(powershell).toContain("WHOLESALEHUB_OPERATIONS_DIAGNOSTIC_COMPLETE")
  })
})
