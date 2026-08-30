import { CATEGORIES, PLAN_CATALOG, VISUAL_OPTIONS } from '../config/catalog.mjs';
import { assertDisclosureAccepted } from '../policy/disclosure.mjs';

function requiredText(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`REQUIRED_${field.toUpperCase()}`);
  return normalized;
}

function optionalText(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function assertIn(value, allowed, field) {
  if (!allowed.includes(value)) throw new Error(`INVALID_${field.toUpperCase()}`);
  return value;
}

function normalizeEmphasisPoints(value) {
  const values = Array.isArray(value) ? value : [];
  const unique = [...new Set(values)];
  for (const item of unique) assertIn(item, VISUAL_OPTIONS.emphasisPoints, 'emphasisPoint');
  return unique;
}

export function normalizeOrder(input) {
  const plan = PLAN_CATALOG[input?.planId];
  if (!plan) throw new Error('INVALID_PLAN');

  const category = assertIn(input?.category, CATEGORIES, 'category');
  const disclosureVersion = assertDisclosureAccepted(input);

  const visualOptions = {
    mainVisualStyle: assertIn(input?.mainVisualStyle, VISUAL_OPTIONS.mainVisualStyle, 'mainVisualStyle'),
    modelCutCount: assertIn(Number(input?.modelCutCount), VISUAL_OPTIONS.modelCutCount, 'modelCutCount'),
    tone: assertIn(input?.tone, VISUAL_OPTIONS.tone, 'tone'),
    copyMood: assertIn(input?.copyMood, VISUAL_OPTIONS.copyMood, 'copyMood'),
    informationDensity: assertIn(input?.informationDensity, VISUAL_OPTIONS.informationDensity, 'informationDensity'),
    emphasisPoints: normalizeEmphasisPoints(input?.emphasisPoints),
    thumbnailStyle: assertIn(input?.thumbnailStyle, VISUAL_OPTIONS.thumbnailStyle, 'thumbnailStyle'),
  };

  return Object.freeze({
    productName: requiredText(input?.productName, 'productName'),
    category,
    description: requiredText(input?.description, 'description'),
    planId: plan.id,
    planSnapshot: { ...plan },
    productSpec: optionalText(input?.productSpec),
    sellingPrice: optionalText(input?.sellingPrice),
    mustInclude: optionalText(input?.mustInclude),
    mustExclude: optionalText(input?.mustExclude),
    visualOptions,
    disclosureVersion,
  });
}

export function buildFactAvailability(order) {
  return Object.freeze({
    hasProductSpec: Boolean(order.productSpec),
    hasSellingPrice: Boolean(order.sellingPrice),
  });
}

export function buildPlanOutputContract(order, requestedBodyCount) {
  const plan = order.planSnapshot;
  const requested = requestedBodyCount == null ? plan.bodyCountMax : Number(requestedBodyCount);
  const bodyCount = Math.max(plan.bodyCountMin, Math.min(plan.bodyCountMax, requested));

  return Object.freeze({
    thumbnailCount: plan.thumbnailCount,
    bodyCount,
    totalImageCount: plan.thumbnailCount + bodyCount,
    imageQuality: plan.imageQuality,
    referenceLimit: plan.referenceLimit,
    maxImageRetries: plan.maxImageRetries,
  });
}
