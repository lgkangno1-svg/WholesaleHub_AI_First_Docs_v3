import { z } from "zod"

export const NORMALIZED_PRODUCT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    normalized_name: { type: "string" },
    category: { type: ["string", "null"] },
    grade: { type: ["string", "null"] },
    origin: { type: ["string", "null"] },
    quantity: { type: ["number", "null"] },
    unit: {
      type: ["string", "null"],
      enum: ["개", "입", "팩", "박스", "망", "kg", "g", null],
    },
    weight_value: { type: ["number", "null"] },
    weight_unit: {
      type: ["string", "null"],
      enum: ["kg", "g", null],
    },
    option_key: { type: "string" },
    is_frozen: { type: ["boolean", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string" },
  },
  required: [
    "normalized_name",
    "category",
    "grade",
    "origin",
    "quantity",
    "unit",
    "weight_value",
    "weight_unit",
    "option_key",
    "is_frozen",
    "confidence",
    "reason",
  ],
} as const

export const OpenRouterNormalizedProductSchema = z.object({
  normalized_name: z.string().min(1),
  category: z.string().nullable(),
  grade: z.string().nullable(),
  origin: z.string().nullable(),
  quantity: z.number().positive().nullable(),
  unit: z.enum(["개", "입", "팩", "박스", "망", "kg", "g"]).nullable(),
  weight_value: z.number().positive().nullable(),
  weight_unit: z.enum(["kg", "g"]).nullable(),
  option_key: z.string().min(1),
  is_frozen: z.boolean().nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
})

export const OpenRouterResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().min(1),
        }),
      }),
    )
    .min(1),
})
