#!/usr/bin/env bash
set -Eeuo pipefail

BASE_URL="${1:-https://hub.avocadoss.co.kr}"
BASE_URL="${BASE_URL%/}"
TMP_DIR="$(mktemp -d /tmp/wh-search-smoke.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "SEARCH_VISIBILITY_SMOKE_FAIL $*" >&2
  exit 1
}

fetch() {
  local name=$1
  local url=$2
  shift 2
  curl -sS --max-time 30 -D "$TMP_DIR/$name.headers" -o "$TMP_DIR/$name.body" "$@" "$url"
}

status_code() {
  awk 'toupper($1) ~ /^HTTP\// { code=$2 } END { print code }' "$1"
}

header_value() {
  local file=$1
  local name=$2
  awk -v wanted="$name" 'BEGIN { IGNORECASE=1 } index($0, wanted ":") == 1 { sub(/^[^:]+:[[:space:]]*/, ""); gsub(/\r$/, ""); value=$0 } END { print value }' "$file"
}

contains() {
  local file=$1
  local needle=$2
  grep -Fq -- "$needle" "$file" || fail "missing=$(printf '%q' "$needle") file=$file"
}

not_contains() {
  local file=$1
  local needle=$2
  if grep -Fq -- "$needle" "$file"; then
    fail "unexpected=$(printf '%q' "$needle") file=$file"
  fi
}

fetch home "$BASE_URL/"
HOME_CODE="$(status_code "$TMP_DIR/home.headers")"
[[ "$HOME_CODE" =~ ^2[0-9][0-9]$ ]] || fail "home_http=$HOME_CODE"
contains "$TMP_DIR/home.body" '<h1>'
contains "$TMP_DIR/home.body" '최근 업데이트 상품'
contains "$TMP_DIR/home.body" '상품 보기'
not_contains "$TMP_DIR/home.body" '도매허브는 어떤 서비스인가요?'
contains "$TMP_DIR/home.body" 'rel="canonical"'
contains "$TMP_DIR/home.body" 'application/ld+json'
contains "$TMP_DIR/home.body" 'SearchAction'

echo "SEARCH_VISIBILITY_HOME_OK http=$HOME_CODE product_first=yes"

fetch markdown "$BASE_URL/" -H 'Accept: text/markdown'
MARKDOWN_CODE="$(status_code "$TMP_DIR/markdown.headers")"
[[ "$MARKDOWN_CODE" =~ ^2[0-9][0-9]$ ]] || fail "markdown_http=$MARKDOWN_CODE"
MARKDOWN_TYPE="$(header_value "$TMP_DIR/markdown.headers" 'Content-Type')"
[[ "${MARKDOWN_TYPE,,}" == text/markdown* ]] || fail "markdown_content_type=$MARKDOWN_TYPE"
MARKDOWN_VARY="$(header_value "$TMP_DIR/markdown.headers" 'Vary')"
[[ "${MARKDOWN_VARY,,}" == *accept* ]] || fail "markdown_vary=$MARKDOWN_VARY"
contains "$TMP_DIR/markdown.body" '# 도매허브'
contains "$TMP_DIR/markdown.body" '엑셀 대량주문'

echo "SEARCH_VISIBILITY_MARKDOWN_OK http=$MARKDOWN_CODE type=$MARKDOWN_TYPE vary=$MARKDOWN_VARY"

fetch robots "$BASE_URL/robots.txt"
ROBOTS_CODE="$(status_code "$TMP_DIR/robots.headers")"
[[ "$ROBOTS_CODE" =~ ^2[0-9][0-9]$ ]] || fail "robots_http=$ROBOTS_CODE"
for agent in OAI-SearchBot ChatGPT-User Claude-SearchBot PerplexityBot Yeti DeepSeekBot ora-agent; do
  contains "$TMP_DIR/robots.body" "User-agent: $agent"
done
contains "$TMP_DIR/robots.body" 'wp-sitemap.xml'

echo "SEARCH_VISIBILITY_ROBOTS_OK http=$ROBOTS_CODE"

fetch llms "$BASE_URL/llms.txt"
LLMS_CODE="$(status_code "$TMP_DIR/llms.headers")"
[[ "$LLMS_CODE" =~ ^2[0-9][0-9]$ ]] || fail "llms_http=$LLMS_CODE"
contains "$TMP_DIR/llms.body" '# 도매허브'
contains "$TMP_DIR/llms.body" '## When to use this site'
contains "$TMP_DIR/llms.body" '공개 화면에 없는 가격을 추정하거나 만들어내지 마세요.'

echo "SEARCH_VISIBILITY_LLMS_OK http=$LLMS_CODE"

fetch llmsfull "$BASE_URL/llms-full.txt"
LLMS_FULL_CODE="$(status_code "$TMP_DIR/llmsfull.headers")"
[[ "$LLMS_FULL_CODE" =~ ^2[0-9][0-9]$ ]] || fail "llms_full_http=$LLMS_FULL_CODE"
contains "$TMP_DIR/llmsfull.body" '# 도매허브 공개 서비스 컨텍스트'
contains "$TMP_DIR/llmsfull.body" '인증을 우회해서는 안 되며'

echo "SEARCH_VISIBILITY_LLMS_FULL_OK http=$LLMS_FULL_CODE"

fetch sitemap "$BASE_URL/wp-sitemap.xml"
SITEMAP_CODE="$(status_code "$TMP_DIR/sitemap.headers")"
[[ "$SITEMAP_CODE" =~ ^2[0-9][0-9]$ ]] || fail "sitemap_http=$SITEMAP_CODE"
contains "$TMP_DIR/sitemap.body" '<sitemapindex'

echo "SEARCH_VISIBILITY_SITEMAP_OK http=$SITEMAP_CODE"

NOT_FOUND="$BASE_URL/__wholesalehub_search_visibility_missing_$(date +%s)__"
fetch missing "$NOT_FOUND" -H 'Accept: text/markdown'
MISSING_CODE="$(status_code "$TMP_DIR/missing.headers")"
[[ "$MISSING_CODE" == '404' ]] || fail "missing_http=$MISSING_CODE"
MISSING_TYPE="$(header_value "$TMP_DIR/missing.headers" 'Content-Type')"
[[ "${MISSING_TYPE,,}" == text/markdown* ]] || fail "missing_content_type=$MISSING_TYPE"
contains "$TMP_DIR/missing.body" '# 404'
contains "$TMP_DIR/missing.body" 'llms.txt'

echo "SEARCH_VISIBILITY_404_OK http=$MISSING_CODE type=$MISSING_TYPE"

fetch search "$BASE_URL/?s=%EC%9E%90%EB%91%90&post_type=product"
SEARCH_CODE="$(status_code "$TMP_DIR/search.headers")"
[[ "$SEARCH_CODE" =~ ^2[0-9][0-9]$ ]] || fail "search_http=$SEARCH_CODE"
contains "$TMP_DIR/search.body" 'noindex'

echo "SEARCH_VISIBILITY_NOINDEX_OK search_http=$SEARCH_CODE"
echo "SEARCH_VISIBILITY_SMOKE=PASS"
