import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("WholesaleHub scheduled collection policy", () => {
  it("schedules the active workflow at 09, 15 and 21 KST", async () => {
    const root = JSON.parse(
      await readFile("docs/n8n-wholesalehub-mvp-sync.workflow.json", "utf8"),
    ) as Record<string, { nodes?: Array<{ type?: string; parameters?: unknown }> }>
    const workflow = Object.values(root)[0]
    const cron = workflow?.nodes?.find((node) => node.type === "n8n-nodes-base.cron") as
      | {
          parameters?: {
            triggerTimes?: {
              item?: Array<{ mode?: string; hour?: number; minute?: number }>
              timezone?: string
            }
          }
        }
      | undefined

    expect(cron?.parameters?.triggerTimes?.item).toEqual([
      { mode: "everyDay", hour: 9, minute: 0 },
      { mode: "everyDay", hour: 15, minute: 0 },
      { mode: "everyDay", hour: 21, minute: 0 },
    ])
    expect(cron?.parameters?.triggerTimes?.timezone).toBe("Asia/Seoul")
  })

  it("allows 09 KST draft creation only when explicitly enabled", async () => {
    const script = await readFile("scripts/n8n-mvp-sync.sh", "utf8")
    expect(script).toContain('RUN_HOUR="${WHOLESALEHUB_RUN_HOUR:-')
    expect(script).toContain('if [ "$RUN_HOUR" = "09" ] && [ "$ALLOW_DRAFT_CREATE" = "1" ]; then')
    expect(script).toContain("run_step collect_and_plan")
  })

  it("refreshes both supplier catalogs on each configured 09, 15 and 21 KST run", async () => {
    const script = await readFile("scripts/n8n-supplier-catalog-sync.sh", "utf8")
    expect(script).toContain('if [ "$RUN_HOUR" != "09" ] && [ "$RUN_HOUR" != "15" ] && [ "$RUN_HOUR" != "21" ] && [ "$SECONDARY_ONLY" != "1" ]; then')
    expect(script).toContain("start_step dailyfood_collect")
    expect(script).toContain("start_step walldob2b_collect")
    expect(script).toContain("collect-dailyfood-catalog.mjs")
    expect(script).toContain("collect-walldob2b-catalog.mjs")
    expect(script).not.toContain("verify_reusable_dailyfood_snapshot")
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
