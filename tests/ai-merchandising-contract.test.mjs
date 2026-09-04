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

// Normal publication is caught by the status hook. Telegram uses an intentional
// compare-and-swap SQL publish, so its post-success processed marker is the queue trigger.
assert.ok(plugin.includes("add_action('transition_post_status', 'wh_ai_merchandising_on_publish'"));
assert.ok(plugin.includes("['draft', 'pending']"));
assert.ok(plugin.includes("_avocadoss_pa_processed"));
assert.ok(plugin.includes("(string) $meta_value !== 'published'"));
assert.ok(plugin.includes("add_action('added_post_meta', 'wh_ai_merchandising_on_telegram_approval_meta'"));
assert.ok(plugin.includes("add_action('updated_post_meta', 'wh_ai_merchandising_on_telegram_approval_meta'"));
assert.ok(telegram.includes("$wpdb->update("));
assert.ok(telegram.includes("array( 'post_status' => 'publish' )"));
assert.ok(telegram.includes("'_avocadoss_pa_processed', 'publish' === $action ? 'published' : 'held'"));
assert.match(bulkPublish, /status:\s*"publish"/u);

const publishStart = telegram.indexOf('function avocadoss_publish_approved_product');
const publishEnd = telegram.indexOf('\nfunction avocadoss_product_source_image_url', publishStart);
const telegramPublish = publishStart >= 0 && publishEnd > publishStart
  ? telegram.slice(publishStart, publishEnd)
  : '';
assert.notEqual(telegramPublish, '', 'Telegram publish helper was not isolated');
assert.ok(telegramPublish.includes("'post_status' => 'publish'"));
assert.equal(telegramPublish.includes('avocadoss_generate_ai_thumbnail'), false, 'Telegram publish must not use legacy OpenRouter AI image path');

// Publishing is deliberately non-blocking. Existing supplier thumbnail/base description are fallback.
assert.ok(plugin.includes('Never block publication'));
assert.ok(plugin.includes('wh_ai_merchandising_enqueue_product'));
assert.equal(plugin.includes('WP_CLI::error'), false);

// Queue data must be public-safe and must not carry supplier/source IDs or costs.
assert.ok(plugin.includes('function wh_ai_merchandising_public_facts'));
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
assert.ok(worker.includes('codex_args=('));
assert.ok(worker.includes('--sandbox workspace-write'));
assert.ok(worker.includes('"$CODEX_BIN" "${codex_args[@]}"'));
assert.ok(worker.includes('unset OPENAI_API_KEY OPENROUTER_API_KEY'));
assert.equal(worker.includes('api.openai.com'), false);
assert.equal(worker.includes('openrouter.ai'), false);
assert.equal(worker.includes('openai responses'), false);

// Built-in Codex image generation must be explicitly invoked and given the real product image as context.
assert.ok(worker.includes('Use $imagegen explicitly'));
assert.ok(worker.includes('codex_args+=(--image "$source_copy")'));
assert.ok(worker.includes('Product Ground Truth'));
assert.ok(smoke.includes('Use $imagegen explicitly'));
assert.ok(smoke.includes('AI_RUNTIME_SMOKE_IMAGE=OK'));

// Codex failure is nonfatal: do not run the apply script and quarantine partial output.
const failureStart = worker.indexOf('if [[ $codex_exit -ne 0');
const failureEnd = worker.indexOf('\n  docker cp "$job_dir/job.json"', failureStart);
const codexFailure = failureStart >= 0 && failureEnd > failureStart
  ? worker.slice(failureStart, failureEnd)
  : '';
assert.notEqual(codexFailure, '', 'Codex fallback block was not isolated');
assert.ok(codexFailure.includes('AI_MERCHANDISING_JOB_FALLBACK'));
assert.ok(codexFailure.includes('mv -f "$job_file" "$FAILED'));
assert.equal(codexFailure.includes('apply-product-merchandising.php'), false);

// Missing generated thumbnail intentionally keeps the already-live supplier thumbnail.
assert.ok(apply.includes('Intentional fallback: the supplier/source thumbnail is never removed'));
assert.ok(apply.includes("_wh_ai_thumbnail_status', 'fallback'"));
assert.equal(apply.includes('delete_post_thumbnail'), false);

// Generated thumbnail is MIME/dimension validated and read back before success marker.
assert.ok(apply.includes('getimagesize'));
assert.ok(apply.includes("'AI 대표이미지', 700, 700"));
assert.ok(apply.includes('get_post_thumbnail_id($product_id) !== $attachment_id'));
assert.ok(apply.includes('_wh_ai_thumbnail_attachment_id'));

// AI identity must not use supplier-image source metadata; that would let the regular supplier sync replace it.
assert.equal(apply.includes("_wholesalehub_image_source_type', 'codex_ai_generated'"), false);
assert.ok(apply.includes('_wh_ai_thumbnail_generated'));

// AI copy is structured, sanitized, rendered as HTML text, and stored in a managed block.
assert.ok(apply.includes('json_decode'));
assert.ok(apply.includes('wh_ai_merchandising_validate_copy'));
assert.ok(apply.includes('wh_ai_merchandising_render_copy'));
assert.ok(plugin.includes('wholesalehub-ai-detail:v1:start'));
assert.ok(plugin.includes('wp_insert_post_data'));
assert.ok(plugin.includes('preserve_detail_on_update'));

// Internal/provider words and placeholders are rejected from visible AI copy.
for (const forbidden of ['dailyfood', 'walldob2b', 'yourlove.co.kr', 'adminplus', '정보 확인 필요']) {
  assert.ok(apply.includes(forbidden), `copy guard missing ${forbidden}`);
}
assert.ok(worker.includes('Never invent price, origin, weight/specification'));
assert.ok(worker.includes('review count, sales volume, medical/health efficacy'));

// Explicit repair path cannot overwrite a verified AI thumbnail.
assert.ok(repair.includes('wh_ai_merchandising_has_valid_thumbnail'));
assert.ok(repair.includes('preserved_ai'));

// The deployment wrapper must ship the MU hook and an unattended scheduler.
assert.ok(deploy.includes('wholesalehub-ai-merchandising.php'));
assert.ok(deploy.includes('scripts/ai-merchandising/install-runtime.sh'));
assert.ok(deploy.includes('scripts/ai-merchandising/runtime-smoke.sh'));
assert.ok(installer.includes('systemctl --user enable --now'));
assert.ok(installer.includes('scheduler=cron'));
assert.ok(service.includes('Environment=HOME=/home/tnfwod'));
assert.ok(service.includes('run-queue.sh'));
assert.ok(timer.includes('OnUnitActiveSec=60s'));

console.log('AI_MERCHANDISING_CONTRACT_OK');
