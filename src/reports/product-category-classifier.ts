export const HUB_PRODUCT_CATEGORY_NAMES = [
  "농산물",
  "수산물",
  "축산물",
  "가공식품",
  "기타",
] as const

export type HubProductCategoryName = (typeof HUB_PRODUCT_CATEGORY_NAMES)[number]

export function classifyHubProductCategory(productName: string): HubProductCategoryName {
  const text = normalize(productName)
  if (
    /새조개|통멍게|멍게|쭈꾸미|주꾸미|오징어|문어|낙지|갈치|고등어|장어|바지락|전복|새우|꽃게|홍합|굴|조개|꼬막|미역|다시마|김\b|해물|수산|생선|명태|동태|황태|코다리|가자미|가오리|연어|참치|삼치|꽁치|아귀|대구|우럭|광어|도미|멸치|건어물|어묵|젓갈|게장/u.test(
      text,
    )
  ) {
    return "수산물"
  }
  if (
    /육우|우육|소고기|쇠고기|한우|수입육|돼지고기|삼겹살|뒷고기|목살|제육|돈육|양념육|닭고기|닭갈비|닭가슴살|오리고기|훈제오리|육류|정육|축산|곱창|갈비|등심|국거리|꽃갈비|부채|불고기|차돌|안심|채끝|치마|토시|제비추리|갈비살|스테이크|돈까스|돈가스/u.test(
      text,
    )
  ) {
    return "축산물"
  }
  if (
    /김치|깍두기|묵은지|겉절이|석박지|절임배추|콩물|구운란|삼계탕|사과즙|과자|스낵|칩|캔디|쿠키|비스킷|초콜릿|젤리|음료|두유|미숫가루|누룽지|수제비|만두|라면|국수|떡볶이|소시지|베이컨|곰탕|설렁탕|감자탕|전골|찌개|장아찌|술밥|스프|샌드|꿀|죽|즉석|밀키트|가공|참기름|들기름|마카다미아/u.test(
      text,
    )
  ) {
    return "가공식품"
  }
  if (
    /라이스|\b쌀\b|신동진|일반미|감자|고구마|옥수수|당근|마늘|깻잎|오이|양파|호박|인삼|콩|배추|쪽파|열무|갓|고사리|채소|야채|쌈채|수박|참외|메론|멜론|복숭아|자두|살구|사과|키위|망고|망고스틴|용과|자몽|블루베리|산딸기|체리|포도|거봉|샤인머스켓|매실|아보카도|토마토|석가/u.test(
      text,
    )
  ) {
    return "농산물"
  }
  return "기타"
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim()
}
