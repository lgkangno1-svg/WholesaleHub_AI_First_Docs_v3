import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOrder } from '../src/domain/order.mjs';
import { buildPromptContext } from '../src/orchestration/prompt-context.mjs';

const input = {
  productName: '테스트 상품',
  category: 'processed_food',
  description: '고객이 직접 제공한 설명',
  planId: 'standard',
  mainVisualStyle: 'female_model',
  modelCutCount: 4,
  tone: 'black',
  copyMood: 'trust',
  informationDensity: 'rich',
  emphasisPoints: ['taste'],
  thumbnailStyle: 'premium',
  imageTextRiskAccepted: true,
};

test('missing price/spec are explicit omit rules', () => {
  const order = normalizeOrder(input);
  const context = buildPromptContext({ order, promptPath: 'sales_conversion_v1' });
  assert.deepEqual(context.omitClaims, { price: true, productSpec: true });
  assert.equal('sellingPrice' in context.confirmedFacts, false);
  assert.equal('productSpec' in context.confirmedFacts, false);
});

test('customer visual choices remain authoritative in prompt context', () => {
  const order = normalizeOrder(input);
  const context = buildPromptContext({ order, promptPath: 'sales_conversion_v1' });
  assert.equal(context.visualOptions.tone, 'black');
  assert.equal(context.visualOptions.modelCutCount, 4);
  assert.equal(context.instructionPriority.indexOf('customer_selected_options') < context.instructionPriority.indexOf('master_prompt_defaults'), true);
});
