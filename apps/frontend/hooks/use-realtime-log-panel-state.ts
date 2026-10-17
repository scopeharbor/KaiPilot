'use client'

/**
 * useRealtimeLogPanelState —— RealtimeLogPanel 的状态投影 hook（v2-5-streaming-realtime-log-panel）。
 *
 * 复用既有 `useStreamConnectionStatus` / `useStreamRecovery` 与 `reduceLogEvent`/`reduceStreamEnvelope`
 * 投影，把 stream client 投递的低敏日志流 + 连接/恢复态组合成面板所需的 props：
 *   - logBuffer：经 reduceLogEvent 委托 log-buffer 投影累积的有界缓冲
 *   - needsReset：复用 useStreamRecovery 的恢复态（呈现「需回放/重置」提示）
 *   - disconnected：复用 useStreamConnectionStatus 的连接断开态
 *
 * 边界（design Non-Goals）：
 * - 只消费既有 hooks 接口、呈现恢复态；**不实现真实恢复接线**（连接/回放真值归 streaming recovery 链）
 * - useStreamRecovery 当前为静态 stub，消费其接口契约，恢复真值接线后自动生效
 * - 零写入：纯投影，无 network/store/run 副作用
 *
 * 消费方可在 Compiler run 详情 / AI 草案生成 / 通用长任务抽屉挂载本 hook + RealtimeLogPanel。
 */

import { useCallback, useMemo, useReducer, useRef } from 'react'
import { useStreamConnectionStatus, useStreamRecovery } from '@/hooks/use-stream-status'
import {
  createStreamProjectionState,
  reduceLogEvent,
  reduceStreamEnvelope,
  handleResetRequired,
  type StreamProjectionState,
} from '@/lib/realtime/stream-projection'
import type { StreamingProgressEnvelope, RealtimeLogEvent } from '@aiproj/types'

export interface RealtimeLogPanelState {
  logBuffer: StreamProjectionState['logBuffer']
  needsReset: boolean
  disconnected: boolean
  /** 接收一条流信封（进度归约）——供消费方在 stream:event 时调用。 */
  ingestEnvelope: (envelope: StreamingProgressEnvelope) => void
  /** 接收一条日志事件（经 reduceLogEvent 委托 log-buffer）——供消费方在 stream:log 时调用。 */
  ingestLog: (log: RealtimeLogEvent) => void
  /** 重置投影（回放/重置后重建日志缓冲）。 */
  reset: (reasonCode?: string) => void
}

type Action =
  | { type: 'envelope'; envelope: StreamingProgressEnvelope }
  | { type: 'log'; log: RealtimeLogEvent }
  | { type: 'reset'; reasonCode?: string }

function reducer(state: StreamProjectionState, action: Action): StreamProjectionState {
  switch (action.type) {
    case 'envelope':
      return reduceStreamEnvelope(state, action.envelope)
    case 'log':
      return reduceLogEvent(state, action.log)
    case 'reset':
      return handleResetRequired(state, action.reasonCode ?? 'RESET')
  }
}

export function useRealtimeLogPanelState(streamId: string, domain: string): RealtimeLogPanelState {
  const connectionStatus = useStreamConnectionStatus()
  const recovery = useStreamRecovery(streamId)

  const [state, dispatch] = useReducer(reducer, streamId, () =>
    createStreamProjectionState(streamId, domain),
  )

  // 流切换（streamId/domain 变化）时重建投影
  const lastStreamKey = useRef(`${streamId}|${domain}`)
  const effectiveState = useMemo(() => {
    const key = `${streamId}|${domain}`
    if (key !== lastStreamKey.current) {
      lastStreamKey.current = key
      return createStreamProjectionState(streamId, domain)
    }
    return state
  }, [state, streamId, domain])

  const ingestEnvelope = useCallback(
    (envelope: StreamingProgressEnvelope) => dispatch({ type: 'envelope', envelope }),
    [],
  )
  const ingestLog = useCallback((log: RealtimeLogEvent) => dispatch({ type: 'log', log }), [])
  const reset = useCallback((reasonCode?: string) => dispatch({ type: 'reset', reasonCode }), [])

  // needsReset 优先取 recovery 真值（恢复链接线后生效），否则回退到投影的 needsReset
  const needsReset = recovery.needsRecovery || effectiveState.needsReset
  const disconnected = connectionStatus.status === 'disconnected' || connectionStatus.isReconnecting

  return {
    logBuffer: effectiveState.logBuffer,
    needsReset,
    disconnected,
    ingestEnvelope,
    ingestLog,
    reset,
  }
}
