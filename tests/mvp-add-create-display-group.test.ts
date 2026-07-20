import { describe, expect, it } from "vitest";
import { routeApprovedDisplayGroups } from "../src/reports/mvp-add-create.js";

const group = {
  id: "mango-peach",
  displayName: "망고복숭아",
  representativeWooProductId: 18047,
  approved: true,
  includeTerms: ["망고복숭아"],
  excludeTerms: ["천반도", "딱딱이복숭아", "일반 천도복숭아"],
};

function row(name: string) {
  return {
    product_id: null,
    variation_id: null,
    woocommerce_product_name: name,
    woocommerce_option_name: "1kg / 소과",
    new_price: "10000",
    new_stock_status: "instock" as const,
    selected_supplier_id: "dailyfood",
    selected_source_product_id: "source-product",
    selected_source_option_id: "source-option",
    selected_source_image_url: "",
    available_supplier_count: 1,
    supplier_candidates_summary: "",
    action: "create_draft_product_candidate",
  };
}

describe("approved display group routing", () => {
  it("routes an approved mango peach draft candidate to the representative product", () => {
    expect(routeApprovedDisplayGroups([row("★옐로드림 망고복숭아")], [group])).toEqual([
      expect.objectContaining({
        product_id: 18047,
        woocommerce_product_name: "망고복숭아",
        action: "add_variation_candidate",
      }),
    ]);
  });

  it("does not merge excluded peach products", () => {
    expect(routeApprovedDisplayGroups([row("딱딱이복숭아")], [group])[0]).toEqual(
      row("딱딱이복숭아"),
    );
  });
});
