import ky from "ky"
import { parseDailyFoodCsv } from "./dailyfood-csv.js"
import type { DailyFoodSupplierConfig, RawProduct } from "./types.js"

export class DailyFoodFetchError extends Error {
  readonly name = "DailyFoodFetchError"

  constructor(
    readonly csvExportUrl: string,
    options?: ErrorOptions,
  ) {
    super(`Failed to fetch DailyFood CSV export: ${csvExportUrl}`, options)
  }
}

export class DailyFoodGoogleSheetAdapter {
  constructor(private readonly config: DailyFoodSupplierConfig) {}

  async collect(signal?: AbortSignal): Promise<readonly RawProduct[]> {
    const signalOption = signal === undefined ? {} : { signal }
    let csv: string
    try {
      csv = await ky
        .get(this.config.googleSheet.csvExportUrl, {
          retry: { limit: 2 },
          timeout: 30_000,
          ...signalOption,
        })
        .text()
    } catch (error) {
      throw new DailyFoodFetchError(this.config.googleSheet.csvExportUrl, { cause: error })
    }
    return parseDailyFoodCsv(csv, this.config)
  }
}
