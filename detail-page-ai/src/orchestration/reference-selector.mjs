function normalizedScore(asset) {
  const sharpness = Number(asset.sharpness ?? 0);
  const productVisibility = Number(asset.productVisibility ?? 0);
  const fidelity = Number(asset.fidelity ?? 0);
  const uniqueness = Number(asset.uniqueness ?? 0);
  const roleFit = Number(asset.roleFit ?? 0);
  const evidenceValue = Number(asset.evidenceValue ?? 0);

  return (
    sharpness * 0.18 +
    productVisibility * 0.24 +
    fidelity * 0.24 +
    uniqueness * 0.10 +
    roleFit * 0.14 +
    evidenceValue * 0.10
  );
}

function dedupeKey(asset) {
  return asset.similarityGroup || asset.sha256 || asset.id;
}

export function selectReferences(assets, limit) {
  if (!Array.isArray(assets) || limit <= 0) return [];

  const bestByGroup = new Map();
  for (const asset of assets) {
    if (!asset?.id) continue;
    const candidate = { ...asset, selectionScore: normalizedScore(asset) };
    const key = dedupeKey(candidate);
    const current = bestByGroup.get(key);
    if (!current || candidate.selectionScore > current.selectionScore) {
      bestByGroup.set(key, candidate);
    }
  }

  return [...bestByGroup.values()]
    .sort((a, b) => b.selectionScore - a.selectionScore || String(a.id).localeCompare(String(b.id)))
    .slice(0, limit);
}

export function referencesForRole(selectedReferences, allowedRoles) {
  const allowed = new Set(allowedRoles);
  return selectedReferences.filter((asset) => allowed.has(asset.inferredRole));
}
