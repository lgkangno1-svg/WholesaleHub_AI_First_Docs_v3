import type { ParsedProduct, ProductParser } from "../domain/product.js"
import { cleanProductText, removeMarketingText } from "./product-name-cleaner.js"
import { RuleBasedProductParser } from "./rule-based-parser.js"

export class HybridProductParser implements ProductParser {
  readonly modelName = "mapping-rule-gemini"
  private readonly ruleParser = new RuleBasedProductParser()

  constructor(private readonly geminiParser: ProductParser | null) {}

  async parse(productName: string, optionName: string | null): Promise<ParsedProduct> {
    const cleaned = cleanProductText(productName, optionName)
    if (this.geminiParser !== null) {
      const parsed = await this.geminiParser.parse(cleaned.productName, cleaned.optionName)
      return {
        ...parsed,
        normalizedName: removeMarketingText(parsed.normalizedName).value,
        parserReason: `${parsed.parserReason}; pre-cleaned: ${cleaned.removedTerms.join(", ")}`,
      }
    }
    return this.ruleParser.parse(productName, optionName)
  }
}
