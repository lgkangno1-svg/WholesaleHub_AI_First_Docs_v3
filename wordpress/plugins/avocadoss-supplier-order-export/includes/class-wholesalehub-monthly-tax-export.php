<?php
/**
 * Monthly business tax invoice (전자세금계산서/전자계산서) export + Telegram.
 *
 * WP-CLI: wp avocadoss monthly-tax-export [--period=YYYY-MM] [--dry-run] [--force-resend]
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Avocadoss_WholesaleHub_Monthly_Tax_Export_Command {
	private const ELIGIBLE_ORDER_STATUSES = array( 'processing', 'completed' );
	private const SCHEMA_VERSION = '1.0.0';
	private const SCHEMA_OPTION = 'wh_monthly_tax_schema_version';
	private const CONSIDERATION_MODE_OPTION = '_wh_taxable_consideration_mode';
	private const CONSIDERATION_MODES = array( 'VAT_INCLUDED', 'VAT_EXCLUDED_SEPARATE', 'UNCONFIRMED' );
	private const TAXABLE_COLUMNS = array(
		'전자(세금)계산서 종류', '작성일자', '공급자 등록번호', '공급자 종사업장번호', '공급자 상호', '공급자 성명',
		'공급자 사업장주소', '공급자 업태', '공급자 종목', '공급자 이메일',
		'공급받는자 등록번호', '공급받는자 종사업장번호', '공급받는자 상호', '공급받는자 성명', '공급받는자 사업장주소',
		'공급받는자 업태', '공급받는자 종목', '공급받는자 이메일1', '공급받는자 이메일2',
		'공급가액 합계', '세액 합계', '비고',
		'일자1', '품목1', '규격1', '수량1', '단가1', '공급가액1', '세액1', '품목비고1',
		'일자2', '품목2', '규격2', '수량2', '단가2', '공급가액2', '세액2', '품목비고2',
		'일자3', '품목3', '규격3', '수량3', '단가3', '공급가액3', '세액3', '품목비고3',
		'일자4', '품목4', '규격4', '수량4', '단가4', '공급가액4', '세액4', '품목비고4',
		'현금', '수표', '어음', '외상미수금', '영수(01)/청구(02)',
	);

	public function __invoke( $args, $assoc_args ) {
		$period  = isset( $assoc_args['period'] ) ? sanitize_text_field( $assoc_args['period'] ) : '';
		$dry_run = isset( $assoc_args['dry-run'] );
		$force   = isset( $assoc_args['force-resend'] );

		if ( '' === $period ) {
			$period = wp_date( 'Y-m', strtotime( 'first day of last month' ), new DateTimeZone( 'Asia/Seoul' ) );
		}
		if ( ! preg_match( '/^\d{4}-\d{2}$/', $period ) ) {
			WP_CLI::error( '--period must be YYYY-MM.' );
		}
		$this->ensure_schema();

		$result = $this->build( $period, $dry_run );
		$input_hash = $result['input_hash'];

		$existing = $this->existing_batch( $period );
		if ( $existing ) {
			if ( (string) $existing['input_hash'] === $input_hash && ! $force ) {
				WP_CLI::line( wp_json_encode( array( 'status' => 'unchanged', 'period' => $period, 'message' => '동일 데이터, 재전송 생략' ), JSON_UNESCAPED_UNICODE ) );
				return;
			}
			if ( (string) $existing['input_hash'] !== $input_hash && ! $force ) {
				$result['status'] = 'REVISION_REQUIRED';
				WP_CLI::line( wp_json_encode( array_merge( $result, array( 'status' => 'REVISION_REQUIRED', 'message' => '기존 전송 후 데이터 변경 감지, 자동 재발급하지 않음' ) ), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) );
				if ( function_exists( 'avocadoss_send_telegram_message' ) ) {
					avocadoss_send_telegram_message( '[도매Hub ' . $period . ' 세금자료 변경 감지]\n기존 전송 후 주문/환불/사업자정보/과세구분 변경이 감지되었습니다.\n자동 재발급하지 않았습니다. 검토가 필요합니다.' );
				}
				return;
			}
		}

		WP_CLI::line( wp_json_encode( $result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) );

		if ( $dry_run ) {
			return;
		}
		$this->send_telegram( $period, $result, $force );
		$this->record_batch( $period, $input_hash, $result, $existing );
	}

	private function existing_batch( $period ) {
		global $wpdb;
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}wholesalehub_monthly_tax_batches WHERE period=%s LIMIT 1", $period ), ARRAY_A );
	}

	private function record_batch( $period, $input_hash, $result, $existing ) {
		global $wpdb;
		$now = current_time( 'mysql' );
		$data = array(
			'period' => $period,
			'input_hash' => $input_hash,
			'status' => 'SENT',
			'taxable_docs' => (int) $result['taxable_docs'],
			'exempt_docs' => (int) $result['exempt_docs'],
			'review_count' => (int) $result['review_count'],
			'telegram_sent_at' => $now,
		);
		if ( $existing ) {
			$wpdb->update( $wpdb->prefix . 'wholesalehub_monthly_tax_batches', $data, array( 'id' => (int) $existing['id'] ) );
		} else {
			$data['created_at'] = $now;
			$wpdb->insert( $wpdb->prefix . 'wholesalehub_monthly_tax_batches', $data );
		}
	}

	private function ensure_schema() {
		if ( (string) get_option( self::SCHEMA_OPTION, '' ) === self::SCHEMA_VERSION ) {
			return;
		}
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$c = $wpdb->get_charset_collate();
		dbDelta(
			"CREATE TABLE {$wpdb->prefix}wholesalehub_monthly_tax_batches (
				id bigint unsigned NOT NULL AUTO_INCREMENT,
				period char(7) NOT NULL,
				input_hash char(64) NOT NULL,
				status varchar(32) NOT NULL,
				taxable_docs int unsigned NOT NULL DEFAULT 0,
				exempt_docs int unsigned NOT NULL DEFAULT 0,
				review_count int unsigned NOT NULL DEFAULT 0,
				telegram_sent_at datetime NULL,
				created_at datetime NOT NULL,
				PRIMARY KEY (id),
				UNIQUE KEY period (period)
			) {$c};"
		);
		update_option( self::SCHEMA_OPTION, self::SCHEMA_VERSION );
	}

	private function build( $period, $dry_run ) {
		$year  = (int) substr( $period, 0, 4 );
		$month = (int) substr( $period, 5, 2 );
		$start = sprintf( '%04d-%02d-01 00:00:00', $year, $month );
		$end_date = wp_date( 'Y-m-t', strtotime( $year . '-' . $month . '-01' ), new DateTimeZone( 'Asia/Seoul' ) );
		$end = $end_date . ' 23:59:59';
		$written_date = str_replace( '-', '', $end_date );

		$rows    = $this->collect_rows( $start, $end );
		$refunds = $this->collect_refunds( $rows );
		foreach ( $refunds as $index => $refund ) {
			$refunds[ $index ]['same_period'] = ( $refund['created_period'] === $period );
		}
		$groups  = $this->group_by_business( $rows );
		$groups  = $this->apply_refunds( $groups, $refunds );

		$taxable = array();
		$exempt  = array();
		$review  = array();
		$summary = array(
			'period' => $period,
			'business_count' => 0,
			'taxable_business' => 0,
			'exempt_business' => 0,
			'zero_rated_business' => 0,
			'taxable_supply' => 0,
			'taxable_vat' => 0,
			'exempt_supply' => 0,
			'review_count' => 0,
			'post_period_refund_count' => 0,
		);

		foreach ( $groups as $biz => $data ) {
			$summary['business_count']++;
			if ( ! empty( $data['issues'] ) ) {
				foreach ( $data['issues'] as $issue ) {
					$review[] = array_merge( array( 'business_number' => $biz, 'company' => $data['company'] ), $issue );
				}
				$summary['review_count'] += count( $data['issues'] );
			}
			foreach ( $data['docs'] as $doc ) {
				if ( 'TAXABLE' === $doc['type'] ) {
					$taxable[] = $doc;
					$summary['taxable_business']++;
					$summary['taxable_supply'] += $doc['supply'];
					$summary['taxable_vat'] += $doc['vat'];
				} elseif ( 'ZERO_RATED' === $doc['type'] ) {
					$taxable[] = $doc;
					$summary['zero_rated_business']++;
				} else {
					$exempt[] = $doc;
					$summary['exempt_business']++;
					$summary['exempt_supply'] += $doc['supply'];
				}
			}
		}

		foreach ( $refunds as $refund ) {
			if ( $refund['same_period'] ) {
				continue;
			}
			$summary['post_period_refund_count']++;
			$review[] = array(
				'business_number' => $refund['business_number'],
				'company' => $refund['company'],
				'order_id' => $refund['order_id'],
				'code' => 'POST_PERIOD_REFUND_REVIEW',
				'message' => '기공급월 ' . $refund['original_period'] . ' 환불, 자동상계 금지',
			);
		}

		$files = array();
		if ( ! $dry_run ) {
			$files = $this->write_files( $period, $written_date, $taxable, $exempt, $rows, $review, $summary, $refunds );
		}

		$hash_payload = array(
			'rows' => $rows,
			'refunds' => $refunds,
			'consideration_mode' => $this->consideration_mode(),
		);

		return array(
			'period' => $period,
			'written_date' => $written_date,
			'taxable_docs' => count( $taxable ),
			'exempt_docs' => count( $exempt ),
			'review_count' => $summary['review_count'],
			'post_period_refund_count' => $summary['post_period_refund_count'],
			'taxable_supply' => $summary['taxable_supply'],
			'taxable_vat' => $summary['taxable_vat'],
			'exempt_supply' => $summary['exempt_supply'],
			'business_count' => $summary['business_count'],
			'input_hash' => hash( 'sha256', wp_json_encode( $hash_payload ) ),
			'files' => $files,
		);
	}

	private function collect_rows( $start, $end ) {
		$start_date = substr( $start, 0, 10 );
		$end_date = substr( $end, 0, 10 );
		$rows = array();
		$mode = $this->consideration_mode();
		$args = array(
			'status' => self::ELIGIBLE_ORDER_STATUSES,
			'limit' => -1,
			'type' => 'shop_order',
			'return' => 'ids',
		);
		foreach ( wc_get_orders( $args ) as $order_id ) {
			$order = wc_get_order( (int) $order_id );
			if ( ! $order || ! $order->get_date_paid() ) {
				continue;
			}
			$business = $this->resolve_business( $order );
			foreach ( $order->get_items() as $item_id => $item ) {
				if ( ! $item instanceof WC_Order_Item_Product ) {
					continue;
				}
				$supply_at   = (string) $item->get_meta( '_wh_tax_supply_at', true );
				$supply_proxy = false;
				$supply_legacy = false;
				if ( '' === $supply_at ) {
					$supply_at = (string) $order->get_meta( '_wh_tax_supply_at', true );
				}
				if ( '' === $supply_at ) {
					$completed = $order->get_date_completed();
					if ( $completed ) {
						$supply_at = $completed->date( 'Y-m-d' );
						$supply_proxy = true;
					}
				}
				if ( '' === $supply_at ) {
					$supply_at = $order->get_date_paid()->date( 'Y-m-d' );
					$supply_legacy = true;
				}
				$supply_day = substr( $supply_at, 0, 10 );
				if ( $supply_day < $start_date || $supply_day > $end_date ) {
					continue;
				}
				$type = $this->tax_document_type( $item );
				$amount = $this->resolve_amounts( $type, $mode, (float) $item->get_total(), (float) $item->get_meta( '_wh_tax_vat_amount', true ) );
				$rows[] = array(
					'order_id' => (int) $order_id,
					'user_id' => (int) $order->get_user_id(),
					'business_number' => $business['number'],
					'business_source' => $business['source'],
					'business_company' => $business['company'],
					'business_representative' => $business['representative'],
					'business_address' => $business['address'],
					'business_type' => $business['type'],
					'business_item' => $business['item'],
					'business_tax_email' => $business['tax_email'],
					'item_id' => (int) $item_id,
					'product' => $item->get_name(),
					'qty' => $item->get_quantity(),
					'tax_type' => $type,
					'consideration_mode' => $mode,
					'gross' => $amount['gross'],
					'supply' => $amount['supply'],
					'vat' => $amount['vat'],
					'amount_confirmed' => $amount['confirmed'],
					'supply_at' => $supply_day,
					'supply_proxy' => $supply_proxy,
					'supply_legacy' => $supply_legacy,
				);
			}
		}
		return $rows;
	}

	private function tax_document_type( WC_Order_Item_Product $item ) {
		$meta = (string) $item->get_meta( '_wh_tax_document_type', true );
		if ( '' === $meta ) {
			$target = (int) $item->get_variation_id() ?: (int) $item->get_product_id();
			$meta = (string) get_post_meta( $target, '_wh_tax_document_type', true );
		}
		if ( in_array( $meta, array( 'TAXABLE', 'EXEMPT', 'ZERO_RATED' ), true ) ) {
			return $meta;
		}
		return 'UNCLASSIFIED';
	}

	private function consideration_mode() {
		$mode = strtoupper( trim( (string) get_option( self::CONSIDERATION_MODE_OPTION, 'UNCONFIRMED' ) ) );
		return in_array( $mode, self::CONSIDERATION_MODES, true ) ? $mode : 'UNCONFIRMED';
	}

	private function split_vat_included( $gross ) {
		$gross  = (int) round( (float) $gross );
		$supply = (int) round( $gross * 100.0 / 110.0 );
		return array( $supply, $gross - $supply );
	}

	private function resolve_amounts( $type, $mode, $gross, $explicit_vat ) {
		$gross = round( (float) $gross );
		if ( 'EXEMPT' === $type || 'ZERO_RATED' === $type ) {
			return array( 'gross' => $gross, 'supply' => $gross, 'vat' => 0.0, 'confirmed' => true );
		}
		if ( 'TAXABLE' !== $type ) {
			return array( 'gross' => $gross, 'supply' => 0.0, 'vat' => 0.0, 'confirmed' => false );
		}
		if ( 'VAT_INCLUDED' === $mode ) {
			list( $supply, $vat ) = $this->split_vat_included( $gross );
			return array( 'gross' => $gross, 'supply' => $supply, 'vat' => $vat, 'confirmed' => true );
		}
		if ( 'VAT_EXCLUDED_SEPARATE' === $mode ) {
			$explicit = is_numeric( $explicit_vat ) ? (float) $explicit_vat : 0.0;
			if ( $explicit > 0 ) {
				return array( 'gross' => $gross + $explicit, 'supply' => $gross, 'vat' => $explicit, 'confirmed' => true );
			}
		}
		return array( 'gross' => $gross, 'supply' => 0.0, 'vat' => 0.0, 'confirmed' => false );
	}

	private function resolve_business( WC_Order $order ) {
		$uid    = (int) $order->get_user_id();
		$number = $this->normalize_business_number( (string) $order->get_meta( '_wh_business_number', true ) );
		$source = 'ORDER_SNAPSHOT';
		if ( '' === $number ) {
			$number = $this->normalize_business_number( (string) $order->get_meta( '_avo_business_number', true ) );
			$source = 'CHECKOUT_META';
		}
		if ( '' === $number && $uid ) {
			$number = $this->normalize_business_number( (string) get_user_meta( $uid, '_avo_business_number', true ) );
			$source = 'CURRENT_PROFILE_FALLBACK';
		}
		if ( '' === $number ) {
			return array( 'number' => '', 'source' => 'MISSING', 'company' => '', 'representative' => '', 'address' => '', 'type' => '', 'item' => '', 'tax_email' => '' );
		}
		$company        = (string) $order->get_meta( '_wh_business_company', true );
		$representative = (string) $order->get_meta( '_wh_business_representative', true );
		$address        = (string) $order->get_meta( '_wh_business_address', true );
		$type           = (string) $order->get_meta( '_wh_business_type', true );
		$item           = (string) $order->get_meta( '_wh_business_item', true );
		$tax_email      = (string) $order->get_meta( '_wh_business_tax_email', true );
		if ( $uid ) {
			if ( '' === $company ) {
				$company = (string) get_user_meta( $uid, 'billing_company', true );
			}
			if ( '' === $representative ) {
				$representative = (string) get_user_meta( $uid, 'billing_first_name', true );
			}
			if ( '' === $address ) {
				$address = trim( (string) get_user_meta( $uid, 'billing_address_1', true ) . ' ' . (string) get_user_meta( $uid, 'billing_address_2', true ) );
			}
			if ( '' === $type ) {
				$type = (string) get_user_meta( $uid, '_avo_business_type', true );
			}
			if ( '' === $item ) {
				$item = (string) get_user_meta( $uid, '_avo_business_item', true );
			}
			if ( '' === $tax_email ) {
				$tax_email = (string) get_user_meta( $uid, '_avo_tax_email', true );
			}
		}
		return array(
			'number' => $number,
			'source' => $source,
			'company' => $company,
			'representative' => $representative,
			'address' => $address,
			'type' => $type,
			'item' => $item,
			'tax_email' => $tax_email,
		);
	}

	private function group_by_business( array $rows ) {
		$groups = array();
		foreach ( $rows as $row ) {
			$biz = $row['business_number'];
			if ( '' === $biz ) {
				continue;
			}
			if ( ! isset( $groups[ $biz ] ) ) {
				$profile = $this->business_profile( (int) $row['user_id'], $biz );
				$groups[ $biz ] = array( 'company' => $profile['company'], 'profile' => $profile, 'issues' => array(), 'docs' => array(), 'identity' => null );
			}
			if ( ! empty( $groups[ $biz ]['profile']['issues'] ) ) {
				foreach ( $groups[ $biz ]['profile']['issues'] as $issue ) {
					$groups[ $biz ]['issues'][] = $issue;
				}
				$groups[ $biz ]['profile']['issues'] = array();
			}
			if ( $this->identity_conflict( $groups[ $biz ]['identity'], $row ) ) {
				$groups[ $biz ]['issues'][] = array( 'order_id' => $row['order_id'], 'code' => 'BUSINESS_PROFILE_CONFLICT', 'message' => '동일 사업자번호의 상호/대표자/주소 핵심정보 상충' );
				continue;
			}
			if ( 'CURRENT_PROFILE_FALLBACK' === $row['business_source'] ) {
				$groups[ $biz ]['issues'][] = array( 'order_id' => $row['order_id'], 'code' => 'CURRENT_PROFILE_FALLBACK', 'message' => '주문 스냅샷 없음, 현재 프로필로 대체' );
			}
			if ( $row['supply_proxy'] ) {
				$groups[ $biz ]['issues'][] = array( 'order_id' => $row['order_id'], 'code' => 'SUPPLY_DATE_PROXY', 'message' => '배송완료 이벤트 없음, 완료시각 proxy 사용' );
			}
			if ( $row['supply_legacy'] ) {
				$groups[ $biz ]['issues'][] = array( 'order_id' => $row['order_id'], 'code' => 'LEGACY_SUPPLY_DATE_FALLBACK', 'message' => '공급시기 미기록, date_paid 대체 사용' );
			}
			if ( 'UNCLASSIFIED' === $row['tax_type'] ) {
				$groups[ $biz ]['issues'][] = array( 'order_id' => $row['order_id'], 'code' => 'TAX_CLASS_REVIEW_REQUIRED', 'message' => '과세구분 미확정' );
				continue;
			}
			if ( 'TAXABLE' === $row['tax_type'] && ! $row['amount_confirmed'] ) {
				$groups[ $biz ]['issues'][] = array( 'order_id' => $row['order_id'], 'code' => 'TAX_AMOUNT_REVIEW_REQUIRED', 'message' => '과세 거래대가 모드 미확정 또는 VAT 별도 수취 증거 없음' );
				continue;
			}
			$key = $row['tax_type'];
			if ( ! isset( $groups[ $biz ]['docs'][ $key ] ) ) {
				$groups[ $biz ]['docs'][ $key ] = array( 'type' => $row['tax_type'], 'business_number' => $biz, 'supply' => 0.0, 'vat' => 0.0, 'gross' => 0.0, 'company' => '', 'name' => '', 'address' => '', 'email' => '', 'business_type' => '', 'business_item' => '' );
			}
			$groups[ $biz ]['docs'][ $key ]['supply'] += $row['supply'];
			$groups[ $biz ]['docs'][ $key ]['vat'] += $row['vat'];
			$groups[ $biz ]['docs'][ $key ]['gross'] += $row['gross'];
		}
		foreach ( $groups as $biz => $data ) {
			$profile = $data['profile'];
			foreach ( $data['docs'] as $key => $doc ) {
				$groups[ $biz ]['docs'][ $key ]['company'] = $profile['company'];
				$groups[ $biz ]['docs'][ $key ]['name'] = $profile['name'];
				$groups[ $biz ]['docs'][ $key ]['address'] = $profile['address'];
				$groups[ $biz ]['docs'][ $key ]['email'] = $profile['email'];
				$groups[ $biz ]['docs'][ $key ]['business_type'] = $profile['type'];
				$groups[ $biz ]['docs'][ $key ]['business_item'] = $profile['item'];
			}
		}
		return $groups;
	}

	private function identity_conflict( &$identity, array $row ) {
		$company        = trim( (string) $row['business_company'] );
		$representative = trim( (string) $row['business_representative'] );
		$address        = trim( (string) $row['business_address'] );
		$current        = implode( '|', array( $company, $representative, $address ) );
		if ( null === $identity ) {
			$identity = $current;
			return false;
		}
		if ( $current === $identity ) {
			return false;
		}
		$prev = explode( '|', $identity );
		$cur  = explode( '|', $current );
		foreach ( array( 0, 1, 2 ) as $i ) {
			if ( '' !== $prev[ $i ] && '' !== $cur[ $i ] && $prev[ $i ] !== $cur[ $i ] ) {
				return true;
			}
		}
		return false;
	}

	private function business_profile( $user_id, $biz ) {
		$company = (string) get_user_meta( $user_id, 'billing_company', true );
		$name    = (string) get_user_meta( $user_id, 'billing_first_name', true );
		$address = trim( (string) get_user_meta( $user_id, 'billing_address_1', true ) . ' ' . (string) get_user_meta( $user_id, 'billing_address_2', true ) );
		$tax_email = (string) get_user_meta( $user_id, '_avo_tax_email', true );
		$billing_email = (string) get_user_meta( $user_id, 'billing_email', true );
		$type = (string) get_user_meta( $user_id, '_avo_business_type', true );
		$item = (string) get_user_meta( $user_id, '_avo_business_item', true );
		$email = $tax_email;
		$email_fallback = false;
		if ( '' === $email ) {
			$email = $billing_email;
			$email_fallback = true;
		}
		$issues = array();
		if ( '' === $company ) {
			$issues[] = array( 'code' => 'PROFILE_REVIEW_REQUIRED', 'message' => '상호 누락' );
		}
		if ( '' === $address ) {
			$issues[] = array( 'code' => 'PROFILE_REVIEW_REQUIRED', 'message' => '사업장주소 누락' );
		}
		if ( '' === $email ) {
			$issues[] = array( 'code' => 'PROFILE_REVIEW_REQUIRED', 'message' => '세금계산서 이메일 누락' );
		} elseif ( $email_fallback ) {
			$issues[] = array( 'code' => 'TAX_EMAIL_FALLBACK', 'message' => '세금계산서 이메일 미지정, 가입 이메일 사용' );
		}
		return array(
			'company' => '' !== $company ? $company : $name,
			'name' => $name,
			'address' => $address,
			'email' => $email,
			'type' => $type,
			'item' => $item,
			'issues' => $issues,
		);
	}

	private function normalize_business_number( $value ) {
		return preg_replace( '/[^0-9]/', '', (string) $value );
	}

	private function collect_refunds( array $rows ) {
		$refunds = array();
		$seen = array();
		foreach ( $rows as $row ) {
			$order_id = (int) $row['order_id'];
			if ( isset( $seen[ $order_id ] ) ) {
				continue;
			}
			$seen[ $order_id ] = true;
			$order = wc_get_order( $order_id );
			if ( ! $order ) {
				continue;
			}
			$biz = $row['business_number'];
			foreach ( $order->get_refunds() as $refund ) {
				if ( ! $refund instanceof WC_Order_Refund ) {
					continue;
				}
				$created = $refund->get_date_created();
				if ( ! $created ) {
					continue;
				}
				$net = abs( (float) $refund->get_total() ) - abs( (float) $refund->get_total_tax() );
				$vat = abs( (float) $refund->get_total_tax() );
				$line_ids = array();
				$types = array();
				foreach ( $refund->get_items() as $item ) {
					if ( $item instanceof WC_Order_Item_Product ) {
						$line_ids[] = (int) $item->get_id();
						$types[] = $this->tax_document_type( $item );
					}
				}
				$refunds[] = array(
					'refund_id' => (int) $refund->get_id(),
					'created_at' => $created->date( 'Y-m-d' ),
					'order_id' => $order_id,
					'business_number' => $biz,
					'company' => $row['business_company'],
					'line_ids' => $line_ids,
					'net' => $net,
					'vat' => $vat,
					'gross' => $net + $vat,
					'tax_type' => $this->dominant_type( $types, $row['tax_type'] ),
					'original_period' => substr( $row['supply_at'], 0, 7 ),
					'created_period' => $created->date( 'Y-m' ),
				);
			}
		}
		return $refunds;
	}

	private function dominant_type( array $types, $fallback ) {
		foreach ( array( 'TAXABLE', 'EXEMPT', 'ZERO_RATED', 'UNCLASSIFIED' ) as $candidate ) {
			if ( in_array( $candidate, $types, true ) ) {
				return $candidate;
			}
		}
		return $fallback;
	}

	private function apply_refunds( array $groups, array $refunds ) {
		foreach ( $refunds as $refund ) {
			if ( empty( $refund['same_period'] ) ) {
				continue;
			}
			$biz = $refund['business_number'];
			if ( '' === $biz ) {
				continue;
			}
			$type = $refund['tax_type'];
			if ( ! isset( $groups[ $biz ]['docs'][ $type ] ) ) {
				continue;
			}
			if ( 'TAXABLE' === $type ) {
				$groups[ $biz ]['docs'][ $type ]['supply'] -= $refund['net'];
				$groups[ $biz ]['docs'][ $type ]['vat'] -= $refund['vat'];
				$groups[ $biz ]['docs'][ $type ]['gross'] -= $refund['gross'];
			} else {
				$groups[ $biz ]['docs'][ $type ]['supply'] -= $refund['gross'];
				$groups[ $biz ]['docs'][ $type ]['gross'] -= $refund['gross'];
			}
		}
		return $groups;
	}

	private function col_letter( $col ) {
		$letter = '';
		$col++;
		while ( $col > 0 ) {
			$col--;
			$letter = chr( 65 + ( $col % 26 ) ) . $letter;
			$col = intdiv( $col, 26 );
		}
		return $letter;
	}

	private function write_xlsx( $path, array $sheets ) {
		$z = new ZipArchive();
		if ( true !== $z->open( $path, ZipArchive::CREATE | ZipArchive::OVERWRITE ) ) {
			return false;
		}
		$overrides = '';
		$n = 1;
		foreach ( $sheets as $title => $rows ) {
			$overrides .= '<Override PartName="/xl/worksheets/sheet' . $n . '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
			$n++;
		}
		$z->addFromString( '[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' . $overrides . '</Types>' );
		$z->addFromString( '_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' );
		$wb = '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>';
		$rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
		$n = 1;
		foreach ( $sheets as $title => $rows ) {
			$wb .= '<sheet name="' . htmlspecialchars( (string) $title, ENT_QUOTES, 'UTF-8' ) . '" sheetId="' . $n . '" r:id="rId' . $n . '"/>';
			$rels .= '<Relationship Id="rId' . $n . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' . $n . '.xml"/>';
			$xml = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
			foreach ( $rows as $rn => $row ) {
				$xml .= '<row r="' . ( $rn + 1 ) . '">';
				foreach ( array_values( $row ) as $col => $v ) {
					$ref = $this->col_letter( $col ) . ( $rn + 1 );
					$xml .= '<c r="' . $ref . '" t="inlineStr"><is><t>' . htmlspecialchars( (string) $v, ENT_XML1 | ENT_QUOTES, 'UTF-8' ) . '</t></is></c>';
				}
				$xml .= '</row>';
			}
			$xml .= '</sheetData></worksheet>';
			$z->addFromString( 'xl/worksheets/sheet' . $n . '.xml', $xml );
			$n++;
		}
		$wb .= '</sheets></workbook>';
		$rels .= '</Relationships>';
		$z->addFromString( 'xl/workbook.xml', $wb );
		$z->addFromString( 'xl/_rels/workbook.xml.rels', $rels );
		return $z->close();
	}

	private function write_files( $period, $written_date, $taxable, $exempt, $rows, $review, $summary, $refunds ) {
		$dir = WP_CONTENT_DIR . '/wholesalehub-private/monthly-tax';
		if ( ! is_dir( $dir ) && ! wp_mkdir_p( $dir ) ) {
			return array();
		}
		$files = array_merge(
			$this->write_hometax( $dir, $period, $written_date, $taxable, '01' ),
			$this->write_hometax( $dir, $period, $written_date, $exempt, '02' )
		);

		$audit = $this->audit_rows( $summary, $rows );
		$audit_file = $dir . '/' . $period . '_월간_세금계산서_검증내역.xlsx';
		$this->write_xlsx( $audit_file, array( '요약' => $audit['summary'], '사업자별' => $audit['business'], '주문상세' => $audit['orders'] ) );
		$files[] = $audit_file;

		if ( ! empty( $review ) ) {
			$review_rows = array( array( '사업자번호', '상호', '주문번호', '문제코드', '설명' ) );
			foreach ( $review as $r ) {
				$review_rows[] = array( $r['business_number'], $r['company'], isset( $r['order_id'] ) ? $r['order_id'] : '', $r['code'], $r['message'] );
			}
			$review_file = $dir . '/' . $period . '_세금자료_검토필요.xlsx';
			$this->write_xlsx( $review_file, array( '검토필요' => $review_rows ) );
			$files[] = $review_file;
		}

		if ( ! empty( $refunds ) ) {
			$refund_rows = array( array( '환불ID', '환불일', '원주문', '기공급월', '환불귀속월', '과세구분', '환불공급가액', '환불VAT', '환불총액', '처리' ) );
			foreach ( $refunds as $rf ) {
				$refund_rows[] = array(
					$rf['refund_id'],
					$rf['created_at'],
					$rf['order_id'],
					$rf['original_period'],
					$rf['created_period'],
					$rf['tax_type'],
					$rf['net'],
					$rf['vat'],
					$rf['gross'],
					$rf['same_period'] ? '동일기간 차감' : 'POST_PERIOD_REFUND_REVIEW',
				);
			}
			$refund_file = $dir . '/' . $period . '_환불_추적내역.xlsx';
			$this->write_xlsx( $refund_file, array( '환불추적' => $refund_rows ) );
			$files[] = $refund_file;
		}
		return $files;
	}

	private function write_hometax( $dir, $period, $written_date, $docs, $default_code ) {
		$files = array();
		foreach ( array_chunk( $docs, 100 ) as $index => $chunk ) {
			$suffix = $index > 0 ? '_' . str_pad( (string) ( $index + 1 ), 2, '0', STR_PAD_LEFT ) : '_01';
			$label = '02' === $default_code ? '_면세_전자계산서' : '_과세_전자세금계산서';
			$file = $dir . '/' . $period . $label . '_홈택스업로드' . $suffix . '.xlsx';
			$data_rows = array( self::TAXABLE_COLUMNS );
			for ( $i = 2; $i <= 6; $i++ ) {
				$data_rows[] = array_fill( 0, count( self::TAXABLE_COLUMNS ), '' );
			}
			foreach ( $chunk as $doc ) {
				$data_rows[] = $this->hometax_row( $doc, $written_date, $default_code, $period );
			}
			$this->write_xlsx( $file, array( 'Sheet1' => $data_rows ) );
			$files[] = $file;
		}
		return $files;
	}

	private function hometax_row( $doc, $written_date, $default_code, $period ) {
		$supply = round( $doc['supply'] );
		$vat = round( $doc['vat'] );
		$row = array_fill( 0, 59, '' );
		$row[0] = $default_code;
		$row[1] = $written_date;
		$row[10] = $doc['business_number'];
		$row[12] = $doc['company'];
		$row[13] = $doc['name'];
		$row[14] = $doc['address'];
		$row[15] = $doc['business_type'];
		$row[16] = $doc['business_item'];
		$row[17] = $doc['email'];
		$row[19] = (string) $supply;
		$row[20] = (string) $vat;
		$row[22] = substr( $written_date, 6, 2 );
		$row[23] = $this->item_label( $period );
		$row[25] = '1';
		$row[26] = (string) $supply;
		$row[27] = (string) $supply;
		$row[28] = (string) $vat;
		$row[58] = '01';
		return $row;
	}

	private function item_label( $period ) {
		$y = substr( $period, 0, 4 );
		$m = (int) substr( $period, 5, 2 );
		return $y . '년 ' . $m . '월 도매상품 매출 합계';
	}

	private function audit_rows( $summary, $rows ) {
		$summary_rows = array(
			array( '항목', '값' ),
			array( '귀속월', $summary['period'] ),
			array( '사업자 거래처', $summary['business_count'] ),
			array( '과세 공급가액', $summary['taxable_supply'] ),
			array( '세액', $summary['taxable_vat'] ),
			array( '면세 공급가액', $summary['exempt_supply'] ),
			array( '검토 필요', $summary['review_count'] ),
			array( '기공급월 환불 검토', $summary['post_period_refund_count'] ),
			array( '고려대가 모드', $this->consideration_mode() ),
		);
		$business_rows = array( array( '사업자번호', '상호', '주문건수' ) );
		$order_rows = array( array( '주문번호', '사업자번호', '상품', '수량', '과세구분', '공급가액', '세액', '공급시기', '공급시기출처' ) );
		$biz_orders = array();
		foreach ( $rows as $r ) {
			if ( '' === $r['business_number'] ) {
				continue;
			}
			if ( ! isset( $biz_orders[ $r['business_number'] ] ) ) {
				$biz_orders[ $r['business_number'] ] = array();
			}
			$biz_orders[ $r['business_number'] ][] = $r['order_id'];
			$supply_source = $r['supply_legacy'] ? 'LEGACY_DATE_PAID' : ( $r['supply_proxy'] ? 'SUPPLY_DATE_PROXY' : 'SUPPLY_EVENT' );
			$order_rows[] = array( $r['order_id'], $r['business_number'], $r['product'], $r['qty'], $r['tax_type'], $r['supply'], $r['vat'], $r['supply_at'], $supply_source );
		}
		foreach ( $biz_orders as $biz => $ids ) {
			$business_rows[] = array( $biz, '', count( array_unique( $ids ) ) );
		}
		return array( 'summary' => $summary_rows, 'business' => $business_rows, 'orders' => $order_rows );
	}

	private function send_telegram( $period, $result, $force ) {
		if ( (int) $result['business_count'] === 0 ) {
			if ( function_exists( 'avocadoss_send_telegram_message' ) ) {
				avocadoss_send_telegram_message( '[도매Hub ' . $period . ' 세금자료]\n사업자 대상 거래 0건\n생성 파일 없음' );
			}
			return;
		}
		$message = sprintf(
			"[도매Hub %s 세금자료 준비]\n작성일자: %s\n사업자 거래처: %d개\n\n전자세금계산서(과세)\n- 거래처: %d개\n- 공급가액: %s원\n- 세액: %s원\n\n전자계산서(면세)\n- 공급가액: %s원\n\n검토 필요: %d건\n기공급월 환불 검토: %d건",
			$period,
			$result['written_date'],
			$result['business_count'],
			$result['taxable_docs'],
			number_format( $result['taxable_supply'] ),
			number_format( $result['taxable_vat'] ),
			number_format( $result['exempt_supply'] ),
			$result['review_count'],
			$result['post_period_refund_count']
		);
		avocadoss_send_telegram_message( $message );
		$token = trim( (string) get_option( 'avocadoss_telegram_bot_token', '' ) );
		$chat  = trim( (string) get_option( 'avocadoss_telegram_chat_id', '' ) );
		if ( '' === $token || '' === $chat ) {
			return;
		}
		foreach ( $result['files'] as $file ) {
			$this->send_document( $file, $token, $chat );
		}
	}

	private function send_document( $file, $token, $chat ) {
		$curl = curl_init( 'https://api.telegram.org/bot' . $token . '/sendDocument' );
		curl_setopt_array(
			$curl,
			array(
				CURLOPT_POST => true,
				CURLOPT_RETURNTRANSFER => true,
				CURLOPT_TIMEOUT => 60,
				CURLOPT_POSTFIELDS => array(
					'chat_id' => $chat,
					'document' => new CURLFile( $file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', basename( $file ) ),
				),
			)
		);
		$res = curl_exec( $curl );
		curl_close( $curl );
		return false !== $res;
	}

	public static function import_review_file( $file, $dry_run ) {
		$z = new ZipArchive();
		if ( true !== $z->open( $file ) ) {
			WP_CLI::error( 'review 엑셀을 열 수 없습니다.' );
		}
		$rows = array();
		$sheet_xml = false;
		for ( $i = 0; $i < $z->numFiles; $i++ ) {
			$name = $z->getNameIndex( $i );
			if ( false !== strpos( $name, 'worksheets/sheet' ) && substr( $name, -4 ) === '.xml' ) {
				$sheet_xml = $z->getFromIndex( $i );
				break;
			}
		}
		$z->close();
		if ( false === $sheet_xml ) {
			WP_CLI::error( 'review 엑셀 시트를 찾을 수 없습니다.' );
		}
		$document = new DOMDocument();
		$document->loadXML( $sheet_xml );
		$xpath = new DOMXPath( $document );
		$xpath->registerNamespace( 'm', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main' );
		$row_nodes = $xpath->query( '//m:sheetData/m:row' );
		$allowed = array( 'TAXABLE', 'EXEMPT', 'ZERO_RATED', 'UNCLASSIFIED' );
		$seen = array();
		$imported = 0;
		$conflicts = 0;
		$index = 0;
		foreach ( $row_nodes as $row_node ) {
			$index++;
			if ( 1 === $index ) {
				continue;
			}
			$cells = array();
			foreach ( $xpath->query( './m:c', $row_node ) as $cell ) {
				$value = '';
				foreach ( $xpath->query( './/m:t', $cell ) as $text ) {
					$value .= $text->textContent;
				}
				$cells[] = $value;
			}
			$variation_id = isset( $cells[0] ) ? absint( $cells[0] ) : 0;
			$confirmed = isset( $cells[5] ) ? strtoupper( trim( (string) $cells[5] ) ) : '';
			if ( $variation_id <= 0 ) {
				continue;
			}
			if ( '' === $confirmed ) {
				continue;
			}
			if ( ! in_array( $confirmed, $allowed, true ) ) {
				continue;
			}
			if ( isset( $seen[ $variation_id ] ) ) {
				$conflicts++;
				continue;
			}
			$seen[ $variation_id ] = true;
			if ( ! $dry_run ) {
				update_post_meta( $variation_id, '_wh_tax_document_type', $confirmed );
			}
			$imported++;
		}
		return array( 'imported' => $imported, 'conflicts' => $conflicts, 'dry_run' => $dry_run );
	}
}

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	WP_CLI::add_command( 'avocadoss monthly-tax-export', 'Avocadoss_WholesaleHub_Monthly_Tax_Export_Command' );
	WP_CLI::add_command(
		'avocadoss tax-classification',
		function ( $args, $assoc_args ) {
			$action = isset( $args[0] ) ? $args[0] : '';
			if ( 'set' === $action ) {
				$variation = isset( $assoc_args['variation'] ) ? absint( $assoc_args['variation'] ) : 0;
				$type = isset( $assoc_args['type'] ) ? strtoupper( sanitize_text_field( $assoc_args['type'] ) ) : '';
				if ( $variation <= 0 || ! in_array( $type, array( 'TAXABLE', 'EXEMPT', 'ZERO_RATED', 'UNCLASSIFIED' ), true ) ) {
					WP_CLI::error( 'usage: wp avocadoss tax-classification set --variation=ID --type=TAXABLE|EXEMPT|ZERO_RATED|UNCLASSIFIED' );
				}
				update_post_meta( $variation, '_wh_tax_document_type', $type );
				WP_CLI::success( "variation {$variation} -> {$type}" );
				return;
			}
			if ( 'export-review' === $action ) {
				global $wpdb;
				$rows = $wpdb->get_results(
					"SELECT p.ID as vid, p.post_parent as pid FROM {$wpdb->posts} p WHERE p.post_type='product_variation' AND p.post_status='publish'",
					ARRAY_A
				);
				$out = array( array( 'variation_id', 'parent_id', '상품명', '옵션명', '현재 분류', '확정 분류', '비고' ) );
				foreach ( $rows as $r ) {
					$type = (string) get_post_meta( (int) $r['vid'], '_wh_tax_document_type', true );
					$v = wc_get_product( (int) $r['vid'] );
					$out[] = array(
						$r['vid'],
						$r['pid'],
						get_the_title( (int) $r['pid'] ),
						$v ? $v->get_name() : '',
						'' === $type ? 'UNCLASSIFIED' : $type,
						'',
						'',
					);
				}
				$dir = WP_CONTENT_DIR . '/wholesalehub-private/monthly-tax';
				wp_mkdir_p( $dir );
				$file = $dir . '/도매허브_상품_과세구분_검토.xlsx';
				$z = new ZipArchive();
				$z->open( $file, ZipArchive::CREATE | ZipArchive::OVERWRITE );
				$z->addFromString( '[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' );
				$z->addFromString( '_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' );
				$z->addFromString( 'xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>' );
				$z->addFromString( 'xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' );
				$xml = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
				foreach ( $out as $n => $row ) {
					$xml .= '<row r="' . ( $n + 1 ) . '">';
					foreach ( array_values( $row ) as $col => $v ) {
						$xml .= '<c r="' . chr( 65 + $col ) . ( $n + 1 ) . '" t="inlineStr"><is><t>' . htmlspecialchars( (string) $v, ENT_XML1 | ENT_QUOTES, 'UTF-8' ) . '</t></is></c>';
					}
					$xml .= '</row>';
				}
				$xml .= '</sheetData></worksheet>';
				$z->addFromString( 'xl/worksheets/sheet1.xml', $xml );
				$z->close();
				WP_CLI::success( 'review excel: ' . $file );
				return;
			}
			if ( 'import-review' === $action ) {
				$file = isset( $assoc_args['file'] ) ? (string) $assoc_args['file'] : '';
				$dry_run = isset( $assoc_args['dry-run'] );
				if ( '' === $file || ! is_readable( $file ) ) {
					WP_CLI::error( 'usage: wp avocadoss tax-classification import-review --file=PATH [--dry-run]' );
				}
				$result = Avocadoss_WholesaleHub_Monthly_Tax_Export_Command::import_review_file( $file, $dry_run );
				WP_CLI::line( wp_json_encode( $result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) );
				return;
			}
			WP_CLI::error( 'usage: wp avocadoss tax-classification <set|export-review|import-review>' );
		}
	);
	WP_CLI::add_command(
		'avocadoss tax-config',
		function ( $args, $assoc_args ) {
			$action = isset( $args[0] ) ? $args[0] : '';
			if ( 'set-consideration-mode' === $action ) {
				$mode = isset( $assoc_args['mode'] ) ? strtoupper( sanitize_text_field( $assoc_args['mode'] ) ) : '';
				if ( ! in_array( $mode, array( 'VAT_INCLUDED', 'VAT_EXCLUDED_SEPARATE', 'UNCONFIRMED' ), true ) ) {
					WP_CLI::error( 'usage: wp avocadoss tax-config set-consideration-mode --mode=VAT_INCLUDED|VAT_EXCLUDED_SEPARATE|UNCONFIRMED' );
				}
				update_option( '_wh_taxable_consideration_mode', $mode, false );
				WP_CLI::success( 'consideration mode -> ' . $mode );
				return;
			}
			if ( 'show' === $action ) {
				$mode = strtoupper( trim( (string) get_option( '_wh_taxable_consideration_mode', 'UNCONFIRMED' ) ) );
				WP_CLI::line( wp_json_encode( array( '_wh_taxable_consideration_mode' => $mode ), JSON_UNESCAPED_UNICODE ) );
				return;
			}
			WP_CLI::error( 'usage: wp avocadoss tax-config <set-consideration-mode|show>' );
		}
	);
}
