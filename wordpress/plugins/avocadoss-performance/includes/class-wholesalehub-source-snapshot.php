<?php
/**
 * Immutable variation-level supplier source snapshots.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WholesaleHub_Source_Snapshot {
	private const DEFAULT_DB_PATH = '/var/www/html/wp-content/uploads/wholesalehub/wholesalehub.sqlite';

	public static function init() {
		add_action( 'woocommerce_new_order_item', array( __CLASS__, 'capture_order_item' ), 20, 3 );
	}

	public static function capture_order_item( $item_id, $item, $order_id ) {
		if ( ! $item instanceof WC_Order_Item_Product ) {
			return;
		}

		try {
			$database = self::database();
			if ( ! $database ) {
				self::store_unmapped( null, $item_id, $order_id, $item, 'snapshot_database_unavailable' );
				return;
			}

			$variation_id = (int) $item->get_variation_id();
			$product_id   = (int) $item->get_product_id();
			$link_id      = $variation_id > 0 ? $variation_id : $product_id;
			$query        = $database->prepare(
				'SELECT
					link.woo_product_id,
					link.woo_variation_id,
					link.canonical_variant_id,
					link.selected_offer_id,
					trace.atomic_supplier_sku_id,
					trace.supplier_id,
					product.supplier_product_id,
					option_row.supplier_option_id,
					product.original_title,
					option_row.original_option_name,
					product.detail_url,
					offer.final_cost,
					offer.shipping_fee,
					trace.is_purchasable
				FROM woo_variation_offer_links AS link
				JOIN selected_offer_trace AS trace
					ON trace.canonical_variant_id = link.canonical_variant_id
					AND trace.selected_offer_id = link.selected_offer_id
				JOIN normalized_offers AS offer
					ON offer.normalized_offer_id = link.selected_offer_id
				JOIN atomic_supplier_skus AS sku
					ON sku.atomic_sku_id = offer.atomic_sku_id
				JOIN supplier_products AS product
					ON product.supplier_product_id = sku.supplier_product_id
				JOIN supplier_options AS option_row
					ON option_row.supplier_option_id = sku.supplier_option_id
				WHERE link.woo_variation_id = :variation_id
				LIMIT 1'
			);
			$query->execute( array( ':variation_id' => $link_id ) );
			$source = $query->fetch( PDO::FETCH_ASSOC );
			if ( ! $source || 1 !== (int) $source['is_purchasable'] ) {
				self::store_unmapped( $database, $item_id, $order_id, $item, 'variation_offer_link_missing_or_unpurchasable' );
				return;
			}

			$insert = $database->prepare(
				'INSERT OR IGNORE INTO woo_order_item_source_snapshots (
					woo_order_item_id, woo_order_id, canonical_variant_id,
					selected_offer_id, atomic_supplier_sku_id, supplier_id,
					supplier_product_id, supplier_option_id, supplier_cost_snapshot,
					shipping_fee_snapshot, unit_payable_snapshot,
					line_payable_snapshot, shipping_included_snapshot,
					selected_at, woo_product_id,
					woo_variation_id, supplier_original_product_title,
					supplier_original_option_name, source_url, quantity, snapshot_status
				) VALUES (
					:woo_order_item_id, :woo_order_id, :canonical_variant_id,
					:selected_offer_id, :atomic_supplier_sku_id, :supplier_id,
					:supplier_product_id, :supplier_option_id, :supplier_cost_snapshot,
					:shipping_fee_snapshot, :unit_payable_snapshot,
					:line_payable_snapshot, :shipping_included_snapshot,
					:selected_at, :woo_product_id,
					:woo_variation_id, :original_product_title,
					:original_option_name, :source_url, :quantity, "mapped"
				)'
			);
			$insert->execute(
				array(
					':woo_order_item_id'       => (int) $item_id,
					':woo_order_id'            => (int) $order_id,
					':canonical_variant_id'    => $source['canonical_variant_id'],
					':selected_offer_id'       => $source['selected_offer_id'],
					':atomic_supplier_sku_id'  => $source['atomic_supplier_sku_id'],
					':supplier_id'             => $source['supplier_id'],
					':supplier_product_id'     => $source['supplier_product_id'],
					':supplier_option_id'      => $source['supplier_option_id'],
					':supplier_cost_snapshot'  => (int) $source['final_cost'],
					':shipping_fee_snapshot'   => (int) $source['shipping_fee'],
					':unit_payable_snapshot'   => (int) $source['final_cost'],
					':line_payable_snapshot'   => (int) $source['final_cost'] * (float) $item->get_quantity(),
					':shipping_included_snapshot' => 1,
					':selected_at'             => gmdate( 'c' ),
					':woo_product_id'          => $product_id,
					':woo_variation_id'        => $variation_id,
					':original_product_title'  => $source['original_title'],
					':original_option_name'    => $source['original_option_name'],
					':source_url'              => (string) $source['detail_url'],
					':quantity'                => (float) $item->get_quantity(),
				)
			);
		} catch ( Throwable $error ) {
			error_log( 'WholesaleHub source snapshot failed: ' . $error->getMessage() );
			self::store_unmapped( isset( $database ) ? $database : null, $item_id, $order_id, $item, 'snapshot_exception' );
		}
	}

	private static function store_unmapped( $database, $item_id, $order_id, $item, $reason ) {
		if ( $database ) {
			$insert = $database->prepare(
				'INSERT OR IGNORE INTO woo_order_item_source_unmapped (
					woo_order_item_id, woo_order_id, woo_product_id, woo_variation_id,
					quantity, snapshot_status, reason, selected_at
				) VALUES (?, ?, ?, ?, ?, "source_unmapped", ?, ?)'
			);
			$insert->execute(
				array(
					(int) $item_id,
					(int) $order_id,
					(int) $item->get_product_id(),
					(int) $item->get_variation_id(),
					(float) $item->get_quantity(),
					(string) $reason,
					gmdate( 'c' ),
				)
			);
			if ( 0 === $insert->rowCount() ) {
				return;
			}
		}
		if ( function_exists( 'avocadoss_send_telegram_message' ) ) {
			avocadoss_send_telegram_message(
				sprintf(
					"⚠️ 공급처 미연결 주문\n주문 #%d / 항목 #%d\n결제는 차단하지 않았습니다.",
					(int) $order_id,
					(int) $item_id
				)
			);
		}
	}

	private static function database() {
		if ( ! extension_loaded( 'pdo_sqlite' ) ) {
			return null;
		}
		$path = defined( 'WHOLESALEHUB_SQLITE_PATH' )
			? WHOLESALEHUB_SQLITE_PATH
			: self::DEFAULT_DB_PATH;
		if ( ! is_readable( $path ) || ! is_writable( $path ) ) {
			return null;
		}
		$database = new PDO( 'sqlite:' . $path );
		$database->setAttribute( PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION );
		$database->exec( 'PRAGMA foreign_keys = ON' );
		$database->exec( 'PRAGMA busy_timeout = 5000' );
		return $database;
	}
}

WholesaleHub_Source_Snapshot::init();

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	WP_CLI::add_command(
		'avocadoss telegram-wholesalehub-summary',
		function ( $args ) {
			$path = isset( $args[0] ) ? $args[0] : '';
			if ( ! $path || ! is_readable( $path ) ) {
				WP_CLI::error( 'summary file is required' );
			}
			$summary = json_decode( file_get_contents( $path ), true );
			if ( ! is_array( $summary ) ) {
				WP_CLI::error( 'invalid summary JSON' );
			}
			$message = sprintf(
				"WholesaleHub 동기화 완료\nDaily %d/%d\nincomplete: %s\n신규 Woo 초안: %d\nmissing_options: %d\nsource_mismatch: %d\n신규 variation link: %d\nsource_unmapped 주문: %d",
				(int) ( $summary['dailyCollected'] ?? 0 ),
				(int) ( $summary['dailyExpected'] ?? 0 ),
				! empty( $summary['incomplete'] ) ? 'yes' : 'no',
				(int) ( $summary['newDraftCount'] ?? 0 ),
				(int) ( $summary['missingOptionsCount'] ?? 0 ),
				(int) ( $summary['sourceMismatchCount'] ?? 0 ),
				(int) ( $summary['newVariationLinkCount'] ?? 0 ),
				(int) ( $summary['sourceUnmappedOrderCount'] ?? 0 )
			);
			if ( ! function_exists( 'avocadoss_send_telegram_message' ) || ! avocadoss_send_telegram_message( $message ) ) {
				WP_CLI::error( 'telegram send failed' );
			}
			WP_CLI::success( 'WholesaleHub summary sent' );
		}
	);
}
