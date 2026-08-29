#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${WHOLESALEHUB_ROOT:-/home/tnfwod/projects/wholesalehub}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="${TMPDIR:-/tmp}/wholesalehub-telegram-control-plane-${STAMP}.txt"

redact() {
  sed -E \
    -e 's/([A-Za-z0-9_]*(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|AUTHORIZATION|BOT_TOKEN)[A-Za-z0-9_]*=)[^[:space:]]+/\1[REDACTED]/Ig' \
    -e 's/(Bearer[[:space:]]+)[A-Za-z0-9._~+\/-]+/\1[REDACTED]/Ig' \
    -e 's/([?&](token|key|secret|api_key)=)[^&[:space:]]+/\1[REDACTED]/Ig'
}

section() { printf '\n===== %s =====\n' "$1"; }

safe_version() {
  local bin="$1"
  local path
  path="$(command -v "$bin" 2>/dev/null || true)"
  echo "${bin^^}_PATH=${path:-NOT_FOUND}"
  if [[ -n "$path" ]]; then
    set +e
    local out code
    out="$(timeout 15s "$path" --version 2>&1)"
    code=$?
    set -e
    printf '%s\n' "$out" | head -n 5 | redact
    echo "${bin^^}_VERSION_EXIT=$code"
  fi
}

probe_port() {
  local host="$1" port="$2" label="$3"
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$host" "$port" "$label" <<'PY'
import socket, sys
host, port, label = sys.argv[1], int(sys.argv[2]), sys.argv[3]
s = socket.socket()
s.settimeout(1.0)
try:
    s.connect((host, port))
except Exception:
    print(f"{label}_TCP=NO")
else:
    print(f"{label}_TCP=YES")
finally:
    s.close()
PY
  fi
}

exec > >(tee "$REPORT") 2>&1

echo 'WHOLESALEHUB_TELEGRAM_CONTROL_PLANE_DIAGNOSTIC=START'
echo "UTC=$STAMP"
echo "HOST=$(hostname 2>/dev/null || echo unknown)"
echo "USER=$(id -un 2>/dev/null || echo unknown)"
echo "ROOT=$ROOT"

section '1. PROJECT / GIT'
if [[ -d "$ROOT/.git" ]]; then
  echo "PROJECT_GIT_HEAD=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo UNKNOWN)"
  echo "PROJECT_BRANCH=$(git -C "$ROOT" branch --show-current 2>/dev/null || echo UNKNOWN)"
  echo "PROJECT_TRACKED_DIRTY_COUNT=$(git -C "$ROOT" status --porcelain --untracked-files=no 2>/dev/null | wc -l | tr -d ' ')"
else
  echo 'PROJECT_GIT=NOT_FOUND'
fi
[[ -r "$ROOT/PROJECT_NORTH_STAR.md" ]] && echo 'NORTH_STAR=READABLE' || echo 'NORTH_STAR=NOT_READABLE'
[[ -r "$ROOT/docs/TELEGRAM_AI_CONTROL_PLANE_CONTRACT.md" ]] && echo 'CONTROL_PLANE_CONTRACT=READABLE' || echo 'CONTROL_PLANE_CONTRACT=NOT_READABLE'

section '2. UTF8 / LOCALE'
printf 'LANG=%s\n' "${LANG:-UNSET}" | redact
printf 'LC_ALL=%s\n' "${LC_ALL:-UNSET}" | redact
if command -v python3 >/dev/null 2>&1; then
  python3 - <<'PY'
import locale, sys
text='한글 테스트 정상'
print('PYTHON_STDOUT_ENCODING=' + str(sys.stdout.encoding))
print('PYTHON_PREFERRED_ENCODING=' + str(locale.getpreferredencoding(False)))
print('UTF8_ROUNDTRIP=' + text.encode('utf-8').decode('utf-8'))
PY
fi

section '3. REQUIRED BINARIES'
for bin in codex opencode gemini node npm npx bwrap unshare; do safe_version "$bin"; done

section '4. SANDBOX SIGNALS'
if [[ -r /proc/sys/kernel/unprivileged_userns_clone ]]; then
  printf 'UNPRIVILEGED_USERNS_CLONE='; cat /proc/sys/kernel/unprivileged_userns_clone
else
  echo 'UNPRIVILEGED_USERNS_CLONE=UNAVAILABLE'
fi
if [[ -r /proc/sys/user/max_user_namespaces ]]; then
  printf 'MAX_USER_NAMESPACES='; cat /proc/sys/user/max_user_namespaces
fi
if command -v unshare >/dev/null 2>&1; then
  set +e
  unshare -Ur true >/dev/null 2>&1
  echo "UNSHARE_UR_EXIT=$?"
  set -e
fi

section '5. OPENCODE CONFIG SHAPE'
auth="$HOME/.local/share/opencode/auth.json"
[[ -f "$auth" ]] && echo 'OPENCODE_AUTH_STORE=PRESENT' || echo 'OPENCODE_AUTH_STORE=ABSENT'
if [[ -f "$auth" && -x "$(command -v jq 2>/dev/null || true)" ]]; then
  jq -r 'keys[]' "$auth" 2>/dev/null | sed 's/^/OPENCODE_AUTH_PROVIDER=/' || true
fi
for cfg in "$HOME/.config/opencode/opencode.json" "$HOME/.config/opencode/config.json" "$ROOT/opencode.json" "$ROOT/.opencode/opencode.json"; do
  [[ -f "$cfg" ]] || continue
  echo "OPENCODE_CONFIG_PATH=$cfg"
  if command -v jq >/dev/null 2>&1; then
    jq -r 'if (.model? | type)=="string" then "OPENCODE_MODEL=" + .model else empty end' "$cfg" 2>/dev/null || true
    jq -r 'if (.provider? | type)=="object" then .provider | keys[] | "OPENCODE_PROVIDER=" + . else empty end' "$cfg" 2>/dev/null || true
    jq -r 'if (.agent? | type)=="object" then .agent | keys[] | "OPENCODE_AGENT=" + . else empty end' "$cfg" 2>/dev/null || true
  fi
done

section '6. OPENCODEX DISCOVERY'
probe_port 127.0.0.1 10100 OPENCODEX_10100
(ps -eo pid=,user=,comm= 2>/dev/null || true) | grep -Ei 'opencodex|opencode|antigravity|gemini|codex|telegram|bot' | head -n 100 | redact || true
units="$(mktemp)"
{
  systemctl --user list-unit-files --type=service --no-legend 2>/dev/null || true
  systemctl list-unit-files --type=service --no-legend 2>/dev/null || true
} | awk '{print $1}' | grep -Ei 'opencodex|opencode|antigravity|gemini|codex|telegram|bot' | sort -u > "$units" || true
if [[ ! -s "$units" ]]; then
  echo 'AI_SYSTEMD_UNITS=NONE'
else
  while IFS= read -r unit; do
    [[ -n "$unit" ]] || continue
    echo "UNIT=$unit"
    set +e
    info="$(systemctl --user show "$unit" -p FragmentPath -p WorkingDirectory -p ActiveState -p SubState 2>/dev/null)"
    if [[ -z "$info" ]]; then info="$(systemctl show "$unit" -p FragmentPath -p WorkingDirectory -p User -p ActiveState -p SubState 2>/dev/null)"; fi
    set -e
    printf '%s\n' "$info" | redact
  done < "$units"
fi
rm -f "$units"

section '7. ROUTER SOURCE DISCOVERY'
candidates="$(mktemp)"
find "$HOME" -maxdepth 7 -type f \
  \( -name '*.py' -o -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.ts' -o -name '*.sh' -o -name '*.service' \) \
  -size -3M ! -path '*/.git/*' ! -path '*/node_modules/*' ! -path '*/wp-content/uploads/*' ! -path '*/.local/share/opencode/*' -print0 2>/dev/null \
  | xargs -0 -r grep -IlE 'OpenCode \(DeepSeek\)|Codex \(Terra\)|Antigravity \(Gemini\)|/codex|callback_query|TelegramBot|opencodex|10100' 2>/dev/null \
  | head -n 60 > "$candidates" || true
if [[ ! -s "$candidates" ]]; then
  echo 'ROUTER_SOURCE_CANDIDATES=NONE'
else
  while IFS= read -r file; do
    [[ -n "$file" ]] || continue
    echo "ROUTER_CANDIDATE=$file"
    sha256sum "$file" 2>/dev/null | sed 's/^/ROUTER_CANDIDATE_SHA256=/' || true
    tags=()
    grep -qEi 'opencodex|10100' "$file" 2>/dev/null && tags+=(opencodex) || true
    grep -qEi 'OpenCode \(DeepSeek\)|deepseek|opencode' "$file" 2>/dev/null && tags+=(opencode_deepseek) || true
    grep -qEi 'Antigravity \(Gemini\)|antigravity|gemini' "$file" 2>/dev/null && tags+=(antigravity) || true
    grep -qEi 'Codex \(Terra\)|/codex|codex' "$file" 2>/dev/null && tags+=(codex) || true
    if ((${#tags[@]})); then joined="$(IFS=,; printf '%s' "${tags[*]}")"; else joined=unknown; fi
    echo "ROUTER_CANDIDATE_TAGS=$joined"
  done < "$candidates"
fi
rm -f "$candidates"

section '8. REPOSITORY WORKER CONTRACT'
for file in scripts/ai-worker.sh scripts/ai-direct-worker.sh scripts/openrouter-direct-worker.mjs; do
  if [[ -f "$ROOT/$file" ]]; then
    echo "HELPER_PRESENT=$file"
    sha256sum "$ROOT/$file" 2>/dev/null | sed 's/^/HELPER_SHA256=/' || true
  else
    echo "HELPER_MISSING=$file"
  fi
done
if [[ -f "$ROOT/scripts/ai-worker.sh" ]]; then
  grep -q 'openrouter/deepseek/deepseek-v4-flash' "$ROOT/scripts/ai-worker.sh" && echo 'REPO_DEEPSEEK_FLASH_ROUTE=DECLARED' || echo 'REPO_DEEPSEEK_FLASH_ROUTE=NOT_DECLARED'
fi

section '9. SAFE ISOLATED OPENCODE FLASH SMOKE'
if command -v opencode >/dev/null 2>&1; then
  tmp="$(mktemp -d)"
  set +e
  out="$(timeout --signal=TERM --kill-after=5s 75s opencode run --pure --dir "$tmp" --format json --model 'openrouter/deepseek/deepseek-v4-flash' 'Reply with exactly PONG. Do not use tools. Do not create or modify files.' 2>&1)"
  code=$?
  set -e
  echo "OPENCODE_FLASH_SMOKE_EXIT=$code"
  echo "OPENCODE_FLASH_SMOKE_FILE_COUNT=$(find "$tmp" -mindepth 1 -maxdepth 1 -print 2>/dev/null | wc -l | tr -d ' ')"
  printf '%s\n' "$out" | tail -n 30 | redact
  rm -rf "$tmp"
else
  echo 'OPENCODE_FLASH_SMOKE=SKIPPED_NOT_FOUND'
fi

section '10. DIRECT CODEX NON-MUTATING SMOKE'
if command -v codex >/dev/null 2>&1; then
  tmp="$(mktemp -d)"
  echo "CODEX_DIRECT_SMOKE_DIR=$tmp"
  echo 'CODEX_DIRECT_SMOKE=NOT_AUTORUN'
  echo 'CODEX_DIRECT_REASON=CLI flags/auth/sandbox mode must be learned from the proven runtime before an automated direct invocation is attempted.'
  rm -rf "$tmp"
else
  echo 'CODEX_DIRECT_SMOKE=SKIPPED_NOT_FOUND'
fi

section '11. ANTIGRAVITY SAFE DISCOVERY'
if command -v gemini >/dev/null 2>&1; then echo 'GEMINI_CLI=PRESENT'; else echo 'GEMINI_CLI=ABSENT'; fi
echo 'ANTIGRAVITY_SMOKE=NOT_AUTORUN'
echo 'ANTIGRAVITY_REASON=Do not equate standalone Gemini CLI with the OpenCodex Antigravity route until the actual adapter/provider is discovered.'

section '12. INTERPRETATION'
echo 'ROUTING_REQUIRED=codex_direct | opencodex_deepseek_flash | opencodex_antigravity'
echo 'NO_SILENT_FALLBACK=REQUIRED'
echo 'PRODUCTION_CONTROL=Must use canonical Git source + tested deploy/rollback path.'
echo 'NO_MUTATION=YES'
echo "REPORT=$REPORT"
echo 'WHOLESALEHUB_TELEGRAM_CONTROL_PLANE_DIAGNOSTIC=DONE'
