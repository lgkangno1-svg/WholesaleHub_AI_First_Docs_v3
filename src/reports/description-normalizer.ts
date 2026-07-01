/**
 * description-normalizer.ts
 *
 * DailyFood의 md 코멘트(memo) 필드를 정규화하여 WooCommerce 상품 설명에 반영한다.
 *
 * 정규화 규칙 (02-rules.md 연동):
 * - 발주마감 시간: 기재된 시간에서 1시간을 앞당겨 표기한다.
 *   예) "발주마감 오전 9시 30분" -> "발주마감 : 오전 8시 30분"
 * - 택배사: 택배사 이름을 정규화된 형식으로 표기한다.
 *   예) "CJ대한통운" -> "택배사 : CJ 대한통운"
 * - 나머지 설명: 정규화 헤더 이후에 원문 그대로 붙인다.
 */

type NormalizedMemo = {
  readonly orderDeadline: string | null
  readonly courier: string | null
  readonly rest: string
}

/**
 * 시간 문자열에서 1시간을 앞당긴다.
 * "9시 30분" -> "8시 30분", "오전 10시" -> "오전 9시"
 */
export function subtractOneHour(timeText: string): string {
  // 오전/오후 처리
  const ampmMatch = /(오전|오후)\s*(\d{1,2})시(?:\s*(\d{1,2})분)?/u.exec(timeText)
  if (ampmMatch) {
    const ampm = ampmMatch[1] ?? ""
    const hour = Number.parseInt(ampmMatch[2] ?? "0", 10)
    const minute = ampmMatch[3] !== undefined ? Number.parseInt(ampmMatch[3], 10) : null

    let newHour = hour - 1
    // 엣지케이스: 오전 1시 이하면 그냥 1시 유지
    if (newHour < 1) {
      newHour = 1
    }

    const minuteStr = minute !== null ? ` ${minute}분` : ""
    return `${ampm} ${newHour}시${minuteStr}`
  }

  // 숫자만 있는 경우: "9:30", "09시30분" 등
  const rawMatch = /(\d{1,2})(?:[시:])\s*(\d{1,2})분?/u.exec(timeText)
  if (rawMatch) {
    const hour = Number.parseInt(rawMatch[1] ?? "0", 10)
    const minute = Number.parseInt(rawMatch[2] ?? "0", 10)
    const newHour = hour > 1 ? hour - 1 : 1
    return `${newHour}시 ${minute}분`
  }

  // 파싱 실패 시 원문 유지
  return timeText
}

/**
 * 택배사 명칭을 정규화한다.
 */
export function normalizeCourierName(raw: string): string {
  const lower = raw.replace(/\s+/gu, "").toLocaleLowerCase("ko-KR")
  if (lower.includes("cj") && lower.includes("대한통운")) return "CJ 대한통운"
  if (lower.includes("로젠")) return "로젠택배"
  if (lower.includes("우체국")) return "우체국택배"
  if (lower.includes("한진")) return "한진택배"
  if (lower.includes("롯데") || lower.includes("현대")) return "롯데택배"
  if (lower.includes("gs")) return "GS 편의점택배"
  if (lower.includes("대신")) return "대신택배"
  if (lower.includes("경동")) return "경동택배"
  if (lower.includes("합동")) return "합동택배"
  return raw.trim()
}

/**
 * DailyFood memo 텍스트를 파싱하여 발주마감/택배사/나머지 설명으로 분리한다.
 */
export function parseDailyFoodMemo(memo: string): NormalizedMemo {
  const lines = memo
    .split(/[\n\r]+/u)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  let orderDeadline: string | null = null
  let courier: string | null = null
  const restLines: string[] = []

  for (const line of lines) {
    // 발주마감 패턴 감지
    if (orderDeadline === null && /발주\s*마감/u.test(line)) {
      const timeMatch =
        /(오전|오후)\s*\d{1,2}시(?:\s*\d{1,2}분)?|\d{1,2}시(?:\s*\d{1,2}분)?|\d{1,2}:\d{2}/u.exec(
          line,
        )
      if (timeMatch?.[0]) {
        const original = timeMatch[0]
        const adjusted = subtractOneHour(original)
        orderDeadline = `발주마감 : ${adjusted}`
      } else {
        orderDeadline = `발주마감 : ${line.replace(/발주\s*마감\s*[:：]?\s*/u, "").trim()}`
      }
      continue
    }

    // 택배사 패턴 감지
    if (courier === null) {
      const courierLineMatch =
        /택배\s*사\s*[:：]?\s*(.+)|(CJ\s*대한통운|로젠택배|우체국택배|한진택배|롯데택배|대신택배|경동택배)$/iu.exec(
          line,
        )
      if (courierLineMatch) {
        const raw = (courierLineMatch[1] ?? courierLineMatch[2] ?? "").trim()
        courier = `택배사 : ${normalizeCourierName(raw || line)}`
        continue
      }

      // 짧은 라인에 택배사명 포함 케이스 (예: "CJ대한통운" 단독 라인)
      const embeddedCourier =
        /(CJ\s*대한통운|로젠택배|우체국택배|한진택배|롯데택배|대신택배|경동택배)/iu.exec(line)
      if (embeddedCourier?.[1] && line.replace(/\s+/gu, "").length <= 15) {
        courier = `택배사 : ${normalizeCourierName(embeddedCourier[1])}`
        continue
      }
    }

    restLines.push(line)
  }

  return {
    orderDeadline,
    courier,
    rest: restLines.join("\n"),
  }
}

/**
 * DailyFood memo를 정규화된 description 텍스트로 변환한다.
 * 이미지 크롤링/첨부 금지 룰에 따라 텍스트만 출력한다.
 */
export function buildNormalizedDescriptionText(memo: string): string {
  if (!memo.trim()) return ""

  const parsed = parseDailyFoodMemo(memo)
  const headerParts: string[] = []

  if (parsed.orderDeadline) headerParts.push(parsed.orderDeadline)
  if (parsed.courier) headerParts.push(parsed.courier)

  const parts: string[] = []
  if (headerParts.length > 0) {
    parts.push(headerParts.join("\n"))
  }
  if (parsed.rest.trim()) {
    parts.push(parsed.rest.trim())
  }

  return parts.join("\n\n")
}

/**
 * description 텍스트를 HTML 형식으로 변환 (p 태그 사용, 이미지 없음)
 */
export function buildNormalizedDescriptionHtml(memo: string): string {
  const text = buildNormalizedDescriptionText(memo)
  if (!text) return ""

  return text
    .split("\n\n")
    .map((block) => {
      const lines = block.split("\n").map(escapeHtml).join("<br>")
      return `<p>${lines}</p>`
    })
    .join("")
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;")
}
