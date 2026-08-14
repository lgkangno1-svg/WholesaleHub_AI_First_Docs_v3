import { randomBytes } from "node:crypto"
import type { P2Supplier } from "../reports/supplier-snapshot-v2.js"

export const SUPPLIER_LANE_MODE_FLAG = "WHOLESALEHUB_SUPPLIER_LANE_MODE"
export const DISPATCH_NOTICE = "주문 후 1~2일 이내 출고 예정"
export const SPLIT_DELIVERY_NOTICE = "선택한 옵션에 따라 상품이 나누어 배송될 수 있습니다."

export type SupplierLaneCode = "A" | "B"

export function laneForSupplier(supplier: P2Supplier): SupplierLaneCode {
  return supplier === "dailyfood" ? "A" : "B"
}

export function publicLaneLabel(lane: SupplierLaneCode): "A사" | "B사" {
  return lane === "A" ? "A사" : "B사"
}

export function supplierForLane(lane: SupplierLaneCode): P2Supplier {
  return lane === "A" ? "dailyfood" : "walldob2b"
}

export function createPublicOfferKey(): string {
  return randomBytes(24).toString("base64url")
}

export function createOpaqueSku(): string {
  return `wh_${randomBytes(15).toString("hex")}`
}

export function sanitizePublicOptionLabel(value: string): string {
  const sanitized = value
    .replace(/dailyfood|walldob2b/giu, "")
    .replace(/source_(?:product|option)_id/giu, "")
    .replace(/https?:\/\/\S+/giu, "")
    .replace(/\s+/gu, " ")
    .trim()
  return sanitized.length > 0 ? sanitized.slice(0, 120) : "옵션"
}

export function supplierLaneModeEnabled(environment = process.env): boolean {
  return environment[SUPPLIER_LANE_MODE_FLAG] === "1"
}
