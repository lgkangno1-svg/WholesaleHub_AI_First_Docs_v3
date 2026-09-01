#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const plugin = await readFile('wordpress/mu-plugins/wholesalehub-ai-merchandising.php', 'utf8');
const worker = await readFile('scripts/ai-merchandising/run-queue.sh', 'utf8');
const apply = await readFile('scripts/ai-merchandising/apply-product-merchandising.php', 'utf8');
const repair = await readFile('scripts/supplier-catalog/apply-catalog-thumbnails.php', 'utf8');
const telegram = await readFile('wordpress/plugins/avocadoss-performance/avocadoss-telegram-approvals.php', 'utf8');
const bulkPublish = await readFile('src/reports/draft-products-publish-cli.ts', 'utf8');

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
for (const forbidden of ['supplier_id', 'source_product_id', 'source_option_id', 'supplier_cost', 'source_url']) {
  const publicFactsBody = plugin.match(/function wh_ai_merchandising_public_facts[\s\S]*?\n}\n/u)?.[0] ?? '';
  assert.equal(publicFactsBody.includes(`'${forbidden}'`), false, `public fact packet leaked ${forbidden}`);
}

// The worker must use ChatGPT-authenticated Codex CLI, with common API-key routes removed.
assert.match(worker, /"\$CODEX_BIN" exec/u);
assert.match(worker, /--sandbox workspace-write/u);
assert.match(worker, /unset OPENAI_API_KEY OPENROUTER_API_KEY/u);
assert.equal(worker.includes('api.openai.com'), false);
assert.equal(worker.includes('openrouter.ai'), false);
assert.equal(worker.includes('openai responses'), false);

// Codex failure is nonfatal: do not run the apply script and move queue evidence to failed.
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

// Explicit repair path cannot overwrite a verified AI thumbnail.
assert.match(repair, /wh_ai_merchandising_has_valid_thumbnail/u);
assert.match(repair, /preserved_ai/u);

console.log('AI_MERCHANDISING_CONTRACT_OK');
