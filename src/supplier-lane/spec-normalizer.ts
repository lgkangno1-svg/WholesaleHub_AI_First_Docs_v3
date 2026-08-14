export type SpecMappingStatus =
  | "auto_approved"
  | "review_required"
  | "manual_approved"
  | "excluded"

export type SpecAnalysisResult = {
  readonly weightVal: number | null
  readonly weightUnit: string | null
  readonly countVal: number | null
  readonly countUnit: string | null
  readonly gradeSize: string | null
  readonly packaging: string | null
  readonly variety: string | null
  readonly origin: string | null
  readonly storageType: string | null
  readonly comparisonGroup: string
  readonly confidence: number
  readonly status: SpecMappingStatus
}

export function parseSpecLabel(rawLabel: string): SpecAnalysisResult {
  const label = rawLabel.trim()
  let weightVal: number | null = null
  let weightUnit: string | null = null
  let countVal: number | null = null
  let countUnit: string | null = null
  let gradeSize: string | null = null
  let packaging: string | null = null
  let variety: string | null = null
  let origin: string | null = null
  let storageType: string | null = null

  // Weight parsing (kg, g, 킬로, 키로, 그램)
  const weightMatch = /([\d\.]+)\s*(kg|킬로|키로|g|그램)/iu.exec(label)
  if (weightMatch && weightMatch[1] && weightMatch[2]) {
    const val = Number.parseFloat(weightMatch[1])
    const unitRaw = weightMatch[2].toLowerCase()
    if (unitRaw === "g" || unitRaw === "그램") {
      weightVal = val
      weightUnit = "g"
    } else {
      weightVal = val
      weightUnit = "kg"
    }
  }

  // Count parsing (개, 입, 과)
  const countMatch = /([\d\.]+)\s*(개입|개|입|과)/u.exec(label)
  if (countMatch && countMatch[1] && countMatch[2]) {
    countVal = Number.parseInt(countMatch[1], 10)
    const unitRaw = countMatch[2]
    countUnit = unitRaw === "개입" || unitRaw === "입" ? "개" : unitRaw
  }

  // Grade / Size parsing
  const compoundGradeMatch =
    /(왕특|특대과|특대|특A품|특A|특품|대과|중과|중품|중소|소과|꼬마|가정용|선물용|정품|못난이|프리미엄)/u.exec(
      label,
    )
  const singleGradeMatch = /(?:^|[\s()\[\],])(특|대|중|소)(?=$|[\s()\[\],])/u.exec(label)

  if (compoundGradeMatch && compoundGradeMatch[1]) {
    const g = compoundGradeMatch[1]
    if (["특품", "특A품", "특A"].includes(g)) {
      gradeSize = "특품"
    } else if (["왕특", "특대과", "특대"].includes(g)) {
      gradeSize = "왕특"
    } else if (g === "대과") {
      gradeSize = "대"
    } else if (["중과", "중품", "중소"].includes(g)) {
      gradeSize = "중"
    } else if (["소과", "꼬마"].includes(g)) {
      gradeSize = "소"
    } else {
      gradeSize = g
    }
  } else if (singleGradeMatch && singleGradeMatch[1]) {
    const g = singleGradeMatch[1]
    if (g === "특") gradeSize = "특품"
    else if (g === "대") gradeSize = "대"
    else if (g === "중") gradeSize = "중"
    else if (g === "소") gradeSize = "소"
  }

  // Packaging parsing
  const packMatch = /(팩|봉|박스|망)/u.exec(label)
  if (packMatch && packMatch[1]) {
    packaging = packMatch[1]
  }

  // Origin parsing
  const originMatch = /(국내산|국산|제주산|성주산|미국산|중국산|수입산)/u.exec(label)
  if (originMatch && originMatch[1]) {
    origin = originMatch[1] === "국산" ? "국내산" : originMatch[1]
  }

  // Storage type parsing
  const storageMatch = /(냉장|냉동|상온)/u.exec(label)
  if (storageMatch && storageMatch[1]) {
    storageType = storageMatch[1]
  }

  // Variety parsing
  const varietyMatch = /(신비복숭아|성주참외|홍감자|찰옥수수|망고스틴|무지개망고)/u.exec(label)
  if (varietyMatch && varietyMatch[1]) {
    variety = varietyMatch[1]
  }

  const keyParts: string[] = []
  if (gradeSize) keyParts.push(gradeSize)
  if (weightVal !== null) {
    const formatted = Number.isInteger(weightVal) ? String(weightVal) : String(weightVal)
    keyParts.push(`${formatted}${weightUnit ?? "kg"}`)
  }
  if (countVal !== null) {
    keyParts.push(`${countVal}${countUnit ?? "개"}`)
  }
  if (packaging) keyParts.push(packaging)
  if (variety) keyParts.push(variety)

  const comparisonGroup = keyParts.length > 0 ? keyParts.join(" ") : label
  const confidence = gradeSize !== null || weightVal !== null || countVal !== null ? 0.95 : 0.5
  const status: SpecMappingStatus = confidence >= 0.85 ? "auto_approved" : "review_required"

  return {
    weightVal,
    weightUnit,
    countVal,
    countUnit,
    gradeSize,
    packaging,
    variety,
    origin,
    storageType,
    comparisonGroup,
    confidence,
    status,
  }
}

export function extractSizeRank(label: string): number {
  const l = label.trim()
  if (/(왕특과|왕특|특대과|특대|특A품|특A)/u.test(l)) return 50
  if (/(특품|특과|특A|\b특\b|특)/u.test(l) && !/(왕특)/u.test(l)) return 40
  if (/(대과|대품|대)/u.test(l)) return 30
  if (/(중과|중품|중소|중)/u.test(l)) return 20
  if (/(소과|꼬마|소)/u.test(l)) return 10
  return 999
}

export function extractWeightValGrams(label: string): number {
  const mKg = /([\d\.]+)\s*(kg|킬로|키로)/iu.exec(label)
  if (mKg && mKg[1]) return Number.parseFloat(mKg[1]) * 1000
  const mG = /([\d\.]+)\s*(g|그램)/iu.exec(label)
  if (mG && mG[1]) return Number.parseFloat(mG[1])
  return 999999
}

export function extractCountVal(label: string): number {
  const m = /([\d\.]+)\s*(개입|개|입|과)/u.exec(label)
  return m && m[1] ? Number.parseFloat(m[1]) : 999999
}

export function extractPackVal(label: string): number {
  const m = /([\d\.]+)\s*(박스|망|상자|팩|봉)/u.exec(label)
  return m && m[1] ? Number.parseFloat(m[1]) : 999999
}

export function sortOffersBySizeWeight<T extends { label?: string; public_option_label?: string; lane?: string }>(
  a: T,
  b: T,
): number {
  if (a.lane && b.lane && a.lane !== b.lane) {
    return a.lane.localeCompare(b.lane)
  }
  const labelA = a.label ?? a.public_option_label ?? ""
  const labelB = b.label ?? b.public_option_label ?? ""

  const rankA = extractSizeRank(labelA)
  const rankB = extractSizeRank(labelB)
  if (rankA !== rankB) return rankA - rankB

  const weightA = extractWeightValGrams(labelA)
  const weightB = extractWeightValGrams(labelB)
  if (weightA !== weightB) return weightA - weightB

  const countA = extractCountVal(labelA)
  const countB = extractCountVal(labelB)
  if (countA !== countB) return countA - countB

  const packA = extractPackVal(labelA)
  const packB = extractPackVal(labelB)
  if (packA !== packB) return packA - packB

  return labelA.localeCompare(labelB, "ko-KR", { numeric: true })
}

