<?php
/**
 * Immutable business/tax snapshots on order creation + supply-date capture.
 *
 * - Captures the customer business profile into order meta at checkout.
 * - Captures tax classification + consideration mode into order-item meta.
 * - Captures the authoritative supply timestamp on fulfillment events.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Avocadoss_WholesaleHub_Tax_Snapshot {
	private const TAX_DOCUMENT_TYPES = array( 'TAXABLE', 'EXEMPT', 'ZERO_RATED', 'UNCLASSIFIED' );

	public static function register() {
		add_action( 'woocommerce_checkout_create_order', array( __CLASS__, 'capture_business_snapshot' ), 30, 1 );
		add_action( 'woocommerce_checkout_create_order_line_item', array( __CLASS__, 'capture_tax_snapshot' ), 30, 4 );
		add_action( 'woocommerce_order_status_completed', array( __CLASS__, 'capture_supply_at_on_completed' ), 20, 2 );
	}

	public static function capture_business_snapshot( $order ) {
		if ( ! $order instanceof WC_Order ) {
			return;
		}
		$uid = (int) $order->get_user_id();
		if ( $uid <= 0 ) {
			return;
		}
		if ( '' !== (string) $order->get_meta( '_wh_business_number', true ) ) {
			return;
		}
		$number = self::normalize_business_number( (string) get_user_meta( $uid, '_avo_business_number', true ) );
		if ( '' === $number ) {
			return;
		}
		$order->update_meta_data( '_wh_business_number', $number );
		$order->update_meta_data( '_wh_business_company', (string) get_user_meta( $uid, 'billing_company', true ) );
		$order->update_meta_data( '_wh_business_representative', (string) get_user_meta( $uid, 'billing_first_name', true ) );
		$order->update_meta_data( '_wh_business_address', trim( (string) get_user_meta( $uid, 'billing_address_1', true ) . ' ' . (string) get_user_meta( $uid, 'billing_address_2', true ) ) );
		$order->update_meta_data( '_wh_business_type', (string) get_user_meta( $uid, '_avo_business_type', true ) );
		$order->update_meta_data( '_wh_business_item', (string) get_user_meta( $uid, '_avo_business_item', true ) );
		$order->update_meta_data( '_wh_business_tax_email', (string) get_user_meta( $uid, '_avo_tax_email', true ) );
		$order->update_meta_data( '_wh_business_snapshot_at', current_time( 'mysql', true ) );
	}

	public static function capture_tax_snapshot( $item, $cart_item_key, $values, $order ) {
		if ( ! $item instanceof WC_Order_Item_Product ) {
			return;
		}
		$variation_id = absint( $values['variation_id'] ?? 0 );
		$product_id   = absint( $values['product_id'] ?? 0 );
		$target       = $variation_id ?: $product_id;
		$type         = (string) get_post_meta( $target, '_wh_tax_document_type', true );
		if ( ! in_array( $type, self::TAX_DOCUMENT_TYPES, true ) ) {
			$type = 'UNCLASSIFIED';
		}
		$item->add_meta_data( '_wh_tax_document_type', $type, true );
		$item->add_meta_data( '_wh_tax_classification_source', 'product', true );
		$item->add_meta_data( '_wh_tax_consideration_mode', self::consideration_mode(), true );
		$item->add_meta_data( '_wh_tax_captured_at', current_time( 'mysql', true ), true );
		$gross = (float) $item->get_total();
		if ( 'EXEMPT' === $type || 'ZERO_RATED' === $type ) {
			$item->add_meta_data( '_wh_tax_supply_amount', $gross, true );
			$item->add_meta_data( '_wh_tax_vat_amount', 0, true );
			$item->add_meta_data( '_wh_tax_gross_amount', $gross, true );
		} elseif ( 'VAT_INCLUDED' === self::consideration_mode() ) {
			$supply = (int) round( $gross * 100.0 / 110.0 );
			$vat    = (int) round( $gross ) - $supply;
			$item->add_meta_data( '_wh_tax_supply_amount', $supply, true );
			$item->add_meta_data( '_wh_tax_vat_amount', $vat, true );
			$item->add_meta_data( '_wh_tax_gross_amount', (int) round( $gross ), true );
		}
	}

	public static function capture_supply_at_on_completed( $order_id, $order ) {
		if ( ! $order instanceof WC_Order ) {
			$order = wc_get_order( $order_id );
		}
		if ( ! $order ) {
			return;
		}
		if ( '' !== (string) $order->get_meta( '_wh_tax_supply_at', true ) ) {
			return;
		}
		$completed = $order->get_date_completed();
		$order->update_meta_data( '_wh_tax_supply_at', $completed ? $completed->date( 'Y-m-d H:i:s' ) : current_time( 'mysql', true ) );
		$order->update_meta_data( '_wh_tax_supply_source', 'completed' );
		$order->save();
	}

	private static function consideration_mode() {
		$mode = strtoupper( trim( (string) get_option( '_wh_taxable_consideration_mode', 'UNCONFIRMED' ) ) );
		return in_array( $mode, array( 'VAT_INCLUDED', 'VAT_EXCLUDED_SEPARATE', 'UNCONFIRMED' ), true ) ? $mode : 'UNCONFIRMED';
	}

	private static function normalize_business_number( $value ) {
		return preg_replace( '/[^0-9]/', '', (string) $value );
	}
}

Avocadoss_WholesaleHub_Tax_Snapshot::register();
