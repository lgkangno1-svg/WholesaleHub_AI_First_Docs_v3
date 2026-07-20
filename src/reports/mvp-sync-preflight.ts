import { z } from "zod"

const SummarySchema = z.object({
  runFailed: z.boolean(),
  failureReasons: z.array(z.string()).default([]),
  dailyFoodOptionCount: z.number().int(),
  walldob2bOptionCount: z.number().int(),
  wooProductCount: z.number().int(),
  wooVariationCount: z.number().int(),
})

const PlanSchema = z.object({ summary: SummarySchema })

export type MvpSyncPreflightResult = {
  readonly ok: boolean
  readonly destructive: boolean
  readonly reasons: readonly string[]
  readonly dailyFoodOptionCount: number
  readonly walldob2bOptionCount: number
  readonly wooProductCount: number
  readonly wooVariationCount: number
}

export function validateMvpSyncPreflight(
  value: unknown,
  options: { readonly destructive: boolean },
): MvpSyncPreflightResult {
  const { summary } = PlanSchema.parse(value)
  const reasons = [...summary.failureReasons]
  const minimumDailyFood = options.destructive ? 380 : 350

  if (summary.runFailed && reasons.length === 0) reasons.push("plan_reported_failure")
  if (summary.dailyFoodOptionCount < minimumDailyFood)
    reasons.push(`dailyfood_options_below_${minimumDailyFood}`)
  if (summary.dailyFoodOptionCount > 700) reasons.push("dailyfood_options_above_700")
  if (summary.walldob2bOptionCount < 180) reasons.push("walldob2b_options_below_180")
  if (summary.walldob2bOptionCount > 240) reasons.push("walldob2b_options_above_240")
  if (summary.wooProductCount <= 0) reasons.push("woocommerce_products_empty")
  if (summary.wooVariationCount <= 0) reasons.push("woocommerce_variations_empty")

  return {
    ok: reasons.length === 0,
    destructive: options.destructive,
    reasons: [...new Set(reasons)],
    dailyFoodOptionCount: summary.dailyFoodOptionCount,
    walldob2bOptionCount: summary.walldob2bOptionCount,
    wooProductCount: summary.wooProductCount,
    wooVariationCount: summary.wooVariationCount,
  }
}
