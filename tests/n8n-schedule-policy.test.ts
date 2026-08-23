import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("WholesaleHub scheduled collection policy", () => {
  it("runs the active-workflow export fallback at 11 and 18 KST", async () => {
    const root = JSON.parse(
      await readFile("docs/n8n-wholesalehub-mvp-sync.workflow.json", "utf8"),
    ) as Record<string, { nodes?: Array<{ type?: string; parameters?: unknown }> }>
    const workflow = Object.values(root)[0]
    const cron = workflow?.nodes?.find((node) => node.type === "n8n-nodes-base.cron") as
      | {
          parameters?: {
            triggerTimes?: {
              item?: Array<{ hour?: number; minute?: number }>
              timezone?: string
            }
          }
        }
      | undefined

    expect(cron?.parameters?.triggerTimes?.item).toEqual([
      { mode: "everyDay", hour: 11, minute: 0 },
      { mode: "everyDay", hour: 18, minute: 0 },
    ])
    expect(cron?.parameters?.triggerTimes?.timezone).toBe("Asia/Seoul")
  })

  it("keeps the legacy MVP wrapper permanently non-destructive", async () => {
    const script = await readFile("scripts/n8n-mvp-sync.sh", "utf8")

    expect(script).toContain(
      'skip_step delete_source_absent "permanent Woo product/variation deletion is disabled by production safety policy"',
    )
    expect(script).not.toContain("run_step delete_source_absent")
    expect(script).toContain('ALLOW_STOCK_VISIBILITY_SYNC="${WHOLESALEHUB_ALLOW_STOCK_VISIBILITY_SYNC:-0}"')
  })

  it("refreshes DailyFood when the source changes without a date-directory skip gate", async () => {
    const script = await readFile("scripts/n8n-supplier-catalog-sync.sh", "utf8")

    expect(script).toContain("check-dailyfood-freshness.mjs")
    expect(script).toContain('freshness_changed=$(node -e')
    expect(script).toContain('FORCE_FULL_DAILY="${WHOLESALEHUB_FORCE_FULL_DAILY:-0}"')
    expect(script).toContain("verify_reusable_dailyfood_snapshot")
    expect(script).toContain("mark_dailyfood_success")
    expect(script).toContain("collect-dailyfood-catalog.mjs")
    expect(script).toContain("collect-walldob2b-catalog.mjs")
    expect(script).toContain("flock -n 9")
    expect(script).not.toContain('mkdir "$ADMINPLUS_RUN_DIR/$RUN_DATE"')
  })

  it("never assigns the AdminPlus common image and keeps image-less parents private", async () => {
    const incremental = await readFile("scripts/supplier-catalog/sync-woocommerce-catalog.php", "utf8")
    const rebuild = await readFile("scripts/supplier-catalog/rebuild-woocommerce-catalog.php", "utf8")
    expect(incremental).not.toContain("$product->set_image_id(2905)")
    expect(rebuild).not.toContain("$product->set_image_id(2905)")
    expect(incremental).toContain("$image_id > 0 && $image_id !== 2905 ? 'publish' : 'private'")
    expect(rebuild).toContain("$image_id > 0 && $image_id !== 2905 ? 'publish' : 'private'")
  })
})
