import type { DatabaseSync } from "node:sqlite"
import {
  type CallbackOutcome,
  getApprovalRequestById,
  resolveCallback,
} from "./approval-repository.js"
import { parseCallbackData } from "./approval-request.js"

export type TelegramApiPayload = {
  readonly method: "answerCallbackQuery" | "editMessageText"
  readonly payload: Readonly<Record<string, string | number | boolean>>
}

export type TelegramCallbackServiceResult = {
  readonly handled: boolean
  readonly approvalRequestId: number | null
  readonly outcome: CallbackOutcome | null
  readonly telegram: readonly TelegramApiPayload[]
}

type TelegramCallbackUpdate = {
  readonly callback_query?: {
    readonly id?: unknown
    readonly data?: unknown
    readonly from?: {
      readonly id?: unknown
      readonly username?: unknown
      readonly first_name?: unknown
    }
    readonly message?: {
      readonly message_id?: unknown
      readonly chat?: { readonly id?: unknown }
    }
  }
}

export function handleSupplierLaneTelegramCallback(
  db: DatabaseSync,
  update: TelegramCallbackUpdate,
  now: string,
): TelegramCallbackServiceResult {
  const callback = update.callback_query
  if (callback === undefined || typeof callback.data !== "string") {
    return { handled: false, approvalRequestId: null, outcome: null, telegram: [] }
  }
  const parsed = parseCallbackData(callback.data)
  if (parsed === null) {
    return { handled: false, approvalRequestId: null, outcome: null, telegram: [] }
  }

  const request = getApprovalRequestById(db, parsed.requestId)
  const actor = callbackActor(callback.from)
  const outcome =
    request === null
      ? ({ kind: "not_found" } as const)
      : resolveCallback(db, {
          requestId: parsed.requestId,
          action: parsed.kind,
          ...(parsed.kind === "link" ? { candidateRank: parsed.candidateRank } : {}),
          actor,
          now,
        })
  const response = outcomeResponse(outcome)
  const telegram: TelegramApiPayload[] = []
  if (typeof callback.id === "string" && callback.id.length > 0) {
    telegram.push({
      method: "answerCallbackQuery",
      payload: {
        callback_query_id: callback.id,
        text: response.answerText,
        show_alert: response.alert,
      },
    })
  }
  const chatId = scalar(callback.message?.chat?.id)
  const messageId = positiveInteger(callback.message?.message_id)
  if (response.editText !== null && chatId !== null && messageId !== null) {
    telegram.push({
      method: "editMessageText",
      payload: {
        chat_id: chatId,
        message_id: messageId,
        text: response.editText,
        reply_markup: JSON.stringify({ inline_keyboard: [] }),
      },
    })
  }
  return {
    handled: true,
    approvalRequestId: parsed.requestId,
    outcome,
    telegram,
  }
}

function outcomeResponse(outcome: CallbackOutcome): {
  readonly answerText: string
  readonly alert: boolean
  readonly editText: string | null
} {
  switch (outcome.kind) {
    case "applied":
      return {
        answerText: "처리했습니다.",
        alert: false,
        editText: `Supplier Lane 요청 #${outcome.request.id}: ${outcome.request.status}`,
      }
    case "already_processed":
      return {
        answerText: "이미 처리된 요청입니다.",
        alert: false,
        editText: `Supplier Lane 요청 #${outcome.request.id}: ${outcome.request.status}`,
      }
    case "conflict":
      return {
        answerText: "이미 다른 상품이 승인 연결되어 있습니다.",
        alert: true,
        editText: null,
      }
    case "not_found":
      return { answerText: "승인 요청을 찾을 수 없습니다.", alert: true, editText: null }
    case "expired_or_invalid":
      return { answerText: "만료되었거나 처리할 수 없는 요청입니다.", alert: true, editText: null }
  }
}

function callbackActor(
  from: NonNullable<TelegramCallbackUpdate["callback_query"]>["from"],
): string {
  if (typeof from?.username === "string" && from.username.length > 0) return from.username
  if (typeof from?.first_name === "string" && from.first_name.length > 0) return from.first_name
  const id = scalar(from?.id)
  return id === null ? "telegram" : `telegram:${id}`
}

function scalar(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null
}
