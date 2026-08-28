import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const shell = readFileSync("scripts/telegram-ai-diagnose.sh", "utf8")
const powershell = readFileSync("scripts/telegram-ai-diagnose.ps1", "utf8")

describe("Telegram AI runtime diagnostic contract", () => {
  it("discovers the actual runtime instead of assuming a repository path", () => {
    expect(shell).toContain("AI PROCESS DISCOVERY (ARGS OMITTED)")
    expect(shell).toContain("SYSTEMD UNIT DISCOVERY (EXEC ARGS OMITTED)")
    expect(shell).toContain("SOURCE CANDIDATE DISCOVERY (CONTENT OMITTED)")
    expect(shell).toContain("OpenCode \\(DeepSeek\\)")
    expect(shell).toContain("gpt-5\\.6-terra")
    expect(shell).toContain("/codex")
  })

  it("collects user namespace, bwrap and UTF-8 evidence needed for the observed failures", () => {
    expect(shell).toContain("kernel.unprivileged_userns_clone")
    expect(shell).toContain("user.max_user_namespaces")
    expect(shell).toContain("unshare -Ur true")
    expect(shell).toContain("bwrap --version")
    expect(shell).toContain("PYTHON_STDOUT_ENCODING")
    expect(shell).toContain("UTF8_LOCALE_AVAILABLE")
  })

  it("never intentionally prints OpenCode credential/config payloads", () => {
    expect(shell).toContain("OPENCODE_AUTH_STORE=PRESENT")
    expect(shell).toContain("jq -r 'keys[]'")
    expect(shell).not.toContain('cat "$auth"')
    expect(shell).not.toContain("grep -En")
    expect(shell).toContain("OPENCODE_CONFIG_DETAILS=SKIPPED_NO_JQ")
    expect(shell).toContain("NO CREDENTIAL VALUES")
  })

  it("omits process arguments, systemd ExecStart, candidate contents and raw journal lines", () => {
    expect(shell).toContain("ps -eo pid=,user=,comm=")
    expect(shell).not.toContain("ps -eo pid=,user=,args=")
    expect(shell).not.toContain("-p ExecStart")
    expect(shell).toContain('CANDIDATE_TAGS=$(keyword_tags "$file")')
    expect(shell).toContain("RECENT ERROR SIGNAL COUNTS (LOG CONTENT OMITTED)")
    expect(shell).toContain("JOURNAL_MATCH_COUNT=")
    expect(shell).not.toContain("tail -n 80")
  })

  it("runs the DeepSeek smoke in an isolated temporary directory", () => {
    expect(shell).toContain("ISOLATED OPENCODE DEEPSEEK SMOKE")
    expect(shell).toContain('smoke_dir="$(mktemp -d)"')
    expect(shell).toContain("openrouter/deepseek/deepseek-v4-flash")
    expect(shell).toContain("Do not create or modify files")
    expect(shell).toContain("OPENCODE_DEEPSEEK_SMOKE_FILES_AFTER")
  })

  it("provides a single Windows command path and saves the report on Desktop", () => {
    expect(powershell).toContain("telegram-ai-diagnose.sh")
    expect(powershell).toContain("scp -q")
    expect(powershell).toContain("ssh $SshHost")
    expect(powershell).toContain("Tee-Object -FilePath $report")
    expect(powershell).toContain("TELEGRAM_AI_DIAGNOSTIC_COMPLETE")
  })
})
