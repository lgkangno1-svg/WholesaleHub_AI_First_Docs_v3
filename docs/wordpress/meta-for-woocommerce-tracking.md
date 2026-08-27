# Meta for WooCommerce tracking and B2B privacy

## Production baseline (2026-08-27)

- Plugin: Meta for WooCommerce `3.7.6`, active.
- Connection: not completed.
- Pixel, native CAPI/S2S, Catalog, and ad account: not configured.
- Business Manager bootstrap data exists, but no identifiers or tokens are recorded here.
- Other storefront Pixel implementations: none active. CTX Feed contains optional Facebook Pixel code, but its Pixel ID is empty and tracking is disabled in effect. Site Kit has Analytics 4 and PageSpeed Insights only; Tag Manager is not active.
- CTX Feed Facebook catalog feeds: `0` configured.
- Existing Meta Catalog product count: not applicable until Meta connection is completed. Existing remote catalog products must never be bulk-deleted without explicit approval.

## B2B Catalog policy

`wordpress/mu-plugins/wholesalehub-meta-policy.php` keeps Meta tracking independent from commerce publishing:

- blocks full batch API product sync with `facebook_for_woocommerce_block_full_batch_api_sync`;
- forces effective global product sync off with `wc_facebook_is_product_sync_enabled`;
- rejects every product and variation with `wc_facebook_should_sync_product`;
- persists the Meta product-sync, legacy/new product-feed, and Meta-managed-coupon options as `no`;
- removes `checkout_url` if product data ever reaches the preparation filter;
- removes an existing legacy product-feed schedule during initial policy enforcement;
- does not disable Meta Pixel or native CAPI event tracking.

Do not enable Shop product synchronization, Facebook/Instagram Checkout, or Meta-managed coupons during Meta onboarding. The remote Meta UI remains authoritative for Checkout and Shop visibility, so this is also a required manual connection choice.

## CompleteRegistration definition

The event is armed only when all of the following are true:

- the request is a public WooCommerce registration `POST` with a valid WooCommerce registration nonce;
- the account role is `customer`;
- `_avo_approval_status` is `pending`;
- all required WholesaleHub business profile fields were stored;
- `_wh_meta_complete_registration_sent` does not exist.

Because the site logs the pending customer out in `woocommerce_registration_redirect`, a 15-minute, HttpOnly, Secure, SameSite=Lax browser token links the successful signup request to the next frontend page. Only a hash of that token is stored. The first eligible page acquires an atomic, expiring per-customer claim, uses Meta for WooCommerce's public `WC_Facebookcommerce_Pixel::inject_event()` API, and then permanently records `_wh_meta_complete_registration_sent`. The ownership-aware claim prevents concurrent page requests from emitting the same event and can recover safely after an interrupted request.

Event payload:

```text
CompleteRegistration
status=pending_approval
registration_type=b2b_wholesale
```

No name, email, phone, address, business registration number, supplier name, supplier ID, source URL, or wholesale price is included. Admin-created users, WP-CLI users, validation failures, logins, refreshes, and approval-state changes do not qualify.

Meta for WooCommerce `3.7.6` does not expose a supported public custom CAPI API. CompleteRegistration is therefore browser-only. Private properties, reflection, Pixel IDs, access tokens, and CAPI tokens are not used. Native PageView, ViewContent, ViewCategory, Search, AddToCart, InitiateCheckout, and Purchase CAPI behavior remains owned by the official plugin.

## UTM naming

Base URL:

```text
https://hub.avocadoss.co.kr/?utm_source=instagram&utm_medium=paid_social&utm_campaign=wholesalehub_launch&utm_content=reel_platform_01
```

Allowed `utm_content` values for the first campaign:

- `reel_platform_01`
- `reel_excel_01`
- `reel_price_01`

Site Kit/GA4 already collects campaign parameters; do not create duplicate custom storage.

## Measurement funnel

```text
Instagram paid_social
  -> PageView / ViewContent / Search
  -> CompleteRegistration (pending approval, browser once)
  -> administrator approval
  -> AddToCart
  -> InitiateCheckout
  -> Purchase (official plugin native browser + CAPI dedupe)
```

## Privacy and consent

The configured `/privacy` page currently does not mention Meta/Facebook Pixel, cookies, or marketing tracking. No CMP plugin is active. Do not add a fake consent UI. Before paid traffic starts, the operator must approve an accurate privacy/cookie disclosure and decide whether a real CMP is required; then verify that the official plugin honors its consent state before sending signals.

## Verification

Automated test: `php tests/wholesalehub-meta-policy.test.php`.

The test verifies catalog filters, stored option enforcement, Checkout URL removal, normal signup qualification, admin and validation false positives, approved non-PII payload keys, the sent marker, replay/refresh deduplication, concurrent-request exclusion, stale-claim recovery, and ownership-safe claim deletion.

After Meta authorization, use Events Manager Test Events with synthetic data only:

1. Verify one PageView on home, one ViewContent on a product, one Search, one AddToCart, and one InitiateCheckout.
2. Complete one synthetic B2B registration and verify exactly one CompleteRegistration.
3. Refresh and attempt login; verify no second registration event.
4. Create a synthetic admin-side user and submit an invalid registration; verify zero registration events.
5. Modify only a synthetic product and verify no Meta product/variation payload or price is sent.
6. Use a safe synthetic/test order path only; never spend real money merely to test Purchase.

## Remaining manual Meta steps

1. WordPress → Marketing → Facebook → Get Started.
2. Sign in to Meta and choose the existing Business Portfolio.
3. Choose the existing Facebook Page and Instagram account.
4. Choose the current ad account.
5. Choose the existing WholesaleHub Pixel/Dataset, or create exactly one if none exists.
6. Keep Shop product sync, Meta-managed coupons, and Facebook/Instagram Checkout off.
7. Complete the connection and open Events Manager → Test Events.
8. Approve the privacy/cookie wording and CMP decision before paid traffic.
9. Run the synthetic event checklist above; never use a real order or payment.
