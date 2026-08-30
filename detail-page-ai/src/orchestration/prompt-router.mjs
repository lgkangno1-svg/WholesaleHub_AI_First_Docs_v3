export const PROMPT_PATHS = Object.freeze({
  direct: 'sales_conversion_v1',
  ted: 'ted_enriched_sales_conversion_v1',
});

export function choosePromptPath(signal = {}) {
  const evidenceScore = Number(signal.evidenceScore ?? 0);
  const differentiationScore = Number(signal.differentiationScore ?? 0);
  const hasProofDocument = signal.hasProofDocument === true;
  const hasBrandPrinciple = signal.hasBrandPrinciple === true;
  const hasProcessEvidence = signal.hasProcessEvidence === true;

  const enriched =
    hasProofDocument ||
    (hasBrandPrinciple && differentiationScore >= 0.5) ||
    (hasProcessEvidence && evidenceScore >= 0.5) ||
    evidenceScore + differentiationScore >= 1.25;

  return enriched ? PROMPT_PATHS.ted : PROMPT_PATHS.direct;
}
