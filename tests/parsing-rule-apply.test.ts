import { describe, expect, it } from "vitest"
import { applyParsingRulesToPlans } from "../src/reports/parsing-rule-apply.js"
import { autoAnswer } from "../src/reports/parsing-rule-auto-answer-cli.js"
import { toRules } from "../src/reports/parsing-rule-files.js"
import type { ParsingRuleQuestion } from "../src/reports/parsing-rule-types.js"
import type {
  ProductGroupPlanRow,
  ProductOptionPlanRow,
} from "../src/reports/product-group-plan.js"

describe("parsing rule application", () => {
  it("marks unanswered matched rules for review and applies answered group separation", () => {
    // Given
    const groups: ProductGroupPlanRow[] = [group("g1", "성주참외")]
    const options: ProductOptionPlanRow[] = [option("g1", "성주참외", "성주참외 5kg")]
    const rules = toRules([
      question("가정용", "separate_product_group"),
      { ...question("성주참외", "same_product"), user_answer: "" },
    ])

    // When
    const applied = applyParsingRulesToPlans(groups, options, rules)

    // Then
    expect(applied.summary).toMatchObject({
      answeredRuleCount: 1,
      unansweredMatchedRuleCount: 1,
      changedOptionCount: 1,
      reviewNeededOptionCount: 1,
    })
    expect(applied.report.productOptions[0]).toEqual(
      expect.objectContaining({
        display_product_name: "성주참외 가정용",
        recommended_action: "review_needed",
      }),
    )
  })

  it("fills confirmed business rule answers and leaves ambiguous terms blank", () => {
    // Given
    const confirmed = question("가정용", "")
    const ambiguous = question("하우스수박", "")

    // When
    const answered = autoAnswer(confirmed)
    const needsUser = autoAnswer(ambiguous)

    // Then
    expect(answered).toEqual(
      expect.objectContaining({
        user_answer: "separate_product_group",
        user_memo: expect.stringContaining("product_group"),
      }),
    )
    expect(needsUser.user_answer).toBe("")
  })
})

function group(productGroupKey: string, displayProductName: string): ProductGroupPlanRow {
  return {
    product_group_key: productGroupKey,
    display_product_name: displayProductName,
    category: "농산물",
    family: "참외",
    included_supplier_count: 1,
    option_count: 1,
    recommended_action: "create_new_variable_product",
    matched_woocommerce_product_id: null,
    reason: "test",
  }
}

function option(
  productGroupKey: string,
  displayProductName: string,
  optionDisplayName: string,
): ProductOptionPlanRow {
  return {
    product_group_key: productGroupKey,
    display_product_name: displayProductName,
    option_display_name: optionDisplayName,
    normalized_option_key: "원산지미상|등급미상|5kg",
    selected_supplier_id: "dailyfood",
    selected_supplier_original_product_name: "가정용 성주참외",
    selected_supplier_original_option_name: "성주참외 5kg",
    selected_price: 10000,
    alternative_suppliers_summary: "dailyfood:10000",
    compared_exact_same_option: false,
    recommended_action: "create_variation_candidate",
  }
}

function question(term: string, answer: string): ParsingRuleQuestion {
  return {
    term,
    detected_context: "1회 / test",
    example_supplier_id: "dailyfood",
    example_product_name: term,
    example_option_name: "",
    current_parser_guess: "test",
    question: "test?",
    suggested_rule_type: "usage",
    suggested_action: "ask_user",
    user_answer: answer,
    user_memo: "",
  }
}
