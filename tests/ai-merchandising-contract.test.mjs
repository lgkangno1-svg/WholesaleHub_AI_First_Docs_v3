#!/usr/bin/env node

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const plugin = await readFile('wordpress/mu-plugins/wholesalehub-ai-merchandising.php', 'utf8');
const worker = await readFile('scripts/ai-merchandising/run-queue.sh', 'utf8');
const installer = await readFile('scripts/ai-merchandising/install-runtime.sh', 'utf8');
const smoke = await readFile('scripts/ai-merchandising/runtime-smoke.sh', 'utf8');
const apply = await readFile('scripts/ai-merchandising/apply-product-merchandising.php', 'utf8');
const repair = await readFile('scripts/supplier-catalog/apply-catalog-thumbnails.php', 'utf8');
const deploy = await readFile('scripts/deploy-wholesalehub.ps1', 'utf8');
const service = await readFile('systemd/wholesalehub-ai-merchandising.service', 'utf8');
const timer = await readFile('systemd/wholesalehub-ai-merchandising.timer', 'utf8');
const telegram = await readFile('wordpress/plugins/avocadoss-performance/avocadoss-telegram-approvals.php', 'utf8');
const bulkPublish = await readFile('src/reports/draft-products-publish-cli.ts', 'utf8');

// There must be exactly one WordPress implementation source of truth: the MU module.
let duplicatePluginModule = true;
try {
  await access('wordpress/plugins/avocadoss-performance/wholesalehub-ai-merchandising.php');
} catch (error) {
  if (error?.code === 'ENOENT') duplicatePluginModule = false;
  else throw error;
}
assert.equal(duplicatePluginModule, false, 'duplicate AI merchandising module must not exist');

// Central hook means both Telegram and bulk REST publication paths are covered.
assert.match(plugin, /add_action\('transition_post_status', 'wh_ai_merchandising_on_publish'/u);
assert.match(plugin, /\['draft', 'pending'\]/u);
assert.match(telegram, /set_status\('publish'\)/u);
assert.match(bulkPublish, /status:\s*"publish"/u);

// Publishing is deliberately non-blocking. Existing supplier thumbnail/base description are fallback.
assert.match(plugin, /Never block publication/u);
assert.match(plugin, /wh_ai_merchandising_enqueue_product/u);
assert.doesNotMatch(plugin, /WP_CLI::error/u);

// Queue data must be public-safe and must not carry supplier/source IDs or costs.
assert.match(plugin, /function wh_ai_merchandising_public_facts/u);
const publicFactsStart = plugin.indexOf('function wh_ai_merchandising_public_facts');
const publicFactsEnd = plugin.indexOf('\nfunction wh_ai_merchandising_source_hash', publicFactsStart);
const publicFactsBody = publicFactsStart >= 0 && publicFactsEnd > publicFactsStart
  ? plugin.slice(publicFactsStart, publicFactsEnd)
  : '';
assert.notEqual(publicFactsBody, '', 'public fact packet function was not isolated');
for (const forbidden of ['supplier_id', 'source_product_id', 'source_option_id', 'supplier_cost', 'source_url']) {
  assert.equal(publicFactsBody.includes(`'${forbidden}'`), false, `public fact packet leaked ${forbidden}`);
}

// The worker must use ChatGPT-authenticated Codex CLI, with common API-key routes removed.
assert.match(worker, /codex_args=\(/u);
assert.match(worker, /exec\n\s+--sandbox workspace-write/u);
assert.match(worker, /"\$CODEX_BIN" "\$\{codex_args\[@\]\}"/u);
assert.match(worker, /unset OPENAI_API_KEY OPENROUTER_API_KEY/u);
assert.equal(worker.includes('api.openai.com'), false);
assert.equal(worker.includes('openrouter.ai'), false);
assert.equal(worker.includes('openai responses'), false);

// Built-in Codex image generation must be explicitly invoked and given the real product image as context.
assert.match(worker, /Use \$imagegen explicitly/u);
assert.match(worker, /codex_args\+\=\(--image "\$source_copy"\)/u);
assert.match(worker, /Product Ground Truth/u);
assert.match(smoke, /Use \$imagegen explicitly/u);
assert.match(smoke, /AI_RUNTIME_SMOKE_IMAGE=OK/u);

// Codex failure is nonfatal: do not run the apply script and quarantine partial output.
const codexFailure = worker.match(/if \[\[ \$codex_exit -ne 0[\s\S]*?continue\n  fi/u)?.[0] ?? '';
assert.match(codexFailure, /AI_MERCHANDISING_JOB_FALLBACK/u);
assert.match(codexFailure, /mv -f "\$job_file" "\$FAILED/u);
assert.equal(codexFailure.includes('apply-product-merchandising.php'), false);

// Missing generated thumbnail intentionally keeps the already-live supplier thumbnail.
assert.match(apply, /Intentional fallback: the supplier\/source thumbnail is never removed/u);
assert.match(apply, /_wh_ai_thumbnail_status', 'fallback'/u);
assert.doesNotMatch(apply, /delete_post_thumbnail/u);

// Generated thumbnail is MIME/dimension validated and read back before success marker.
assert.match(apply, /getimagesize/u);
assert.match(apply, /700, 700/u);
assert.match(apply, /get_post_thumbnail_id\(\$product_id\) !== \$attachment_id/u);
assert.match(apply, /_wh_ai_thumbnail_attachment_id/u);

// AI identity must not use supplier-image source metadata; that would let the regular supplier sync replace it.
assert.equal(apply.includes("_wholesalehub_image_source_type', 'codex_ai_generated'"), false);
assert.match(apply, /_wh_ai_thumbnail_generated/u);

// AI copy is structured, sanitized, rendered as HTML text, and stored in a managed block.
assert.match(apply, /json_decode/u);
assert.match(apply, /wh_ai_merchandising_validate_copy/u);
assert.match(apply, /wh_ai_merchandising_render_copy/u);
assert.match(plugin, /wholesalehub-ai-detail:v1:start/u);
assert.match(plugin, /wp_insert_post_data/u);
assert.match(plugin, /preserve_detail_on_update/u);

// Internal/provider words and placeholders are rejected from visible AI copy.
for (const forbidden of ['dailyfood', 'walldob2b', 'yourlove.co.kr', 'adminplus', '정보 확인 필요']) {
  assert.ok(apply.includes(forbidden), `copy guard missing ${forbidden}`);
}
assert.match(worker, /Never invent price, origin, weight\/specification/u);
assert.match(worker, /review count, sales volume, medical\/health efficacy/u);

// Explicit repair path cannot overwrite a verified AI thumbnail.
assert.match(repair, /wh_ai_merchandising_has_valid_thumbnail/u);
assert.match(repair, /preserved_ai/u);

// The deployment wrapper must ship the MU hook and an unattended scheduler.
assert.match(deploy, /wholesalehub-ai-merchandising\.php/u);
assert.match(deploy, /scripts\/ai-merchandising\/install-runtime\.sh/u);
assert.match(deploy, /scripts\/ai-merchandising\/runtime-smoke\.sh/u);
assert.match(installer, /systemctl --user enable --now/u);
assert.match(installer, /scheduler=cron/u);
assert.match(service, /Environment=HOME=\/home\/tnfwod/u);
assert.match(service, /run-queue\.sh/u);
assert.match(timer, /OnUnitActiveSec=60s/u);

console.log('AI_MERCHANDISING_CONTRACT_OK');
