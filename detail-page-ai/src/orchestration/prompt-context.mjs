import { buildFactAvailability, buildPlanOutputContract } from '../domain/order.mjs';

export function buildPromptContext({ order, requestedBodyCount, selectedReferences = [], promptPath }) {
  const availability = buildFactAvailability(order);
  const output = buildPlanOutputContract(order, requestedBodyCount);

  const confirmedFacts = {
    productName: order.productName,
    category: order.category,
    description: order.description,
  };

  if (availability.hasProductSpec) confirmedFacts.productSpec = order.productSpec;
  if (availability.hasSellingPrice) confirmedFacts.sellingPrice = order.sellingPrice;

  return Object.freeze({
    instructionPriority: [
      'safety_and_factual_truth',
      'uploaded_ground_truth',
      'customer_entered_facts',
      'customer_selected_options',
      'purchased_plan_contract',
      'internal_strategy',
      'master_prompt_defaults',
      'diversity_randomization',
    ],
    promptPath,
    plan: output,
    confirmedFacts,
    omitClaims: {
      price: !availability.hasSellingPrice,
      productSpec: !availability.hasProductSpec,
    },
    visualOptions: { ...order.visualOptions },
    mustInclude: order.mustInclude,
    mustExclude: order.mustExclude,
    referenceAssets: selectedReferences.map((asset) => ({
      id: asset.id,
      inferredRole: asset.inferredRole,
      selectionScore: asset.selectionScore,
    })),
    hardRules: [
      'Do not invent missing price, specification, origin, certification, test results, shipping conditions, review metrics, sales volume, or health efficacy.',
      'If an optional hard fact is missing, omit that claim/axis from final images rather than showing placeholders.',
      'Customer-selected options override conflicting defaults in any master prompt.',
      'Uploaded real product material is the strict Product Ground Truth for product identity and visible physical characteristics.',
      'The customer purchased a sales-conversion detail page; internal prompt routing must not change that customer-facing purpose.',
    ],
  });
}
