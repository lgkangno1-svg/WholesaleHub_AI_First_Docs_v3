#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT="${WHOLESALEHUB_ROOT:-/home/tnfwod/projects/wholesalehub}"
WP_ROOT="${WHOLESALEHUB_WP_ROOT:-/home/tnfwod/avocadoss-wordpress/wp_data}"
WP_CONTAINER="${WHOLESALEHUB_WP_CONTAINER:-avocadoss-wp}"
ROOT="$WP_ROOT/wp-content/uploads/wholesalehub/ai-merchandising"
QUEUE="$ROOT/queue"
WORK="$ROOT/work"
DONE="$ROOT/done"
FAILED="$ROOT/failed"
LOCK="$ROOT/worker.lock"
CODEX_BIN="${WHOLESALEHUB_CODEX_BIN:-$(command -v codex 2>/dev/null || true)}"
TIMEOUT_SECONDS="${WHOLESALEHUB_CODEX_TIMEOUT_SECONDS:-720}"
MAX_JOBS="${WHOLESALEHUB_AI_MAX_JOBS_PER_RUN:-3}"

if [[ -z "$CODEX_BIN" ]]; then
  for candidate in \
    "$HOME/.local/bin/codex" \
    "$HOME/.npm-global/bin/codex" \
    /usr/local/bin/codex \
    /usr/bin/codex; do
    if [[ -x "$candidate" ]]; then
      CODEX_BIN="$candidate"
      break
    fi
  done
fi

mkdir -p "$QUEUE" "$WORK" "$DONE" "$FAILED"
exec 9>"$LOCK"
flock -n 9 || { echo 'AI_MERCHANDISING_WORKER=SKIPPED_LOCKED'; exit 0; }

if [[ -z "$CODEX_BIN" || ! -x "$CODEX_BIN" ]]; then
  echo 'AI_MERCHANDISING_WORKER=CODEX_UNAVAILABLE_FALLBACK_ONLY'
  exit 0
fi
if [[ ! -f "$PROJECT/scripts/ai-merchandising/apply-product-merchandising.php" ]]; then
  echo 'AI_MERCHANDISING_WORKER=APPLY_SCRIPT_MISSING' >&2
  exit 66
fi

# The user explicitly chose ChatGPT/Codex plan usage, not API billing. Remove
# common provider keys from the Codex child environment so this worker cannot
# silently switch to OpenAI/OpenRouter/other API-key billing.
unset OPENAI_API_KEY OPENROUTER_API_KEY ANTHROPIC_API_KEY GEMINI_API_KEY GOOGLE_API_KEY AZURE_OPENAI_API_KEY

processed=0
shopt -s nullglob
for job_file in "$QUEUE"/*.json; do
  (( processed < MAX_JOBS )) || break
  job_name="$(basename "$job_file" .json)"
  [[ "$job_name" =~ ^[0-9]+-[a-f0-9]{16}$ ]] || {
    mv -f "$job_file" "$FAILED/$(basename "$job_file")"
    continue
  }
  job_dir="$WORK/$job_name"
  output_dir="$job_dir/output"
  result_path="$job_dir/apply-result.json"
  codex_log="$job_dir/codex.log"
  rm -rf "$job_dir"
  mkdir -p "$output_dir"
  cp -f "$job_file" "$job_dir/job.json"

  product_id="$(node -e 'const j=require(process.argv[1]); const v=Number(j.product_id); if(!Number.isInteger(v)||v<=0)process.exit(2); process.stdout.write(String(v));' "$job_dir/job.json" 2>/dev/null || true)"
  if [[ -z "$product_id" ]]; then
    mv -f "$job_file" "$FAILED/$(basename "$job_file")"
    continue
  fi

  source_rel="$(node -e 'const j=require(process.argv[1]); process.stdout.write(typeof j.source_thumbnail_upload_relative==="string"?j.source_thumbnail_upload_relative:"");' "$job_dir/job.json")"
  source_copy=""
  if [[ -n "$source_rel" && "$source_rel" != /* && "$source_rel" != *".."* ]]; then
    candidate="$WP_ROOT/wp-content/uploads/$source_rel"
    if [[ -f "$candidate" ]]; then
      ext="${candidate##*.}"
      source_copy="$job_dir/source-product.${ext,,}"
      cp -f "$candidate" "$source_copy"
    fi
  fi

  prompt_file="$job_dir/PROMPT.md"
  node - "$job_dir/job.json" "$prompt_file" "$(basename "$source_copy")" <<'NODE'
const fs = require('node:fs');
const [jobPath, promptPath, sourceName] = process.argv.slice(2);
const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
const safe = {
  product_name: String(job.product_name || '').slice(0, 300),
  public_description: String(job.public_description || '').slice(0, 3500),
  categories: Array.isArray(job.categories) ? job.categories.slice(0, 8).map(v => String(v).slice(0, 100)) : [],
};
const prompt = `You are the autonomous merchandising worker for a Korean B2B food ecommerce product.

IMPORTANT EXECUTION BOUNDARIES
- Work only inside the current job directory.
- Do not use curl, wget, web browsing, external APIs, API keys, MCP network tools, or provider SDKs.
- Do not modify the repository, WordPress, databases, system services, or files outside this job directory.
- Never invent price, origin, weight/specification, certification, test results, shipping condition, review count, sales volume, medical/health efficacy, or any other hard fact not present below.
- Never mention supplier names, source IDs, supplier URLs, internal costs, or internal operations.
- Korean copy must be natural, concise, sales-conversion oriented, and not repetitive.

PUBLIC PRODUCT FACTS
${JSON.stringify(safe, null, 2)}

OUTPUT 1 — REQUIRED
Create output/copy.json as valid UTF-8 JSON with exactly this shape:
{
  "title": "short Korean hero headline",
  "intro": "1-2 sentence Korean introduction",
  "sections": [
    {"heading":"...", "body":"...", "bullets":["...", "..."]}
  ],
  "cta": "short Korean closing line"
}
Requirements:
- 4 to 6 sections.
- Each section must have a distinct purpose; no repeated claims.
- Use only the supplied public facts plus safe category-level usage ideas clearly phrased as suggestions, never unsupported product-specific facts.
- No placeholders such as 확인 필요/TODO.
- No HTML or Markdown inside JSON values.

OUTPUT 2 — REQUIRED WHEN BUILT-IN IMAGE GENERATION IS AVAILABLE
Use $imagegen explicitly. Built-in Codex image generation only; never use an image API or API key.
${sourceName ? `The attached real source product photo (${sourceName}) is Product Ground Truth. Preserve the real product identity, color, shape, packaging and visible texture while creating a new composition.` : 'No real source product photo is attached. Do not invent a brand, label or packaging identity; create only a generic category-safe visual.'}
Create a NEW premium ecommerce featured image at output/thumbnail.png (or .jpg/.webp), square and at least 1024px. It must be clearly different from the source composition while preserving the real product when a reference exists. Use clean commercial food photography, strong product focus, no Korean text, no logos you cannot verify, no price badges, no certifications, no watermark.
You may additionally create up to 3 text-free supporting visuals named output/detail-01.png, output/detail-02.png, output/detail-03.png when useful.
If $imagegen is unavailable in this Codex environment, do not fake an image file and do not call any API. Complete copy.json only; the system will safely keep the supplier thumbnail.

Before finishing, parse output/copy.json yourself and confirm it is valid JSON.`;
fs.writeFileSync(promptPath, prompt, 'utf8');
NODE

  echo "AI_MERCHANDISING_JOB_START product_id=$product_id job=$job_name"
  codex_args=(
    exec
    --sandbox workspace-write
    --skip-git-repo-check
    -C "$job_dir"
  )
  if [[ -n "$source_copy" ]]; then
    # Official Codex image guidance: attach the real source visual with -i/--image
    # so imagegen can use it as visual context rather than inferring from a path.
    codex_args+=(--image "$source_copy")
  fi

  set +e
  (
    cd "$job_dir"
    timeout --signal=TERM --kill-after=10s "${TIMEOUT_SECONDS}s" \
      "$CODEX_BIN" "${codex_args[@]}" "$(cat "$prompt_file")"
  ) >"$codex_log" 2>&1
  codex_exit=$?
  set -e

  if [[ $codex_exit -ne 0 || ! -s "$output_dir/copy.json" ]]; then
    # Nonfatal by business policy: publication already happened with supplier
    # image/base description. Keep failed evidence, quarantine the job and never
    # apply partial output.
    printf '%s\n' "codex_exit=$codex_exit" > "$job_dir/failure.txt"
    mv -f "$job_file" "$FAILED/$(basename "$job_file")"
    echo "AI_MERCHANDISING_JOB_FALLBACK product_id=$product_id codex_exit=$codex_exit"
    ((processed+=1))
    continue
  fi

  docker cp "$job_dir/job.json" "$WP_CONTAINER:/tmp/wh-ai-job-$job_name.json" >/dev/null
  docker cp "$output_dir" "$WP_CONTAINER:/tmp/wh-ai-output-$job_name" >/dev/null
  docker cp "$PROJECT/scripts/ai-merchandising/apply-product-merchandising.php" "$WP_CONTAINER:/tmp/wh-ai-apply-$job_name.php" >/dev/null

  set +e
  docker exec \
    -e WHOLESALEHUB_AI_JOB="/tmp/wh-ai-job-$job_name.json" \
    -e WHOLESALEHUB_AI_OUTPUT_DIR="/tmp/wh-ai-output-$job_name" \
    -e WHOLESALEHUB_AI_RESULT="/tmp/wh-ai-result-$job_name.json" \
    "$WP_CONTAINER" wp --allow-root --path=/var/www/html eval-file "/tmp/wh-ai-apply-$job_name.php" > "$job_dir/apply.log" 2>&1
  apply_exit=$?
  if [[ $apply_exit -eq 0 ]]; then
    docker cp "$WP_CONTAINER:/tmp/wh-ai-result-$job_name.json" "$result_path" >/dev/null 2>&1 || true
  fi
  docker exec "$WP_CONTAINER" sh -c "rm -rf '/tmp/wh-ai-job-$job_name.json' '/tmp/wh-ai-output-$job_name' '/tmp/wh-ai-apply-$job_name.php' '/tmp/wh-ai-result-$job_name.json'" >/dev/null 2>&1 || true
  set -e

  if [[ $apply_exit -eq 0 && -s "$result_path" ]]; then
    mv -f "$job_file" "$DONE/$(basename "$job_file")"
    echo "AI_MERCHANDISING_JOB_DONE product_id=$product_id result=$(tr -d '\n' < "$result_path")"
  else
    # Apply failed before verified mutation. Product remains on its supplier/base fallback.
    mv -f "$job_file" "$FAILED/$(basename "$job_file")"
    echo "AI_MERCHANDISING_JOB_APPLY_FAILED product_id=$product_id exit=$apply_exit"
  fi
  ((processed+=1))
done

echo "AI_MERCHANDISING_WORKER=DONE processed=$processed"
