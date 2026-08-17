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
		WP_CLI::line( wp_json_encode( $result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) );

		if ( $dry_run ) {
			return;
		}
		$this->send_telegram( $period, $result, $force );
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

		$rows   = $this->collect_rows( $start, $end );
		$groups = $this->group_by_business( $rows );

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
		);

		foreach ( $groups as $biz => $data ) {
			$summary['business_count']++;
			if ( ! empty( $data['issues'] ) ) {
				foreach ( $data['issues'] as $issue ) {
					$review[] = array_merge( array( 'business_number' => $biz, 'company' => $data['company'] ), $issue );
				}
				$summary['review_count'] += count( $data['issues'] );
				continue;
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

		$files = array();
		if ( ! $dry_run ) {
			$files = $this->write_files( $period, $written_date, $taxable, $exempt, $rows, $review, $summary );
		}

		return array(
			'period' => $period,
			'written_date' => $written_date,
			'taxable_docs' => count( $taxable ),
			'exempt_docs' => count( $exempt ),
			'review_count' => $summary['review_count'],
			'taxable_supply' => $summary['taxable_supply'],
			'taxable_vat' => $summary['taxable_vat'],
			'exempt_supply' => $summary['exempt_supply'],
			'business_count' => $summary['business_count'],
			'files' => $files,
		);
	}

	private function collect_rows( $start, $end ) {
		$rows = array();
		$args = array(
			'status' => self::ELIGIBLE_ORDER_STATUSES,
			'limit' => -1,
			'type' => 'shop_order',
			'return' => 'ids',
			'date_paid' => $start . '...' . $end,
		);
		foreach ( wc_get_orders( $args ) as $order_id ) {
			$order = wc_get_order( (int) $order_id );
			if ( ! $order || ! $order->get_date_paid() ) {
				continue;
			}
			$uid = (int) $order->get_user_id();
			$biz = $this->normalize_business_number( (string) get_user_meta( $uid, '_avo_business_number', true ) );
			foreach ( $order->get_items() as $item_id => $item ) {
				if ( ! $item instanceof WC_Order_Item_Product ) {
					continue;
				}
				$rows[] = array(
					'order_id' => (int) $order_id,
					'user_id' => $uid,
					'business_number' => $biz,
					'item_id' => (int) $item_id,
					'product' => $item->get_name(),
					'qty' => $item->get_quantity(),
					'tax_type' => $this->tax_document_type( $item ),
					'net' => (float) $item->get_total(),
					'vat' => (float) $item->get_total_tax(),
					'paid_at' => $order->get_date_paid()->date( 'Y-m-d' ),
				);
			}
		}
		return $rows;
	}

	private function tax_document_type( WC_Order_Item_Product $item ) {
		$class  = (string) $item->get_tax_class();
		$status = (string) $item->get_tax_status();
		if ( 'zero-rate' === $class ) {
			return 'ZERO_RATED';
		}
		if ( 'taxable' === $status ) {
			return 'TAXABLE';
		}
		if ( 'none' === $status ) {
			return 'EXEMPT';
		}
		return 'UNCLASSIFIED';
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
				$groups[ $biz ] = array( 'company' => $profile['company'], 'profile' => $profile, 'issues' => array(), 'docs' => array() );
			}
			if ( ! empty( $groups[ $biz ]['profile']['issues'] ) ) {
				foreach ( $groups[ $biz ]['profile']['issues'] as $issue ) {
					$groups[ $biz ]['issues'][] = $issue;
				}
				$groups[ $biz ]['profile']['issues'] = array();
			}
			if ( 'UNCLASSIFIED' === $row['tax_type'] ) {
				$groups[ $biz ]['issues'][] = array( 'order_id' => $row['order_id'], 'code' => 'TAX_CLASS_REVIEW_REQUIRED', 'message' => '과세구분 미확정' );
				continue;
			}
			$key = $row['tax_type'];
			if ( ! isset( $groups[ $biz ]['docs'][ $key ] ) ) {
				$groups[ $biz ]['docs'][ $key ] = array( 'type' => $row['tax_type'], 'supply' => 0.0, 'vat' => 0.0 );
			}
			$groups[ $biz ]['docs'][ $key ]['supply'] += $row['net'];
			$groups[ $biz ]['docs'][ $key ]['vat'] += $row['vat'];
		}
		return $groups;
	}

	private function business_profile( $user_id, $biz ) {
		$company = (string) get_user_meta( $user_id, 'billing_company', true );
		$name    = (string) get_user_meta( $user_id, 'billing_first_name', true );
		$address = trim( (string) get_user_meta( $user_id, 'billing_address_1', true ) . ' ' . (string) get_user_meta( $user_id, 'billing_address_2', true ) );
		$email   = (string) get_user_meta( $user_id, 'billing_email', true );
		$issues  = array();
		if ( '' === $company ) {
			$issues[] = array( 'code' => 'PROFILE_REVIEW_REQUIRED', 'message' => '상호 누락' );
		}
		if ( '' === $address ) {
			$issues[] = array( 'code' => 'PROFILE_REVIEW_REQUIRED', 'message' => '사업장주소 누락' );
		}
		if ( '' === $email ) {
			$issues[] = array( 'code' => 'PROFILE_REVIEW_REQUIRED', 'message' => '세금계산서 이메일 누락' );
		}
		return array(
			'company' => '' !== $company ? $company : $name,
			'name' => $name,
			'address' => $address,
			'email' => $email,
			'issues' => $issues,
		);
	}

	private function normalize_business_number( $value ) {
		return preg_replace( '/[^0-9]/', '', (string) $value );
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

	private function write_files( $period, $written_date, $taxable, $exempt, $rows, $review, $summary ) {
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
		);
		$business_rows = array( array( '사업자번호', '상호', '주문건수' ) );
		$order_rows = array( array( '주문번호', '사업자번호', '상품', '수량', '과세구분', '공급가액', '세액' ) );
		$biz_orders = array();
		foreach ( $rows as $r ) {
			if ( '' === $r['business_number'] ) {
				continue;
			}
			if ( ! isset( $biz_orders[ $r['business_number'] ] ) ) {
				$biz_orders[ $r['business_number'] ] = array();
			}
			$biz_orders[ $r['business_number'] ][] = $r['order_id'];
			$order_rows[] = array( $r['order_id'], $r['business_number'], $r['product'], $r['qty'], $r['tax_type'], $r['net'], $r['vat'] );
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
			"[도매Hub %s 세금자료 준비]\n작성일자: %s\n사업자 거래처: %d개\n\n전자세금계산서(과세)\n- 거래처: %d개\n- 공급가액: %s원\n- 세액: %s원\n\n전자계산서(면세)\n- 공급가액: %s원\n\n검토 필요: %d건",
			$period,
			$result['written_date'],
			$result['business_count'],
			$result['taxable_docs'],
			number_format( $result['taxable_supply'] ),
			number_format( $result['taxable_vat'] ),
			number_format( $result['exempt_supply'] ),
			$result['review_count']
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
}

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	WP_CLI::add_command( 'avocadoss monthly-tax-export', 'Avocadoss_WholesaleHub_Monthly_Tax_Export_Command' );
}
