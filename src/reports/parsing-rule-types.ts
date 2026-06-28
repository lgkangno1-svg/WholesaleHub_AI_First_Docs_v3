import { z } from "zod"

export const RuleTypeSchema = z.enum([
  "product_alias",
  "product_family",
  "variety",
  "quality_grade",
  "usage",
  "size",
  "weight",
  "quantity",
  "packaging",
  "exclude_word",
  "must_separate",
  "review_needed",
])

export const RuleActionSchema = z.enum([
  "same_product",
  "separate_product_group",
  "option_attribute",
  "ignore_for_grouping",
  "block",
  "ask_user",
])

export const ParsingRuleQuestionSchema = z.object({
  term: z.string(),
  detected_context: z.string(),
  example_supplier_id: z.string(),
  example_product_name: z.string(),
  example_option_name: z.string(),
  current_parser_guess: z.string(),
  question: z.string(),
  suggested_rule_type: RuleTypeSchema,
  suggested_action: RuleActionSchema,
  user_answer: z.string(),
  user_memo: z.string(),
})

export const ParsingRuleSchema = ParsingRuleQuestionSchema.extend({
  effective_action: RuleActionSchema,
  answered: z.boolean(),
})

export type RuleType = z.infer<typeof RuleTypeSchema>
export type RuleAction = z.infer<typeof RuleActionSchema>
export type ParsingRuleQuestion = z.infer<typeof ParsingRuleQuestionSchema>
export type ParsingRule = z.infer<typeof ParsingRuleSchema>
