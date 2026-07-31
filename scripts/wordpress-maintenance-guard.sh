#!/usr/bin/env bash
set -euo pipefail

maintenance_file="${1:-/home/tnfwod/avocadoss-wordpress/wp_data/.maintenance}"

if [[ ! -e "$maintenance_file" && ! -L "$maintenance_file" ]]; then
  exit 0
fi

if command -v logger >/dev/null 2>&1; then
  logger -t wholesalehub-wordpress-maintenance-guard \
    "Removing WordPress maintenance marker: $maintenance_file"
fi
rm -f -- "$maintenance_file"
