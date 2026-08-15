import assert from "node:assert/strict"

const cutoff = /발주\s*마감|주문\s*마감|마감\s*시간|오전\s*\d+\s*시\s*마감|오후\s*\d+\s*시\s*마감/u
const normalize = (raw) => {
  const lines = String(raw ?? "").split("\n").map((line) => line.trim()).filter(Boolean)
  const kept = lines.filter((line) => !cutoff.test(line))
  if (kept.length === 0) return ""
  return ["발주마감 오전 8시", ...kept].join("\n")
}

// TEST 1: 원문 9:30 -> public 08:00
assert.equal(
  normalize("발주마감 오전 9시 30분\n롯데택배 (무료택배)\n원산지 : 경북"),
  "발주마감 오전 8시\n롯데택배 (무료택배)\n원산지 : 경북",
  "TEST 1: 9:30 -> 08:00",
)

// TEST 2: 원문 10:00 -> public 08:00
assert.equal(
  normalize("발주마감 오전 10시\n롯데택배"),
  "발주마감 오전 8시\n롯데택배",
  "TEST 2: 10:00 -> 08:00",
)

// TEST 3: 원문 cutoff 없음 -> public 첫줄 08:00
assert.equal(
  normalize("롯데택배\n원산지 : 경북"),
  "발주마감 오전 8시\n롯데택배\n원산지 : 경북",
  "TEST 3: no cutoff -> 08:00 first line",
)

// TEST 4: cutoff 중복 -> public 08:00 정확히 1회
const dup = normalize("발주마감 오전 9시\n주문마감 오후 5시\n마감시간 9시\n롯데택배")
assert.equal(dup.split("\n").filter((l) => l === "발주마감 오전 8시").length, 1, "TEST 4: 08:00 exactly once")
assert.ok(dup.startsWith("발주마감 오전 8시\n롯데택배"), "TEST 4: dedup keeps content")

// genuinely empty -> public empty
assert.equal(normalize(""), "", "empty raw -> empty public")
assert.equal(normalize("발주마감 오전 9시 30분"), "", "cutoff-only raw -> empty public")

console.log("PASS: dailyfood description normalize")
