# WooCommerce customer product page cleanup notes

Applied outside this repo:
`/home/tnfwod/avocadoss-wordpress/wp_data/wp-content/plugins/avocadoss-performance/avocadoss-performance.php`

Backup before edit:
`/home/tnfwod/avocadoss-wordpress/wp_data/wp-content/plugins/avocadoss-performance/avocadoss-performance.php.bak-20260627-b2b-filter-sort`

What it does:
- Hides B2B automation/source text from customer-facing product content, short description, Rank Math description, OpenGraph descriptions, and JSON-LD strings.
- Keeps internal meta such as `_b2b_source`, `_b2b_walldo_it_id`, `_b2b_option_name` untouched.
- Sorts single-attribute variable product options by similar option group first, then final customer variation price ascending.
- Keeps option label price display based on WooCommerce variation customer price only.

Do not expose:
- supplier name
- source/original URL
- raw cost / wholesale cost
- internal comparison fields

Do not modify:
- product price
- stock
- orders/payments/deposits
- supplier collection pipeline
