<?php
/**
 * Plugin Name: Avocadoss Product Identity
 * Description: Displays and validates crawler source and SKU integrity for WooCommerce products.
 */

defined( 'ABSPATH' ) || exit;

function avocadoss_product_identity_normalize_source( $value ) {
	$value = strtolower( trim( (string) $value ) );
	if ( false !== strpos( $value, 'daily' ) ) {
		return 'dailyfood';
	}
	if ( false !== strpos( $value, 'walldo' ) ) {
		return 'walldob2b';
	}
	if ( false !== strpos( $value, 'fafa' ) ) {
		return 'fafane';
	}
	return '';
}

function avocadoss_product_identity_source( $product_id ) {
	$stored = avocadoss_product_identity_normalize_source( get_post_meta( $product_id, '_b2b_source', true ) );
	if ( $stored ) {
		return $stored;
	}

	$sources = array();
	if ( get_post_meta( $product_id, '_b2b_dailyfood_pcode', true ) ) {
		$sources[] = 'dailyfood';
	}
	if ( get_post_meta( $product_id, '_b2b_walldo_it_id', true ) ) {
		$sources[] = 'walldob2b';
	}
	$product = wc_get_product( $product_id );
	if ( $product && 0 === strpos( (string) $product->get_sku(), 'FAF-' ) ) {
		$sources[] = 'fafane';
	}
	if ( $product ) {
		foreach ( $product->get_children() as $variation_id ) {
			foreach ( array( '_supplier_id', '_wholesalehub_supplier_id', '_wholesalehub_selected_supplier_id' ) as $key ) {
				$source = avocadoss_product_identity_normalize_source( get_post_meta( $variation_id, $key, true ) );
				if ( $source ) {
					$sources[] = $source;
					break;
				}
			}
		}
	}
	$sources = array_values( array_unique( $sources ) );
	return 1 === count( $sources ) ? $sources[0] : '';
}

function avocadoss_product_identity_source_ids( $product_id, $source = '' ) {
	$source = $source ? avocadoss_product_identity_normalize_source( $source ) : avocadoss_product_identity_source( $product_id );
	$ids    = array();
	foreach ( array( '_wholesalehub_source_product_id', '_source_product_id' ) as $key ) {
		$value = trim( (string) get_post_meta( $product_id, $key, true ) );
		if ( $value ) {
			$ids[] = $value;
		}
	}
	if ( 'dailyfood' === $source ) {
		$value = trim( (string) get_post_meta( $product_id, '_b2b_dailyfood_pcode', true ) );
		if ( $value ) {
			$ids[] = $value;
		}
	} elseif ( 'walldob2b' === $source ) {
		$value = trim( (string) get_post_meta( $product_id, '_b2b_walldo_it_id', true ) );
		if ( $value ) {
			$ids[] = $value;
		}
	} elseif ( 'fafane' === $source ) {
		$product = wc_get_product( $product_id );
		if ( $product && 0 === strpos( (string) $product->get_sku(), 'FAF-' ) ) {
			$ids[] = $product->get_sku();
		}
	}

	$product = wc_get_product( $product_id );
	if ( $product ) {
		foreach ( $product->get_children() as $variation_id ) {
			$variation_source = '';
			foreach ( array( '_supplier_id', '_wholesalehub_supplier_id', '_wholesalehub_selected_supplier_id' ) as $key ) {
				$variation_source = avocadoss_product_identity_normalize_source( get_post_meta( $variation_id, $key, true ) );
				if ( $variation_source ) {
					break;
				}
			}
			if ( $source && $variation_source !== $source ) {
				continue;
			}
			foreach ( array( '_wholesalehub_source_product_id', '_source_product_id' ) as $key ) {
				$value = trim( (string) get_post_meta( $variation_id, $key, true ) );
				if ( $value ) {
					$ids[] = $value;
				}
			}
		}
	}
	if ( empty( $ids ) && avocadoss_product_identity_option_provenance_complete( $product_id ) ) {
		$product = wc_get_product( $product_id );
		if ( $product ) {
			foreach ( $product->get_children() as $variation_id ) {
				$value = trim( (string) get_post_meta( $variation_id, '_wh_source_product_id', true ) );
				if ( $value ) {
					$ids[] = $value;
				}
			}
		}
	}
	return array_values( array_unique( array_filter( $ids ) ) );
}

function avocadoss_product_identity_active_ids() {
	return get_posts(
		array(
			'post_type'      => 'product',
			'post_status'    => array( 'publish', 'draft', 'private', 'pending', 'future' ),
			'posts_per_page' => -1,
			'fields'         => 'ids',
			'orderby'        => 'ID',
			'order'          => 'ASC',
		)
	);
}

/**
 * Option-level provenance check (supplier-lane architecture).
 * A product passes when every SELLABLE variation carries its full crawl
 * provenance (supplier + source product id + source option id). Variations
 * that are not purchasable/in stock are exempt — dead options cannot reach
 * the supplier order export.
 */
function avocadoss_product_identity_option_provenance_complete( $product_id ) {
	$product = wc_get_product( $product_id );
	if ( ! $product ) {
		return false;
	}
	$children = $product->get_children();
	if ( empty( $children ) ) {
		return false;
	}
	foreach ( $children as $variation_id ) {
		$variation = wc_get_product( $variation_id );
		if ( ! $variation || ! $variation->is_purchasable() || ! $variation->is_in_stock() ) {
			continue;
		}
		foreach ( array( '_supplier_id', '_wh_source_product_id', '_wh_source_option_id' ) as $key ) {
			if ( ! trim( (string) get_post_meta( $variation_id, $key, true ) ) ) {
				return false;
			}
		}
	}
	return true;
}

function avocadoss_product_identity_title_key( $product_id ) {
	$title = mb_strtolower( (string) get_the_title( $product_id ) );
	return preg_replace( '/[\s\p{P}\p{S}]+/u', '', $title );
}

function avocadoss_product_identity_duplicate_ids( $product_id ) {
	$source     = avocadoss_product_identity_source( $product_id );
	$source_ids = avocadoss_product_identity_source_ids( $product_id, $source );
	if ( ! $source ) {
		return array();
	}
	$duplicates = array();
	foreach ( avocadoss_product_identity_active_ids() as $candidate_id ) {
		if ( (int) $candidate_id === (int) $product_id || $source !== avocadoss_product_identity_source( $candidate_id ) ) {
			continue;
		}
		$candidate_source_ids = avocadoss_product_identity_source_ids( $candidate_id, $source );
		$source_id_match      = $source_ids && $candidate_source_ids && array_intersect( $source_ids, $candidate_source_ids );
		$title_fallback_match = ( empty( $source_ids ) || empty( $candidate_source_ids ) ) && avocadoss_product_identity_title_key( $product_id ) === avocadoss_product_identity_title_key( $candidate_id );
		if ( $source_id_match || $title_fallback_match ) {
			$duplicates[] = (int) $candidate_id;
		}
	}
	return array_values( array_unique( $duplicates ) );
}

function avocadoss_product_identity_safety_blocked( $product_id ) {
	foreach ( array( '_wholesalehub_safety_status', '_mvp_safety_status', 'safety_status' ) as $key ) {
		if ( in_array( get_post_meta( $product_id, $key, true ), array( 'review_needed', 'blocked', 'excluded' ), true ) ) {
			return true;
		}
	}
	return false;
}

function avocadoss_product_identity_prepare_for_publish( $product_id ) {
	$product = wc_get_product( $product_id );
	if ( ! $product || 'product' !== get_post_type( $product_id ) ) {
		return new WP_Error( 'identity_invalid_product', '상품 식별자 검증 대상이 아닙니다.' );
	}
	if ( avocadoss_product_identity_safety_blocked( $product_id ) ) {
		return new WP_Error( 'identity_safety_blocked', '검수 보류 상품은 게시할 수 없습니다.' );
	}

	if ( ! $product->get_sku() ) {
		$sku      = 'HUB-' . (int) $product_id;
		$existing = wc_get_product_id_by_sku( $sku );
		if ( $existing && (int) $existing !== (int) $product_id ) {
			return new WP_Error( 'identity_sku_duplicate', 'SKU가 다른 상품과 중복됩니다.' );
		}
		$product->set_sku( $sku );
		$product->save();
	}
	foreach ( $product->get_children() as $variation_id ) {
		$variation = wc_get_product( $variation_id );
		if ( ! $variation || trim( (string) get_post_meta( $variation_id, '_sku', true ) ) ) {
			continue;
		}
		$variation_sku = 'HUB-' . (int) $product_id . '-' . (int) $variation_id;
		$existing      = wc_get_product_id_by_sku( $variation_sku );
		if ( $existing && (int) $existing !== (int) $variation_id ) {
			return new WP_Error( 'identity_variation_sku_duplicate', '옵션 SKU가 다른 상품과 중복됩니다.' );
		}
		$variation->set_sku( $variation_sku );
		$variation->save();
	}

	$source = avocadoss_product_identity_source( $product_id );
	if ( ! $source ) {
		return new WP_Error( 'identity_source_missing', '크롤링 출처를 확정할 수 없어 게시를 중단했습니다.' );
	}
	if ( ! get_post_meta( $product_id, '_b2b_source', true ) ) {
		update_post_meta( $product_id, '_b2b_source', $source );
	}
	if ( empty( avocadoss_product_identity_source_ids( $product_id, $source ) ) ) {
		return new WP_Error( 'identity_source_id_missing', '공급처 상품 식별자가 없어 게시를 중단했습니다.' );
	}
	$duplicates = avocadoss_product_identity_duplicate_ids( $product_id );
	if ( $duplicates ) {
		return new WP_Error( 'identity_duplicate_product', '동일 공급처 상품이 이미 등록되어 있습니다. 중복 상품 ID: ' . implode( ', ', $duplicates ) );
	}
	return array( 'sku' => $product->get_sku(), 'source' => $source );
}

add_filter( 'manage_edit-product_columns', 'avocadoss_add_product_source_column', 20 );
function avocadoss_add_product_source_column( $columns ) {
	$new_columns = array();
	foreach ( $columns as $key => $column ) {
		$new_columns[ $key ] = $column;
		if ( 'sku' === $key ) {
			$new_columns['b2b_source'] = '크롤링 출처';
		}
	}
	if ( ! isset( $new_columns['b2b_source'] ) ) {
		$new_columns['b2b_source'] = '크롤링 출처';
	}
	return $new_columns;
}

add_action( 'manage_product_posts_custom_column', 'avocadoss_populate_product_source_column', 10, 2 );
function avocadoss_populate_product_source_column( $column, $post_id ) {
	if ( 'b2b_source' !== $column ) {
		return;
	}
	$source = avocadoss_product_identity_source( $post_id );
	if ( ! $source ) {
		echo '<span style="color:#aaa;">-</span>';
		return;
	}
	$styles = array(
		'dailyfood' => array( 'Dailyfood', '#155724', '#d4edda' ),
		'walldob2b' => array( 'Walldo', '#004085', '#cce5ff' ),
		'fafane'    => array( 'Fafane', '#856404', '#fff3cd' ),
	);
	list( $label, $color, $background ) = $styles[ $source ];
	echo '<span style="display:inline-block;padding:4px 8px;border-radius:4px;font-size:11px;font-weight:600;background-color:' . esc_attr( $background ) . ';color:' . esc_attr( $color ) . ';">' . esc_html( $label ) . '</span>';
}

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	WP_CLI::add_command(
		'avocadoss verify-product-identities',
		function () {
			$active_ids     = avocadoss_product_identity_active_ids();
			$issues         = array();
			$warnings       = array();
			$identity_index = array();
			$title_index    = array();
			foreach ( $active_ids as $product_id ) {
				$product = wc_get_product( $product_id );
				if ( ! $product ) {
					$issues[] = $product_id . ':invalid_product';
					continue;
				}
				if ( ! $product->get_sku() ) {
					$issues[] = $product_id . ':missing_sku';
				}
				foreach ( $product->get_children() as $variation_id ) {
					$variation = wc_get_product( $variation_id );
					if ( ! $variation || ! trim( (string) get_post_meta( $variation_id, '_sku', true ) ) ) {
						$issues[] = $product_id . ':' . $variation_id . ':missing_variation_sku';
					}
				}
				if ( $product->is_type( 'variable' ) && empty( $product->get_children() ) ) {
					// A variable product with zero options cannot be ordered, so no
					// crawl provenance is required. Flag it as a warning instead.
					$warnings[] = $product_id . ':variable_without_options';
					continue;
				}
			$option_provenance_complete = avocadoss_product_identity_option_provenance_complete( $product_id );
			if ( ! $option_provenance_complete && ! avocadoss_product_identity_normalize_source( get_post_meta( $product_id, '_b2b_source', true ) ) ) {
				$issues[] = $product_id . ':missing_source_meta';
			}
			$source = avocadoss_product_identity_source( $product_id );
			if ( ! $source && ! $option_provenance_complete ) {
				$issues[] = $product_id . ':missing_source';
				continue;
			}
			if ( ! $source ) {
				$source = 'lane';
			}
				$source_ids = avocadoss_product_identity_source_ids( $product_id, $source );
				if ( empty( $source_ids ) ) {
					if ( 'publish' === get_post_status( $product_id ) ) {
						$warnings[] = $product_id . ':legacy_missing_source_id';
					} else {
						$issues[] = $product_id . ':missing_source_id';
					}
				}
				foreach ( $source_ids as $source_id ) {
					$key = $source . ':' . $source_id;
					$identity_index[ $key ][] = (int) $product_id;
				}
				$title_key = $source . ':' . avocadoss_product_identity_title_key( $product_id );
				$title_index[ $title_key ][] = array( 'id' => (int) $product_id, 'has_source_id' => ! empty( $source_ids ) );
			}
			foreach ( $identity_index as $product_ids ) {
				$product_ids = array_values( array_unique( $product_ids ) );
				if ( count( $product_ids ) > 1 ) {
					$issues[] = implode( ':', $product_ids ) . ':duplicate_source_identity';
				}
			}
			foreach ( $title_index as $products ) {
				$product_ids = array_values( array_unique( array_column( $products, 'id' ) ) );
				if ( count( $product_ids ) > 1 && in_array( false, array_column( $products, 'has_source_id' ), true ) ) {
					$issues[] = implode( ':', $product_ids ) . ':duplicate_source_title_fallback';
				}
			}
			WP_CLI::log( 'products=' . count( $active_ids ) . ' issues=' . count( $issues ) . ' warnings=' . count( $warnings ) );
			foreach ( $warnings as $warning ) {
				WP_CLI::warning( $warning );
			}
			if ( $issues ) {
				WP_CLI::error( implode( ',', $issues ) );
			}
			WP_CLI::success( 'Product SKU/source identity verification passed.' );
		}
	);
}
