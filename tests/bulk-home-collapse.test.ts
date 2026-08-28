import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const togglePath = "wordpress/mu-plugins/wholesalehub-bulk-home-toggle.php"
const deployPath = "scripts/deploy-wholesalehub.ps1"
const toggle = readFileSync(togglePath, "utf8")
const deploy = readFileSync(deployPath, "utf8")

describe("WholesaleHub floating bulk-order collapse contract", () => {
  it("progressively enhances the existing quick-order panel without changing order URLs", () => {
    expect(toggle).toContain("document.querySelector('.wh-bulk-home')")
    expect(toggle).toContain("root.querySelector('nav')")
    expect(toggle).not.toContain("admin-post.php")
    expect(toggle).not.toContain("wh_bulk_checkout")
  })

  it("is accessible and defaults mobile screens to collapsed", () => {
    expect(toggle).toContain("button.type='button'")
    expect(toggle).toContain("aria-controls")
    expect(toggle).toContain("aria-expanded")
    expect(toggle).toContain("빠른주문 메뉴 접기")
    expect(toggle).toContain("빠른주문 메뉴 펼치기")
    expect(toggle).toContain("(max-width: 768px)")
    expect(toggle).toContain("saved!==null?saved:!(media&&media.matches)")
  })

  it("keeps an explicit visitor choice while remaining usable if storage is blocked", () => {
    expect(toggle).toContain("window.localStorage.getItem")
    expect(toggle).toContain("window.localStorage.setItem")
    expect(toggle).toMatch(/catch\(e\)\{\}/)
    expect(toggle).toContain("nav[hidden]{display:none!important}")
  })

  it("is included in the surgical production MU-plugin deployment and PHP verification", () => {
    const occurrences = deploy.match(/wholesalehub-bulk-home-toggle\.php/g) ?? []
    expect(occurrences.length).toBeGreaterThanOrEqual(2)
    expect(deploy).toContain("VERIFY_FILE_OK $file")
  })
})
