import { DatabaseSync } from "node:sqlite"
import { pathToFileURL } from "node:url"
import {
  decideParentLink,
  listParentLinks,
  proposeParentLink,
  unlinkParentLink,
} from "../supplier-lane/repository.js"

export function runSupplierLaneAdminCli(args: readonly string[]): number {
  const databasePath = required(args, "--db-path")
  const action = args[0] ?? "list"
  const database = new DatabaseSync(databasePath)
  try {
    const now = new Date().toISOString()
    const actor = argument(args, "--actor") ?? "supplier-lane-admin-cli"
    let result: unknown
    if (action === "list") {
      const status = argument(args, "--status")
      if (status !== null && !["pending", "approved", "rejected", "terminal"].includes(status)) {
        throw new Error("invalid_status")
      }
      result = listParentLinks(
        database,
        status as "pending" | "approved" | "rejected" | "terminal" | undefined,
      )
    } else if (action === "propose") {
      const supplier = required(args, "--supplier")
      if (supplier !== "dailyfood" && supplier !== "walldob2b") throw new Error("invalid_supplier")
      result = proposeParentLink(database, {
        wooParentId: positiveInteger(required(args, "--woo-parent-id")),
        supplier,
        sourceProductId: required(args, "--source-product-id"),
        actor,
        now,
      })
    } else if (action === "approve" || action === "reject") {
      result = decideParentLink(
        database,
        positiveInteger(required(args, "--id")),
        action === "approve" ? "approved" : "rejected",
        actor,
        now,
      )
    } else if (action === "unlink") {
      result = unlinkParentLink(database, positiveInteger(required(args, "--id")), actor, now)
    } else {
      throw new Error(`unsupported_action:${action}`)
    }
    process.stdout.write(`${JSON.stringify({ action, result })}\n`)
    return 0
  } finally {
    database.close()
  }
}

function argument(args: readonly string[], key: string): string | null {
  const index = args.indexOf(key)
  return index < 0 ? null : (args[index + 1] ?? null)
}

function required(args: readonly string[], key: string): string {
  const value = argument(args, key)
  if (value === null || value.length === 0) throw new Error(`${key} is required`)
  return value
}

function positiveInteger(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("positive_integer_required")
  return parsed
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = runSupplierLaneAdminCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
