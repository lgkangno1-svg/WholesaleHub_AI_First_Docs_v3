import { isAbsolute, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"

const DatabaseEnvironmentSchema = z.object({
  DATABASE_URL: z.string().trim().min(1),
})

export class DatabaseUrlError extends Error {
  readonly name = "DatabaseUrlError"

  constructor(options?: ErrorOptions) {
    super("DATABASE_URL must contain a SQLite file path", options)
  }
}

export function readDatabaseUrl(environment: NodeJS.ProcessEnv): string {
  const result = DatabaseEnvironmentSchema.safeParse(environment)
  if (!result.success) {
    throw new DatabaseUrlError({ cause: result.error })
  }
  return result.data.DATABASE_URL
}

export function resolveDatabasePath(databaseUrl: string, workingDirectory = process.cwd()): string {
  const parsed = z.string().trim().min(1).safeParse(databaseUrl)
  if (!parsed.success) {
    throw new DatabaseUrlError({ cause: parsed.error })
  }
  if (parsed.data === ":memory:") {
    return parsed.data
  }
  if (parsed.data.startsWith("file:")) {
    try {
      return fileURLToPath(parsed.data)
    } catch (error) {
      throw new DatabaseUrlError({ cause: error })
    }
  }
  return isAbsolute(parsed.data) ? parsed.data : resolve(workingDirectory, parsed.data)
}
