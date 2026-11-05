<?php
declare(strict_types=1);
define('ABSPATH','/tmp/');
define('HOUR_IN_SECONDS',3600);
define('WP_CONTENT_DIR','/tmp');
function add_action(...$a):void{}
function wp_next_scheduled(...$a){return false;}
function wp_schedule_event(...$a):void{}
function get_option(...$a){return [];}
function update_option(...$a):void{}
require __DIR__.'/../wordpress/mu-plugins/wholesalehub-catalog-watchdog.php';
function verify(bool $ok,string $message):void { if(!$ok){fwrite(STDERR,"FAIL $message\n");exit(1);} echo "PASS $message\n"; }
$kst=new DateTimeZone('Asia/Seoul');
$now=new DateTimeImmutable('2026-11-05 20:16:00',$kst);
$good=['sanjiro'=>['complete'=>true,'generatedAt'=>'2026-11-05T18:25:00+09:00'],'walldob2b'=>['complete'=>true,'generatedAt'=>'2026-11-05T19:20:00+09:00']];
verify(wholesalehub_catalog_watchdog_evaluate($good,$now)['health']==='healthy','fresh supplier snapshots');
$bad=$good;$bad['sanjiro']['complete']=false;
verify(in_array('sanjiro_snapshot_incomplete',wholesalehub_catalog_watchdog_evaluate($bad,$now)['reasons'],true),'incomplete source rejected');
$bad=$good;$bad['walldob2b']['generatedAt']='2026-11-05T09:20:00+09:00';
verify(in_array('walldob2b_scheduled_catalog_snapshot_missing',wholesalehub_catalog_watchdog_evaluate($bad,$now)['reasons'],true),'missed scheduled snapshot flagged');
$bad=$good;$bad['sanjiro']['generatedAt']='2026-11-05T12:25:00+09:00';
verify(in_array('sanjiro_snapshot_over_5h',wholesalehub_catalog_watchdog_evaluate($bad,$now)['reasons'],true),'stale source flagged');
