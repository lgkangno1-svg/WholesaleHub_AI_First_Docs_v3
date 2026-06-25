import type { ParsedProduct, ProductParser } from "../domain/product.js"
import { RuleBasedProductParser } from "./rule-based-parser.js"

export class HybridProductParser implements ProductParser {
  readonly modelName = "mapping-rule-gemini"
  private readonly ruleParser = new RuleBasedProductParser()

  constructor(private readonly geminiParser: ProductParser | null) {}

  async parse(productName: string, optionName: string | null): Promise<ParsedProduct> {
    if (this.geminiParser !== null) {
      return this.geminiParser.parse(productName, optionName)
    }
    return this.ruleParser.parse(productName, optionName)
  }
}
