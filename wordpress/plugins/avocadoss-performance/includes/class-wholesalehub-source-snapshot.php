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

		$variation_id     = (int) $item->get_variation_id();
		$product_id       = (int) $item->get_product_id();
		$target_id        = $variation_id > 0 ? $variation_id : $product_id;
		$supplier_id      = (string) get_post_meta( $target_id, '_wh_internal_supplier_id', true );
		$source_product_id = (string) get_post_meta( $target_id, '_wh_source_product_id', true );
		$source_option_id = (string) get_post_meta( $target_id, '_wh_source_option_id', true );
		if ( '' === $supplier_id || '' === $source_product_id ) {
			self::store_unmapped( null, $item_id, $order_id, $item, 'live_supplier_meta_missing' );
			return;
		}

		$original = self::original_names( $supplier_id, $source_product_id, $source_option_id );
		if ( '' === $original['title'] ) {
			self::store_unmapped( null, $item_id, $order_id, $item, 'original_source_names_missing' );
			return;
		}

		$item->update_meta_data( '_wh_source_supplier_id', $supplier_id );
		$item->update_meta_data( '_wh_source_product_id', $source_product_id );
		$item->update_meta_data( '_wh_source_option_id', $source_option_id );
		$item->update_meta_data( '_wh_source_original_title', $original['title'] );
		$item->update_meta_data( '_wh_source_original_option_name', $original['option'] );
		$item->update_meta_data( '_wh_source_quantity', (float) $item->get_quantity() );
		$item->save();

		try {
			$database = self::database();
			if ( ! $database ) {
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
					':canonical_variant_id'    => '',
					':selected_offer_id'       => '',
					':atomic_supplier_sku_id'  => '',
					':supplier_id'             => $supplier_id,
					':supplier_product_id'     => $source_product_id,
					':supplier_option_id'      => $source_option_id,
					':supplier_cost_snapshot'  => 0,
					':shipping_fee_snapshot'   => 0,
					':unit_payable_snapshot'   => 0,
					':line_payable_snapshot'   => 0,
					':shipping_included_snapshot' => 1,
					':selected_at'             => gmdate( 'c' ),
					':woo_product_id'          => $product_id,
					':woo_variation_id'        => $variation_id,
					':original_product_title'  => $original['title'],
					':original_option_name'    => $original['option'],
					':source_url'              => '',
					':quantity'                => (float) $item->get_quantity(),
				)
			);
		} catch ( Throwable $error ) {
			// The legacy SQLite snapshot table is FK-coupled to a retired
			// normalization schema; the authoritative snapshot now lives in
			// order-item meta, so a SQLite write failure is non-fatal.
			error_log( 'WholesaleHub snapshot sqlite mirror skipped: ' . $error->getMessage() );
		}
	}

	private static function original_names( $supplier_id, $source_product_id, $source_option_id ) {
		$is_walldo = 'walldob2b' === $supplier_id || 'walldo' === $supplier_id;
		$dir       = defined( 'WHOLESALEHUB_SNAPSHOT_DIR' )
			? WHOLESALEHUB_SNAPSHOT_DIR
			: WP_CONTENT_DIR . '/uploads/wholesalehub';
		$path      = $dir . '/' . ( $is_walldo ? 'walldob2b-catalog-snapshot.json' : 'dailyfood-catalog-snapshot.json' );
		if ( ! is_readable( $path ) ) {
			return array( 'title' => '', 'option' => '' );
		}
		$snapshot = json_decode( (string) file_get_contents( $path ), true );
		$products = is_array( $snapshot ) && isset( $snapshot['products'] ) && is_array( $snapshot['products'] )
			? $snapshot['products']
			: ( is_array( $snapshot ) ? $snapshot : array() );
		foreach ( $products as $product ) {
			if ( (string) ( $product['sourceProductId'] ?? '' ) !== (string) $source_product_id ) {
				continue;
			}
			$option = '';
			foreach ( (array) ( $product['options'] ?? array() ) as $option_row ) {
				if ( (string) ( $option_row['sourceOptionId'] ?? '' ) === (string) $source_option_id ) {
					$option = (string) ( $option_row['optionName'] ?? $option_row['publicOptionLabel'] ?? '' );
					break;
				}
			}
			return array(
				'title'  => (string) ( $product['productName'] ?? '' ),
				'option' => $option,
			);
		}
		return array( 'title' => '', 'option' => '' );
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
