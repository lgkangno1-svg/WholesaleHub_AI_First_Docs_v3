#!/usr/bin/env bash
set -Eeuo pipefail

CODEX_BIN="${WHOLESALEHUB_CODEX_BIN:-$(command -v codex 2>/dev/null || true)}"
if [[ -z "$CODEX_BIN" ]]; then
  for candidate in "$HOME/.local/bin/codex" "$HOME/.npm-global/bin/codex" /usr/local/bin/codex /usr/bin/codex; do
    [[ -x "$candidate" ]] || continue
    CODEX_BIN="$candidate"
    break
  done
fi
[[ -n "$CODEX_BIN" && -x "$CODEX_BIN" ]] || { echo 'AI_RUNTIME_SMOKE=CODEX_NOT_FOUND' >&2; exit 69; }

unset OPENAI_API_KEY OPENROUTER_API_KEY ANTHROPIC_API_KEY GEMINI_API_KEY GOOGLE_API_KEY AZURE_OPENAI_API_KEY

ROOT="$(mktemp -d /tmp/wholesalehub-ai-smoke.XXXXXX)"
trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$ROOT/text/output" "$ROOT/image/output"

"$CODEX_BIN" --version | sed 's/^/CODEX_VERSION=/'

TEXT_PROMPT='Work only in the current directory. Do not use the web, external APIs, API keys, MCP network tools, or provider SDKs. Create output/pong.txt containing exactly PONG followed by a newline. Do not create any other file.'
timeout --signal=TERM --kill-after=10s 180s \
  "$CODEX_BIN" exec --sandbox workspace-write --skip-git-repo-check -C "$ROOT/text" "$TEXT_PROMPT" \
  >"$ROOT/text.log" 2>&1
[[ "$(cat "$ROOT/text/output/pong.txt" 2>/dev/null || true)" == 'PONG' ]] || {
  echo 'AI_RUNTIME_SMOKE=TEXT_FAILED' >&2
  tail -n 60 "$ROOT/text.log" >&2 || true
  exit 1
}
echo 'AI_RUNTIME_SMOKE_TEXT=OK'

IMAGE_PROMPT='Work only in the current directory. Do not use the web, external APIs, API keys, MCP network tools, or provider SDKs. Use $imagegen explicitly to create one original square ecommerce-style studio image of a plain red apple on a neutral background, with no text, logo, label, badge, watermark, packaging, or people. Save the generated image as output/smoke.png, output/smoke.jpg, output/smoke.jpeg, or output/smoke.webp. Do not fake or synthesize an image with code; use only built-in Codex image generation.'
timeout --signal=TERM --kill-after=10s 420s \
  "$CODEX_BIN" exec --sandbox workspace-write --skip-git-repo-check -C "$ROOT/image" "$IMAGE_PROMPT" \
  >"$ROOT/image.log" 2>&1

image_file=''
for candidate in "$ROOT/image/output/smoke.png" "$ROOT/image/output/smoke.jpg" "$ROOT/image/output/smoke.jpeg" "$ROOT/image/output/smoke.webp"; do
  if [[ -s "$candidate" ]]; then image_file="$candidate"; break; fi
done
[[ -n "$image_file" ]] || {
  echo 'AI_RUNTIME_SMOKE=IMAGE_MISSING' >&2
  tail -n 80 "$ROOT/image.log" >&2 || true
  exit 1
}
command -v file >/dev/null 2>&1 || { echo 'AI_RUNTIME_SMOKE=FILE_UTILITY_MISSING' >&2; exit 69; }
kind="$(file -b "$image_file")"
case "$kind" in
  *'PNG image data'*|*'JPEG image data'*|*'Web/P image'*) ;;
  *) echo "AI_RUNTIME_SMOKE=IMAGE_INVALID kind=$kind" >&2; exit 1 ;;
esac
bytes="$(wc -c < "$image_file" | tr -d ' ')"
(( bytes >= 10000 )) || { echo "AI_RUNTIME_SMOKE=IMAGE_TOO_SMALL bytes=$bytes" >&2; exit 1; }
echo "AI_RUNTIME_SMOKE_IMAGE=OK bytes=$bytes kind=$kind"
echo 'AI_RUNTIME_SMOKE=OK'
