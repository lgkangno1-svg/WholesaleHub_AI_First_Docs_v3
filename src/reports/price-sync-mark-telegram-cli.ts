import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

const runId = argument("--run-id")
const status = argument("--status")
const dbPath =
  argument("--db") ??
  "/home/tnfwod/avocadoss-wordpress/wp_data/wp-content/uploads/wholesalehub/wholesalehub.sqlite"

if (!runId) throw new Error("--run-id is required")
if (status !== "sent" && status !== "failed") throw new Error("--status sent|failed is required")

const database = new DatabaseSync(resolve(dbPath))
try {
  const result = database
    .prepare(
      `UPDATE price_sync_runs
          SET telegram_status = ?,
              current_stage = CASE WHEN ? = 'sent' THEN 'telegram_completed' ELSE current_stage END
        WHERE run_id = ?`,
    )
    .run(status, status, runId)
  if (result.changes !== 1) throw new Error(`price sync run not found: ${runId}`)
  console.log(JSON.stringify({ runId, telegramStatus: status }))
} finally {
  database.close()
}

function argument(key: string): string | null {
  const index = process.argv.indexOf(key)
  return index < 0 ? null : (process.argv[index + 1] ?? null)
}
