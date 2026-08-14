const ALLOWED_IMAGE_HOSTS = new Set(["cdn.yourlove.co.kr", "walldob2b.com"])

export function safeCatalogImageUrl(value: unknown): string {
  try {
    const url = new URL(String(value ?? "").trim())
    if (url.protocol !== "https:" || !ALLOWED_IMAGE_HOSTS.has(url.hostname.toLowerCase())) {
      return ""
    }
    if (!/\.(?:jpe?g|png|webp)$/iu.test(url.pathname)) return ""
    return url.toString()
  } catch {
    return ""
  }
}

export function selectCatalogImageUrl(input: {
  readonly imageUrl?: unknown
  readonly lanes?: Readonly<Record<string, { readonly imageUrl?: unknown } | undefined>>
}): string {
  const candidates = [input.imageUrl, input.lanes?.["B"]?.imageUrl, input.lanes?.["A"]?.imageUrl]
  for (const candidate of candidates) {
    const url = safeCatalogImageUrl(candidate)
    if (url) return url
  }
  return ""
}
