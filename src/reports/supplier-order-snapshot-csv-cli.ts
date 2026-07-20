import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import ky from "ky"

type Snapshot = {
  readonly woo_order_id: number
  readonly woo_order_item_id: number
  readonly supplier_id: string
  readonly supplier_product_id: string
  readonly supplier_option_id: string
  readonly supplier_original_product_title: string
  readonly supplier_original_option_name: string
  readonly supplier_cost_snapshot: number
  readonly quantity: number
}

type WooOrder = {
  readonly id: number
  readonly date_created: string
  readonly shipping: Record<string, string>
  readonly billing: Record<string, string>
  readonly customer_note: string
  readonly line_items: readonly {
    readonly id: number
    readonly name: string
    readonly meta_data: readonly { readonly display_value?: string; readonly value?: unknown }[]
  }[]
}

async function main(): Promise<void> {
  await loadDotEnv()
  const database = new DatabaseSync(resolve(argument("--db") ?? "data/wholesalehub.sqlite"))
  const outputDirectory = resolve(argument("--output-dir") ?? "reports/supplier-orders")
  await mkdir(outputDirectory, { recursive: true })
  try {
    const snapshots = database
      .prepare(
        `SELECT
          woo_order_id, woo_order_item_id, supplier_id, supplier_product_id,
          supplier_option_id, supplier_original_product_title,
          supplier_original_option_name, supplier_cost_snapshot, quantity
         FROM woo_order_item_source_snapshots
         WHERE snapshot_status = 'mapped'
         ORDER BY supplier_id, woo_order_id, woo_order_item_id`,
      )
      .all() as unknown as Snapshot[]
    const orders = new Map<number, WooOrder>()
    for (const orderId of new Set(snapshots.map((row) => row.woo_order_id))) {
      orders.set(orderId, await fetchOrder(orderId))
    }
    const files: string[] = []
    for (const supplierId of new Set(snapshots.map((row) => row.supplier_id))) {
      const path = resolve(outputDirectory, `${safeName(supplierId)}.csv`)
      const lines = [
        [
          "주문번호",
          "주문일",
          "수령인",
          "연락처",
          "주소",
          "배송메모",
          "고객 구매 상품명",
          "고객 구매 옵션",
          "수량",
          "공급처",
          "공급처 원본 상품명",
          "공급처 원본 옵션명",
          "공급처 상품 ID",
          "공급처 옵션 ID",
          "매입가 스냅샷",
        ],
        ...snapshots
          .filter((row) => row.supplier_id === supplierId)
          .map((row) => csvRow(row, orders.get(row.woo_order_id))),
      ]
      await writeFile(path, `\uFEFF${lines.map(toCsv).join("\n")}\n`, "utf8")
      files.push(path)
    }
    console.log(JSON.stringify({ supplierFileCount: files.length, snapshotRowCount: snapshots.length, files }))
  } finally {
    database.close()
  }
}

async function fetchOrder(orderId: number): Promise<WooOrder> {
  const credentials = `${requiredEnv("WOOCOMMERCE_CONSUMER_KEY")}:${requiredEnv(
    "WOOCOMMERCE_CONSUMER_SECRET",
  )}`
  return (await ky
    .get(
      `${requiredEnv("WOOCOMMERCE_BASE_URL").replace(/\/+$/u, "")}/wp-json/wc/v3/orders/${orderId}`,
      {
        headers: { Authorization: `Basic ${Buffer.from(credentials).toString("base64")}` },
        timeout: 30_000,
        retry: { limit: 1 },
      },
    )
    .json()) as WooOrder
}

function csvRow(row: Snapshot, order: WooOrder | undefined): readonly unknown[] {
  const shipping = order?.shipping ?? {}
  const billing = order?.billing ?? {}
  const line = order?.line_items.find((item) => item.id === row.woo_order_item_id)
  const recipient = [shipping["last_name"], shipping["first_name"]].filter(Boolean).join("")
  const address = [
    shipping["postcode"],
    shipping["state"],
    shipping["city"],
    shipping["address_1"],
    shipping["address_2"],
  ]
    .filter(Boolean)
    .join(" ")
  return [
    row.woo_order_id,
    order?.date_created ?? "",
    recipient || [billing["last_name"], billing["first_name"]].filter(Boolean).join(""),
    shipping["phone"] || billing["phone"] || "",
    address,
    order?.customer_note ?? "",
    line?.name ?? "",
    line?.meta_data.map((item) => item.display_value ?? String(item.value ?? "")).join(" / ") ?? "",
    row.quantity,
    row.supplier_id,
    row.supplier_original_product_title,
    row.supplier_original_option_name,
    row.supplier_product_id,
    row.supplier_option_id,
    row.supplier_cost_snapshot,
  ]
}

function toCsv(values: readonly unknown[]): string {
  return values
    .map((value) => `"${String(value ?? "").replace(/"/gu, '""')}"`)
    .join(",")
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/gu, "_")
}

function argument(key: string): string | null {
  const index = process.argv.indexOf(key)
  return index < 0 ? null : (process.argv[index + 1] ?? null)
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`${key} is required`)
  return value
}

async function loadDotEnv(): Promise<void> {
  const env = await readFile(".env", "utf8")
  for (const line of env.split(/\r?\n/u)) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line)
    if (match?.[1] !== undefined && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2] ?? ""
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
