export const HUB_PRODUCT_CATEGORY_NAMES = [
  "과일",
  "채소/농산물",
  "김치/반찬",
  "쌀/잡곡",
  "정육",
  "계란/가공식품",
  "수산물",
  "기타",
] as const

export type HubProductCategoryName = (typeof HUB_PRODUCT_CATEGORY_NAMES)[number]

export function classifyHubProductCategory(productName: string): HubProductCategoryName {
  const text = normalize(productName)
  if (
    /새조개|통멍게|멍게|쭈꾸미|주꾸미|오징어|문어|낙지|갈치|고등어|장어|바지락|전복|새우|꽃게|홍합|굴|조개|꼬막|미역|다시마|김\b|해물|수산|생선|명태|동태|황태|코다리|가자미|연어|참치|삼치|꽁치|아귀|대구|우럭|광어|도미|멸치|건어물|어묵|젓갈/u.test(
      text,
    )
  ) {
    return "수산물"
  }
  if (
    /육우|갈비|등심|국거리|꽃갈비|부채|불고기|차돌|안심|채끝|치마|토시|제비추리|갈비살|스테이크/u.test(
      text,
    )
  ) {
    return "정육"
  }
  if (/김치|깍두기|묵은지|겉절이|석박지|절임배추|콩물/u.test(text)) {
    return "김치/반찬"
  }
  if (/라이스|\b쌀\b|신동진|일반미/u.test(text)) {
    return "쌀/잡곡"
  }
  if (/구운란|삼계탕|사과즙/u.test(text)) {
    return "계란/가공식품"
  }
  if (/감자|고구마|옥수수|당근|마늘|깻잎|오이|양파|호박|인삼|콩|배추|쪽파|열무|갓/u.test(text)) {
    return "채소/농산물"
  }
  if (
    /수박|참외|메론|멜론|복숭아|자두|살구|사과|키위|망고|망고스틴|용과|자몽|블루베리|산딸기|체리|포도|매실|아보카도/u.test(
      text,
    )
  ) {
    return "과일"
  }
  return "기타"
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim()
}
