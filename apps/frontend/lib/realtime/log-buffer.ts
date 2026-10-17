/**
 * log-buffer —— 前端有界实时日志缓冲投影（v2-5-streaming-realtime-log-panel）。
 *
 * 把 stream client 投递的 `RealtimeLogEvent` 低敏日志流累积为**有序、按稳定身份键去重、
 * 容量有上界、FIFO 淘汰、gap/reset 感知**的可显示条目列表，替代
 * `reduceLogEvent` 仅更新 `lastEventAt`、丢弃日志内容的旧行为。
 *
 * 纯前端投影，不改后端事件语义，不改 `reduceStreamEnvelope` 进度归约。
 * 渲染层只吃护栏后对象（`projectToLogEntry`），非白名单字段永不落 DOM。
 *
 * 不变量：
 * - 有序：按到达顺序追加，不重排（重连/回放事件经身份键幂等忽略）
 * - 幂等去重：身份键 `streamId`+`stageId`+`phase`+`attempt`+`timestamp`
 * - 容量上界：超 `DEFAULT_LOG_BUFFER_CAPACITY` 按 FIFO 淘汰最旧，条目数永不上界
 * - gap 冻结：`needsReset === true`（含 `SEQUENCE_GAP`）时冻结缓冲、不追加越过缺口的日志
 * - 零写入：纯投影，无 network/store/run 副作用
 */

import type { RealtimeLogEvent, RealtimeLogSeverity } from '@aiproj/types'
import { REALTIME_LOG_ALLOWLIST_SET } from '@aiproj/types'

/** 缓冲容量默认上界（可调常量，D2）。长任务日志量无界，必须有界防内存膨胀。 */
export const DEFAULT_LOG_BUFFER_CAPACITY = 500

/**
 * 日志面板渲染条目——护栏后对象，只含白名单字段。
 * 渲染层只吃此类型；非白名单字段在投影时即被丢弃，永不落 DOM（D4）。
 */
export interface LogEntry {
  streamId: string
  stageId: string
  phase: string
  attempt: number
  severity: RealtimeLogSeverity
  messageCode: string
  count?: number
  durationMs?: number
  safeRefs?: string[]
  hash?: string
  timestamp: string
  /** 到达序号（缓冲内单调递增），用于稳定排序与 FIFO 淘汰。 */
  __seq: number
}

/** 日志缓冲状态——纯数据，无 React 依赖。 */
export interface LogBufferState {
  /** 有序条目（最旧在前、最新在后）。 */
  entries: LogEntry[]
  /** 已见身份键集合，幂等去重。 */
  seenKeys: Set<string>
  /** 单调递增序号源。 */
  nextSeq: number
  /** 是否因序列缺口冻结（进入 needsReset 后冻结，重置后重建）。 */
  frozen: boolean
}

export function createLogBuffer(): LogBufferState {
  return { entries: [], seenKeys: new Set(), nextSeq: 0, frozen: false }
}

/**
 * 稳定身份键：`streamId`+`stageId`+`phase`+`attempt`+`timestamp`。
 * 重连/回放会重发事件，相同身份键幂等忽略（D2）。timestamp 同毫秒多事件
 * 在同一 stream/stage/phase/attempt 下视为同一逻辑日志点（编译器每阶段每 attempt
 * 每相位产出的日志 timestamp 语义唯一）。
 */
export function logIdentityKey(event: RealtimeLogEvent): string {
  return [event.streamId, event.stageId, event.phase, String(event.attempt), event.timestamp].join(
    '|',
  )
}

/**
 * 客户端低敏白名单护栏投影（D4）。
 *
 * 只挑 11 个 allowlist 键构造 `LogEntry`，非白名单键（prompt/rawOutput/token/
 * secret/authorization/stackTrace/fullCode 等）一律丢弃，绝不进 DOM。
 * 即便某条事件异常携带敏感字段，渲染层也只吃到护栏后对象。
 *
 * 注：allowlist 字段集与 `RealtimeLogEvent` 契约字段完全一致，本函数是
 * 防御性纵深——即便后端脱敏失效或事件被污染，客户端也只保留白名单键。
 */
export function projectToLogEntry(
  raw: RealtimeLogEvent | Record<string, unknown>,
  seq: number,
): LogEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>

  // 白名单键逐个安全取值；类型不符的视为缺失（不渲染该字段）
  const streamId = typeof source.streamId === 'string' ? source.streamId : null
  const stageId = typeof source.stageId === 'string' ? source.stageId : null
  const phase = typeof source.phase === 'string' ? source.phase : null
  const attempt = typeof source.attempt === 'number' ? source.attempt : null
  const severity = isRealtimeLogSeverity(source.severity) ? source.severity : null
  const messageCode = typeof source.messageCode === 'string' ? source.messageCode : null
  const timestamp = typeof source.timestamp === 'string' ? source.timestamp : null

  // 必需低敏字段缺失 → 视为不可投影，丢弃整条（不落 DOM）
  if (
    !streamId ||
    !stageId ||
    !phase ||
    attempt === null ||
    !severity ||
    !messageCode ||
    !timestamp
  ) {
    return null
  }

  const entry: LogEntry = {
    streamId,
    stageId,
    phase,
    attempt,
    severity,
    messageCode,
    __seq: seq,
  } as LogEntry

  if (typeof source.count === 'number') entry.count = source.count
  if (typeof source.durationMs === 'number') entry.durationMs = source.durationMs
  if (Array.isArray(source.safeRefs)) {
    entry.safeRefs = source.safeRefs.filter((r): r is string => typeof r === 'string')
  }
  if (typeof source.hash === 'string') entry.hash = source.hash
  entry.timestamp = timestamp

  return entry
}

const REALTIME_LOG_SEVERITIES: readonly RealtimeLogSeverity[] = ['info', 'warn', 'error']

function isRealtimeLogSeverity(value: unknown): value is RealtimeLogSeverity {
  return typeof value === 'string' && (REALTIME_LOG_SEVERITIES as readonly string[]).includes(value)
}

/**
 * `messageCode → 人读标签`映射表（低敏、无自由文本，D4）。
 *
 * 后端 messageCode 为开放字符串（各 stage 自填，如 `draft.generation.failed`、
 * compiler stage 的 `data.messageCode`）。未知 code 回落原始 code 字符串
 * （仍低敏，因 messageCode 契约禁止自由文本 prompt/token/secret）。
 */
export const MESSAGE_CODE_LABELS: Record<string, string> = {
  // AI 草案
  'draft.generation.failed': '草案生成失败',
  // 通用 phase 标签（编译器 stage 常见相位）
  'stage.started': '阶段已开始',
  'stage.completed': '阶段已完成',
  'stage.failed': '阶段失败',
  'stage.retried': '阶段重试',
  'stage.skipped': '阶段跳过',
}

/** 取 messageCode 人读标签；未知 code 回落原始字符串（D4）。 */
export function resolveMessageCodeLabel(messageCode: string): string {
  return MESSAGE_CODE_LABELS[messageCode] ?? messageCode
}

/**
 * 把一条 `RealtimeLogEvent` 投影并累积进缓冲。
 *
 * - 进入 `needsReset`（序列缺口）时**冻结**缓冲，不追加越过缺口的日志（D3）
 * - 重连/回放重复事件经身份键幂等忽略（D2）
 * - 超容量上界按 FIFO 淘汰最旧（D2）
 * - 经白名单护栏投影，非白名单字段永不落 DOM（D4）
 *
 * 纯函数，零副作用：返回新 state，不改原 state。
 */
export function reduceLogBuffer(
  state: LogBufferState,
  event: RealtimeLogEvent | Record<string, unknown>,
  capacity: number = DEFAULT_LOG_BUFFER_CAPACITY,
): LogBufferState {
  // gap 冻结：不追加越过缺口的日志（D3）
  if (state.frozen) return state

  // 白名单护栏投影（D4）
  const seq = state.nextSeq
  const entry = projectToLogEntry(event, seq)
  if (!entry) return state

  // 幂等去重（D2）
  const key = logIdentityKey(entry as unknown as RealtimeLogEvent)
  if (state.seenKeys.has(key)) return state

  const entries = [...state.entries, entry]
  // FIFO 淘汰最旧，保持容量上界（D2）
  while (entries.length > capacity) {
    entries.shift()
  }

  const seenKeys = new Set(state.seenKeys)
  seenKeys.add(key)

  return {
    entries,
    seenKeys,
    nextSeq: seq + 1,
    frozen: false,
  }
}

/**
 * 标记缓冲进入冻结态（与 `StreamProjectionState.needsReset`/`SEQUENCE_GAP` 对齐，D3）。
 * 进入缺口即冻结，不追加越过缺口的日志，直到 `resetLogBuffer` 重建。
 */
export function freezeLogBuffer(state: LogBufferState): LogBufferState {
  if (state.frozen) return state
  return { ...state, frozen: true }
}

/**
 * 重建缓冲（回放/重置后调用，D3）。
 * 清空条目与已见键，解冻，恢复追加能力。
 */
export function resetLogBuffer(_state: LogBufferState): LogBufferState {
  return { entries: [], seenKeys: new Set(), nextSeq: 0, frozen: false }
}

/** allowlist 集合再导出（护栏测试断言用）。 */
export { REALTIME_LOG_ALLOWLIST_SET }
