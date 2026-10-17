'use client'

import * as React from 'react'
import { apiRawFetch } from '@/lib/api-client'
import {
  appendOutputPiece,
  closeOutputLanes,
  type OutputLane,
  type OutputPiece,
} from './output-lanes'

/**
 * 实时输出旁路（GET /ai/live-output/:id，SSE）。
 *
 * 意图分析、项目理解是一次性返回 JSON 的请求：发起前生成一个频道编号并订阅，
 * 请求体带上同一编号，等待期间就能看到模型正在吐出的文字。订阅失败只影响观察，不影响请求本身。
 */
export function newLiveOutputId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : '00000000-0000-4000-8000-000000000000'.replace(/0/g, () =>
        Math.floor(Math.random() * 16).toString(16),
      )
}

/** 解析一段 SSE 文本帧（event: / data:），只认 output 与 end。 */
export function parseLiveOutputFrame(frame: string): { event: string; piece?: OutputPiece } | null {
  let event = 'message'
  const data: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (event === 'end') return { event }
  if (event !== 'output' || data.length === 0) return null
  try {
    const parsed = JSON.parse(data.join('\n')) as OutputPiece
    return typeof parsed.text === 'string' ? { event, piece: parsed } : null
  } catch {
    return null
  }
}

async function subscribe(
  id: string,
  onPiece: (piece: OutputPiece) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await apiRawFetch(`/ai/live-output/${id}`, { signal })
  if (!response.ok || !response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const frame = parseLiveOutputFrame(buffer.slice(0, boundary))
      buffer = buffer.slice(boundary + 2)
      if (frame?.event === 'end') return
      if (frame?.piece) onPiece(frame.piece)
      boundary = buffer.indexOf('\n\n')
    }
  }
}

/** 订阅一个频道并把片段归成按调用分道的 lanes；id 变为 null 时停止订阅（保留已收到的内容直到下次订阅）。 */
export function useLiveOutputLanes(id: string | null): {
  lanes: OutputLane[]
  totalChars: number
} {
  const [state, setState] = React.useState<{ lanes: OutputLane[]; totalChars: number }>({
    lanes: [],
    totalChars: 0,
  })
  React.useEffect(() => {
    if (!id) return
    setState({ lanes: [], totalChars: 0 })
    const controller = new AbortController()
    subscribe(
      id,
      (piece) =>
        setState((current) => ({
          lanes: appendOutputPiece(current.lanes, piece),
          totalChars: current.totalChars + piece.text.length,
        })),
      controller.signal,
    )
      .catch(() => {
        // 旁路观察失败不打扰主流程。
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setState((current) => ({ ...current, lanes: closeOutputLanes(current.lanes) }))
        }
      })
    return () => controller.abort()
  }, [id])
  return state
}
