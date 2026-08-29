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

  it("screens Woo order-export eligibility without invoking the mutating exporter", () => {
    expect(shell).toContain("ORDER EXPORT SCREENING (READ ONLY)")
    expect(shell).toContain("wc_get_orders")
    expect(shell).toContain("_wholesalehub_supplier_sent_at")
    expect(shell).toContain('"unsent_mapped_lines"=>0')
    expect(shell).toContain('"ORDER_SCREEN_" . strtoupper($key)')
    expect(shell).toContain("NO_MUTATION=YES")
    expect(shell).not.toContain("supplier-order-export --")
    expect(shell).not.toContain("wp avocadoss supplier-order-export")
    expect(shell).not.toContain("wc_create_refund")
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
