import type {
  AdminPlusCollectedProduct,
  AdminPlusPageCollector,
  AdminPlusRunGate,
  AdminPlusSiteConfig,
} from "./types.js"

export class AdminPlusLimitedAdapter {
  constructor(
    private readonly site: AdminPlusSiteConfig,
    private readonly pageCollector: AdminPlusPageCollector,
    private readonly runGate: AdminPlusRunGate,
  ) {}

  async collect(date: string, signal?: AbortSignal): Promise<readonly AdminPlusCollectedProduct[]> {
    return this.runGate.runOnce(this.site.supplierId, date, () =>
      this.pageCollector.collect(this.site, signal),
    )
  }
}
