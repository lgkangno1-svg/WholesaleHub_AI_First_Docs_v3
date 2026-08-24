import { describe, expect, it } from "vitest"

const cutoff = /발주\s*마감|주문\s*마감|마감\s*시간|오전\s*\d+\s*시\s*마감|오후\s*\d+\s*시\s*마감/u
const normalize = (raw) => {
  const lines = String(raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  const kept = lines.filter((line) => !cutoff.test(line))
  if (kept.length === 0) return ""
  return ["발주마감 오전 8시", ...kept].join("\n")
}

describe("DailyFood description normalization", () => {
  it("normalizes source cutoff times to the public 08:00 cutoff", () => {
    expect(normalize("발주마감 오전 9시 30분\n롯데택배 (무료택배)\n원산지 : 경북")).toBe(
      "발주마감 오전 8시\n롯데택배 (무료택배)\n원산지 : 경북",
    )
    expect(normalize("발주마감 오전 10시\n롯데택배")).toBe("발주마감 오전 8시\n롯데택배")
  })

  it("adds the public cutoff when the source has no cutoff line", () => {
    expect(normalize("롯데택배\n원산지 : 경북")).toBe(
      "발주마감 오전 8시\n롯데택배\n원산지 : 경북",
    )
  })

  it("deduplicates source cutoff lines and keeps product content", () => {
    const normalized = normalize("발주마감 오전 9시\n주문마감 오후 5시\n마감시간 9시\n롯데택배")
    expect(normalized.split("\n").filter((line) => line === "발주마감 오전 8시")).toHaveLength(1)
    expect(normalized.startsWith("발주마감 오전 8시\n롯데택배")).toBe(true)
  })

  it("keeps genuinely empty or cutoff-only source text empty", () => {
    expect(normalize("")).toBe("")
    expect(normalize("발주마감 오전 9시 30분")).toBe("")
  })
})
