import type { AdminPlusSiteConfig } from "./types.js"

export class AdminPlusForbiddenUrlError extends Error {
  readonly name = "AdminPlusForbiddenUrlError"

  constructor(
    readonly blockedUrl: string,
    options?: ErrorOptions,
  ) {
    super(`AdminPlus URL access blocked by policy: ${blockedUrl}`, options)
  }
}

export class AdminPlusUrlPolicy {
  constructor(private readonly site: AdminPlusSiteConfig) {}

  assertNavigationAllowed(rawUrl: string): void {
    const url = this.parseHttpsUrl(rawUrl)
    if (
      !this.site.listUrls.includes(url.href) ||
      !this.site.allowedPathPrefixes.some((prefix) => url.pathname.startsWith(prefix))
    ) {
      throw new AdminPlusForbiddenUrlError(rawUrl)
    }
    this.assertCommonRules(url, rawUrl)
  }

  assertResourceAllowed(rawUrl: string): void {
    if (rawUrl.startsWith("data:") || rawUrl.startsWith("blob:")) {
      return
    }
    const url = this.parseHttpsUrl(rawUrl)
    this.assertCommonRules(url, rawUrl)
  }

  assertProductUrlAllowed(rawUrl: string): void {
    const url = this.parseHttpsUrl(rawUrl)
    this.assertCommonRules(url, rawUrl)
  }

  private parseHttpsUrl(rawUrl: string): URL {
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch (error) {
      throw new AdminPlusForbiddenUrlError(rawUrl, { cause: error })
    }
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.port.length > 0
    ) {
      throw new AdminPlusForbiddenUrlError(rawUrl)
    }
    return url
  }

  private assertCommonRules(url: URL, rawUrl: string): void {
    if (
      !this.site.allowedHosts.includes(url.hostname) ||
      this.site.forbiddenPathPatterns.some((pattern) => url.pathname.startsWith(pattern))
    ) {
      throw new AdminPlusForbiddenUrlError(rawUrl)
    }
  }
}
