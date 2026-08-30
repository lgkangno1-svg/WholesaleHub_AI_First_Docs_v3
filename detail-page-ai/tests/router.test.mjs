import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePromptPath, PROMPT_PATHS } from '../src/orchestration/prompt-router.mjs';

test('simple product request uses direct sales conversion path', () => {
  assert.equal(choosePromptPath({ evidenceScore: 0.2, differentiationScore: 0.2 }), PROMPT_PATHS.direct);
});

test('proof-rich product request uses TED enrichment internally', () => {
  assert.equal(choosePromptPath({ hasProofDocument: true }), PROMPT_PATHS.ted);
});
