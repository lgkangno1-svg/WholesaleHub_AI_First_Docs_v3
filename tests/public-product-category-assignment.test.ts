import { describe, expect, it } from "vitest"
import { classifyHubProductCategory } from "../src/reports/product-category-classifier.js"
import {
  groupbuyFoodCategory,
  mergeCategoryIds,
  sourceFoodCategory,
} from "../src/reports/public-product-category-assignment.js"

describe("public product category assignment", () => {
  it("classifies observed food names into the intended food category", () => {
    expect(classifyHubProductCategory("한상궁 소곱창전골 1kg")).toBe("축산물")
    expect(classifyHubProductCategory("박포갈비 500g")).toBe("축산물")
    expect(classifyHubProductCategory("국내산 뒷고기 600g")).toBe("축산물")
    expect(classifyHubProductCategory("베트남 국민과자 12봉")).toBe("가공식품")
    expect(classifyHubProductCategory("갈치쌈 젓갈")).toBe("수산물")
    expect(classifyHubProductCategory("순살 간장게장 400g")).toBe("수산물")
    expect(classifyHubProductCategory("고사리감자탕 1kg")).toBe("가공식품")
    expect(classifyHubProductCategory("초당콘스프맛 스낵")).toBe("가공식품")
    expect(classifyHubProductCategory("부사 사과 가정용")).toBe("농산물")
    expect(classifyHubProductCategory("쌀(신동진/일반미)")).toBe("농산물")
  })

  it("adds a food category only to recognised Fafane 공동구매 food products", () => {
    const groupbuy = [{ id: 36, name: "공동구매" }]
    expect(groupbuyFoodCategory("베트남 국민과자", groupbuy, "fafane")).toBe("가공식품")
    expect(groupbuyFoodCategory("스텐 텀블러", groupbuy, "fafane")).toBeNull()
    expect(groupbuyFoodCategory("베트남 국민과자", groupbuy, "dailyfood")).toBeNull()
    expect(groupbuyFoodCategory("베트남 국민과자", groupbuy, "walldob2b")).toBeNull()
    expect(groupbuyFoodCategory("베트남 국민과자", [{ id: 1, name: "기타" }], "fafane")).toBeNull()
  })

  it("classifies DailyFood and Walldo products into public hub categories only", () => {
    expect(sourceFoodCategory("딱딱이 복숭아", "walldob2b")).toBe("농산물")
    expect(sourceFoodCategory("여수 돌산 갓김치", "dailyfood")).toBe("가공식품")
    expect(sourceFoodCategory("한상궁 소곱창전골 1kg", "fafane")).toBeNull()
  })

  it("preserves 공동구매 and every existing category when adding one category", () => {
    expect(
      mergeCategoryIds(
        [
          { id: 36, name: "공동구매" },
          { id: 7, name: "추천" },
        ],
        24,
      ),
    ).toEqual([36, 7, 24])
  })
})
