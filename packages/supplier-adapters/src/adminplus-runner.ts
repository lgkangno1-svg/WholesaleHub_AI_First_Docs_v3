import { z } from "zod"
import { loadAdminPlusSitesConfig } from "./adminplus-config.js"
import { AdminPlusLimitedAdapter } from "./adminplus-limited-adapter.js"
import { PlaywrightAdminPlusPageCollector } from "./adminplus-playwright-collector.js"
import { AdminPlusDailyLimitError, JsonFileAdminPlusRunGate } from "./adminplus-run-gate.js"

const EnvironmentSchema = z.object({
  ADMINPLUS_CONFIG_PATH: z.string().min(1).default("config/suppliers/adminplus.sites.yml"),
  ADMINPLUS_BROWSER_ENDPOINT: z.url().default("http://browserless:3000"),
  ADMINPLUS_RUN_STATE_PATH: z.string().min(1).default("data/adminplus-runs.json"),
})

type SiteRunResult =
  | {
      readonly supplierId: string
      readonly status: "collected"
      readonly products: readonly {
        readonly productName: string
        readonly optionText: string | null
        readonly price: number
        readonly stockStatus: string
        readonly productUrl: string | null
      }[]
    }
  | {
      readonly supplierId: string
      readonly status: "disabled" | "already_collected_today"
      readonly products: readonly []
    }

async function run(): Promise<void> {
  const environment = EnvironmentSchema.parse(process.env)
  const config = await loadAdminPlusSitesConfig(environment.ADMINPLUS_CONFIG_PATH)
  const collector = new PlaywrightAdminPlusPageCollector({
    browserEndpoint: environment.ADMINPLUS_BROWSER_ENDPOINT,
  })
  const gate = new JsonFileAdminPlusRunGate(environment.ADMINPLUS_RUN_STATE_PATH)
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.schedule.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
  const results: SiteRunResult[] = []
  for (const site of config.sites) {
    if (!site.enabled) {
      results.push({ supplierId: site.supplierId, status: "disabled", products: [] })
      continue
    }
    try {
      const products = await new AdminPlusLimitedAdapter(site, collector, gate).collect(date)
      results.push({ supplierId: site.supplierId, status: "collected", products })
    } catch (error) {
      if (error instanceof AdminPlusDailyLimitError) {
        results.push({
          supplierId: site.supplierId,
          status: "already_collected_today",
          products: [],
        })
        continue
      }
      throw error
    }
  }
  console.log(JSON.stringify({ mode: "adminplus-limited-collect", date, results }))
}

// no-excuse-ok: catch - CLI process boundary reports the error and exits non-zero.
run().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
