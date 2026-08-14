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

  it("keeps AdminPlus at 11 KST and uses a Walldo-only secondary run", async () => {
    const script = await readFile("scripts/n8n-mvp-sync.sh", "utf8")
    expect(script).toContain('if [ "$RUN_HOUR" != "11" ] && [ "$RUN_HOUR" != "18" ]')
    expect(script).toContain('mkdir "$ADMINPLUS_RUN_DIR/$RUN_DATE"')
    expect(script).toContain('if [ "$RUN_HOUR" = "18" ] || [ "$SECONDARY_ONLY" = "1" ]')
    expect(script).toContain("collect_walldob2b_catalog")
  })

  it("splits the active catalog runner into one AdminPlus run and two Walldo runs", async () => {
    const script = await readFile("scripts/n8n-supplier-catalog-sync.sh", "utf8")
    expect(script).toContain('if [ "$RUN_HOUR" != "11" ] && [ "$RUN_HOUR" != "18" ]')
    expect(script).toContain('mkdir "$ADMINPLUS_RUN_DIR/$RUN_DATE"')
    expect(script).toContain("verify_reusable_dailyfood_snapshot")
    expect(script).toContain("collect-dailyfood-catalog.mjs")
    expect(script).toContain("collect-walldob2b-catalog.mjs")
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
