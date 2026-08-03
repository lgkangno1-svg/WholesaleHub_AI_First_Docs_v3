<?php
defined('ABSPATH') || exit;

final class WholesaleHub_Bulk_Order {
    private const MAX_BYTES = 10485760;
    private const MAX_ROWS = 1000;
    private const LIMIT_MESSAGE = '한 번에 최대 1,000행까지 주문할 수 있습니다. 파일을 나누어 업로드해 주세요.';
    private const NONCE = 'wh_bulk_order';
    private const SCHEMA_VERSION = '1.0.1';
    private const SCHEMA_OPTION = 'wh_bulk_schema_version';

    public static function boot(): void {
        add_action('init', [self::class, 'routes']);
        add_action('admin_post_wh_bulk_template', [self::class, 'template']);
        add_action('admin_post_wh_bulk_upload', [self::class, 'upload']);
        add_action('admin_post_wh_bulk_errors', [self::class, 'errors']);
        add_action('admin_post_wh_bulk_result', [self::class, 'result']);
        add_action('admin_post_wh_bulk_checkout', [self::class, 'checkout']);
        add_action('woocommerce_checkout_create_order', [self::class, 'attach_order'], 10, 2);
        add_action('woocommerce_checkout_create_order_line_item', [self::class, 'attach_line'], 10, 4);
        add_action('woocommerce_payment_complete', [self::class, 'finalize'], 10);
        add_action('woocommerce_order_status_failed', [self::class, 'retry'], 10);
        add_action('woocommerce_order_status_cancelled', [self::class, 'retry'], 10);
        add_action('woocommerce_thankyou', [self::class, 'thankyou'], 20);
        add_action('admin_menu', [self::class, 'admin_menu']);
        add_action('admin_menu', [self::class, 'admin_search_menu']);
        add_action('wp_footer', [self::class, 'home_entry'], 20);
        add_filter('woocommerce_account_menu_items', [self::class, 'account_menu']);
        add_filter('woocommerce_email_order_meta_fields', [self::class, 'email_meta'], 20, 3);
    }

    public static function install_schema(): void {
        if ((string) get_option(self::SCHEMA_OPTION, '') === self::SCHEMA_VERSION) {
            return;
        }
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $c = $wpdb->get_charset_collate();
        $tables = [
            'batches' => "
                id bigint unsigned NOT NULL AUTO_INCREMENT,
                uuid char(36) NOT NULL,
                customer_id bigint unsigned NOT NULL,
                status varchar(32) NOT NULL,
                file_hash char(64) NOT NULL,
                row_count int unsigned NOT NULL,
                shipment_count int unsigned NOT NULL DEFAULT 0,
                item_subtotal decimal(18,2) NOT NULL DEFAULT 0,
                shipping_total decimal(18,2) NOT NULL DEFAULT 0,
                grand_total decimal(18,2) NOT NULL DEFAULT 0,
                woo_order_id bigint unsigned NULL,
                idempotency_key varchar(64) NULL,
                created_at datetime NOT NULL,
                expires_at datetime NOT NULL,
                finalized_at datetime NULL,
                PRIMARY KEY  (id),
                UNIQUE KEY uuid (uuid),
                UNIQUE KEY customer_file (customer_id, file_hash),
                UNIQUE KEY idempotency_key (idempotency_key)",
            'rows' => "
                id bigint unsigned NOT NULL AUTO_INCREMENT,
                batch_id bigint unsigned NOT NULL,
                row_number int unsigned NOT NULL,
                customer_reference varchar(100) NOT NULL,
                variation_id bigint unsigned NULL,
                public_offer_key varchar(191) NOT NULL,
                quantity int unsigned NOT NULL,
                recipient varchar(100) NOT NULL,
                phone varchar(40) NOT NULL,
                postcode varchar(20) NOT NULL,
                address1 text NOT NULL,
                address2 text NULL,
                message text NULL,
                unit_price decimal(18,2) NOT NULL DEFAULT 0,
                shipping_snapshot longtext NULL,
                validation_state varchar(24) NOT NULL,
                error_code varchar(64) NULL,
                error_message text NULL,
                PRIMARY KEY  (id),
                KEY batch_row (batch_id, row_number)",
            'shipments' => "
                id bigint unsigned NOT NULL AUTO_INCREMENT,
                batch_id bigint unsigned NOT NULL,
                group_key varchar(191) NOT NULL,
                customer_reference varchar(100) NOT NULL,
                recipient varchar(100) NOT NULL,
                phone varchar(40) NOT NULL,
                postcode varchar(20) NOT NULL,
                address1 text NOT NULL,
                address2 text NULL,
                item_subtotal decimal(18,2) NOT NULL DEFAULT 0,
                shipping_amount decimal(18,2) NOT NULL DEFAULT 0,
                fulfillment_status varchar(32) NOT NULL DEFAULT 'pending',
                snapshot longtext NULL,
                PRIMARY KEY  (id),
                UNIQUE KEY batch_group (batch_id, group_key)",
        ];
        foreach ($tables as $name => $sql) {
            dbDelta("CREATE TABLE {$wpdb->prefix}wholesalehub_bulk_{$name} ({$sql}) {$c};");
        }
        update_option(self::SCHEMA_OPTION, self::SCHEMA_VERSION);
    }

    public static function routes(): void {
        add_rewrite_endpoint('bulk-order', EP_ROOT | EP_PAGES);
        add_action('woocommerce_account_bulk-order_endpoint', [self::class, 'page']);
        if (get_option('wh_bulk_rewrite_version') !== '1') {
            flush_rewrite_rules(false);
            update_option('wh_bulk_rewrite_version', '1');
        }
    }
    public static function account_menu(array $items): array { if(!self::allowed())return $items;$out=[];foreach($items as $key=>$label){$out[$key]=$label;if($key==='orders')$out['bulk-order']='엑셀 대량주문';}if(!isset($out['bulk-order']))$out['bulk-order']='엑셀 대량주문';return $out; }
    public static function email_meta(array $fields,bool $sent_to_admin,WC_Order $order): array { unset($sent_to_admin);$id=absint($order->get_meta('_wh_bulk_batch_id'));if(!$id)return $fields;global $wpdb;$b=$wpdb->get_row($wpdb->prepare("SELECT grand_total FROM {$wpdb->prefix}wholesalehub_bulk_batches WHERE id=%d",$id),ARRAY_A);$shipments=$wpdb->get_results($wpdb->prepare("SELECT recipient,customer_reference FROM {$wpdb->prefix}wholesalehub_bulk_shipments WHERE batch_id=%d ORDER BY id LIMIT 20",$id),ARRAY_A);$summary=[];foreach($shipments as $s){$name=(string)$s['recipient'];$masked=mb_strlen($name)>1?mb_substr($name,0,1).str_repeat('*',max(1,mb_strlen($name)-1)):'*';$summary[]=$s['customer_reference'].' · '.$masked;}$fields['bulk_batch']=['label'=>'대량주문 번호','value'=>(string)$order->get_meta('_wh_bulk_batch_uuid')];$fields['bulk_shipments']=['label'=>'배송 건수','value'=>(string)$order->get_meta('_wh_bulk_shipment_count')];$fields['bulk_total']=['label'=>'총 결제금액','value'=>wc_price((float)($b['grand_total']??$order->get_total()))];$fields['bulk_summary']=['label'=>'배송 건 요약','value'=>implode("\n",$summary)];return $fields; }

    private static function allowed(): bool {
        return is_user_logged_in() && ('approved' === get_user_meta(get_current_user_id(), '_avo_approval_status', true) || current_user_can('manage_woocommerce'));
    }

    public static function home_entry(): void {
        if (!is_shop() || is_paged()) return;
        $bulk = wc_get_account_endpoint_url('bulk-order');
        $download = self::allowed() ? admin_url('admin-post.php?action=wh_bulk_template') : $bulk;
        echo '<aside class="wh-bulk-home" aria-labelledby="wh-bulk-home-title"><div><span class="wh-bulk-home-kicker">빠른주문</span><h2 id="wh-bulk-home-title">엑셀 대량주문</h2><p>양식을 다운로드한 뒤 여러 상품과 배송지를 한 번에 주문하세요.</p></div><nav aria-label="엑셀 대량주문 바로가기"><a class="button alt" href="'.esc_url($bulk).'">엑셀 대량주문</a><a class="button" href="'.esc_url($download).'">양식 다운로드</a><a class="button" href="'.esc_url($bulk).'">주문 상품 확인</a></nav></aside>';
    }

    public static function page(): void {
        if (!self::allowed()) wp_die('Forbidden', 403);
        $batch = self::batch(absint($_GET['batch'] ?? 0), get_current_user_id());
        $download = admin_url('admin-post.php?action=wh_bulk_template');
        echo '<section class="wh-bulk-order"><header class="wh-bulk-hero"><h2>엑셀로 여러 배송지를 한 번에 주문하세요</h2><p>상품과 배송지 정보를 엑셀에 입력해 업로드하면<br>최대 1,000행까지 한 번에 주문할 수 있습니다.</p></header><div class="wh-bulk-steps">';
        echo '<article class="wh-bulk-step wh-bulk-step-download"><span>STEP 1</span><h3>엑셀 양식 다운로드</h3><a class="button alt" href="'.esc_url($download).'">대량주문 엑셀 양식 다운로드</a></article>';
        echo '<article class="wh-bulk-step"><span>STEP 2</span><h3>엑셀 작성</h3><p>상품목록 시트에서 주문코드를 복사해 주문입력 시트에 입력합니다.</p></article>';
        echo '<article class="wh-bulk-step"><span>STEP 3</span><h3>작성한 파일 업로드</h3><p>지원 형식: .xlsx, .csv<br>최대 주문행: 1,000행</p><form class="wh-bulk-upload" method="post" enctype="multipart/form-data" action="' . esc_url(admin_url('admin-post.php')) . '"><input type="hidden" name="action" value="wh_bulk_upload">'; wp_nonce_field(self::NONCE); echo '<label class="wh-bulk-dropzone"><strong>엑셀 파일 선택</strong><span data-wh-file-name>파일을 선택하거나 여기에 놓아주세요.</span><input required type="file" name="bulk_file" accept=".xlsx,.csv"></label><label class="wh-bulk-new"><input type="checkbox" name="new_batch" value="1"> 완료된 동일 파일로 새 주문 만들기</label><button class="button alt" type="submit">업로드하고 주문내용 확인</button></form></article>';
        echo '<article class="wh-bulk-step"><span>STEP 4</span><h3>오류 및 주문금액 확인</h3><p>오류 행과 서버에서 다시 계산한 상품금액·배송비를 확인합니다.</p></article>';
        echo '<article class="wh-bulk-step"><span>STEP 5</span><h3>주소별 상품과 배송비를 확인하고 결제</h3><p>배송지별 주문 내용을 최종 확인한 뒤 결제합니다.</p></article></div>';
        echo '<details class="wh-bulk-help"><summary>사용방법</summary><ol><li>엑셀 양식을 다운로드합니다.</li><li>상품목록 시트에서 원하는 상품의 주문코드를 확인합니다.</li><li>주문입력 시트에 주문코드, 수량, 수령지 정보를 입력합니다.</li><li>작성한 파일을 업로드합니다.</li><li>오류가 없으면 상품금액과 배송비를 확인합니다.</li><li>주소별 주문내역을 확인한 뒤 결제합니다.</li></ol><h3>주의사항</h3><ul><li>엑셀의 가격과 배송비는 서버에서 다시 계산됩니다.</li><li>품절되거나 판매가 종료된 상품은 주문할 수 없습니다.</li><li>오류가 있는 행은 결제할 수 없습니다.</li><li>한 번에 최대 1,000행까지 가능합니다.</li></ul></details>';
        if ($batch) { self::preview($batch); } else { self::history(); }
        echo '</section>';
    }

    public static function template(): void {
        if (!self::allowed()) wp_die('Forbidden', 403);
        $catalog = self::catalog();
        $rows = [["고객주문번호","주문코드","수량","수령인","수령인연락처","우편번호","기본주소","상세주소","배송메시지","상품명","옵션명","현재 참고 판매가"]];
        for($n=2;$n<=self::MAX_ROWS+1;$n++)$rows[]=['','','','','','','','','',['formula'=>'IF(B'.$n.'="","",IFERROR(VLOOKUP(B'.$n.',\'상품목록\'!$A:$I,2,FALSE),"주문코드를 확인하세요"))'],['formula'=>'IF(B'.$n.'="","",IFERROR(VLOOKUP(B'.$n.',\'상품목록\'!$A:$I,3,FALSE),"주문코드를 확인하세요"))'],['formula'=>'IF(B'.$n.'="","",IFERROR(VLOOKUP(B'.$n.',\'상품목록\'!$A:$I,4,FALSE),"주문코드를 확인하세요"))']];
        $example = [["안내","고객주문번호","주문코드","수량","수령인","수령인연락처","우편번호","기본주소","상세주소","배송메시지"],["예시행 — 업로드 전에 삭제하세요","ORDER-001",(string)($catalog[2][0]??''),1,"홍길동","01012345678","12345","서울특별시","101호",""]];
        $guide = [["1. 상품목록 시트에서 원하는 상품을 검색합니다."],["2. 해당 상품의 주문코드를 복사합니다."],["3. 주문입력 시트의 주문코드 칸에 붙여넣습니다."],["4. 수량과 수령지 정보를 입력합니다."],["5. 같은 고객주문번호는 같은 배송 건으로 처리됩니다."],["6. 파일을 저장한 뒤 도매허브에 업로드합니다."],["7. 실제 가격과 배송비는 업로드 시 서버에서 다시 계산됩니다."]];
        self::xlsx('도매허브_대량주문_양식_'.wp_date('Ymd').'.xlsx', ['주문입력' => $rows, '상품목록' => $catalog, '입력예시' => $example, '작성안내' => $guide]);
    }

    public static function upload(): void {
        self::guard();
        $file = $_FILES['bulk_file'] ?? null;
        if (!is_array($file) || (int)$file['error'] !== UPLOAD_ERR_OK || (int)$file['size'] > self::MAX_BYTES) self::redirect_error('파일은 10MB 이하의 CSV 또는 XLSX여야 합니다.');
        $name = strtolower((string)$file['name']); $tmp = (string)$file['tmp_name'];
        $mime = wp_check_filetype_and_ext($tmp, $name); $actual=(string)mime_content_type($tmp); $ext=pathinfo($name, PATHINFO_EXTENSION);
        if (!in_array($ext, ['csv','xlsx'], true) || !is_uploaded_file($tmp) || ($ext==='csv'&&!str_starts_with($actual,'text/')) || ($ext==='xlsx'&&!in_array($actual,['application/zip','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream'],true))) self::redirect_error('허용되지 않는 파일입니다.');
        $rows = str_ends_with($name, '.csv') ? self::csv_rows($tmp) : self::xlsx_rows($tmp);
        if (!$rows || count($rows) > self::MAX_ROWS + 1) self::redirect_error(self::LIMIT_MESSAGE);
        $hash = hash_file('sha256', $tmp); global $wpdb; $b = $wpdb->prefix.'wholesalehub_bulk_batches';
        $existing = $wpdb->get_row($wpdb->prepare("SELECT id,status FROM {$b} WHERE customer_id=%d AND file_hash=%s ORDER BY id DESC LIMIT 1", get_current_user_id(), $hash),ARRAY_A);
        if ($existing && ($existing['status']!=='finalized' || empty($_POST['new_batch']))) { if($existing['status']==='finalized')self::redirect_error('이미 완료된 파일입니다. 새 batch 생성을 명시적으로 선택해 주세요.');wp_safe_redirect(self::url((int)$existing['id'])); exit; }
        $now=current_time('mysql'); $uuid=wp_generate_uuid4();if($existing&&$existing['status']==='finalized'&&!empty($_POST['new_batch']))$hash=hash('sha256',$hash.'|'.$uuid);
        $wpdb->insert($b, ['uuid'=>$uuid,'customer_id'=>get_current_user_id(),'status'=>'draft','file_hash'=>$hash,'row_count'=>count($rows)-1,'created_at'=>$now,'expires_at'=>gmdate('Y-m-d H:i:s', time()+DAY_IN_SECONDS)]);
        $id=(int)$wpdb->insert_id; self::validate_rows($id, $rows); wp_safe_redirect(self::url($id)); exit;
    }

    private static function validate_rows(int $batch_id, array $rows): void {
        global $wpdb; $table=$wpdb->prefix.'wholesalehub_bulk_rows'; $headers=array_map('trim', array_map('strval', array_shift($rows))); $new=in_array('주문코드',$headers,true);$required=$new?['고객주문번호','주문코드','수량','수령인','수령인연락처','우편번호','기본주소']:['고객주문번호','상품코드','옵션코드','수량','수령인','수령인연락처','우편번호','기본주소'];
        $map=array_flip($headers); foreach ($rows as $n=>$row) { $get=static fn($h)=>trim(wp_strip_all_tags((string)($row[$map[$h] ?? -1] ?? ''))); $errors=[]; foreach($required as $h) if($get($h)==='') $errors[]=$h.' 필수'; $qty=absint($get('수량')); if($qty<1) $errors[]='수량은 1 이상'; $postcode=preg_replace('/\D/','',$get('우편번호')); if(!preg_match('/^\d{5}$/',$postcode)) $errors[]='우편번호 형식'; $phone=preg_replace('/\D/','',$get('수령인연락처')); if(strlen($phone)<9||strlen($phone)>12) $errors[]='연락처 형식'; $offer=$new?self::offer_by_order_code($get('주문코드')):self::offer($get('상품코드'),$get('옵션코드'));
            if(!$offer) $errors[]=$new?'주문코드를 확인하세요':'판매 가능한 옵션을 찾을 수 없습니다.'; $snapshot=null; $unit=0; if($offer){ $product=wc_get_product((int)$offer['woo_variation_id']); $min=(int)$product->get_min_purchase_quantity();$max=(int)$product->get_max_purchase_quantity();if($qty<$min||($max>0&&$qty>$max))$errors[]='주문 가능 수량 범위';$unit=(float)$product->get_price(); $snapshot=self::shipping((int)$offer['woo_variation_id'],$qty,$postcode,$get('기본주소').' '.$get('상세주소')); if(!$snapshot) $errors[]='배송정책 확인 필요'; }
            $wpdb->insert($table,['batch_id'=>$batch_id,'row_number'=>$n+2,'customer_reference'=>sanitize_text_field($get('고객주문번호')),'variation_id'=>(int)($offer['woo_variation_id']??0),'public_offer_key'=>sanitize_text_field((string)($offer['public_offer_key']??$get('옵션코드'))),'quantity'=>$qty,'recipient'=>sanitize_text_field($get('수령인')),'phone'=>$phone,'postcode'=>$postcode,'address1'=>sanitize_textarea_field($get('기본주소')),'address2'=>sanitize_textarea_field($get('상세주소')),'message'=>sanitize_textarea_field($get('배송메시지')),'unit_price'=>$unit,'shipping_snapshot'=>wp_json_encode($snapshot),'validation_state'=>$errors?'error':'valid','error_code'=>$errors?'invalid_row':null,'error_message'=>$errors?implode(', ',$errors):null]);
        } self::rebuild($batch_id);
    }

    private static function offer(string $product_code,string $key): ?array { global $wpdb; $o=$wpdb->prefix.'supplier_lane_offers'; $p=$wpdb->prefix.'supplier_lane_parent_links'; $row=$wpdb->get_row($wpdb->prepare("SELECT o.* FROM {$o} o JOIN {$p} p ON p.id=o.parent_link_id AND p.status='approved' WHERE o.public_offer_key=%s AND o.approval_status='approved' AND o.lifecycle_status='active' LIMIT 1",$key),ARRAY_A); if(!$row||(string)$row['woo_parent_id']!==$product_code) return null; $v=wc_get_product((int)$row['woo_variation_id']); return $v && $v->is_purchasable() && $v->is_in_stock() ? $row : null; }
    private static function order_code(int $variation):string{return 'H'.$variation;}
    private static function offer_by_order_code(string $code):?array{if(!preg_match('/^H([1-9]\d*)$/',$code,$m))return null;global $wpdb;$o=$wpdb->prefix.'supplier_lane_offers';$p=$wpdb->prefix.'supplier_lane_parent_links';$row=$wpdb->get_row($wpdb->prepare("SELECT o.* FROM {$o} o JOIN {$p} p ON p.id=o.parent_link_id AND p.status='approved' WHERE o.woo_variation_id=%d AND o.approval_status='approved' AND o.lifecycle_status='active' LIMIT 1",(int)$m[1]),ARRAY_A);if(!$row)return null;$v=wc_get_product((int)$row['woo_variation_id']);return $v&&$v->is_purchasable()&&$v->is_in_stock()?$row:null;}
    private static function shipping(int $variation,int $qty,string $postcode,string $address): ?array { $meta=WholesaleHub_Supplier_Lanes::get_variation_shipping_meta($variation);$p=$meta['policy']??null;if(!is_array($p))return null;$calculated=WholesaleHub_Supplier_Lanes::shipping_amount($p,$qty);if($calculated===null)return null;$amount=(float)$calculated['amount'];$jeju=WholesaleHub_Supplier_Lanes::is_jeju_address($postcode,'',$address);$remote=!$jeju&&WholesaleHub_Supplier_Lanes::is_remote_address($postcode,$address);$amount+=$jeju?(float)($p['shipping_jeju_extra_fee']??0):($remote?(float)($p['shipping_remote_extra_fee']??0):0);return ['policy'=>$p,'group'=>(string)($meta['shipping_policy_group_key']?:$meta['supplier_id'].'|'.$meta['source_product_id']),'amount'=>$amount]; }

    private static function rebuild(int $id): void { global $wpdb;$r=$wpdb->prefix.'wholesalehub_bulk_rows';$s=$wpdb->prefix.'wholesalehub_bulk_shipments';$b=$wpdb->prefix.'wholesalehub_bulk_batches';$wpdb->delete($s,['batch_id'=>$id]);$rows=$wpdb->get_results($wpdb->prepare("SELECT * FROM {$r} WHERE batch_id=%d AND validation_state='valid'",$id),ARRAY_A);$groups=[];$subtotal=0;foreach($rows as $row){$x=json_decode($row['shipping_snapshot'],true);$g=hash('sha256',$row['customer_reference'].'|'.$row['postcode'].'|'.$row['address1'].'|'.($x['group']??''));if(!isset($groups[$g]))$groups[$g]=['row'=>$row,'snapshot'=>$x,'qty'=>0,'items'=>0,'row_ids'=>[]];$groups[$g]['qty']+=(int)$row['quantity'];$groups[$g]['items']+=(float)$row['unit_price']*(int)$row['quantity'];$groups[$g]['row_ids'][]=(int)$row['id'];$subtotal+=(float)$row['unit_price']*(int)$row['quantity'];}$shipping=0;foreach($groups as $g=>$v){$row=$v['row'];$ship=self::group_shipping((array)($v['snapshot']['policy']??[]),(int)$v['qty'],(string)$row['postcode'],trim((string)$row['address1'].' '.(string)$row['address2']));if($ship===null){foreach($v['row_ids'] as $row_id)$wpdb->update($r,['validation_state'=>'error','error_code'=>'invalid_shipping','error_message'=>'배송정책을 확인할 수 없습니다.'],['id'=>$row_id]);continue;}$shipping+=$ship;$snapshot=$v['snapshot'];$snapshot['group_quantity']=(int)$v['qty'];$snapshot['group_amount']=$ship;$snapshot['actual_applied_amount']=$ship;$wpdb->insert($s,['batch_id'=>$id,'group_key'=>$g,'customer_reference'=>$row['customer_reference'],'recipient'=>$row['recipient'],'phone'=>$row['phone'],'postcode'=>$row['postcode'],'address1'=>$row['address1'],'address2'=>$row['address2'],'item_subtotal'=>$v['items'],'shipping_amount'=>$ship,'snapshot'=>wp_json_encode($snapshot)]);foreach($v['row_ids'] as $index=>$row_id){$row_snapshot=$snapshot;$row_snapshot['actual_applied_amount']=$index===0?$ship:0;$wpdb->update($r,['shipping_snapshot'=>wp_json_encode($row_snapshot)],['id'=>$row_id]);}}$wpdb->update($b,['shipment_count'=>count($groups),'item_subtotal'=>$subtotal,'shipping_total'=>$shipping,'grand_total'=>$subtotal+$shipping],['id'=>$id]); }
    private static function group_shipping(array $policy,int $qty,string $postcode,string $address): ?float { $calculated=WholesaleHub_Supplier_Lanes::shipping_amount($policy,$qty);if($calculated===null)return null;$amount=(float)$calculated['amount'];$jeju=WholesaleHub_Supplier_Lanes::is_jeju_address($postcode,'',$address);$remote=!$jeju&&WholesaleHub_Supplier_Lanes::is_remote_address($postcode,$address);return $amount+($jeju?(float)($policy['shipping_jeju_extra_fee']??0):($remote?(float)($policy['shipping_remote_extra_fee']??0):0)); }

    private static function preview(array $batch): void { global $wpdb;$r=$wpdb->prefix.'wholesalehub_bulk_rows';$rows=$wpdb->get_results($wpdb->prepare("SELECT * FROM {$r} WHERE batch_id=%d ORDER BY row_number",$batch['id']),ARRAY_A);$bad=array_filter($rows,fn($x)=>$x['validation_state']!=='valid');echo '<h3>검증 결과</h3><p>상품 '.esc_html((string)$batch['item_subtotal']).'원 / 배송 '.esc_html((string)$batch['shipping_total']).'원 / 결제 '.esc_html((string)$batch['grand_total']).'원</p><table><tr><th>행</th><th>상태</th><th>오류</th></tr>';foreach($rows as $r)echo '<tr><td>'.(int)$r['row_number'].'</td><td>'.esc_html($r['validation_state']).'</td><td>'.esc_html($r['error_message']).'</td></tr>';echo '</table>';if($bad){echo '<p><a href="'.esc_url(self::download_url('wh_bulk_errors',(int)$batch['id'])).'">오류 CSV 다운로드</a></p>';return;} echo '<form method="post" action="'.esc_url(admin_url('admin-post.php')).'"><input type="hidden" name="action" value="wh_bulk_checkout"><input type="hidden" name="batch" value="'.(int)$batch['id'].'">';wp_nonce_field(self::NONCE);echo '<button class="button alt">주문 정보와 결제 화면으로</button></form>'; }

    public static function checkout(): void { self::guard();$b=self::batch(absint($_POST['batch']??0),get_current_user_id());if(!$b||$b['status']!=='draft')self::redirect_error('유효한 대량주문이 아닙니다.');if(!function_exists('WC')||!WC()->cart)self::redirect_error('구매 바구니를 준비하지 못했습니다.');$token=wp_generate_uuid4();WC()->cart->empty_cart();global $wpdb;$r=$wpdb->prefix.'wholesalehub_bulk_rows';foreach($wpdb->get_results($wpdb->prepare("SELECT * FROM {$r} WHERE batch_id=%d AND validation_state='valid'",$b['id']),ARRAY_A) as $row){$v=wc_get_product((int)$row['variation_id']);$offer=$v?self::offer((string)$v->get_parent_id(),(string)$row['public_offer_key']):null;$fresh=$offer?self::shipping((int)$row['variation_id'],(int)$row['quantity'],(string)$row['postcode'],(string)$row['address1'].' '.(string)$row['address2']):null;$saved=json_decode((string)$row['shipping_snapshot'],true);if(!$v||!$offer||!$v->is_purchasable()||!$v->is_in_stock()||!$fresh||abs((float)$row['unit_price']-(float)$v->get_price())>0.001||wp_json_encode($fresh['policy']??null)!==wp_json_encode($saved['policy']??null)||(string)($fresh['group']??'')!==(string)($saved['group']??'')){WC()->cart->empty_cart();self::redirect_error('가격, 재고 또는 배송비가 변경되었습니다. 다시 검증해 주세요.');}$cart_data=WholesaleHub_Supplier_Lanes::cart_data_from_offer($offer,$v);$cart_data['wh_bulk_row_id']=(int)$row['id'];$cart_data['wh_bulk_shipment_snapshot']=$row['shipping_snapshot'];WC()->cart->add_to_cart($v->get_parent_id(),(int)$row['quantity'],$v->get_id(),$v->get_variation_attributes(),$cart_data);}self::rebuild((int)$b['id']);$fresh_batch=self::batch((int)$b['id'],get_current_user_id());if(!$fresh_batch||abs((float)$fresh_batch['shipping_total']-(float)$b['shipping_total'])>0.001){WC()->cart->empty_cart();self::redirect_error('배송비가 변경되었습니다. 다시 확인해 주세요.');}$b=$fresh_batch;WC()->session->set('wh_bulk_batch',(int)$b['id']);WC()->session->set('wh_bulk_token',$token);WC()->cart->calculate_totals();WC()->cart->set_session();$wpdb->update($wpdb->prefix.'wholesalehub_bulk_batches',['status'=>'checkout','idempotency_key'=>hash('sha256',$token)],['id'=>$b['id']]);wp_safe_redirect(wc_get_checkout_url());exit; }
    public static function checkout_shipping_total(): float { if(!function_exists('WC')||!WC()->session)return 0.0;$id=absint(WC()->session->get('wh_bulk_batch'));$b=self::batch($id,get_current_user_id());return $b?(float)$b['shipping_total']:0.0; }
    public static function attach_order(WC_Order $order,array $data): void { unset($data);if(!function_exists('WC')||!WC()->session)return;$id=absint(WC()->session->get('wh_bulk_batch'));$token=(string)WC()->session->get('wh_bulk_token');$b=self::batch($id,get_current_user_id());if(!$b||$b['status']!=='checkout'||!hash_equals((string)$b['idempotency_key'],hash('sha256',$token)))return;global $wpdb;$claimed=$wpdb->query($wpdb->prepare("UPDATE {$wpdb->prefix}wholesalehub_bulk_batches SET woo_order_id=%d WHERE id=%d AND customer_id=%d AND status='checkout' AND woo_order_id IS NULL",$order->get_id(),$id,get_current_user_id()));if($claimed!==1)throw new RuntimeException('이미 처리 중인 대량주문입니다.');$order->update_meta_data('_wh_bulk_batch_id',$id);$order->update_meta_data('_wh_bulk_batch_uuid',$b['uuid']);$order->update_meta_data('_wh_bulk_shipment_count',$b['shipment_count']); }
    public static function attach_line(WC_Order_Item_Product $item,string $key,array $values,WC_Order $order): void { unset($key,$order);$row=absint($values['wh_bulk_row_id']??0);if(!$row)return;global $wpdb;$table=$wpdb->prefix.'wholesalehub_bulk_rows';$data=$wpdb->get_row($wpdb->prepare("SELECT * FROM {$table} WHERE id=%d",$row),ARRAY_A);if(!$data)return;$item->add_meta_data('_wh_bulk_row_id',$row,true);$item->add_meta_data('_wh_bulk_shipment_snapshot',(string)$data['shipping_snapshot'],true);$item->add_meta_data('_wh_bulk_recipient',(string)$data['recipient'],true);$item->add_meta_data('_wh_bulk_phone',(string)$data['phone'],true);$item->add_meta_data('_wh_bulk_postcode',(string)$data['postcode'],true);$item->add_meta_data('_wh_bulk_address1',(string)$data['address1'],true);$item->add_meta_data('_wh_bulk_address2',(string)$data['address2'],true);$item->add_meta_data('_wh_bulk_message',(string)$data['message'],true); }
    public static function finalize(int $order_id): void { $order=wc_get_order($order_id);if(!$order)return;$id=absint($order->get_meta('_wh_bulk_batch_id'));if(!$id)return;global $wpdb;$b=$wpdb->prefix.'wholesalehub_bulk_batches';$wpdb->query($wpdb->prepare("UPDATE {$b} SET status='finalized',finalized_at=%s WHERE id=%d AND status='checkout'",current_time('mysql'),$id));self::clear_session(); }
    public static function retry(int $order_id): void { $order=wc_get_order($order_id);if(!$order)return;$id=absint($order->get_meta('_wh_bulk_batch_id'));if(!$id)return;global $wpdb;$wpdb->query($wpdb->prepare("UPDATE {$wpdb->prefix}wholesalehub_bulk_batches SET status='draft',idempotency_key=NULL,woo_order_id=NULL WHERE id=%d AND status='checkout'",$id));self::clear_session(); }
    public static function thankyou(int $order_id): void { $order=wc_get_order($order_id);if(!$order||get_current_user_id()!==$order->get_user_id())return;$id=absint($order->get_meta('_wh_bulk_batch_id'));if(!$id)return;$csv=self::download_url('wh_bulk_result',$id);$xlsx=self::download_url('wh_bulk_result',$id,'xlsx');echo '<section class="wh-bulk-order"><h2>대량주문이 접수되었습니다</h2><p>대량주문 번호: '.esc_html((string)$order->get_meta('_wh_bulk_batch_uuid')).'</p><p>배송 건수: '.(int)$order->get_meta('_wh_bulk_shipment_count').'</p><p><a href="'.esc_url($csv).'">주문 결과 CSV 다운로드</a> · <a href="'.esc_url($xlsx).'">XLSX 다운로드</a></p></section>';self::clear_session(); }
    public static function errors(): void { self::guard();$b=self::batch(absint($_GET['batch']??0),get_current_user_id());if(!$b)wp_die('Not found',404);global $wpdb;$r=$wpdb->prefix.'wholesalehub_bulk_rows';$rows=$wpdb->get_results($wpdb->prepare("SELECT row_number,error_message FROM {$r} WHERE batch_id=%d AND validation_state='error'",$b['id']),ARRAY_A);nocache_headers();header('Content-Type: text/csv; charset=utf-8');header('Content-Disposition: attachment; filename=bulk-errors.csv');$out=fopen('php://output','w');fputcsv($out,['행','오류']);foreach($rows as $row)fputcsv($out,[$row['row_number'],self::csv_safe($row['error_message'])]);fclose($out);exit; }
    private static function history(): void { global $wpdb;$b=$wpdb->prefix.'wholesalehub_bulk_batches';$rows=$wpdb->get_results($wpdb->prepare("SELECT * FROM {$b} WHERE customer_id=%d ORDER BY id DESC LIMIT 30",get_current_user_id()),ARRAY_A);echo '<h3>대량주문 내역</h3><table><tr><th>번호</th><th>주문</th><th>배송</th><th>금액</th><th>상태</th><th>결과</th></tr>';foreach($rows as $r){$url=self::download_url('wh_bulk_result',(int)$r['id']);echo '<tr><td><a href="'.esc_url(self::url((int)$r['id'])).'">'.esc_html($r['uuid']).'</a></td><td>'.(int)$r['woo_order_id'].'</td><td>'.(int)$r['shipment_count'].'</td><td>'.esc_html($r['grand_total']).'</td><td>'.esc_html($r['status']).'</td><td>'.($r['status']==='finalized'?'<a href="'.esc_url($url).'">CSV</a>':'-').'</td></tr>';}echo '</table>'; }
    public static function result(): void { self::guard();$b=self::batch(absint($_GET['batch']??0),get_current_user_id());if(!$b||$b['status']!=='finalized')wp_die('Not found',404);global $wpdb;$r=$wpdb->prefix.'wholesalehub_bulk_rows';$rows=$wpdb->get_results($wpdb->prepare("SELECT customer_reference,quantity,recipient,postcode,address1,address2,unit_price,shipping_snapshot FROM {$r} WHERE batch_id=%d ORDER BY row_number",$b['id']),ARRAY_A);$outrows=[['고객주문번호','수량','수령인','우편번호','주소','상품금액','배송비']];foreach($rows as $row){$shipping=json_decode((string)$row['shipping_snapshot'],true);$outrows[]=[self::csv_safe($row['customer_reference']),$row['quantity'],self::csv_safe($row['recipient']),$row['postcode'],self::csv_safe(trim($row['address1'].' '.$row['address2'])),$row['unit_price'],(string)($shipping['actual_applied_amount']??0)];}if(($_GET['format']??'')==='xlsx')self::xlsx('bulk-order-'.$b['uuid'].'.xlsx',['주문결과'=>$outrows]);nocache_headers();header('Content-Type: text/csv; charset=utf-8');header('Content-Disposition: attachment; filename=bulk-order-'.$b['uuid'].'.csv');$out=fopen('php://output','w');foreach($outrows as $row)fputcsv($out,$row);fclose($out);exit; }
    private static function csv_safe(string $s): string{return preg_match('/^[=+\-@]/',$s)?"'".$s:$s;}
    private static function clear_session():void{if(function_exists('WC')&&WC()->session){WC()->session->__unset('wh_bulk_batch');WC()->session->__unset('wh_bulk_token');}}
    public static function clear_checkout_session():void{self::clear_session();}
    private static function download_url(string $action,int $batch,string $format=''):string{$url=admin_url('admin-post.php?action='.$action.'&batch='.$batch.($format!==''?'&format='.$format:''));return wp_nonce_url($url,self::NONCE);}
    private static function batch(int $id,int $customer): ?array{global $wpdb;$r=$wpdb->get_row($wpdb->prepare("SELECT * FROM {$wpdb->prefix}wholesalehub_bulk_batches WHERE id=%d AND customer_id=%d",$id,$customer),ARRAY_A);return is_array($r)?$r:null;}
    private static function url(int $id):string{return wc_get_account_endpoint_url('bulk-order').'?batch='.$id;}
    private static function guard():void{if(!self::allowed()||!check_admin_referer(self::NONCE))wp_die('Forbidden',403);}
    private static function redirect_error(string $m):void{wc_add_notice($m,'error');wp_safe_redirect(wc_get_account_endpoint_url('bulk-order'));exit;}
    private static function csv_rows(string $file):array{$f=fopen($file,'r');$rows=[];while(($r=fgetcsv($f))!==false)$rows[]=$r;fclose($f);return $rows;}
    private static function xlsx_rows(string $file):array{if(!class_exists('ZipArchive'))return []; $z=new ZipArchive();if($z->open($file)!==true)return [];$compressed=0;$expanded=0;if($z->numFiles<1||$z->numFiles>100){$z->close();return [];}for($i=0;$i<$z->numFiles;$i++){$s=$z->statIndex($i);$n=(string)$s['name'];$compressed+=(int)$s['comp_size'];$expanded+=(int)$s['size'];if(str_starts_with($n,'xl/externalLinks/')||$n==='xl/vbaProject.bin'){$z->close();return [];}}if($expanded>self::MAX_BYTES*4||$compressed<1||$expanded/$compressed>100){$z->close();return [];} $shared=[];$xml=$z->getFromName('xl/sharedStrings.xml');if($xml){$x=simplexml_load_string($xml);if(!$x){$z->close();return [];}foreach($x->si as $v)$shared[]=self::cell((string)$v->t);}$sheet=$z->getFromName('xl/worksheets/sheet1.xml');$z->close();if(!$sheet)return [];$x=simplexml_load_string($sheet);if(!$x)return [];$x->registerXPathNamespace('x','http://schemas.openxmlformats.org/spreadsheetml/2006/main');$out=[];foreach($x->xpath('//x:row') as $row){if(count($out)>self::MAX_ROWS||count($row->c)>12)return [];$line=[];foreach($row->c as $c){$ref=(string)$c['r'];if(isset($c->f)&&($ref===''||ord($ref[0])-64<10||ord($ref[0])-64>12))return [];$v=(string)$c->v;if((string)$c['t']==='s')$v=$shared[(int)$v]??'';elseif((string)$c['t']==='inlineStr')$v=(string)$c->is->t;$line[]=self::cell($v);}if(!$out||array_filter(array_slice($line,0,in_array('주문코드',$out[0]??[],true)?9:10),fn($v)=>$v!==''))$out[]=$line;}return $out;}
    private static function cell(string $value):string{$value=wp_strip_all_tags($value);return mb_strlen($value)>1000?'':trim($value);}
    private static function catalog():array{global $wpdb;$o=$wpdb->prefix.'supplier_lane_offers';$p=$wpdb->prefix.'supplier_lane_parent_links';$posts=$wpdb->posts;$rows=[["원하는 상품을 검색한 뒤 주문코드를 주문입력 시트에 복사하세요."],['주문코드','상품명','옵션명','판매가','재고상태','배송비유형','기본배송비','제주추가배송비','도서산간안내']];foreach($wpdb->get_results("SELECT o.public_option_label,o.woo_parent_id,o.woo_variation_id,o.stock_status,o.shipping_policy_json FROM {$o} o JOIN {$p} l ON l.id=o.parent_link_id AND l.status='approved' JOIN {$posts} parent ON parent.ID=o.woo_parent_id AND parent.post_status='publish' JOIN {$posts} variation ON variation.ID=o.woo_variation_id AND variation.post_status='publish' WHERE o.approval_status='approved' AND o.lifecycle_status='active' ORDER BY o.woo_variation_id",ARRAY_A) as $r){$v=wc_get_product((int)$r['woo_variation_id']);if(!$v||!$v->is_purchasable()||!$v->is_in_stock())continue;$policy=json_decode((string)$r['shipping_policy_json'],true);$rows[]=[self::order_code((int)$r['woo_variation_id']),get_the_title((int)$r['woo_parent_id']),(string)$r['public_option_label'],(string)$v->get_price(),(string)$r['stock_status'],(string)($policy['shipping_policy_type']??''),(string)($policy['shipping_base_fee']??0),(string)($policy['shipping_jeju_extra_fee']??0),(float)($policy['shipping_remote_extra_fee']??0)>0?'도서산간 추가배송비 있음':'정책 없음'];}return $rows;}
    private static function xlsx(string $name,array $sheets):void{nocache_headers();header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');header('Content-Disposition: attachment; filename='.$name);$z=new ZipArchive();$tmp=tempnam(sys_get_temp_dir(),'whx');$z->open($tmp,ZipArchive::CREATE);$overrides='';for($n=1;$n<=count($sheets);$n++)$overrides.='<Override PartName="/xl/worksheets/sheet'.$n.'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';$z->addFromString('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'.$overrides.'</Types>');$z->addFromString('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');$wb='<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'; $rels='<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';$i=1;foreach($sheets as $title=>$rows){$wb.='<sheet name="'.esc_attr($title).'" sheetId="'.$i.'" r:id="rId'.$i.'"/>'; $rels.='<Relationship Id="rId'.$i.'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'.$i.'.xml"/>'; $view=$title==='주문입력'?'<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>':($title==='상품목록'?'<sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>':'');$xml='<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'.$view.'<sheetData>';foreach($rows as $n=>$row){$xml.='<row r="'.($n+1).'">';foreach(array_values($row) as $col=>$v){$ref=chr(65+$col).($n+1);if(is_array($v)&&isset($v['formula']))$xml.='<c r="'.$ref.'"><f>'.htmlspecialchars((string)$v['formula'],ENT_XML1|ENT_QUOTES,'UTF-8').'</f><v></v></c>';else $xml.='<c r="'.$ref.'" t="inlineStr"><is><t>'.htmlspecialchars((string)$v,ENT_XML1|ENT_QUOTES,'UTF-8').'</t></is></c>';}$xml.='</row>';}$filter=$title==='주문입력'?'<autoFilter ref="A1:L'.count($rows).'"/>':($title==='상품목록'?'<autoFilter ref="A2:I'.count($rows).'"/>':'');$path='xl/worksheets/sheet'.$i.'.xml';$z->addFromString($path,$xml.'</sheetData>'.$filter.'</worksheet>');if($title==='주문입력')$z->setCompressionName($path,ZipArchive::CM_STORE);$i++;}$z->addFromString('xl/workbook.xml',$wb.'</sheets></workbook>');$z->addFromString('xl/_rels/workbook.xml.rels',$rels.'</Relationships>');$z->close();readfile($tmp);unlink($tmp);exit;}
    public static function admin_menu():void{add_submenu_page('woocommerce','대량주문','대량주문','manage_woocommerce','wh-bulk-order',function(){global $wpdb;$t=$wpdb->prefix.'wholesalehub_bulk_batches';$rows=$wpdb->get_results("SELECT * FROM {$t} ORDER BY id DESC LIMIT 100",ARRAY_A);echo '<div class="wrap"><h1>대량주문</h1><p>'.esc_html(self::LIMIT_MESSAGE).'</p><table class="widefat"><tr><th>Batch</th><th>고객</th><th>행</th><th>배송</th><th>금액</th><th>Woo order</th><th>상태</th></tr>';foreach($rows as $r)echo '<tr><td>'.esc_html($r['uuid']).'</td><td>'.(int)$r['customer_id'].'</td><td>'.(int)$r['row_count'].'</td><td>'.(int)$r['shipment_count'].'</td><td>'.esc_html($r['grand_total']).'</td><td>'.(int)$r['woo_order_id'].'</td><td>'.esc_html($r['status']).'</td></tr>';echo '</table></div>';});}
    public static function admin_search_menu():void{add_submenu_page('woocommerce','대량주문 검색','대량주문 검색','manage_woocommerce','wh-bulk-order-search',[self::class,'admin_search_page']);}
    public static function admin_search_page():void{if(!current_user_can('manage_woocommerce'))wp_die('Forbidden',403);global $wpdb;$b=$wpdb->prefix.'wholesalehub_bulk_batches';$r=$wpdb->prefix.'wholesalehub_bulk_rows';$id=absint($_GET['batch']??0);if($id){$rows=$wpdb->get_results($wpdb->prepare("SELECT * FROM {$r} WHERE batch_id=%d ORDER BY row_number",$id),ARRAY_A);echo '<div class="wrap"><h1>대량주문 상세</h1><table class="widefat"><tr><th>수령인/주소</th><th>옵션</th><th>수량</th><th>배송비</th><th>고객주문</th><th>검증/snapshot</th></tr>';foreach($rows as $x){$s=json_decode((string)$x['shipping_snapshot'],true);echo '<tr><td>'.esc_html($x['recipient'].' '.$x['postcode'].' '.$x['address1'].' '.$x['address2']).'</td><td>'.esc_html($x['public_offer_key']).'</td><td>'.(int)$x['quantity'].'</td><td>'.esc_html((string)($s['amount']??0)).'</td><td>'.esc_html($x['customer_reference']).'</td><td>'.esc_html($x['validation_state'].' '.wp_json_encode($s)).'</td></tr>';}echo '</table></div>';return;}$q=sanitize_text_field(wp_unslash($_GET['s']??''));$like='%'.$wpdb->esc_like($q).'%';$sql="SELECT DISTINCT b.* FROM {$b} b LEFT JOIN {$r} r ON r.batch_id=b.id WHERE (%s='' OR b.uuid LIKE %s OR CAST(b.woo_order_id AS CHAR) LIKE %s OR CAST(b.customer_id AS CHAR) LIKE %s OR r.customer_reference LIKE %s OR r.recipient LIKE %s) ORDER BY b.id DESC LIMIT 100";$rows=$wpdb->get_results($wpdb->prepare($sql,$q,$like,$like,$like,$like,$like),ARRAY_A);echo '<div class="wrap"><h1>대량주문 검색</h1><form><input type="hidden" name="page" value="wh-bulk-order-search"><input name="s" value="'.esc_attr($q).'" placeholder="batch, Woo order, customer, reference, recipient"><button class="button">검색</button></form><table class="widefat"><tr><th>Batch</th><th>고객</th><th>배송</th><th>금액</th><th>Woo</th><th>상태</th></tr>';foreach($rows as $x){$url=admin_url('admin.php?page=wh-bulk-order-search&batch='.(int)$x['id']);echo '<tr><td><a href="'.esc_url($url).'">'.esc_html($x['uuid']).'</a></td><td>'.(int)$x['customer_id'].'</td><td>'.(int)$x['shipment_count'].'</td><td>'.esc_html($x['grand_total']).'</td><td>'.(int)$x['woo_order_id'].'</td><td>'.esc_html($x['status']).'</td></tr>';}echo '</table></div>';}
}
