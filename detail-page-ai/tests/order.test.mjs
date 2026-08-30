import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanOutputContract, normalizeOrder } from '../src/domain/order.mjs';

const base = {
  productName: '사과대추',
  category: 'fruit',
  description: '국내산 제철 원물, 아삭한 식감',
  planId: 'trial',
  mainVisualStyle: 'product_only',
  modelCutCount: 0,
  tone: 'white',
  copyMood: 'sales',
  informationDensity: 'standard',
  emphasisPoints: ['freshness', 'taste'],
  thumbnailStyle: 'strong_sales',
  imageTextRiskAccepted: true,
};

test('trial is exactly 1 thumbnail + 8 body at medium', () => {
  const order = normalizeOrder(base);
  assert.deepEqual(buildPlanOutputContract(order), {
    thumbnailCount: 1,
    bodyCount: 8,
    totalImageCount: 9,
    imageQuality: 'medium',
    referenceLimit: 3,
    maxImageRetries: 1,
  });
});

test('standard allows 10-12 body at high', () => {
  const order = normalizeOrder({ ...base, planId: 'standard' });
  assert.equal(buildPlanOutputContract(order, 10).bodyCount, 10);
  assert.equal(buildPlanOutputContract(order, 11).bodyCount, 11);
  const max = buildPlanOutputContract(order, 99);
  assert.equal(max.bodyCount, 12);
  assert.equal(max.thumbnailCount, 2);
  assert.equal(max.imageQuality, 'high');
});

test('blank price/spec become null and therefore omittable', () => {
  const order = normalizeOrder({ ...base, productSpec: '  ', sellingPrice: '' });
  assert.equal(order.productSpec, null);
  assert.equal(order.sellingPrice, null);
});

test('image text risk acknowledgement is mandatory', () => {
  assert.throws(() => normalizeOrder({ ...base, imageTextRiskAccepted: false }), /IMAGE_TEXT_RISK_ACK_REQUIRED/);
});
