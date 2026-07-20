import type { DryRunProductPairRule } from "./compare.js"

export const FIVE_ITEM_DRY_RUN_PRODUCT_PAIR_RULES: readonly DryRunProductPairRule[] = [
  {
    ruleId: "corn-mibaek-count-only-missing-size-review",
    decision: "review_needed",
    productFamily: "옥수수",
    conflictFields: ["size_specification"],
    left: { supplierId: "dailyfood", sourceProductId: "10002676" },
    right: { supplierId: "walldob2b", sourceProductId: "JW000039" },
  },
  separateRule(
    "apple-washed-vs-value",
    "사과",
    ["processing", "weightBasis"],
    "10000871",
    "1768298699",
  ),
  separateRule(
    "apple-washed-vs-home",
    "사과",
    ["processing", "weightBasis"],
    "10000871",
    "1768301488",
  ),
  separateRule(
    "apple-washed-vs-premium",
    "사과",
    ["processing", "weightBasis"],
    "10000871",
    "1768375171",
  ),
  separateRule(
    "apple-home-vs-value",
    "사과",
    ["qualityGrade", "usageGrade"],
    "10001086",
    "1768298699",
  ),
  separateRule("corn-special-a-vs-special", "옥수수", ["qualityGrade"], "10002651", "1783944185"),
  separateRule(
    "corn-special-a-vs-promotion",
    "옥수수",
    ["qualityGrade", "promotionFlag"],
    "10002651",
    "1784217890",
  ),
  separateRule(
    "melon-random-vs-mixed",
    "참외",
    ["qualityGrade", "usageGrade", "weightBasis"],
    "10002939",
    "1772082302",
  ),
  separateRule(
    "melon-random-vs-home",
    "참외",
    ["qualityGrade", "usageGrade", "weightBasis"],
    "10002939",
    "1772514578",
  ),
]

function separateRule(
  ruleId: string,
  productFamily: string,
  conflictFields: readonly string[],
  dailyFoodProductId: string,
  walldob2bProductId: string,
): DryRunProductPairRule {
  return {
    ruleId,
    decision: "separate_variant",
    productFamily,
    conflictFields,
    left: { supplierId: "dailyfood", sourceProductId: dailyFoodProductId },
    right: { supplierId: "walldob2b", sourceProductId: walldob2bProductId },
  }
}
