import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("WholesaleHub agentic readiness", () => {
  it("keeps the raw homepage server-rendered with one H1 before H2 content", async () => {
    const template = await readFile(
      "wordpress/plugins/avocadoss-performance/templates/wholesalehub-front-page.php",
      "utf8",
    )

    const h1 = template.indexOf("<h1>")
    const h2 = template.indexOf("<h2")
    expect(h1).toBeGreaterThan(-1)
    expect(h2).toBeGreaterThan(-1)
    expect(h1).toBeLessThan(h2)
    expect(template).toContain("도매허브 이용 방법")
    expect(template).toContain("주문 전 알아두세요")
  })

  it("implements canonical Markdown negotiation with q-values, Vary and 406", async () => {
    const plugin = await readFile("wordpress/mu-plugins/wholesalehub-seo-aeo.php", "utf8")

    expect(plugin).toContain("function wholesalehub_accept_quality")
    expect(plugin).toContain("function wholesalehub_negotiate_home_representation")
    expect(plugin).toContain("text/markdown; charset=utf-8")
    expect(plugin).toContain("Vary: Accept, Accept-Encoding")
    expect(plugin).toContain("status_header( 406 )")
    expect(plugin).toContain("text/markdown, text/html;q=0.8") === false
    expect(plugin).toContain("$markdown_specificity > $html_specificity")
  })

  it("publishes honest agent instructions and developer discovery resources", async () => {
    const plugin = await readFile("wordpress/mu-plugins/wholesalehub-seo-aeo.php", "utf8")

    for (const path of [
      "/llms.txt",
      "/agent-instructions.md",
      "/developer",
      "/agent-sitemap.xml",
      "/about",
      "/contact",
      "/privacy",
    ]) {
      expect(plugin).toContain(path)
    }

    expect(plugin).toContain("## When to use this site")
    expect(plugin).toContain("공개 주문 API")
    expect(plugin).toContain("OpenAPI")
    expect(plugin).toContain("MCP 서버")
    expect(plugin).toContain("비공개 공급사 실명")
    expect(plugin).toContain("get_privacy_policy_url()")
  })

  it("adds agent recovery 404s and explicit origin crawler guidance", async () => {
    const plugin = await readFile("wordpress/mu-plugins/wholesalehub-seo-aeo.php", "utf8")

    expect(plugin).toContain("function wholesalehub_agentic_render_404")
    expect(plugin).toContain("status_header( 404 )")
    expect(plugin).toContain("wp-sitemap.xml")
    expect(plugin).toContain("X-Robots-Tag: noindex, follow")

    for (const userAgent of [
      "ChatGPT-User",
      "ClaudeBot",
      "Google-Extended",
      "DeepSeekBot",
      "ora-agent",
    ]) {
      expect(plugin).toContain(userAgent)
    }
  })

  it("adds Organization identity and an OG image without replacing product schema", async () => {
    const plugin = await readFile("wordpress/mu-plugins/wholesalehub-seo-aeo.php", "utf8")

    expect(plugin).toContain("'@type'       => 'Organization'")
    expect(plugin).toContain("'name'        => '도매허브'")
    expect(plugin).toContain("'description' => '농수축산물")
    expect(plugin).toContain('property=\"og:image\"')
    expect(plugin).toContain("get_site_icon_url( 512 )")
    expect(plugin).toContain("get_theme_mod( 'custom_logo' )")
    expect(plugin).toContain("wc_placeholder_img_src")
    expect(plugin).not.toContain("'@type' => 'Product'")
  })

  it("locks live deployment verification to all public agentic endpoints", async () => {
    const deploy = await readFile("scripts/deploy-site-hardening-cloudflare.ps1", "utf8")

    expect(deploy).toContain("PRODUCTION_AGENTIC_SMOKE=PASS")
    expect(deploy).toContain("Accept: text/markdown, text/html;q=0.8")
    expect(deploy).toContain("AGENT_404=PASS")
    expect(deploy).toContain("SSR_TEXT_CHARS")
    expect(deploy).toContain("agent-sitemap.xml")
    expect(deploy).toContain("AGENT_UA_WARNING ua=ora-agent")
    expect(deploy).toContain(".bak-$timestamp")
  })
})
