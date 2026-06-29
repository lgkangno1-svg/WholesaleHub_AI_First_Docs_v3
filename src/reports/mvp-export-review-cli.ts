import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"

const WINDOWS_DESKTOP = "/mnt/c/Users/tnfwo/Desktop"
const WINDOWS_REVIEW_DIR = `${WINDOWS_DESKTOP}/hub검수`
const REQUIRED_FILES = [
  "reports/mvp-sync-safety-review.csv",
  "reports/mvp-sync-safety-review-summary.md",
] as const
const OPTIONAL_FILES = [
  "reports/mvp-final-summary.md",
  "reports/mvp-handoff-summary.md",
  "reports/mvp-customer-qa-summary.md",
  "reports/mvp-customer-qa-results.csv",
  "reports/mvp-add-create-safety-review.csv",
  "reports/mvp-add-create-execute-summary.md",
] as const

async function main(): Promise<void> {
  await mkdir("reports", { recursive: true })
  const timestamp = timestampForFile(new Date())
  if (!(await isDirectory(WINDOWS_DESKTOP))) {
    await writeFile(
      "reports/windows-export-unavailable.md",
      `# Windows Export Unavailable\n\n- checked_path: ${WINDOWS_DESKTOP}\n- reason: Windows Desktop path is not accessible from this Linux environment. Reports remain in /home/tnfwod/projects/wholesalehub/reports.\n- checked_at: ${new Date().toISOString()}\n`,
      "utf8",
    )
    console.log(JSON.stringify({ windowsAvailable: false, copiedCount: 0 }, null, 2))
    return
  }

  await mkdir(WINDOWS_REVIEW_DIR, { recursive: true })
  const copied: string[] = []
  for (const file of [...REQUIRED_FILES, ...OPTIONAL_FILES]) {
    if (!(await exists(file))) continue
    const target = join(WINDOWS_REVIEW_DIR, basename(file))
    await copyReport(file, target)
    copied.push(target)
  }
  for (const file of REQUIRED_FILES) {
    if (!(await exists(file))) continue
    const target = join(WINDOWS_REVIEW_DIR, `${timestamp}-${basename(file)}`)
    await copyReport(file, target)
    copied.push(target)
  }
  await writeFile(
    "reports/mvp-export-review-summary.md",
    `# MVP Export Review Summary\n\n- windows_available: true\n- windows_review_dir: ${WINDOWS_REVIEW_DIR}\n- copied_count: ${copied.length}\n- exported_at: ${new Date().toISOString()}\n\n## Files\n${copied.map((file) => `- ${file}`).join("\n")}\n`,
    "utf8",
  )
  console.log(
    JSON.stringify(
      { windowsAvailable: true, reviewDir: WINDOWS_REVIEW_DIR, copiedCount: copied.length },
      null,
      2,
    ),
  )
}

async function copyReport(source: string, target: string): Promise<void> {
  if (source.endsWith(".csv")) {
    const content = await readFile(source)
    const hasBom =
      content.length >= 3 && content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf
    await writeFile(
      target,
      hasBom ? content : Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), content]),
    )
    return
  }
  await copyFile(source, target)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(resolve(path))
    return true
  } catch {
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function timestampForFile(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00"
  return `${part("year")}${part("month")}${part("day")}-${part("hour")}${part("minute")}`
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
