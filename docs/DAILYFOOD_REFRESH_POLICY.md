# DailyFood catalog freshness policy

## Objective

DailyFood must not reuse an earlier same-day catalog snapshot in a way that hides products or options added after the first crawl.

For every configured supplier-catalog synchronization run, both DailyFood and Walldo are refreshed before catalog grouping and WooCommerce synchronization.

## Behavior

### Existing approved product / option

A fresh supplier crawl can update the existing WooCommerce representation for supported fields such as:

- price;
- stock status;
- shipping policy;
- source/spec metadata used by the supplier lane.

### Newly discovered product

A product that has no approved parent mapping is staged into the supplier-lane approval workflow. It must not be silently published as a new public WooCommerce product.

The normal result is a Telegram approval/mapping request so the operator can link it to an existing product, create a new product through the approved flow, hold it, or exclude it.

### Newly discovered option

An option that is not yet approved is staged as `pending_option` and routed to the Telegram approval flow. It must not silently attach itself to a public product without the mapping/approval rules.

## Freshness rule

Do not restore the old behavior:

`11 KST full DailyFood crawl -> later runs reuse the 11 KST snapshot`

That pattern can miss a new DailyFood product or option uploaded later in the day.

The required behavior is:

`configured catalog run -> fresh DailyFood crawl -> fresh Walldo crawl -> grouping -> Woo sync -> Telegram summary/approval`

The exact timer cadence is controlled separately. This policy does not change timer times; it changes what DailyFood does whenever the catalog sync actually runs.

## Load control

Correctness takes priority over same-day snapshot reuse. The DailyFood collector already reuses previously successful per-option image detail evidence when the export shape allows it, so refreshing the catalog does not imply blindly redownloading every image detail on every run.

If a future optimization introduces a lightweight change detector, it must prove that it can detect new products, new options, price changes, stock changes, and relevant shipping/spec changes before it is allowed to skip the full DailyFood collection. A detector that can miss any of these changes must not replace the fresh crawl.

## Telegram reporting

The catalog completion message should make it visible that DailyFood was refreshed on that run and should continue to report at least:

- collected products;
- newly created/staged products;
- price updates;
- stock updates;
- pending new-product approvals;
- pending new-option approvals;
- failures/review-required counts.
