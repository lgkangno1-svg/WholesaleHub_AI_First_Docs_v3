#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${WHOLESALEHUB_ROOT:-/home/tnfwod/projects/wholesalehub}"
RUN_SMOKE=0
[[ "${1:-}" == "--smoke" ]] && RUN_SMOKE=1
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="${TMPDIR:-/tmp}/wholesalehub-telegram-ai-diagnostic-${STAMP}.txt"

redact() {
  sed -E \
    -e 's/([A-Za-z0-9_]*(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|AUTHORIZATION|BOT_TOKEN)[A-Za-z0-9_]*=)[^[:space:]]+/\1[REDACTED]/Ig' \
    -e 's/(Bearer[[:space:]]+)[A-Za-z0-9._~+\/-]+/\1[REDACTED]/Ig' \
    -e 's/([?&](token|key|secret|api_key)=)[^&[:space:]]+/\1[REDACTED]/Ig' \
    -e 's/(https?:\/\/[^[:space:]@]+):[^[:space:]@]+@/\1:[REDACTED]@/g'
}

section() {
  printf '\n===== %s =====\n' "$1"
}

safe_run() {
  local label="$1"; shift
  printf '%s: ' "$label"
  set +e
  local out code
  out="$(timeout 20s "$@" 2>&1)"
  code=$?
  set -e
  if [[ -n "$out" ]]; then
    printf '\n%s\n' "$out" | redact
  fi
  printf 'EXIT=%s\n' "$code"
  return 0
}

exec > >(tee "$REPORT") 2>&1

echo "WHOLESALEHUB_TELEGRAM_AI_DIAGNOSTIC=START"
echo "UTC=$STAMP"
echo "HOST=$(hostname 2>/dev/null || echo unknown)"
echo "USER=$(id -un 2>/dev/null || echo unknown)"
echo "ROOT=$ROOT"

section "1. PLATFORM"
uname -a | redact || true
printf 'OS='; (grep '^PRETTY_NAME=' /etc/os-release 2>/dev/null || true) | redact
printf 'ARCH='; uname -m 2>/dev/null || true
printf 'SHELL='; printf '%s\n' "${SHELL:-unknown}" | redact
printf 'PATH_ENTRIES='; printf '%s\n' "$PATH" | awk -F: '{print NF}'

section "2. UTF-8 / LOCALE"
(locale 2>&1 || true) | redact
if command -v python3 >/dev/null 2>&1; then
  python3 - <<'PY' 2>&1 | redact || true
import locale, sys
print("PYTHON_DEFAULT_ENCODING=" + sys.getdefaultencoding())
print("PYTHON_STDOUT_ENCODING=" + str(sys.stdout.encoding))
print("PYTHON_PREFERRED_ENCODING=" + locale.getpreferredencoding(False))
PY
fi
printf 'UTF8_LOCALE_AVAILABLE='; if locale -a 2>/dev/null | grep -Eiq '^(C\.UTF-?8|en_US\.UTF-?8|ko_KR\.UTF-?8)$'; then echo YES; else echo NO; fi

section "3. USER NAMESPACE / BWRAP"
if [[ -r /proc/sys/kernel/unprivileged_userns_clone ]]; then
  printf 'kernel.unprivileged_userns_clone='; cat /proc/sys/kernel/unprivileged_userns_clone
else
  echo 'kernel.unprivileged_userns_clone=UNAVAILABLE'
fi
if [[ -r /proc/sys/user/max_user_namespaces ]]; then
  printf 'user.max_user_namespaces='; cat /proc/sys/user/max_user_namespaces
fi
if command -v unshare >/dev/null 2>&1; then
  set +e
  unshare -Ur true >/dev/null 2>&1
  userns_exit=$?
  set -e
  echo "UNPRIVILEGED_USERNS_SMOKE_EXIT=$userns_exit"
else
  echo 'UNSHARE=NOT_FOUND'
fi
if command -v bwrap >/dev/null 2>&1; then
  safe_run BWRAP_VERSION bwrap --version
else
  echo 'BWRAP=NOT_FOUND'
fi

section "4. AI BINARIES"
for bin in codex opencode gemini node npm npx; do
  path="$(command -v "$bin" 2>/dev/null || true)"
  echo "${bin^^}_PATH=${path:-NOT_FOUND}"
  if [[ -n "$path" ]]; then
    safe_run "${bin^^}_VERSION" "$bin" --version
  fi
done

section "5. OPENCODE CONFIG SHAPE (NO CREDENTIAL VALUES)"
auth="$HOME/.local/share/opencode/auth.json"
if [[ -f "$auth" ]]; then
  echo 'OPENCODE_AUTH_STORE=PRESENT'
  if command -v jq >/dev/null 2>&1; then
    jq -r 'keys[]' "$auth" 2>/dev/null | sed 's/^/OPENCODE_AUTH_PROVIDER=/' | redact || true
  else
    echo 'JQ=NOT_FOUND; provider names not enumerated'
  fi
else
  echo 'OPENCODE_AUTH_STORE=ABSENT'
fi
for cfg in "$HOME/.config/opencode/opencode.json" "$HOME/.config/opencode/config.json" "$ROOT/opencode.json" "$ROOT/.opencode/opencode.json"; do
  [[ -f "$cfg" ]] || continue
  echo "OPENCODE_CONFIG=$cfg"
  grep -En '"(model|provider|agent)"[[:space:]]*:' "$cfg" 2>/dev/null | head -n 80 | redact || true
done

section "6. REPOSITORY AI HELPERS"
for file in scripts/ai-worker.sh scripts/ai-direct-worker.sh scripts/openrouter-direct-worker.mjs; do
  if [[ -f "$ROOT/$file" ]]; then
    echo "HELPER_PRESENT=$file"
    sha256sum "$ROOT/$file" 2>/dev/null | sed 's/^/HELPER_SHA256=/' || true
  else
    echo "HELPER_MISSING=$file"
  fi
done

section "7. TELEGRAM/CODEX/OPENCODE PROCESS DISCOVERY"
(ps -eo pid=,user=,args= 2>/dev/null || true) \
  | grep -Ei 'telegram|codex|opencode|antigravity|gemini|bot' \
  | grep -Ev 'grep -E|telegram-ai-diagnose' \
  | head -n 80 \
  | redact || true

section "8. SYSTEMD UNIT DISCOVERY"
units_tmp="$(mktemp)"
{
  systemctl --user list-unit-files --type=service --no-legend 2>/dev/null || true
  systemctl list-unit-files --type=service --no-legend 2>/dev/null || true
} | awk '{print $1}' | grep -Ei 'telegram|codex|opencode|antigravity|gemini|bot' | sort -u > "$units_tmp" || true
if [[ ! -s "$units_tmp" ]]; then
  echo 'MATCHING_SYSTEMD_UNITS=NONE'
else
  while IFS= read -r unit; do
    [[ -n "$unit" ]] || continue
    echo "UNIT=$unit"
    set +e
    info="$(systemctl --user show "$unit" -p FragmentPath -p ExecStart -p WorkingDirectory -p ActiveState -p SubState 2>/dev/null)"
    code=$?
    if [[ $code -ne 0 || -z "$info" ]]; then
      info="$(systemctl show "$unit" -p FragmentPath -p ExecStart -p WorkingDirectory -p User -p ActiveState -p SubState 2>/dev/null)"
    fi
    set -e
    printf '%s\n' "$info" | redact
  done < "$units_tmp"
fi
rm -f "$units_tmp"

section "9. SOURCE CANDIDATE DISCOVERY"
candidates="$(mktemp)"
find "$HOME" -maxdepth 6 -type f \
  \( -name '*.py' -o -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.ts' -o -name '*.sh' -o -name '*.service' \) \
  -size -2M \
  ! -path '*/.git/*' \
  ! -path '*/node_modules/*' \
  ! -path '*/wp-content/uploads/*' \
  ! -path '*/data/*' \
  ! -path '*/.local/share/opencode/*' \
  -print0 2>/dev/null \
  | xargs -0 -r grep -IlE 'OpenCode \(DeepSeek\)|Codex \(Terra\)|Antigravity \(Gemini\)|gpt-5\.6-terra|/codex|bwrap|unprivileged_userns' 2>/dev/null \
  | head -n 40 > "$candidates" || true
if [[ ! -s "$candidates" ]]; then
  echo 'SOURCE_CANDIDATES=NONE'
else
  while IFS= read -r file; do
    [[ -n "$file" ]] || continue
    echo "CANDIDATE=$file"
    sha256sum "$file" 2>/dev/null | sed 's/^/CANDIDATE_SHA256=/' || true
    grep -En 'OpenCode \(DeepSeek\)|Codex \(Terra\)|Antigravity \(Gemini\)|gpt-5\.6-terra|/codex|bwrap|unprivileged_userns' "$file" 2>/dev/null \
      | head -n 20 \
      | redact || true
  done < "$candidates"
fi
rm -f "$candidates"

section "10. RECENT MATCHED ERROR SIGNALS"
if command -v journalctl >/dev/null 2>&1; then
  journalctl --since '-24 hours' --no-pager -p warning..alert 2>/dev/null \
    | grep -Ei 'telegram|codex|opencode|bwrap|namespace|userns|unicode|utf-8|encoding|gemini|antigravity' \
    | tail -n 80 \
    | redact || true
else
  echo 'JOURNALCTL=NOT_FOUND'
fi

if [[ $RUN_SMOKE -eq 1 ]]; then
  section "11. ISOLATED OPENCODE DEEPSEEK SMOKE"
  if command -v opencode >/dev/null 2>&1; then
    smoke_dir="$(mktemp -d)"
    before="$(find "$smoke_dir" -mindepth 1 -maxdepth 1 -print 2>/dev/null | wc -l)"
    set +e
    smoke_out="$(timeout --signal=TERM --kill-after=5s 75s opencode run --pure --dir "$smoke_dir" --format json --model 'openrouter/deepseek/deepseek-v4-flash' 'Reply with exactly PONG. Do not use tools. Do not create or modify files.' 2>&1)"
    smoke_exit=$?
    set -e
    after="$(find "$smoke_dir" -mindepth 1 -maxdepth 1 -print 2>/dev/null | wc -l)"
    echo "OPENCODE_DEEPSEEK_SMOKE_EXIT=$smoke_exit"
    echo "OPENCODE_DEEPSEEK_SMOKE_FILES_BEFORE=$before"
    echo "OPENCODE_DEEPSEEK_SMOKE_FILES_AFTER=$after"
    printf '%s\n' "$smoke_out" | tail -n 40 | redact
    rm -rf "$smoke_dir"
  else
    echo 'OPENCODE_DEEPSEEK_SMOKE=SKIPPED_NOT_FOUND'
  fi
fi

section "12. INTERPRETATION KEYS"
echo 'USERNS: UNPRIVILEGED_USERNS_SMOKE_EXIT=0 means the kernel permits a basic unprivileged user namespace.'
echo 'BWRAP: a bwrap version alone does not prove sandbox creation works; source/service discovery identifies the actual invocation.'
echo 'UTF8: LANG/LC_ALL and Python stdout should resolve to UTF-8 to avoid garbled Korean output.'
echo 'OPENCODE: the isolated smoke runs outside the project and must leave the temp directory unchanged.'
echo 'SECURITY: credential values are never intentionally printed; only provider names/config model lines are reported.'

echo "REPORT=$REPORT"
echo 'WHOLESALEHUB_TELEGRAM_AI_DIAGNOSTIC=DONE'
