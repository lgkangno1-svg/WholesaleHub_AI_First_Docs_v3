import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const contract = readFileSync("docs/TELEGRAM_AI_CONTROL_PLANE_CONTRACT.md", "utf8");
const task = readFileSync("ai/tasks/TELEGRAM_AI_CONTROL_PLANE_REPAIR.md", "utf8");
const shell = readFileSync("scripts/telegram-ai-control-plane-diagnose.sh", "utf8");
const powershell = readFileSync("scripts/telegram-ai-control-plane-diagnose.ps1", "utf8");

describe("Telegram AI control plane contract", () => {
  it("requires three explicit non-fallback routes", () => {
    expect(contract).toContain("Codex route = direct Codex usage");
    expect(contract).toContain("OpenCode DeepSeek Flash route = OpenCodex/OpenCode Go");
    expect(contract).toContain("Antigravity route = OpenCodex Antigravity");
    expect(contract).toContain("Do not proxy this selection through OpenCodex");
    expect(contract).toContain("Do not silently fall back");
    expect(task).toContain("codex_direct");
    expect(task).toContain("opencodex_deepseek_flash");
    expect(task).toContain("opencodex_antigravity");
  });

  it("requires canonical Git/deploy control for hub.avocadoss.co.kr", () => {
    expect(contract).toContain("hub.avocadoss.co.kr");
    expect(contract).toContain("/home/tnfwod/projects/wholesalehub");
    expect(contract).toContain("tested deployment path");
    expect(task).toContain("safe Production deploy wrapper");
  });

  it("keeps risky operations outside generic Telegram automation", () => {
    expect(contract).toContain("real customer payments");
    expect(contract).toContain("real supplier purchases");
    expect(contract).toContain("real refunds");
    expect(contract).toContain("tax issuance");
    expect(task).toContain("Do not let a general Telegram instruction execute real payments");
  });

  it("collects runtime evidence without mutating host security", () => {
    expect(shell).toContain("OPENCODEX_10100");
    expect(shell).toContain("ROUTER_SOURCE_CANDIDATES");
    expect(shell).toContain("openrouter/deepseek/deepseek-v4-flash");
    expect(shell).toContain("CODEX_DIRECT_SMOKE=NOT_AUTORUN");
    expect(shell).toContain("ANTIGRAVITY_SMOKE=NOT_AUTORUN");
    expect(shell).toContain("NO_MUTATION=YES");
    expect(shell).not.toContain("sysctl -w");
    expect(shell).not.toContain("systemctl restart");
    expect(shell).not.toContain("cat $HOME/.local/share/opencode/auth.json");
  });

  it("provides a Windows one-command collector", () => {
    expect(powershell).toContain("telegram-ai-control-plane-diagnose.sh");
    expect(powershell).toContain("scp -q");
    expect(powershell).toContain("ssh $SshHost");
    expect(powershell).toContain("Tee-Object -FilePath $report");
    expect(powershell).toContain("TELEGRAM_CONTROL_PLANE_DIAGNOSTIC_COMPLETE");
  });
});
