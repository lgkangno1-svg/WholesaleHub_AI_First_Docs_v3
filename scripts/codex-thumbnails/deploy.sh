#!/usr/bin/env bash
set -Eeuo pipefail
stage=/home/tnfwod/wholesalehub-thumbnail-worker/staging
live=/home/tnfwod/avocadoss-wordpress/wp_data/wp-content/plugins/wholesalehub-supplier-lanes/includes/class-wholesalehub-supplier-lane-approval.php
mu=/home/tnfwod/avocadoss-wordpress/wp_data/wp-content/mu-plugins/wholesalehub-codex-thumbnails.php
backup=/home/tnfwod/backups/codex-thumbnails-20260915
expected=e90dfaeb87f51b3118f91fe01fafaa6a1d2de7f497f7abd59d21d264cf65751b
test "$(sha256sum "$live" | cut -d' ' -f1)" = "$expected"
test ! -e "$mu"
test ! -e "$backup"
mkdir -m 700 "$backup"
cp -p "$live" "$backup/approval.php"
changed=0
rollback() {
  code=$?
  if [ "$code" -ne 0 ] && [ "$changed" -eq 1 ]; then
    systemctl --user disable --now wholesalehub-codex-thumbnails.timer || true
    docker cp "$backup/approval.php" avocadoss-wp:/var/www/html/wp-content/plugins/wholesalehub-supplier-lanes/includes/class-wholesalehub-supplier-lane-approval.php
    if [ -e "$mu" ]; then docker exec avocadoss-wp mv /var/www/html/wp-content/mu-plugins/wholesalehub-codex-thumbnails.php /tmp/whct-bridge-failed.php; fi
    docker exec avocadoss-wp wp --allow-root --path=/var/www/html option delete whct_start_after_id || true
  fi
  exit "$code"
}
trap rollback EXIT
docker cp "$stage/wholesalehub-codex-thumbnails.php" avocadoss-wp:/tmp/whct-bridge.php
docker exec avocadoss-wp php -l /tmp/whct-bridge.php
docker exec avocadoss-wp php -l /tmp/whct-tests/live-approval.php
changed=1
docker exec avocadoss-wp cp /tmp/whct-bridge.php /var/www/html/wp-content/mu-plugins/wholesalehub-codex-thumbnails.php
docker exec avocadoss-wp cp /tmp/whct-tests/live-approval.php /var/www/html/wp-content/plugins/wholesalehub-supplier-lanes/includes/class-wholesalehub-supplier-lane-approval.php
docker exec avocadoss-wp chmod 644 /var/www/html/wp-content/mu-plugins/wholesalehub-codex-thumbnails.php /var/www/html/wp-content/plugins/wholesalehub-supplier-lanes/includes/class-wholesalehub-supplier-lane-approval.php
docker exec avocadoss-wp wp --allow-root --path=/var/www/html eval 'global $wpdb; if (get_option("whct_start_after_id", false) !== false) { throw new RuntimeException("already_enabled"); } $id=(int)$wpdb->get_var("SELECT MAX(id) FROM {$wpdb->prefix}supplier_lane_approval_requests"); add_option("whct_start_after_id", $id, "", false); echo "BASELINE=".$id.PHP_EOL;'
docker exec avocadoss-wp wp --allow-root --path=/var/www/html whct list
mkdir -p /home/tnfwod/.config/systemd/user
cp "$stage/wholesalehub-codex-thumbnails.service" "$stage/wholesalehub-codex-thumbnails.timer" /home/tnfwod/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user start wholesalehub-codex-thumbnails.service
systemctl --user enable --now wholesalehub-codex-thumbnails.timer
test "$(curl --max-time 25 -s -o /dev/null -w '%{http_code}' https://hub.avocadoss.co.kr/)" = 200
systemctl --user is-active wholesalehub-codex-thumbnails.timer
cmp "$stage/live-approval.php" "$live"
cmp "$stage/wholesalehub-codex-thumbnails.php" "$mu"
printf 'DEPLOY_OK backup=%s\n' "$backup"
