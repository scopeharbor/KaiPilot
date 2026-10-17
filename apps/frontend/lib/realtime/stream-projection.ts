import type { StreamingProgressEnvelope, RealtimeLogEvent } from '@aiproj/types'
import {
  createLogBuffer,
  reduceLogBuffer,
  freezeLogBuffer,
  resetLogBuffer,
  type LogBufferState,
} from '@/lib/realtime/log-buffer'

export interface StreamProjectionState {
  streamId: string
  domain: string
  lastSequence: number
  lastEventAt: number | null
  terminal: boolean
  error: string | null
  needsReset: boolean
  /**
   * 有界日志缓冲投影（v2-5-streaming-realtime-log-panel）。
   * 加法字段：默认空缓冲；reduceLogEvent 委托 log-buffer 投影累积。
   * gap/reset 时随 needsReset 同步冻结/重建，与进度归约语义一致（design D3）。
   */
  logBuffer: LogBufferState
}

export function createStreamProjectionState(
  streamId: string,
  domain: string,
): StreamProjectionState {
  return {
    streamId,
    domain,
    lastSequence: 0,
    lastEventAt: null,
    terminal: false,
    error: null,
    needsReset: false,
    logBuffer: createLogBuffer(),
  }
}

export function reduceStreamEnvelope(
  state: StreamProjectionState,
  envelope: StreamingProgressEnvelope,
): StreamProjectionState {
  if (envelope.domain !== state.domain) return state
  if (state.lastSequence > 0 && envelope.sequence <= state.lastSequence) return state
  if (state.lastSequence > 0 && envelope.sequence > state.lastSequence + 1) {
    // 序列缺口：冻结日志缓冲，不追加越过缺口的日志（design D3）
    return {
      ...state,
      needsReset: true,
      error: 'SEQUENCE_GAP',
      logBuffer: freezeLogBuffer(state.logBuffer),
    }
  }
  const terminal =
    envelope.type === 'completed' || envelope.type === 'failed' || envelope.type === 'cancelled'
  return {
    ...state,
    lastSequence: envelope.sequence,
    lastEventAt: Date.now(),
    terminal: state.terminal || terminal,
    error: envelope.type === 'failed' ? 'STREAM_FAILED' : state.error,
    needsReset: false,
  }
}

export function handleResetRequired(
  state: StreamProjectionState,
  reasonCode: string,
): StreamProjectionState {
  // 重置后重建日志缓冲，解冻、恢复追加能力（design D3）
  return {
    ...state,
    needsReset: true,
    error: reasonCode,
    logBuffer: resetLogBuffer(state.logBuffer),
  }
}

/**
 * reduceLogEvent —— 从「丢弃」升级为「更新 lastEventAt 且委托 log-buffer 投影」。
 *
 * 加法委托：保持 StreamProjectionState 结构兼容，不改 reduceStreamEnvelope。
 * gap 冻结期间（needsReset）log-buffer 已被冻结，追加被忽略（design D3）。
 * 白名单护栏在 log-buffer 投影内执行，渲染层只吃护栏后对象（design D4）。
 */
export function reduceLogEvent(
  state: StreamProjectionState,
  log: RealtimeLogEvent,
): StreamProjectionState {
  return {
    ...state,
    lastEventAt: Date.now(),
    logBuffer: reduceLogBuffer(state.logBuffer, log),
  }
}
