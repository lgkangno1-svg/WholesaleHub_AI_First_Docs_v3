<?php
/**
 * Supplier order XLSX export and Telegram delivery.
 *
 * Registered command:
 *   wp avocadoss supplier-order-export [--date=YYYY-MM-DD]
 *     [--supplier=dailyfood|walldo] [--dry-run] [--resend-batch=ID]
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Avocadoss_WholesaleHub_Supplier_Order_Export_Command {
    private const ELIGIBLE_ORDER_STATUSES = array( 'processing', 'completed' );
    private const SUPPLIERS = array( 'dailyfood', 'walldob2b' );

    public function __invoke( $args, $assoc_args ) {
        $date             = isset( $assoc_args['date'] ) ? sanitize_text_field( $assoc_args['date'] ) : wp_date( 'Y-m-d', null, new DateTimeZone( 'Asia/Seoul' ) );
        $supplier_filter  = isset( $assoc_args['supplier'] ) ? $this->normalize_supplier( $assoc_args['supplier'] ) : '';
        $dry_run          = isset( $assoc_args['dry-run'] );
        $resend_batch_id  = isset( $assoc_args['resend-batch'] ) ? absint( $assoc_args['resend-batch'] ) : 0;
        $order_id_filter  = isset( $assoc_args['order-id'] ) ? absint( $assoc_args['order-id'] ) : 0;
        $simulate_failure = isset( $assoc_args['simulate-failure'] ) ? $this->normalize_supplier( $assoc_args['simulate-failure'] ) : '';

        if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $date ) ) {
            WP_CLI::error( '--date must be YYYY-MM-DD.' );
        }
        if ( isset( $assoc_args['supplier'] ) && ! $supplier_filter ) {
            WP_CLI::error( '--supplier must be dailyfood or walldo.' );
        }

        $database = $this->open_database();
        $this->ensure_schema( $database );

        if ( $resend_batch_id ) {
            $batch = $this->load_batch( $database, $resend_batch_id );
            if ( ! $batch || 'sent' === $batch['status'] ) {
                WP_CLI::error( 'The requested batch is unavailable or already sent.' );
            }
            $supplier_filter = $this->normalize_supplier( $batch['supplier_id'] );
        }

        $suppliers = $supplier_filter ? array( $supplier_filter ) : self::SUPPLIERS;
        $summary   = array(
            'dailyfood'       => array( 'orders' => 0, 'rows' => 0, 'payable' => 0, 'missing_amount' => 0 ),
            'walldob2b'       => array( 'orders' => 0, 'rows' => 0, 'payable' => 0, 'missing_amount' => 0 ),
            'documents_sent'  => 0,
            'source_unmapped' => $this->count_source_unmapped( $database, $order_id_filter ),
            'duplicate_rows'  => 0,
            'files_deleted'   => true,
            'failures'        => array(),
            'missing_amount_items' => array(),
        );

        foreach ( $suppliers as $supplier_id ) {
            $rows = $this->load_rows( $database, $supplier_id, $order_id_filter );
            if ( empty( $rows ) ) {
                continue;
            }

            if ( 'dailyfood' === $supplier_id ) {
                $sender = $this->dailyfood_sender();
                if ( ! $sender ) {
                    $summary['failures'][] = 'DailyFood sender settings are missing.';
                    if ( ! $dry_run ) {
                        avocadoss_send_telegram_message( '[도매Hub 발주서] DailyFood 발송인 설정이 누락되었습니다: DAILY_SENDER_ADDRESS, DAILY_SENDER_NAME, DAILY_SENDER_PHONE' );
                    }
                    continue;
                }
            } else {
                $sender = null;
            }

            $batch_id = 0;
            $file     = '';
            try {
                if ( ! $dry_run ) {
                    $batch_id = $this->create_batch( $database, $supplier_id, $date, count( $rows ) );
                }
                $file = $this->private_temp_file( $supplier_id, $date );
                $this->build_workbook( $supplier_id, $rows, $file, $sender );
                $this->verify_workbook( $supplier_id, $file, count( $rows ) );

                $summary[ $supplier_id ]['rows']   = count( $rows );
                $summary[ $supplier_id ]['orders'] = count( array_unique( array_column( $rows, 'woo_order_id' ) ) );
                foreach ( $rows as $row ) {
                    if ( null === $row['line_payable_snapshot'] ) {
                        ++$summary[ $supplier_id ]['missing_amount'];
                        $summary['missing_amount_items'][] = array(
                            'woo_order_id'      => $row['woo_order_id'],
                            'woo_order_item_id' => $row['woo_order_item_id'],
                        );
                    } else {
                        $summary[ $supplier_id ]['payable'] += (int) $row['line_payable_snapshot'];
                    }
                }

                if ( $dry_run ) {
                    continue;
                }
                if ( $simulate_failure === $supplier_id ) {
                    throw new RuntimeException( 'Simulated supplier delivery failure.' );
                }

                $message_id = $this->send_document( $file );
                $this->mark_sent( $database, $batch_id, $message_id, $rows );
                ++$summary['documents_sent'];
            } catch ( Throwable $error ) {
                if ( $batch_id ) {
                    $this->mark_failed( $database, $batch_id, $error->getMessage() );
                }
                $summary['failures'][] = $this->supplier_label( $supplier_id ) . ': ' . $error->getMessage();
            } finally {
                if ( $file && file_exists( $file ) && ! unlink( $file ) ) {
                    $summary['files_deleted'] = false;
                }
            }
        }

        if ( ! $dry_run ) {
            $this->send_summary( $date, $summary );
        }

        WP_CLI::line(
            wp_json_encode(
                array(
                    'dailyfood_rows'  => $summary['dailyfood']['rows'],
                    'walldo_rows'     => $summary['walldob2b']['rows'],
                    'dailyfood_payable' => $summary['dailyfood']['payable'],
                    'walldo_payable'    => $summary['walldob2b']['payable'],
                    'missing_amount'    => count( $summary['missing_amount_items'] ),
                    'documents_sent' => $summary['documents_sent'],
                    'source_unmapped'=> $summary['source_unmapped'],
                    'files_deleted'  => $summary['files_deleted'],
                    'failure_count'  => count( $summary['failures'] ),
                ),
                JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
            )
        );

        if ( ! empty( $summary['failures'] ) ) {
            WP_CLI::halt( 2 );
        }
    }

    private function open_database() {
        $path = WP_CONTENT_DIR . '/uploads/wholesalehub/wholesalehub.sqlite';
        if ( defined( 'WHOLESALEHUB_SQLITE_PATH' ) && WHOLESALEHUB_SQLITE_PATH ) {
            $path = WHOLESALEHUB_SQLITE_PATH;
        }
        if ( ! file_exists( $path ) ) {
            WP_CLI::error( 'WholesaleHub SQLite database was not found.' );
        }
        $database = new PDO( 'sqlite:' . $path );
        $database->setAttribute( PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION );
        $database->exec( 'PRAGMA busy_timeout = 10000' );
        return $database;
    }

    private function ensure_schema( PDO $database ) {
        $database->beginTransaction();
        try {
            $database->exec(
                "CREATE TABLE IF NOT EXISTS supplier_order_export_batches (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    supplier_id TEXT NOT NULL,
                    scheduled_at TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    sent_at TEXT,
                    status TEXT NOT NULL,
                    telegram_message_id TEXT,
                    file_name TEXT NOT NULL,
                    row_count INTEGER NOT NULL DEFAULT 0,
                    error_message TEXT
                )"
            );
            $database->exec(
                "CREATE TABLE IF NOT EXISTS supplier_order_export_items (
                    batch_id INTEGER NOT NULL,
                    woo_order_id INTEGER NOT NULL,
                    woo_order_item_id INTEGER NOT NULL,
                    source_snapshot_id INTEGER NOT NULL,
                    supplier_id TEXT NOT NULL,
                    exported_at TEXT NOT NULL,
                    FOREIGN KEY (batch_id) REFERENCES supplier_order_export_batches(id)
                )"
            );
            $database->exec(
                'CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_order_export_item ON supplier_order_export_items(woo_order_item_id, supplier_id)'
            );
            $database->exec(
                'CREATE INDEX IF NOT EXISTS ix_supplier_order_export_batch_status ON supplier_order_export_batches(supplier_id, status, sent_at)'
            );
            $database->commit();
        } catch ( Throwable $error ) {
            $database->rollBack();
            throw $error;
        }
    }

    private function load_rows( PDO $database, $supplier_id, $order_id_filter ) {
        $sql = "SELECT s.*
                FROM woo_order_item_source_snapshots s
                WHERE s.snapshot_status = 'mapped'
                  AND lower(s.supplier_id) = :supplier_id
                  AND NOT EXISTS (
                    SELECT 1
                    FROM supplier_order_export_items i
                    JOIN supplier_order_export_batches b ON b.id = i.batch_id
                    WHERE i.woo_order_item_id = s.woo_order_item_id
                      AND lower(i.supplier_id) = lower(s.supplier_id)
                      AND b.status = 'sent'
                  )";
        if ( $order_id_filter ) {
            $sql .= ' AND s.woo_order_id = :order_id';
        }
        $sql .= ' ORDER BY s.woo_order_id, s.woo_order_item_id';
        $statement = $database->prepare( $sql );
        $statement->bindValue( ':supplier_id', $supplier_id );
        if ( $order_id_filter ) {
            $statement->bindValue( ':order_id', $order_id_filter, PDO::PARAM_INT );
        }
        $statement->execute();

        $rows = array();
        foreach ( $statement->fetchAll( PDO::FETCH_ASSOC ) as $snapshot ) {
            $order = wc_get_order( (int) $snapshot['woo_order_id'] );
            if ( ! $order || ! in_array( $order->get_status(), self::ELIGIBLE_ORDER_STATUSES, true ) ) {
                continue;
            }
            $item = $order->get_item( (int) $snapshot['woo_order_item_id'] );
            if ( ! $item instanceof WC_Order_Item_Product ) {
                continue;
            }
            $rows[] = $this->map_order_row( $snapshot, $order, $item );
        }
        return $rows;
    }

    private function map_order_row( array $snapshot, WC_Order $order, WC_Order_Item_Product $item ) {
        $shipping_first = $order->get_shipping_first_name();
        $shipping_last  = $order->get_shipping_last_name();
        $billing_first  = $order->get_billing_first_name();
        $billing_last   = $order->get_billing_last_name();
        $recipient      = trim( $shipping_first . ' ' . $shipping_last );
        if ( '' === $recipient ) {
            $recipient = trim( $billing_first . ' ' . $billing_last );
        }
        $shipping_phone = method_exists( $order, 'get_shipping_phone' ) ? $order->get_shipping_phone() : '';
        $phone          = $shipping_phone ? $shipping_phone : $order->get_billing_phone();
        $postcode       = $order->get_shipping_postcode() ? $order->get_shipping_postcode() : $order->get_billing_postcode();
        $address        = trim(
            implode(
                ' ',
                array_filter(
                    array(
                        $order->get_shipping_address_1() ? $order->get_shipping_address_1() : $order->get_billing_address_1(),
                        $order->get_shipping_address_2() ? $order->get_shipping_address_2() : $order->get_billing_address_2(),
                    )
                )
            )
        );
        return array(
            'woo_order_id'                    => (int) $snapshot['woo_order_id'],
            'woo_order_item_id'               => (int) $snapshot['woo_order_item_id'],
            'source_snapshot_id'              => (int) $snapshot['woo_order_item_id'],
            'supplier_id'                     => $this->normalize_supplier( $snapshot['supplier_id'] ),
            'supplier_original_product_title' => (string) $snapshot['supplier_original_product_title'],
            'supplier_original_option_name'   => (string) $snapshot['supplier_original_option_name'],
            'quantity'                        => (int) $snapshot['quantity'],
            'recipient'                       => $recipient,
            'recipient_phone'                 => (string) $phone,
            'postcode'                        => (string) $postcode,
            'address'                         => $address,
            'delivery_message'                => (string) $order->get_customer_note(),
            'buyer'                           => trim( $billing_first . ' ' . $billing_last ),
            'buyer_phone'                     => (string) $order->get_billing_phone(),
            'customer_product'                => (string) $item->get_name(),
            'unit_payable_snapshot'           => isset( $snapshot['unit_payable_snapshot'] ) && is_numeric( $snapshot['unit_payable_snapshot'] )
                ? (int) $snapshot['unit_payable_snapshot']
                : null,
            'line_payable_snapshot'           => isset( $snapshot['line_payable_snapshot'] ) && is_numeric( $snapshot['line_payable_snapshot'] )
                ? (int) $snapshot['line_payable_snapshot']
                : null,
            'shipping_included_snapshot'      => isset( $snapshot['shipping_included_snapshot'] )
                ? (int) $snapshot['shipping_included_snapshot']
                : null,
        );
    }

    private function count_source_unmapped( PDO $database, $order_id_filter ) {
        $sql = 'SELECT DISTINCT woo_order_id FROM woo_order_item_source_unmapped';
        $params = array();
        if ( $order_id_filter ) {
            $sql .= ' WHERE woo_order_id = :order_id';
            $params[':order_id'] = $order_id_filter;
        }
        $statement = $database->prepare( $sql );
        $statement->execute( $params );
        $count = 0;
        foreach ( $statement->fetchAll( PDO::FETCH_COLUMN ) as $order_id ) {
            $order = wc_get_order( (int) $order_id );
            if ( $order && in_array( $order->get_status(), self::ELIGIBLE_ORDER_STATUSES, true ) ) {
                ++$count;
            }
        }
        return $count;
    }

    private function create_batch( PDO $database, $supplier_id, $date, $row_count ) {
        $now       = wp_date( 'Y-m-d H:i:s', null, new DateTimeZone( 'Asia/Seoul' ) );
        $file_name = $this->file_name( $supplier_id, $date );
        $statement = $database->prepare(
            "INSERT INTO supplier_order_export_batches
             (supplier_id, scheduled_at, started_at, status, file_name, row_count)
             VALUES (:supplier_id, :scheduled_at, :started_at, 'started', :file_name, :row_count)"
        );
        $statement->execute(
            array(
                ':supplier_id'  => $supplier_id,
                ':scheduled_at' => $date . ' 06:00:00 KST',
                ':started_at'   => $now,
                ':file_name'    => $file_name,
                ':row_count'    => $row_count,
            )
        );
        return (int) $database->lastInsertId();
    }

    private function load_batch( PDO $database, $batch_id ) {
        $statement = $database->prepare( 'SELECT * FROM supplier_order_export_batches WHERE id = :id' );
        $statement->execute( array( ':id' => $batch_id ) );
        return $statement->fetch( PDO::FETCH_ASSOC );
    }

    private function mark_sent( PDO $database, $batch_id, $message_id, array $rows ) {
        $now = wp_date( 'Y-m-d H:i:s', null, new DateTimeZone( 'Asia/Seoul' ) );
        $database->beginTransaction();
        try {
            $update = $database->prepare(
                "UPDATE supplier_order_export_batches
                 SET status = 'sent', sent_at = :sent_at, telegram_message_id = :message_id, error_message = NULL
                 WHERE id = :id"
            );
            $update->execute( array( ':sent_at' => $now, ':message_id' => (string) $message_id, ':id' => $batch_id ) );
            $insert = $database->prepare(
                'INSERT OR IGNORE INTO supplier_order_export_items
                 (batch_id, woo_order_id, woo_order_item_id, source_snapshot_id, supplier_id, exported_at)
                 VALUES (:batch_id, :woo_order_id, :woo_order_item_id, :source_snapshot_id, :supplier_id, :exported_at)'
            );
            foreach ( $rows as $row ) {
                $insert->execute(
                    array(
                        ':batch_id'           => $batch_id,
                        ':woo_order_id'       => $row['woo_order_id'],
                        ':woo_order_item_id'  => $row['woo_order_item_id'],
                        ':source_snapshot_id' => $row['source_snapshot_id'],
                        ':supplier_id'        => $row['supplier_id'],
                        ':exported_at'        => $now,
                    )
                );
            }
            $database->commit();
        } catch ( Throwable $error ) {
            $database->rollBack();
            throw $error;
        }
    }

    private function mark_failed( PDO $database, $batch_id, $message ) {
        $statement = $database->prepare(
            "UPDATE supplier_order_export_batches
             SET status = 'failed', error_message = :error_message
             WHERE id = :id"
        );
        $statement->execute(
            array(
                ':error_message' => mb_substr( wp_strip_all_tags( (string) $message ), 0, 500 ),
                ':id'            => $batch_id,
            )
        );
    }

    private function dailyfood_sender() {
        $address = trim( (string) getenv( 'DAILY_SENDER_ADDRESS' ) );
        $name    = trim( (string) getenv( 'DAILY_SENDER_NAME' ) );
        $phone   = trim( (string) getenv( 'DAILY_SENDER_PHONE' ) );
        if ( '' === $address ) {
            $address = trim( (string) get_option( 'avocadoss_daily_sender_address', '' ) );
        }
        if ( '' === $name ) {
            $name = trim( (string) get_option( 'avocadoss_daily_sender_name', '' ) );
        }
        if ( '' === $phone ) {
            $phone = trim( (string) get_option( 'avocadoss_daily_sender_phone', '' ) );
        }
        if ( '' === $address || '' === $name || '' === $phone ) {
            return null;
        }
        return array( 'address' => $address, 'name' => $name, 'phone' => $phone );
    }

    private function build_workbook( $supplier_id, array $rows, $output_file, $sender ) {
        $template = __DIR__ . '/../templates/supplier-orders/' . ( 'dailyfood' === $supplier_id ? 'dailyfood.xlsx' : 'walldo.xlsx' );
        if ( ! file_exists( $template ) || ! copy( $template, $output_file ) ) {
            throw new RuntimeException( 'Supplier template could not be copied.' );
        }
        $archive = new ZipArchive();
        if ( true !== $archive->open( $output_file ) ) {
            throw new RuntimeException( 'XLSX archive could not be opened.' );
        }
        try {
            $sheet_path = $this->worksheet_path( $archive, 'dailyfood' === $supplier_id ? 'Sheet1' : 'Sheet2' );
            $xml        = $archive->getFromName( $sheet_path );
            if ( false === $xml ) {
                throw new RuntimeException( 'Worksheet XML is missing.' );
            }
            $text_styles = $this->ensure_text_styles( $archive, $xml, $supplier_id );
            $updated     = $this->rewrite_sheet( $xml, $supplier_id, $rows, $sender, $text_styles );
            if ( ! $archive->addFromString( $sheet_path, $updated ) ) {
                throw new RuntimeException( 'Worksheet XML could not be updated.' );
            }
        } finally {
            $archive->close();
        }
    }

    private function worksheet_path( ZipArchive $archive, $sheet_name ) {
        $workbook_xml = $archive->getFromName( 'xl/workbook.xml' );
        $rels_xml     = $archive->getFromName( 'xl/_rels/workbook.xml.rels' );
        if ( false === $workbook_xml || false === $rels_xml ) {
            throw new RuntimeException( 'Workbook metadata is missing.' );
        }
        $workbook = new DOMDocument();
        $workbook->loadXML( $workbook_xml );
        $xpath = new DOMXPath( $workbook );
        $xpath->registerNamespace( 'm', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main' );
        $xpath->registerNamespace( 'r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' );
        $sheet = $xpath->query( '//m:sheet[@name="' . $sheet_name . '"]' )->item( 0 );
        if ( ! $sheet ) {
            throw new RuntimeException( 'Expected worksheet is missing.' );
        }
        $relationship_id = $sheet->getAttributeNS( 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id' );
        $rels = new DOMDocument();
        $rels->loadXML( $rels_xml );
        $rels_xpath = new DOMXPath( $rels );
        $rels_xpath->registerNamespace( 'p', 'http://schemas.openxmlformats.org/package/2006/relationships' );
        $relationship = $rels_xpath->query( '//p:Relationship[@Id="' . $relationship_id . '"]' )->item( 0 );
        if ( ! $relationship ) {
            throw new RuntimeException( 'Worksheet relationship is missing.' );
        }
        return 'xl/' . ltrim( str_replace( '../', '', $relationship->getAttribute( 'Target' ) ), '/' );
    }

    private function ensure_text_styles( ZipArchive $archive, $sheet_xml, $supplier_id ) {
        $sheet_document = new DOMDocument();
        $sheet_document->loadXML( $sheet_xml );
        $sheet_xpath = new DOMXPath( $sheet_document );
        $sheet_xpath->registerNamespace( 'm', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main' );
        $base_styles = array();
        foreach ( $sheet_xpath->query( '//m:sheetData/m:row[@r="2"]/m:c' ) as $cell ) {
            $column = preg_replace( '/\d+$/', '', $cell->getAttribute( 'r' ) );
            $base_styles[ $column ] = '' !== $cell->getAttribute( 's' ) ? (int) $cell->getAttribute( 's' ) : 0;
        }

        $styles_xml = $archive->getFromName( 'xl/styles.xml' );
        if ( false === $styles_xml ) {
            throw new RuntimeException( 'Workbook styles are missing.' );
        }
        $styles_document = new DOMDocument( '1.0', 'UTF-8' );
        $styles_document->preserveWhiteSpace = true;
        $styles_document->loadXML( $styles_xml );
        $styles_xpath = new DOMXPath( $styles_document );
        $namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
        $styles_xpath->registerNamespace( 'm', $namespace );
        $cell_xfs = $styles_xpath->query( '//m:cellXfs' )->item( 0 );
        if ( ! $cell_xfs ) {
            throw new RuntimeException( 'Workbook cell styles are missing.' );
        }
        $existing = iterator_to_array( $styles_xpath->query( './m:xf', $cell_xfs ) );
        $text_styles = array();
        foreach ( $this->text_columns( $supplier_id ) as $column ) {
            $base_index = isset( $base_styles[ $column ] ) ? $base_styles[ $column ] : 0;
            $source     = isset( $existing[ $base_index ] ) ? $existing[ $base_index ] : $existing[0];
            $clone      = $source->cloneNode( true );
            $clone->setAttribute( 'numFmtId', '49' );
            $clone->setAttribute( 'applyNumberFormat', '1' );
            $cell_xfs->appendChild( $clone );
            $text_styles[ $column ] = count( $existing );
            $existing[] = $clone;
        }
        $cell_xfs->setAttribute( 'count', (string) count( $existing ) );
        if ( ! $archive->addFromString( 'xl/styles.xml', $styles_document->saveXML() ) ) {
            throw new RuntimeException( 'Workbook text styles could not be updated.' );
        }
        return $text_styles;
    }

    private function rewrite_sheet( $xml, $supplier_id, array $rows, $sender, array $text_styles ) {
        $document = new DOMDocument( '1.0', 'UTF-8' );
        $document->preserveWhiteSpace = true;
        $document->loadXML( $xml );
        $xpath = new DOMXPath( $document );
        $namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
        $xpath->registerNamespace( 'm', $namespace );
        $sheet_data = $xpath->query( '//m:sheetData' )->item( 0 );
        $header     = $xpath->query( './m:row[@r="1"]', $sheet_data )->item( 0 );
        $style_row  = $xpath->query( './m:row[@r="2"]', $sheet_data )->item( 0 );
        $styles     = array();
        if ( $style_row ) {
            foreach ( $xpath->query( './m:c', $style_row ) as $cell ) {
                $styles[ preg_replace( '/\d+$/', '', $cell->getAttribute( 'r' ) ) ] = $cell->getAttribute( 's' );
            }
        }
        foreach ( iterator_to_array( $sheet_data->childNodes ) as $child ) {
            if ( $child !== $header ) {
                $sheet_data->removeChild( $child );
            }
        }

        foreach ( array_values( $rows ) as $index => $row ) {
            $row_number = $index + 2;
            $row_node   = $document->createElementNS( $namespace, 'row' );
            $row_node->setAttribute( 'r', (string) $row_number );
            if ( $style_row && $style_row->hasAttribute( 'ht' ) ) {
                $row_node->setAttribute( 'ht', $style_row->getAttribute( 'ht' ) );
                $row_node->setAttribute( 'customHeight', '1' );
            }
            $values = 'dailyfood' === $supplier_id
                ? array(
                    $sender['address'],
                    $sender['name'],
                    $sender['phone'],
                    trim( $row['postcode'] . ' ' . $row['address'] ),
                    $row['recipient'],
                    $row['recipient_phone'],
                    $row['recipient_phone'] === $row['buyer_phone'] ? '' : $row['buyer_phone'],
                    $row['quantity'],
                    trim( $row['supplier_original_product_title'] . ' / ' . $row['supplier_original_option_name'], ' /' ),
                    $row['delivery_message'],
                    (string) $row['woo_order_id'],
                )
                : array(
                    (string) $row['woo_order_id'],
                    $row['supplier_original_product_title'],
                    $row['supplier_original_option_name'],
                    $row['quantity'],
                    $row['recipient'],
                    $row['recipient_phone'],
                    $row['postcode'],
                    $row['address'],
                    $row['delivery_message'],
                    $row['buyer'],
                    $row['buyer_phone'],
                );
            foreach ( $values as $column_index => $value ) {
                $column = chr( 65 + $column_index );
                $cell   = $document->createElementNS( $namespace, 'c' );
                $cell->setAttribute( 'r', $column . $row_number );
                if ( isset( $text_styles[ $column ] ) ) {
                    $cell->setAttribute( 's', (string) $text_styles[ $column ] );
                } elseif ( isset( $styles[ $column ] ) && '' !== $styles[ $column ] ) {
                    $cell->setAttribute( 's', $styles[ $column ] );
                }
                $numeric_quantity = 3 === $column_index && 'walldob2b' === $supplier_id;
                $numeric_quantity = $numeric_quantity || ( 7 === $column_index && 'dailyfood' === $supplier_id );
                if ( $numeric_quantity ) {
                    $cell->appendChild( $document->createElementNS( $namespace, 'v', (string) (int) $value ) );
                } else {
                    $cell->setAttribute( 't', 'inlineStr' );
                    $inline = $document->createElementNS( $namespace, 'is' );
                    $text   = $document->createElementNS( $namespace, 't' );
                    $text->setAttribute( 'xml:space', 'preserve' );
                    $text->appendChild( $document->createTextNode( $this->xlsx_text( $value ) ) );
                    $inline->appendChild( $text );
                    $cell->appendChild( $inline );
                }
                $row_node->appendChild( $cell );
            }
            $sheet_data->appendChild( $row_node );
        }

        $dimension = $xpath->query( '//m:dimension' )->item( 0 );
        if ( $dimension ) {
            $dimension->setAttribute( 'ref', 'A1:K' . max( 1, count( $rows ) + 1 ) );
        }
        return $document->saveXML();
    }

    private function verify_workbook( $supplier_id, $file, $expected_rows ) {
        $archive = new ZipArchive();
        if ( true !== $archive->open( $file ) ) {
            throw new RuntimeException( 'Generated XLSX could not be reopened.' );
        }
        try {
            $sheet_path = $this->worksheet_path( $archive, 'dailyfood' === $supplier_id ? 'Sheet1' : 'Sheet2' );
            $xml        = $archive->getFromName( $sheet_path );
            $document   = new DOMDocument();
            $document->loadXML( $xml );
            $xpath = new DOMXPath( $document );
            $xpath->registerNamespace( 'm', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main' );
            $actual_rows = $xpath->query( '//m:sheetData/m:row[position() > 1]' )->length;
            if ( $actual_rows !== $expected_rows ) {
                throw new RuntimeException( 'Generated XLSX row count verification failed.' );
            }
            foreach ( $this->text_columns( $supplier_id ) as $column ) {
                $cells = $xpath->query( '//m:sheetData/m:row[position() > 1]/m:c[starts-with(@r, "' . $column . '")]' );
                foreach ( $cells as $cell ) {
                    if ( 'inlineStr' !== $cell->getAttribute( 't' ) ) {
                        throw new RuntimeException( 'Generated XLSX text cell verification failed.' );
                    }
                }
            }
        } finally {
            $archive->close();
        }
    }

    private function text_columns( $supplier_id ) {
        return 'dailyfood' === $supplier_id ? array( 'C', 'F', 'G', 'K' ) : array( 'A', 'F', 'G', 'K' );
    }

    private function send_document( $file ) {
        $token   = trim( (string) get_option( 'avocadoss_telegram_bot_token', '' ) );
        $chat_id = trim( (string) get_option( 'avocadoss_telegram_chat_id', '' ) );
        if ( '' === $token && defined( 'AVOCADOSS_TG_BOT_TOKEN' ) ) {
            $token = trim( (string) AVOCADOSS_TG_BOT_TOKEN );
        }
        if ( '' === $chat_id && defined( 'AVOCADOSS_TG_CHAT_ID' ) ) {
            $chat_id = trim( (string) AVOCADOSS_TG_CHAT_ID );
        }
        if ( '' === $token || '' === $chat_id ) {
            throw new RuntimeException( 'Telegram configuration is missing.' );
        }
        $curl = curl_init( 'https://api.telegram.org/bot' . $token . '/sendDocument' );
        curl_setopt_array(
            $curl,
            array(
                CURLOPT_POST           => true,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CONNECTTIMEOUT => 10,
                CURLOPT_TIMEOUT        => 60,
                CURLOPT_POSTFIELDS     => array(
                    'chat_id'  => $chat_id,
                    'document' => new CURLFile(
                        $file,
                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        basename( $file )
                    ),
                ),
            )
        );
        $response = curl_exec( $curl );
        $status   = (int) curl_getinfo( $curl, CURLINFO_HTTP_CODE );
        $failed   = false === $response || $status < 200 || $status >= 300;
        curl_close( $curl );
        if ( $failed ) {
            throw new RuntimeException( 'Telegram document send failed.' );
        }
        $decoded = json_decode( $response, true );
        if ( empty( $decoded['ok'] ) || empty( $decoded['result']['message_id'] ) ) {
            throw new RuntimeException( 'Telegram document response was invalid.' );
        }
        return (string) $decoded['result']['message_id'];
    }

    private function send_summary( $date, array $summary ) {
        $missing_amount_count = count( $summary['missing_amount_items'] );
        $total_payable        = (int) $summary['dailyfood']['payable'] + (int) $summary['walldob2b']['payable'];
        $message = sprintf(
            "[도매Hub 오전 6시 발주서]\n기준시각: %s 06:00 KST\n\nDailyFood\n- 주문: %d건\n- 상품행: %d건\n- 결제예정금액: %s원\n\nWalldo\n- 주문: %d건\n- 상품행: %d건\n- 결제예정금액: %s원\n\n총 공급처 결제예정금액: %s원\n금액 확인 필요: %d건\n미연결 주문: %d건",
            $date,
            $summary['dailyfood']['orders'],
            $summary['dailyfood']['rows'],
            number_format( (int) $summary['dailyfood']['payable'] ),
            $summary['walldob2b']['orders'],
            $summary['walldob2b']['rows'],
            number_format( (int) $summary['walldob2b']['payable'] ),
            number_format( $total_payable ),
            $missing_amount_count,
            $summary['source_unmapped']
        );
        if ( $missing_amount_count > 0 ) {
            $message .= "\n\n[금액 확인 필요 항목]";
            foreach ( $summary['missing_amount_items'] as $item ) {
                $message .= sprintf(
                    "\n- 주문 #%d / 항목 #%d",
                    (int) $item['woo_order_id'],
                    (int) $item['woo_order_item_id']
                );
            }
        }
        if ( ! empty( $summary['failures'] ) ) {
            $message .= "\n전송 실패: " . count( $summary['failures'] ) . '건';
        }
        avocadoss_send_telegram_message( $message );
        return;

        $message = sprintf(
            "[도매Hub 오전 6시 발주서]\n기준시각: %s 06:00 KST\nDailyFood: 주문 %d건 / 상품행 %d건\nWalldo: 주문 %d건 / 상품행 %d건\n미연결 주문: %d건",
            $date,
            $summary['dailyfood']['orders'],
            $summary['dailyfood']['rows'],
            $summary['walldob2b']['orders'],
            $summary['walldob2b']['rows'],
            $summary['source_unmapped']
        );
        if ( ! empty( $summary['failures'] ) ) {
            $message .= "\n전송 실패: " . count( $summary['failures'] ) . '건';
        }
        avocadoss_send_telegram_message( $message );
    }

    private function private_temp_file( $supplier_id, $date ) {
        $directory = WP_CONTENT_DIR . '/wholesalehub-private/supplier-order-exports';
        if ( ! is_dir( $directory ) && ! wp_mkdir_p( $directory ) ) {
            throw new RuntimeException( 'Private temporary directory could not be created.' );
        }
        $protection = $directory . '/.htaccess';
        if ( ! file_exists( $protection ) ) {
            file_put_contents( $protection, "Deny from all\n" );
        }
        return $directory . '/' . $this->file_name( $supplier_id, $date );
    }

    private function file_name( $supplier_id, $date ) {
        $compact = str_replace( '-', '', $date );
        return ( 'dailyfood' === $supplier_id ? 'dailyfood_발주_' : 'walldo_발주_' ) . $compact . '_0600.xlsx';
    }

    private function normalize_supplier( $supplier_id ) {
        $value = strtolower( trim( (string) $supplier_id ) );
        if ( in_array( $value, array( 'daily', 'dailyfood' ), true ) ) {
            return 'dailyfood';
        }
        if ( in_array( $value, array( 'walldo', 'walldob2b' ), true ) ) {
            return 'walldob2b';
        }
        return '';
    }

    private function supplier_label( $supplier_id ) {
        return 'dailyfood' === $supplier_id ? 'DailyFood' : 'Walldo';
    }

    private function xlsx_text( $value ) {
        return preg_replace( '/[^\P{C}\t\r\n]/u', '', (string) $value );
    }
}

if ( defined( 'WP_CLI' ) && WP_CLI ) {
    WP_CLI::add_command( 'avocadoss supplier-order-export', 'Avocadoss_WholesaleHub_Supplier_Order_Export_Command' );
}
