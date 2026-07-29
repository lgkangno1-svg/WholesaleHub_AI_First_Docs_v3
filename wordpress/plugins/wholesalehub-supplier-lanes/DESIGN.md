# Supplier Lane Product UI

## Existing visual system

The plugin extends the active WooCommerce product page instead of introducing a
separate application shell. Its frontend surface uses the existing Option A
card language from `assets/supplier-lanes.css`:

- neutral panel: `#f9fafb`, `#e5e7eb`, 12px radius;
- white purchase cards with 10px radius and restrained shadow;
- blue `#2563eb` for selected spec controls;
- green `#16a34a` / `#dcfce7` for the lowest product-price distinction;
- text hierarchy from `#111827` through `#6b7280`;
- native WooCommerce `.button.alt` cart actions.

The adaptive implementation must preserve these tokens and the surrounding
theme typography. Supplier or source identities remain represented only by the
privacy-safe `판매조건 A/B` labels.

## Components

- `.wh-supplier-lanes`: shared purchase surface.
- `.wh-spec-dropdown`: MODE 2 normalized-spec selector.
- `.wh-spec-filters` and `.wh-spec-pill`: MODE 3 dependent dimension controls.
- `.wh-selection-status`: incomplete or zero-match status message.
- `.wh-offer-results`: live offer-result region.
- `.wh-condition-card`: purchasable offer. A single match uses
  `.wh-compact-purchase`; two or more matches use `.wh-comparison-grid`.
- `.wh-badge-lowest`: shown once, and only when two or more exact matches exist.

## Modes and states

1. `single-offer`: no selector; one compact purchase panel is immediately
   available.
2. `single-supplier`: one native `규격 선택` dropdown; no supplier badge and no
   purchase panel until an offer is selected.
3. `multi-supplier`: only normalized dimensions present in the offers are
   rendered. No offer is visible before every rendered dimension is selected.

Each selector state is derived from persisted normalized values supplied by
PHP. The browser never parses the public label. Exact matching compares every
rendered variation-level dimension: grade/size, weight, count, and packaging.
Product-level metadata such as variety, origin, and storage never becomes a
purchase selector. Dependent controls hide values incompatible with current
other selections and clear a selection when it becomes invalid.

## Interaction and accessibility

- Controls use native buttons/selects with visible labels.
- Selected pills use `aria-pressed="true"` and `.active`.
- Incompatible pills are both hidden and disabled.
- Result/status changes are announced through `aria-live="polite"`.
- Focus rings remain visible; minimum control height is 44px.
- At 640px and below, controls and cards occupy one column without horizontal
  overflow.

## Cart identity contract

Every purchase form is server-rendered with its original parent product,
privacy-safe lane, public offer key, and variation ID as diagnostic DOM data.
The submitted cart fields remain `product_id`, `wh_lane`,
`wh_public_offer_key`, and `quantity`; existing server validation remains the
authority for variation, price, stock, ownership, and cross-lane protection.
