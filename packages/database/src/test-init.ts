import { initializeDatabase } from "./initialize.js"

async function main(): Promise<void> {
  const result = await initializeDatabase(process.env)
  console.log(JSON.stringify({ status: "initialized", ...result }))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
