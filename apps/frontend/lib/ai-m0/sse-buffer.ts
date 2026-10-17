/**
 * ai-structured-output-poc / M0 —— SSE 消费缓冲区（前端留存资产）。
 *
 * 依据 spec「M0 SSE 中断恢复率 ≥ 95%」+ design D7 断点续传：
 *   - 每个 chunk 有独立 event id；
 *   - 断线时缓存 lastEventId；
 *   - 重连时把 lastEventId 放 request header `Last-Event-ID`，服务端跳过已消费。
 *
 * 本文件是**纯函数缓冲**，不依赖 DOM/window，可在 Node/浏览器/vitest 中运行。
 * 真实 SSE 连接由 `useAiM0Sse` hook 使用 `fetch` + ReadableStream 组装（tasks 6.x）。
 */

import type { AiM0ErrorKind } from '@aiproj/types'

export interface SseChunkEvent {
  kind: 'chunk'
  eventId: string
  text: string
}
export interface SseErrorEvent {
  kind: 'error'
  eventId?: string
  errorKind?: AiM0ErrorKind
  errorMessage?: string
}
export interface SseDoneEvent {
  kind: 'done'
  eventId?: string
  meta: unknown
}
export type SseEvent = SseChunkEvent | SseErrorEvent | SseDoneEvent

export interface SseBufferState {
  /** 累计 rawText（chunk 拼接）。 */
  rawText: string
  /** 最后一个 chunk / done / error 的 event id，用于 Last-Event-ID 续传。 */
  lastEventId: string
  /** 是否结束（done 或 error）。 */
  finished: boolean
}

export const initialSseBufferState: SseBufferState = {
  rawText: '',
  lastEventId: '0',
  finished: false,
}

/** reducer 风格：消费一个 SseEvent → 返回新状态。 */
export function applySseEvent(state: SseBufferState, event: SseEvent): SseBufferState {
  if (event.kind === 'chunk') {
    return {
      rawText: state.rawText + event.text,
      lastEventId: event.eventId || state.lastEventId,
      finished: false,
    }
  }
  if (event.kind === 'error') {
    return {
      rawText: state.rawText,
      lastEventId: event.eventId || state.lastEventId,
      finished: true,
    }
  }
  // done
  return {
    rawText: state.rawText,
    lastEventId: event.eventId || state.lastEventId,
    finished: true,
  }
}

/**
 * 从 SSE 原始 text/event-stream 流片段解析出多个 SseEvent。
 * 支持 `id:` / `event:` / `data:` 三行的标准 SSE frame。
 * 传入未完成的 tail，会在返回值中原样返回 `pending`，供下次调用拼回。
 */
export function parseSseFrames(
  chunk: string,
  pending: string,
): {
  events: SseEvent[]
  pending: string
} {
  const buf = pending + chunk
  // SSE 分隔符：\n\n。以最后一个 `\n\n` 之前为已收全帧，之后为 pending。
  const lastBoundary = buf.lastIndexOf('\n\n')
  if (lastBoundary < 0) {
    return { events: [], pending: buf }
  }
  const framesRaw = buf.slice(0, lastBoundary).split('\n\n')
  const rest = buf.slice(lastBoundary + 2)
  const events: SseEvent[] = []
  for (const frame of framesRaw) {
    const parsed = parseSseFrame(frame)
    if (parsed) events.push(parsed)
  }
  return { events, pending: rest }
}

function parseSseFrame(frame: string): SseEvent | null {
  let eventName = 'message'
  const dataLines: string[] = []
  let id: string | undefined
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    else if (line.startsWith('id:')) id = line.slice(3).trim()
  }
  const data = dataLines.join('\n')
  if (!data) return null
  let parsed: { text?: unknown; errorKind?: AiM0ErrorKind; errorMessage?: string }
  try {
    parsed = JSON.parse(data)
  } catch {
    return { kind: 'error', eventId: id, errorKind: 'malformed_json', errorMessage: data }
  }
  if (eventName === 'chunk') {
    return { kind: 'chunk', eventId: id ?? '0', text: String(parsed.text ?? '') }
  }
  if (eventName === 'error') {
    return {
      kind: 'error',
      eventId: id,
      errorKind: parsed.errorKind,
      errorMessage: parsed.errorMessage,
    }
  }
  if (eventName === 'done') {
    return { kind: 'done', eventId: id, meta: parsed }
  }
  return null
}
