<?php
/**
 * Homepage recommendations, price history, and presentation.
 *
 * @package AvocadossPerformance
 */

defined( 'ABSPATH' ) || exit;

final class WholesaleHub_Homepage {
	const DB_VERSION          = '1.0.0';
	const DB_VERSION_OPTION   = 'wholesalehub_price_history_db_version';
	const SETTINGS_OPTION     = 'wholesalehub_homepage_settings';
	const DROP_CACHE          = 'wholesalehub_recent_price_drop_products';
	const POPULAR_CACHE       = 'wholesalehub_popular_business_products';
	const HOURLY_HOOK         = 'wholesalehub_refresh_homepage_recommendations';
	const ASYNC_HOOK          = 'wholesalehub_refresh_homepage_recommendations_async';
	const ACTION_GROUP        = 'wholesalehub-homepage';
	const CACHE_TTL           = HOUR_IN_SECONDS + 10 * MINUTE_IN_SECONDS;

	private static $pending_prices = array();

	public static function init() {
		add_action( 'init', array( __CLASS__, 'maybe_install' ), 5 );
		add_action( 'init', array( __CLASS__, 'ensure_schedule' ), 20 );
		add_filter( 'update_post_metadata', array( __CLASS__, 'capture_old_price' ), 10, 5 );
		add_action( 'updated_post_meta', array( __CLASS__, 'record_price_change' ), 10, 4 );
		add_action( self::HOURLY_HOOK, array( __CLASS__, 'refresh_recommendations' ) );
		add_action( self::ASYNC_HOOK, array( __CLASS__, 'refresh_recommendations' ) );
		add_action( 'woocommerce_order_status_changed', array( __CLASS__, 'order_changed' ), 10, 4 );
		add_action( 'woocommerce_payment_complete', array( __CLASS__, 'order_event' ) );
		add_filter( 'template_include', array( __CLASS__, 'front_page_template' ), 1000 );
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue_assets' ), 30 );
		add_action( 'admin_menu', array( __CLASS__, 'admin_menu' ) );
		add_action( 'admin_post_wholesalehub_save_homepage_settings', array( __CLASS__, 'save_settings' ) );
	}

	public static function defaults() {
		return array(
			'shipping_text'       => '상품별 배송비는 상세페이지에서 확인',
			'fulfillment_text'    => '결제 후 영업일 기준 1~2일 내 출고 예정',
			'price_drop_days'     => 14,
			'popular_days'        => 30,
			'section_limit'       => 8,
			'enable_price_drops'  => 1,
			'enable_popular'      => 1,
			'enable_all_products' => 1,
		);
	}

	public static function settings() {
		$saved = get_option( self::SETTINGS_OPTION, array() );
		return wp_parse_args( is_array( $saved ) ? $saved : array(), self::defaults() );
	}

	public static function table_name() {
		global $wpdb;
		return $wpdb->prefix . 'wholesalehub_price_history';
	}

	public static function maybe_install() {
		if ( self::DB_VERSION === get_option( self::DB_VERSION_OPTION ) ) {
			return;
		}

		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$table   = self::table_name();
		$charset = $wpdb->get_charset_collate();
		$sql     = "CREATE TABLE {$table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			product_id bigint(20) unsigned NOT NULL,
			variation_id bigint(20) unsigned NOT NULL DEFAULT 0,
			old_price decimal(20,6) NOT NULL,
			new_price decimal(20,6) NOT NULL,
			changed_at datetime NOT NULL,
			change_type varchar(32) NOT NULL DEFAULT 'price',
			source_context varchar(64) NOT NULL DEFAULT 'application',
			PRIMARY KEY  (id),
			KEY product_changed (product_id, changed_at),
			KEY variation_changed (variation_id, changed_at),
			KEY changed_at (changed_at)
		) {$charset};";
		dbDelta( $sql );
		update_option( self::DB_VERSION_OPTION, self::DB_VERSION, false );
	}

	public static function capture_old_price( $check, $object_id, $meta_key, $meta_value, $prev_value ) {
		if ( '_price' !== $meta_key || ! self::is_price_object( $object_id ) ) {
			return $check;
		}

		$old_price = get_post_meta( $object_id, '_price', true );
		if ( '' !== $old_price && is_numeric( $old_price ) && is_numeric( $meta_value ) ) {
			self::$pending_prices[ (int) $object_id ] = (float) $old_price;
		}
		return $check;
	}

	public static function record_price_change( $meta_id, $object_id, $meta_key, $meta_value ) {
		$object_id = (int) $object_id;
		if ( '_price' !== $meta_key || ! isset( self::$pending_prices[ $object_id ] ) || ! is_numeric( $meta_value ) ) {
			return;
		}

		$old_price = (float) self::$pending_prices[ $object_id ];
		$new_price = (float) $meta_value;
		unset( self::$pending_prices[ $object_id ] );
		if ( abs( $old_price - $new_price ) < 0.000001 ) {
			return;
		}

		$post_type = get_post_type( $object_id );
		$is_var    = 'product_variation' === $post_type;
		$product_id = $is_var ? (int) wp_get_post_parent_id( $object_id ) : $object_id;
		if ( $product_id < 1 ) {
			return;
		}

		global $wpdb;
		$wpdb->insert(
			self::table_name(),
			array(
				'product_id'    => $product_id,
				'variation_id'  => $is_var ? $object_id : 0,
				'old_price'     => $old_price,
				'new_price'     => $new_price,
				'changed_at'    => current_time( 'mysql', true ),
				'change_type'   => 'price',
				'source_context'=> self::source_context(),
			),
			array( '%d', '%d', '%f', '%f', '%s', '%s', '%s' )
		);
		delete_transient( self::DROP_CACHE );
		self::schedule_async_refresh();
	}

	private static function is_price_object( $object_id ) {
		return in_array( get_post_type( $object_id ), array( 'product', 'product_variation' ), true );
	}

	private static function source_context() {
		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			return 'wp_cli';
		}
		if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
			return 'woocommerce_rest';
		}
		if ( wp_doing_cron() ) {
			return 'scheduled';
		}
		if ( is_admin() ) {
			return 'wp_admin';
		}
		return 'application';
	}

	public static function ensure_schedule() {
		if ( function_exists( 'as_next_scheduled_action' ) && function_exists( 'as_schedule_recurring_action' ) ) {
			if ( ! as_next_scheduled_action( self::HOURLY_HOOK, array(), self::ACTION_GROUP ) ) {
				as_schedule_recurring_action( time() + 5 * MINUTE_IN_SECONDS, HOUR_IN_SECONDS, self::HOURLY_HOOK, array(), self::ACTION_GROUP, true );
			}
			return;
		}

		if ( ! wp_next_scheduled( self::HOURLY_HOOK ) ) {
			wp_schedule_event( time() + 5 * MINUTE_IN_SECONDS, 'hourly', self::HOURLY_HOOK );
		}
	}

	private static function schedule_async_refresh() {
		if ( function_exists( 'as_next_scheduled_action' ) && function_exists( 'as_schedule_single_action' ) ) {
			if ( ! as_next_scheduled_action( self::ASYNC_HOOK, array(), self::ACTION_GROUP ) ) {
				as_schedule_single_action( time() + 60, self::ASYNC_HOOK, array(), self::ACTION_GROUP, true );
			}
			return;
		}
		if ( ! wp_next_scheduled( self::ASYNC_HOOK ) ) {
			wp_schedule_single_event( time() + 60, self::ASYNC_HOOK );
		}
	}

	public static function order_event() {
		delete_transient( self::POPULAR_CACHE );
		self::schedule_async_refresh();
	}

	public static function order_changed( $order_id, $from, $to, $order ) {
		$watched = array( 'processing', 'completed', 'pending', 'on-hold', 'cancelled', 'failed', 'refunded', 'trash' );
		if ( in_array( $from, $watched, true ) || in_array( $to, $watched, true ) ) {
			self::order_event();
		}
	}

	public static function refresh_recommendations() {
		self::rebuild_price_drop_cache();
		self::rebuild_popular_cache();
	}

	public static function rebuild_price_drop_cache() {
		$settings = self::settings();
		$limit    = max( 1, min( 8, (int) $settings['section_limit'] ) );
		$days     = max( 1, min( 90, (int) $settings['price_drop_days'] ) );
		$ids      = self::find_price_drop_products( $days, $limit );
		if ( count( $ids ) < 4 && $days < 30 ) {
			$ids = self::find_price_drop_products( 30, $limit );
		}
		set_transient( self::DROP_CACHE, $ids, self::CACHE_TTL );
		return $ids;
	}

	private static function find_price_drop_products( $days, $limit ) {
		global $wpdb;
		$table = self::table_name();
		$since = gmdate( 'Y-m-d H:i:s', time() - DAY_IN_SECONDS * $days );
		$rows  = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, product_id, variation_id, old_price, new_price, changed_at
				 FROM {$table}
				 WHERE changed_at >= %s AND new_price < old_price AND new_price > 0
				 ORDER BY changed_at DESC, ((old_price - new_price) / NULLIF(old_price, 0)) DESC, product_id DESC
				 LIMIT %d",
				$since,
				max( 40, $limit * 10 )
			)
		);

		$ids = array();
		foreach ( $rows as $row ) {
			$product_id = (int) $row->product_id;
			if ( isset( $ids[ $product_id ] ) || ! self::recommendable_product( $product_id ) ) {
				continue;
			}
			$price_product = (int) $row->variation_id > 0 ? wc_get_product( (int) $row->variation_id ) : wc_get_product( $product_id );
			if ( ! $price_product || '' === $price_product->get_price() || abs( (float) $price_product->get_price() - (float) $row->new_price ) > 1 ) {
				continue;
			}
			$ids[ $product_id ] = $product_id;
			if ( count( $ids ) >= $limit ) {
				break;
			}
		}
		return array_values( $ids );
	}

	public static function rebuild_popular_cache() {
		$settings = self::settings();
		$limit    = max( 1, min( 8, (int) $settings['section_limit'] ) );
		$days     = max( 1, min( 365, (int) $settings['popular_days'] ) );
		$ids      = self::aggregate_popular_products( $days, $limit );
		if ( count( $ids ) < 4 && $days < 90 ) {
			$ids = self::aggregate_popular_products( 90, $limit );
		}
		set_transient( self::POPULAR_CACHE, $ids, self::CACHE_TTL );
		return $ids;
	}

	private static function aggregate_popular_products( $days, $limit ) {
		if ( ! function_exists( 'wc_get_orders' ) ) {
			return array();
		}

		$stats = array();
		$page  = 1;
		do {
			$orders = wc_get_orders(
				array(
					'status'       => array( 'processing', 'completed' ),
					'date_created' => '>=' . ( time() - DAY_IN_SECONDS * $days ),
					'limit'        => 100,
					'page'         => $page,
					'paginate'     => true,
					'orderby'      => 'date',
					'order'        => 'DESC',
				)
			);
			foreach ( $orders->orders as $order ) {
				$seen = array();
				$when = $order->get_date_created() ? $order->get_date_created()->getTimestamp() : 0;
				foreach ( $order->get_items( 'line_item' ) as $item ) {
					$product_id = (int) $item->get_product_id();
					if ( $product_id < 1 ) {
						continue;
					}
					if ( ! isset( $stats[ $product_id ] ) ) {
						$stats[ $product_id ] = array( 'orders' => 0, 'quantity' => 0, 'last' => 0 );
					}
					$stats[ $product_id ]['quantity'] += max( 0, (float) $item->get_quantity() );
					$stats[ $product_id ]['last'] = max( $stats[ $product_id ]['last'], $when );
					if ( ! isset( $seen[ $product_id ] ) ) {
						++$stats[ $product_id ]['orders'];
						$seen[ $product_id ] = true;
					}
				}
			}
			++$page;
		} while ( $page <= (int) $orders->max_num_pages );

		uasort(
			$stats,
			function ( $a, $b ) {
				return ( $b['orders'] <=> $a['orders'] ) ?: ( $b['quantity'] <=> $a['quantity'] ) ?: ( $b['last'] <=> $a['last'] );
			}
		);
		$ids = array();
		foreach ( array_keys( $stats ) as $product_id ) {
			if ( self::recommendable_product( $product_id ) ) {
				$ids[] = (int) $product_id;
			}
			if ( count( $ids ) >= $limit ) {
				break;
			}
		}
		return $ids;
	}

	public static function recommendable_product( $product_id ) {
		$product = wc_get_product( $product_id );
		if ( ! $product || 'publish' !== $product->get_status() ) {
			return false;
		}
		$price_ok = false;
		$stock_ok = true;
		if ( $product->is_type( 'variable' ) ) {
			$children = $product->get_children();
			$active_variations = 0;
			foreach ( $children as $child_id ) {
				$variation = wc_get_product( (int) $child_id );
				if ( ! $variation || 'publish' !== $variation->get_status() ) {
					continue;
				}
				$vprice = $variation->get_price();
				if ( is_numeric( $vprice ) && (float) $vprice > 0 ) {
					$price_ok = true;
					++$active_variations;
				}
			}
			$stock_ok = $active_variations > 0;
		} else {
			$price_ok = '' !== $product->get_price() && (float) $product->get_price() > 0;
			$stock_ok = $product->is_in_stock();
		}
		if ( ! $price_ok || ! $stock_ok ) {
			return false;
		}
		if ( 'visible' !== $product->get_catalog_visibility() || has_term( '공동구매', 'product_cat', $product_id ) ) {
			return false;
		}
		$title = get_the_title( $product_id );
		if ( false !== mb_strpos( $title, '예치금' ) || preg_match( '/충전.*포인트|포인트.*충전/u', $title ) ) {
			return false;
		}
		foreach ( array( '_wholesalehub_safety_status', '_mvp_safety_status', 'safety_status' ) as $key ) {
			if ( in_array( get_post_meta( $product_id, $key, true ), array( 'review_needed', 'blocked', 'excluded' ), true ) ) {
				return false;
			}
		}
		return true;
	}

	public static function cached_ids( $cache_key ) {
		$ids = get_transient( $cache_key );
		if ( false === $ids ) {
			self::schedule_async_refresh();
			return array();
		}
		return array_values( array_filter( array_map( 'absint', (array) $ids ), array( __CLASS__, 'recommendable_product' ) ) );
	}

	public static function featured_product_ids( $limit ) {
		$query = new WP_Query(
			array(
				'post_type'              => 'product',
				'post_status'            => 'publish',
				'posts_per_page'         => min( 30, max( 8, $limit * 3 ) ),
				'orderby'                => 'date',
				'order'                  => 'DESC',
				'fields'                 => 'ids',
				'no_found_rows'          => true,
				'update_post_meta_cache' => false,
				'update_post_term_cache' => true,
				'tax_query'              => array(
					array(
						'taxonomy' => 'product_visibility',
						'field'    => 'name',
						'terms'    => array( 'featured' ),
					),
				),
			)
		);
		$ids = array();
		foreach ( $query->posts as $product_id ) {
			if ( self::recommendable_product( $product_id ) ) {
				$ids[] = (int) $product_id;
			}
			if ( count( $ids ) >= $limit ) {
				break;
			}
		}
		return $ids;
	}

	public static function latest_product_ids( $limit ) {
		$excluded = get_term_by( 'name', '공동구매', 'product_cat' );
		$tax_query = array(
			array(
				'taxonomy' => 'product_visibility',
				'field'    => 'name',
				'terms'    => array( 'exclude-from-catalog', 'exclude-from-search' ),
				'operator' => 'NOT IN',
			),
		);
		if ( $excluded && ! is_wp_error( $excluded ) ) {
			$tax_query[] = array( 'taxonomy' => 'product_cat', 'field' => 'term_id', 'terms' => array( (int) $excluded->term_id ), 'operator' => 'NOT IN' );
		}
		$query = new WP_Query(
			array(
				'post_type'              => 'product',
				'post_status'            => 'publish',
				'posts_per_page'         => min( 30, max( 8, $limit * 3 ) ),
				'orderby'                => 'date',
				'order'                  => 'DESC',
				'fields'                 => 'ids',
				'no_found_rows'          => true,
				'update_post_meta_cache' => false,
				'update_post_term_cache' => true,
				'tax_query'              => $tax_query,
			)
		);
		$ids = array();
		foreach ( $query->posts as $product_id ) {
			if ( self::recommendable_product( $product_id ) ) {
				$ids[] = (int) $product_id;
			}
			if ( count( $ids ) >= $limit ) {
				break;
			}
		}
		return $ids;
	}

	public static function front_page_template( $template ) {
		if ( is_front_page() || is_shop() ) {
			$custom = dirname( __DIR__ ) . '/templates/wholesalehub-front-page.php';
			if ( is_readable( $custom ) ) {
				return $custom;
			}
		}
		return $template;
	}

	public static function enqueue_assets() {
		if ( is_front_page() || is_shop() ) {
			wp_enqueue_style( 'wholesalehub-homepage', plugins_url( '../assets/css/wholesalehub-homepage.css', __FILE__ ), array(), (string) filemtime( dirname( __DIR__ ) . '/assets/css/wholesalehub-homepage.css' ) );
		}
	}

	public static function admin_menu() {
		add_submenu_page( 'woocommerce', '홈페이지 상품 섹션', '홈페이지 상품 섹션', 'manage_woocommerce', 'wholesalehub-homepage', array( __CLASS__, 'settings_page' ) );
	}

	public static function settings_page() {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		$s = self::settings();
		?>
		<div class="wrap"><h1>홈페이지 상품 섹션</h1>
		<?php if ( isset( $_GET['updated'] ) ) : ?><div class="notice notice-success is-dismissible"><p>설정을 저장하고 추천 캐시 갱신을 예약했습니다.</p></div><?php endif; ?>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
		<input type="hidden" name="action" value="wholesalehub_save_homepage_settings"><?php wp_nonce_field( 'wholesalehub_homepage_settings' ); ?>
		<table class="form-table">
		<tr><th><label for="shipping_text">배송 안내</label></th><td><input class="regular-text" id="shipping_text" name="shipping_text" value="<?php echo esc_attr( $s['shipping_text'] ); ?>"></td></tr>
		<tr><th><label for="fulfillment_text">출고 안내</label></th><td><input class="regular-text" id="fulfillment_text" name="fulfillment_text" value="<?php echo esc_attr( $s['fulfillment_text'] ); ?>"></td></tr>
		<tr><th><label for="price_drop_days">가격 인하 기간</label></th><td><input type="number" min="1" max="90" id="price_drop_days" name="price_drop_days" value="<?php echo esc_attr( $s['price_drop_days'] ); ?>"> 일</td></tr>
		<tr><th><label for="popular_days">인기 집계 기간</label></th><td><input type="number" min="1" max="365" id="popular_days" name="popular_days" value="<?php echo esc_attr( $s['popular_days'] ); ?>"> 일</td></tr>
		<tr><th><label for="section_limit">섹션별 상품 수</label></th><td><input type="number" min="1" max="8" id="section_limit" name="section_limit" value="<?php echo esc_attr( $s['section_limit'] ); ?>"></td></tr>
		<tr><th>활성 섹션</th><td><label><input type="checkbox" name="enable_price_drops" value="1" <?php checked( $s['enable_price_drops'] ); ?>> 최근 가격 인하</label><br><label><input type="checkbox" name="enable_popular" value="1" <?php checked( $s['enable_popular'] ); ?>> 사업자 인기</label><br><label><input type="checkbox" name="enable_all_products" value="1" <?php checked( $s['enable_all_products'] ); ?>> 전체 상품</label></td></tr>
		</table><?php submit_button(); ?></form></div>
		<?php
	}

	public static function save_settings() {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( '권한이 없습니다.' );
		}
		check_admin_referer( 'wholesalehub_homepage_settings' );
		$defaults = self::defaults();
		$settings = array(
			'shipping_text'       => sanitize_text_field( wp_unslash( $_POST['shipping_text'] ?? $defaults['shipping_text'] ) ),
			'fulfillment_text'    => sanitize_text_field( wp_unslash( $_POST['fulfillment_text'] ?? $defaults['fulfillment_text'] ) ),
			'price_drop_days'     => max( 1, min( 90, absint( $_POST['price_drop_days'] ?? 14 ) ) ),
			'popular_days'        => max( 1, min( 365, absint( $_POST['popular_days'] ?? 30 ) ) ),
			'section_limit'       => max( 1, min( 8, absint( $_POST['section_limit'] ?? 8 ) ) ),
			'enable_price_drops'  => isset( $_POST['enable_price_drops'] ) ? 1 : 0,
			'enable_popular'      => isset( $_POST['enable_popular'] ) ? 1 : 0,
			'enable_all_products' => isset( $_POST['enable_all_products'] ) ? 1 : 0,
		);
		update_option( self::SETTINGS_OPTION, $settings, false );
		delete_transient( self::DROP_CACHE );
		delete_transient( self::POPULAR_CACHE );
		self::schedule_async_refresh();
		wp_safe_redirect( add_query_arg( array( 'page' => 'wholesalehub-homepage', 'updated' => 1 ), admin_url( 'admin.php' ) ) );
		exit;
	}
}

WholesaleHub_Homepage::init();
