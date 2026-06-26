import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"
import type { AdminPlusRunGate } from "./types.js"

const RunStateSchema = z.record(z.string(), z.string())
const ErrorCodeSchema = z.object({ code: z.string() })

export class AdminPlusDailyLimitError extends Error {
  readonly name = "AdminPlusDailyLimitError"

  constructor(
    readonly supplierId: string,
    readonly date: string,
  ) {
    super(`AdminPlus supplier already collected on ${date}: ${supplierId}`)
  }
}

export class AdminPlusRunInProgressError extends Error {
  readonly name = "AdminPlusRunInProgressError"

  constructor(readonly supplierId: string) {
    super(`AdminPlus supplier collection is already in progress: ${supplierId}`)
  }
}

export class JsonFileAdminPlusRunGate implements AdminPlusRunGate {
  constructor(private readonly statePath: string) {}

  async runOnce<T>(supplierId: string, date: string, task: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.statePath), { recursive: true })
    const lockPath = `${this.statePath}.${supplierId}.lock`
    try {
      await open(lockPath, "wx").then((handle) => handle.close())
    } catch (error) {
      if (ErrorCodeSchema.safeParse(error).data?.code === "EEXIST") {
        throw new AdminPlusRunInProgressError(supplierId)
      }
      throw error
    }
    try {
      const state = await this.readState()
      if (state[supplierId] === date) {
        throw new AdminPlusDailyLimitError(supplierId, date)
      }
      const result = await task()
      const nextState = { ...state, [supplierId]: date }
      const temporaryPath = `${this.statePath}.tmp`
      await writeFile(temporaryPath, JSON.stringify(nextState, null, 2), "utf8")
      await rename(temporaryPath, this.statePath)
      return result
    } finally {
      await unlink(lockPath)
    }
  }

  private async readState(): Promise<Readonly<Record<string, string>>> {
    try {
      return RunStateSchema.parse(JSON.parse(await readFile(this.statePath, "utf8")))
    } catch (error) {
      if (ErrorCodeSchema.safeParse(error).data?.code === "ENOENT") {
        return {}
      }
      throw error
    }
  }
}
