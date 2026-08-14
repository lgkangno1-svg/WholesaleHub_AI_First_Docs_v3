#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT=/home/tnfwod/projects/wholesalehub
BACKUP=/home/tnfwod/backups/wholesalehub-catalog-rebuild/20260726-135621
PLAN="$PROJECT/reports/rebuild/catalog-rebuild-plan.json"
RESULT="$PROJECT/reports/rebuild/woocommerce-rebuild-result.json"
STATUS="$PROJECT/reports/rebuild/production-rebuild.status"
WP_PLUGIN_DIR=/home/tnfwod/avocadoss-wordpress/wp_data/wp-content/plugins

rollback() {
  local reason=$1
  printf 'rollback_reason=%s\n' "$reason" >&2
  gzip -dc "$BACKUP/wordpress-full.sql.gz" |
    docker exec -i avocadoss-db sh -c \
      'exec mariadb -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'
  sqlite_tmp="$PROJECT/data/wholesalehub.sqlite.rebuild-restore"
  cp -a "$BACKUP/wholesalehub.sqlite" "$sqlite_tmp"
  mv -f "$sqlite_tmp" "$PROJECT/data/wholesalehub.sqlite"
  tar -xzf "$BACKUP/wordpress-plugins.tar.gz" -C "$WP_PLUGIN_DIR"
  docker restart avocadoss-wp >/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS https://hub.avocadoss.co.kr/ >/dev/null 2>&1; then
      printf 'ROLLED_BACK\n' >"$STATUS"
      return 0
    fi
    sleep 3
  done
  printf 'ROLLBACK_HEALTH_FAILED\n' >"$STATUS"
  return 1
}

test -s "$PLAN"
node -e '
  const plan = require(process.argv[1]);
  if (!plan.counts || plan.counts.productGroups < 1 || plan.counts.variations < 1) {
    throw new Error("empty rebuild plan");
  }
' "$PLAN"

docker cp "$PLAN" avocadoss-wp:/tmp/catalog-rebuild-plan.json >/dev/null
docker cp "$PROJECT/scripts/supplier-catalog/rebuild-woocommerce-catalog.php" \
  avocadoss-wp:/tmp/rebuild-woocommerce-catalog.php >/dev/null

set +e
docker exec \
  -e WHOLESALEHUB_REBUILD_PLAN=/tmp/catalog-rebuild-plan.json \
  -e WHOLESALEHUB_REBUILD_RESULT=/tmp/woocommerce-rebuild-result.json \
  avocadoss-wp \
  wp --allow-root --path=/var/www/html eval-file /tmp/rebuild-woocommerce-catalog.php \
  >"$PROJECT/reports/rebuild/woocommerce-rebuild.log" 2>&1
code=$?
set -e
if [ "$code" -ne 0 ]; then
  rollback "woocommerce_rebuild_exit_$code"
  exit "$code"
fi
docker cp avocadoss-wp:/tmp/woocommerce-rebuild-result.json "$RESULT" >/dev/null
node -e '
  const result = require(process.argv[1]);
  if (result.status !== "rebuilt" || result.created_products < 1 || result.created_variations < 1) {
    process.exit(1);
  }
' "$RESULT" || {
  rollback "woocommerce_rebuild_result_invalid"
  exit 1
}
printf 'REBUILT\n' >"$STATUS"
