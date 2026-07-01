# WooCommerce category archive product visibility fix

Date: 2026-07-01
Live path: `/var/www/html/wp-content/themes/astra-child/style.css`

## Issue

WooCommerce category archive pages such as `/product-category/농산물/` and `/product-category/과일/` rendered the product loop HTML, but product cards were invisible. The global rule below applied to all WooCommerce product loops:

```css
.products .product {
    opacity: 0;
    transform: translateY(30px);
}
```

The matching reveal rule depended on a `.reveal-active` ancestor, which exists on homepage reveal sections but not on WooCommerce category archive pages.

## Live Fix

The animation rule was scoped to homepage reveal sections only:

```css
.reveal-element .products .product { ... }
.reveal-element.reveal-active .products .product { ... }
.reveal-element .products .product:nth-child(...) { ... }
```

This keeps homepage entrance animation behavior while making category archive product cards visible by default.

## Verification

- `/product-category/농산물/`: first 12 product cards visible, first card opacity `1`.
- `/product-category/과일/`: first 12 product cards visible, first card opacity `1`.
- Product data, price, stock, order data unchanged.
