export const PLAN_CATALOG = Object.freeze({
  trial: Object.freeze({
    id: 'trial',
    priceKrw: 9900,
    thumbnailCount: 1,
    bodyCountMin: 8,
    bodyCountMax: 8,
    imageQuality: 'medium',
    referenceLimit: 3,
    maxImageRetries: 1,
  }),
  standard: Object.freeze({
    id: 'standard',
    priceKrw: 14900,
    thumbnailCount: 2,
    bodyCountMin: 10,
    bodyCountMax: 12,
    imageQuality: 'high',
    referenceLimit: 6,
    maxImageRetries: 2,
  }),
});

export const CATEGORIES = Object.freeze([
  'fruit',
  'vegetables',
  'meat',
  'seafood',
  'processed_food',
]);

export const VISUAL_OPTIONS = Object.freeze({
  mainVisualStyle: ['male_model', 'female_model', 'farm', 'product_only', 'premium_studio'],
  modelCutCount: [0, 2, 4, 6],
  tone: ['white', 'beige', 'black', 'natural_green', 'luxury_dark'],
  copyMood: ['emotional', 'professional', 'trust', 'sales', 'gift'],
  informationDensity: ['simple', 'standard', 'rich'],
  emphasisPoints: ['freshness', 'price', 'origin', 'taste', 'nutrition', 'gift', 'bulk', 'value'],
  thumbnailStyle: ['strong_sales', 'emotional', 'premium', 'information'],
});
