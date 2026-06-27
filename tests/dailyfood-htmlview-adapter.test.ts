import { describe, expect, it } from "vitest"
import { parseDailyFoodHtmlSheetToCsvRows } from "../src/adapters/dailyfood/dailyfood-html-table.js"

describe("parseDailyFoodHtmlSheetToCsvRows", () => {
  it("keeps option rows that rely on rowspans and forward-fill context", () => {
    // Given
    const html = `<table><tbody>
      <tr><td></td><td>품목 사진<br>*클릭 시 사진 이동*</td><td>상품명</td><td>중량</td><td>단가</td></tr>
      <tr><td></td><td rowspan="2">옥수수 이미지</td><td>미백찰옥수수</td><td>5개입</td><td>6,000</td></tr>
      <tr><td></td><td>10개입</td><td>7,800</td></tr>
    </tbody></table>`

    // When
    const rows = parseDailyFoodHtmlSheetToCsvRows(html)

    // Then
    expect(rows).toEqual([
      ["미백찰옥수수", "5개입", "6000", "", ""],
      ["미백찰옥수수", "10개입", "7800", "", ""],
    ])
  })
})
