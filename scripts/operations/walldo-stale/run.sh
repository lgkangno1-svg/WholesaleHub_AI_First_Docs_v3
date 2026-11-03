#!/usr/bin/env bash
set -euo pipefail
BASE=/home/tnfwod/mcp-workspaces/kelvin/wholesale-walldo-stale-20261104
exec 9>"$BASE/reconcile.lock"
if ! flock -n 9; then
  echo "SKIP concurrent Walldo reconciliation"
  exit 0
fi
docker cp "$BASE/export_links.php" avocadoss-wp:/tmp/kelvin-wholesale-export-links-20261104.php >/dev/null
docker exec avocadoss-wp php /tmp/kelvin-wp-cli.phar --allow-root --path=/var/www/html \
  eval-file /tmp/kelvin-wholesale-export-links-20261104.php > "$BASE/lane-links-latest.json.tmp"
python3 - "$BASE/lane-links-latest.json.tmp" <<'PY'
import json,sys
rows=json.load(open(sys.argv[1]))
if not isinstance(rows,list) or len(rows)<20:
    raise SystemExit('WordPress lane bridge is incomplete; refusing reconciliation')
PY
mv "$BASE/lane-links-latest.json.tmp" "$BASE/lane-links-latest.json"
exec /home/tnfwod/b2b-sync/venv/bin/python -u "$BASE/reconcile.py" "${1:---apply}"
