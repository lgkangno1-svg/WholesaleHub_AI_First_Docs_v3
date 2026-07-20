import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

const stage = requiredArgument("--stage")
const status = requiredArgument("--status")
const runId = requiredArgument("--run-id")
const database = new DatabaseSync(resolve(argument("--db") ?? "data/wholesalehub.sqlite"))

try {
  if (process.argv.includes("--is-complete")) {
    const row = database
      .prepare(
        `SELECT 1 FROM sync_stage_checkpoints
         WHERE pipeline_run_id = ? AND stage_name = ?
           AND stage_status IN ('completed', 'incomplete')`,
      )
      .get(runId, stage)
    process.exitCode = row === undefined ? 1 : 0
  } else {
  const now = new Date().toISOString()
  database
    .prepare(
      `INSERT INTO sync_stage_checkpoints (
        pipeline_run_id, stage_name, stage_status, artifact_path, result_json,
        error_message, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pipeline_run_id, stage_name) DO UPDATE SET
        stage_status=excluded.stage_status,
        artifact_path=excluded.artifact_path,
        result_json=excluded.result_json,
        error_message=excluded.error_message,
        completed_at=excluded.completed_at`,
    )
    .run(
      runId,
      stage,
      status,
      argument("--artifact"),
      argument("--result") ?? "{}",
      argument("--error"),
      now,
      status === "started" ? null : now,
    )
  }
} finally {
  database.close()
}

function argument(key: string): string | null {
  const index = process.argv.indexOf(key)
  return index < 0 ? null : (process.argv[index + 1] ?? null)
}

function requiredArgument(key: string): string {
  const value = argument(key)
  if (value === null) throw new Error(`${key} is required`)
  return value
}
