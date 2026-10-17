/**
 * progress-streaming —— 统一流式进度事件契约（V2.5 W1 共享可见性基础）。
 *
 * 定义 StreamingProgressEnvelope 及其生命周期类型，供 AI Draft、Compiler 等
 * 长任务共享使用。本模块是前后端共享的纯 TypeScript 模块，零运行时依赖。
 *
 * # 核心设计
 * - D1：固定 envelope，领域 payload 使用判别联合
 * - D2：sequence 是单 stream 的严格单调游标，eventId 幂等
 * - D3：生命周期有限状态机（started → completed|failed|cancelled）
 * - D4：进度来源必须可证，禁止定时器伪造百分比
 * - D5：恢复用 cursor + replay + reset
 * - D6：隐私使用 allowlist，不传自由文本
 *
 * @aiproj/types 零依赖约束：不导入 zod / adonisjs / compiler-spec。
 */
import type { ContractVersion } from './contract-versioning.js'

// =============================================================================
// 1. 版本常量
// =============================================================================

/** StreamingProgressEnvelope 的当前契约版本。 */
export const STREAMING_PROGRESS_CONTRACT_VERSION = '1.0' as const

/** 事件域名常量——AI Draft */
export const DOMAIN_AI_DRAFT = 'ai-draft' as const

/** 事件域名常量——Compiler */
export const DOMAIN_COMPILER = 'compiler' as const

// =============================================================================
// 2. 事件类型判别联合
// =============================================================================

/** 共享进度事件类型。 */
export const STREAMING_EVENT_TYPES = [
  'started',
  'progress',
  'heartbeat',
  'checkpoint',
  'completed',
  'failed',
  'cancelled',
] as const
export type StreamingEventType = (typeof STREAMING_EVENT_TYPES)[number]

/** 合法终态事件类型列表。 */
export const TERMINAL_EVENT_TYPES: readonly StreamingEventType[] = [
  'completed',
  'failed',
  'cancelled',
]

/** FSM 合法转换映射：当前状态允许的下一个事件类型。 */
export const FSM_TRANSITIONS: Record<string, readonly StreamingEventType[]> = {
  // 初始态：只允许 started
  initial: ['started'],
  // started 后：progress / heartbeat / checkpoint 或直接终态
  started: ['progress', 'heartbeat', 'checkpoint', 'completed', 'failed', 'cancelled'],
  // 运行中（收到过 progress/checkpoint）：同上
  running: ['progress', 'heartbeat', 'checkpoint', 'completed', 'failed', 'cancelled'],
  // 终态：无合法转换
  completed: [],
  failed: [],
  cancelled: [],
}

/**
 * FSM 状态标识符（事件流生命周期状态，不一定是当前最后事件类型）。
 * running 表示已收到 started 后的非终态事件。
 */
export type FsmState = 'initial' | 'started' | 'running' | 'completed' | 'failed' | 'cancelled'

// =============================================================================
// 3. 领域判别联合常量
// =============================================================================

/** 已注册的领域白名单。 */
export const STREAMING_DOMAINS = ['ai-draft', 'compiler'] as const
export type StreamingDomain = (typeof STREAMING_DOMAINS)[number]

// =============================================================================
// 4. 共享 payload 接口
// =============================================================================

/**
 * 进度事件 payload —— `progress` 类型的负载。
 * 只有真实完成单位与稳定 total 同时存在时才可发 percent；
 * 否则只发 phase/count。
 */
export interface ProgressPayload {
  /** 当前阶段标识（如 "generating-tasks"、"compiling-stage-2"）。 */
  phase: string
  /** 已完成单元数（如模块数、任务数）。 */
  completedUnits?: number
  /** 总单元数（若已知且稳定）。不存在时不可提交 percent。 */
  totalUnits?: number
  /** 完成百分比 0-100。仅在 totalUnits 稳定时提交。 */
  percent?: number
  /**
   * 消息代码（前端根据 locale 映射为面向用户的文案）。
   * 非自由文本——必须是 allowlist 中或已审查的 code。
   */
  messageCode?: string
}

/**
 * Checkpoint 事件 payload。
 */
export interface CheckpointPayload {
  /** 可恢复的位置标识。 */
  checkpointId: string
  /** 已完成的工作摘要。 */
  summary: string
}

/**
 * Completed 事件 payload。
 */
export interface CompletedPayload {
  /** 结果标识。 */
  resultId?: string
  /** 完成摘要。 */
  summary?: string
}

/**
 * Failed 事件 payload。
 */
export interface FailedPayload {
  /** 错误代码（枚举值，禁止自由文本 prompt/rawOutput/stackTrace）。 */
  errorCode: string
  /** 错误消息代码（前端根据 locale 映射）。 */
  messageCode?: string
  /** 发生失败的阶段标识（可选）。 */
  stage?: string
  /** 稳定原因代码（可选）。 */
  reasonCode?: string
  /** 脱敏错误明细（可选）。 */
  errors?: Array<{ path?: string; message: string; code?: string }>
}

/**
 * Cancelled 事件 payload。
 */
export interface CancelledPayload {
  /** 取消原因代码。 */
  reasonCode?: string
}

// =============================================================================
// 5. 领域扩展 payload 接口
// =============================================================================

/**
 * AI Draft 领域扩展——在 `progress` 事件中携带模块级进度。
 * 当 envelope.domain === 'ai-draft' 且 type === 'progress' 时适用。
 */
export interface AiDraftProgressExtension {
  /** 当前生成的模块标识。 */
  module: string
  /** 模块状态。 */
  moduleStatus: 'pending' | 'generating' | 'completed' | 'failed'
}

/**
 * Compiler 领域扩展——在 `progress` 事件中携带 Stage 级进度。
 * 当 envelope.domain === 'compiler' 且 type === 'progress' 时适用。
 */
export interface CompilerProgressExtension {
  /** 当前阶段标识。 */
  stageId: string
  /** 阶段尝试次数。 */
  attempt: number
  /** 错误代码（仅失败时）。 */
  errorCode?: string
}

/**
 * AI Draft 领域扩展联合——envelope.domain 判别后使用。
 * 当 domain === 'ai-draft' 时，payload 可携带此扩展。
 */
export interface AiDraftDomainPayload {
  domain: typeof DOMAIN_AI_DRAFT
  /** 草案 ID。 */
  draftId: string
  /** 模块级进度扩展（可选）。 */
  progress?: AiDraftProgressExtension
}

/**
 * Compiler 领域扩展联合——envelope.domain 判别后使用。
 * 当 domain === 'compiler' 时，payload 可携带此扩展。
 */
export interface CompilerDomainPayload {
  domain: typeof DOMAIN_COMPILER
  /** Compiler run ID。 */
  runId: string
  /** Stage 级进度扩展（可选）。 */
  progress?: CompilerProgressExtension
}

/** 领域扩展联合。 */
export type DomainPayload = AiDraftDomainPayload | CompilerDomainPayload

// =============================================================================
// 6. Envelope 类型
// =============================================================================

/**
 * 流式进度事件信封——所有长任务进度事件的共享外壳。
 *
 * 核心字段说明：
 * - contractVersion：本信封的契约版本（当前 "1.0"），消费者据此判断兼容性。
 * - eventId：生产者分配的全局唯一事件 ID，用于幂等去重。
 * - streamId：逻辑流标识（如 AI Draft 生成会话的 streamId）。
 * - domain：领域标识（"ai-draft" / "compiler"），决定 payload 类型。
 * - sequence：单 stream 内严格递增序号，从 1 开始。
 * - occurredAt：事件发生时间 ISO-8601 字符串。
 * - type：事件类型（started/progress/heartbeat/checkpoint/completed/failed/cancelled）。
 * - correlationId：关联 ID（可选，用于连接上下游请求）。
 * - payload：类型相关负载，按 domain + type 判别。
 * - _domainPayload：领域扩展（可选），按 domain 判别。
 */
export interface StreamingProgressEnvelope {
  contractVersion: ContractVersion
  eventId: string
  streamId: string
  domain: StreamingDomain
  sequence: number
  occurredAt: string
  type: StreamingEventType
  correlationId?: string
  payload: ProgressPayload | CheckpointPayload | CompletedPayload | FailedPayload | CancelledPayload
  _domainPayload?: DomainPayload
}

// =============================================================================
// 7. 序列/幂等 Reducer 类型
// =============================================================================

/** Reducer 处理结果。 */
export interface ReduceResult {
  /** 该事件是否被应用（false = 重复/忽略）。 */
  applied: boolean
  /** 更新后的 FSM 状态。 */
  state: FsmState
  /** 若为 gap 事件（sequence 跳跃），标记需要回放。 */
  needsReplay: boolean
  /** 契约冲突时（同 sequence 不同 eventId），需要刷新快照。 */
  needsReset: boolean
  /** 错误信息（非终态时可选）。 */
  error?: string
}

/** 给定 stream 的 reducer 持久化状态。 */
export interface StreamState {
  streamId: string
  lastSequence: number
  lastEventId: string
  fsmState: FsmState
  /** 已见 eventId 集合（用于幂等检测）。保留最近 N 个。 */
  seenEventIds: string[]
  /** 最后语义进度时间（heartbeat 不更新此字段）。 */
  lastSemanticProgressAt: string | null
  /** 最后心跳时间。 */
  lastHeartbeatAt: string | null
}

// =============================================================================
// 8. Cursor 类型
// =============================================================================

/** 消费者端保存的恢复游标。 */
export interface ProgressCursor {
  streamId: string
  lastSequence: number
  contractVersion: ContractVersion
}

/** 回放响应结果类型。 */
export interface ReplayResponse {
  /** 回放成功的事件列表。 */
  events: StreamingProgressEnvelope[]
  /** 是否因 retention 过期或版本不兼容需要重置。 */
  resetRequired: boolean
  /** 重置指引（resetRequired 为 true 时提供）。 */
  resetMessage?: string
}

/** 重置要求（retention 过期或版本不兼容时的响应）。 */
export interface ResetRequired {
  streamId: string
  reason: 'retention_expired' | 'unsupported_version' | 'contract_conflict'
  message: string
}

// =============================================================================
// 9. 进度 validator 类型
// =============================================================================

/** 进度验证结果。 */
export interface ProgressValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

// =============================================================================
// 10. 敏感字段 allowlist
// =============================================================================

/**
 * Payload allowlist——枚举允许出现在 payload 中的字段路径。
 * 用于事件审计或序列化前过滤。
 */
export const PAYLOAD_ALLOWLIST_FIELDS = [
  'phase',
  'completedUnits',
  'totalUnits',
  'percent',
  'messageCode',
  'checkpointId',
  'summary',
  'resultId',
  'errorCode',
  'reasonCode',
  // domain extension fields
  'module',
  'moduleStatus',
  'stageId',
  'attempt',
] as const

/** Allowlist 中的字段路径集合（Set 用于快速查找）。 */
export const PAYLOAD_ALLOWLIST_SET = new Set<string>(PAYLOAD_ALLOWLIST_FIELDS)

/** 禁止出现在任何事件字段中的敏感内容模式。 */
export const FORBIDDEN_PATTERNS = [
  /prompt/i,
  /rawOutput/i,
  /raw_output/i,
  /token/i,
  /secret/i,
  /stackTrace/i,
  /stack_trace/i,
  /api[_-]?key/i,
  /password/i,
  /credential/i,
  /privateKey/i,
  /private_key/i,
] as const

// =============================================================================
// 11. Fixture 辅助函数
// =============================================================================

/**
 * 创建 AI Draft fixture 事件序列——模拟从 started 到 completed 的完整流程。
 * 不改变任何人工确认状态。
 */
export function createAiDraftProgressFixtures(
  streamId: string,
  modules: string[],
): StreamingProgressEnvelope[] {
  const now = new Date().toISOString()
  const events: StreamingProgressEnvelope[] = []

  // started
  events.push({
    contractVersion: STREAMING_PROGRESS_CONTRACT_VERSION,
    eventId: `${streamId}-start`,
    streamId,
    domain: 'ai-draft',
    sequence: 1,
    occurredAt: now,
    type: 'started',
    payload: {},
  })

  // progress per module
  let seq = 2
  for (let i = 0; i < modules.length; i++) {
    events.push({
      contractVersion: STREAMING_PROGRESS_CONTRACT_VERSION,
      eventId: `${streamId}-progress-${i}`,
      streamId,
      domain: 'ai-draft',
      sequence: seq++,
      occurredAt: now,
      type: 'progress',
      payload: {
        phase: modules[i]!,
        completedUnits: i + 1,
        totalUnits: modules.length,
        percent: Math.round(((i + 1) / modules.length) * 100),
      },
      _domainPayload: {
        domain: 'ai-draft',
        draftId: streamId,
        progress: {
          module: modules[i]!,
          moduleStatus: 'completed',
        },
      },
    })
  }

  // completed
  events.push({
    contractVersion: STREAMING_PROGRESS_CONTRACT_VERSION,
    eventId: `${streamId}-completed`,
    streamId,
    domain: 'ai-draft',
    sequence: seq++,
    occurredAt: now,
    type: 'completed',
    payload: {
      summary: `All ${modules.length} modules completed`,
    },
  })

  return events
}

/**
 * 创建 Compiler fixture 事件序列——模拟 stage 级进度。
 * 不泄露输入包。
 */
export function createCompilerProgressFixtures(
  streamId: string,
  stages: string[],
  failAtIndex?: number,
): StreamingProgressEnvelope[] {
  const now = new Date().toISOString()
  const events: StreamingProgressEnvelope[] = []

  // started
  events.push({
    contractVersion: STREAMING_PROGRESS_CONTRACT_VERSION,
    eventId: `${streamId}-start`,
    streamId,
    domain: 'compiler',
    sequence: 1,
    occurredAt: now,
    type: 'started',
    payload: {},
  })

  // progress per stage
  let seq = 2
  for (let i = 0; i < stages.length; i++) {
    const isFailed = failAtIndex !== undefined && i === failAtIndex

    events.push({
      contractVersion: STREAMING_PROGRESS_CONTRACT_VERSION,
      eventId: `${streamId}-stage-${i}`,
      streamId,
      domain: 'compiler',
      sequence: seq++,
      occurredAt: now,
      type: isFailed ? 'failed' : 'progress',
      payload: isFailed
        ? { errorCode: 'STAGE_FAILED', messageCode: 'compiler.stage.error.generic' }
        : {
            phase: stages[i]!,
            completedUnits: i + 1,
            totalUnits: stages.length,
          },
      _domainPayload: {
        domain: 'compiler',
        runId: streamId,
        progress: {
          stageId: stages[i]!,
          attempt: 1,
          errorCode: isFailed ? 'STAGE_FAILED' : undefined,
        },
      },
    })
  }

  // terminal
  if (failAtIndex === undefined) {
    events.push({
      contractVersion: STREAMING_PROGRESS_CONTRACT_VERSION,
      eventId: `${streamId}-completed`,
      streamId,
      domain: 'compiler',
      sequence: seq++,
      occurredAt: now,
      type: 'completed',
      payload: { summary: `All ${stages.length} stages completed` },
    })
  }

  return events
}

// =============================================================================
// 12. Reducer 实现
// =============================================================================

/**
 * 创建初始 StreamState。
 */
export function createInitialStreamState(streamId: string): StreamState {
  return {
    streamId,
    lastSequence: 0,
    lastEventId: '',
    fsmState: 'initial',
    seenEventIds: [],
    lastSemanticProgressAt: null,
    lastHeartbeatAt: null,
  }
}

/** 已见 eventId 集合的最大保留数。 */
export const MAX_SEEN_EVENT_IDS = 100

/**
 * 处理单个 StreamingProgressEnvelope 并返回 ReduceResult。
 *
 * 规则：
 * - eventId 已见：忽略（幂等）
 * - sequence <= lastSequence 但 eventId 未见：契约冲突，需 reset
 * - sequence > lastSequence + 1：标记 gap，需回放
 * - 终态后收到业务事件：忽略
 * - 重复终态：幂等忽略
 * - 不同终态冲突：错误
 * - heartbeat 不更新 lastSemanticProgressAt
 */
export function reduceProgressEvent(
  state: StreamState,
  event: StreamingProgressEnvelope,
): ReduceResult {
  // ── eventId 幂等检测 ───────────────────────────────
  if (state.seenEventIds.includes(event.eventId)) {
    return {
      applied: false,
      state: state.fsmState,
      needsReplay: false,
      needsReset: false,
    }
  }

  // ── 同 sequence 不同 eventId 检测 ───────────────────
  if (
    event.sequence <= state.lastSequence &&
    event.sequence > 0 &&
    event.eventId !== state.lastEventId
  ) {
    return {
      applied: false,
      state: state.fsmState,
      needsReplay: false,
      needsReset: true,
      error: `Contract conflict: sequence ${event.sequence} already has eventId ${state.lastEventId}, got ${event.eventId}`,
    }
  }

  // ── sequence gap 检测 ──────────────────────────────
  const needsReplay = event.sequence > state.lastSequence + 1 && state.lastSequence > 0

  // ── 终态检测 ───────────────────────────────────────
  const isTerminal = (TERMINAL_EVENT_TYPES as readonly string[]).includes(event.type)

  if (isTerminal && state.fsmState === event.type) {
    // 重复同一终态：幂等忽略
    return {
      applied: false,
      state: state.fsmState,
      needsReplay: false,
      needsReset: false,
    }
  }

  if (
    (state.fsmState === 'completed' ||
      state.fsmState === 'failed' ||
      state.fsmState === 'cancelled') &&
    isTerminal &&
    state.fsmState !== event.type
  ) {
    // 不同终态冲突
    return {
      applied: false,
      state: state.fsmState,
      needsReplay: false,
      needsReset: true,
      error: `Terminal state conflict: stream already in state "${state.fsmState}", got event type "${event.type}"`,
    }
  }

  if (
    state.fsmState === 'completed' ||
    state.fsmState === 'failed' ||
    state.fsmState === 'cancelled'
  ) {
    // 终态后忽略任何其他事件
    return {
      applied: false,
      state: state.fsmState,
      needsReplay: false,
      needsReset: false,
    }
  }

  // ── FSM 转换合法性检测 ────────────────────────────
  const allowedTransitions = FSM_TRANSITIONS[state.fsmState]
  if (allowedTransitions && !allowedTransitions.includes(event.type)) {
    return {
      applied: false,
      state: state.fsmState,
      needsReplay: false,
      needsReset: true,
      error: `Invalid transition from state "${state.fsmState}" with event type "${event.type}"`,
    }
  }

  // ── 应用事件 ───────────────────────────────────────
  let newFsmState: FsmState = state.fsmState
  if (isTerminal) {
    newFsmState = event.type as FsmState
  } else if (state.fsmState === 'initial' && event.type === 'started') {
    newFsmState = 'started'
  } else if (state.fsmState === 'started' && event.type !== 'started' && !isTerminal) {
    newFsmState = 'running'
  }
  // running 保持 running

  const isHeartbeat = event.type === 'heartbeat'
  const isSemantic =
    event.type === 'progress' || event.type === 'checkpoint' || event.type === 'started'

  return {
    applied: true,
    state: newFsmState,
    needsReplay,
    needsReset: false,
    ...{
      lastSemanticProgressAt: isSemantic ? event.occurredAt : state.lastSemanticProgressAt,
      lastHeartbeatAt: isHeartbeat ? event.occurredAt : state.lastHeartbeatAt,
    },
    // Return the updated state fields as overrides
  }
}

/**
 * 对一批事件按 sequence 排序后依次 reduce。
 * 用于回放场景：同一批事件通过 reducer 幂等收敛。
 */
export function reduceEventBatch(
  initial: StreamState,
  events: StreamingProgressEnvelope[],
): { finalState: StreamState; results: ReduceResult[] } {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence)
  let currentState = { ...initial, seenEventIds: [...initial.seenEventIds] }
  const results: ReduceResult[] = []

  for (const event of sorted) {
    const result = reduceProgressEvent(currentState, event)
    results.push(result)

    if (result.applied) {
      currentState = {
        ...currentState,
        lastSequence: event.sequence,
        lastEventId: event.eventId,
        fsmState: result.state,
        seenEventIds: [...currentState.seenEventIds, event.eventId].slice(-MAX_SEEN_EVENT_IDS),
        lastSemanticProgressAt:
          event.type === 'progress' || event.type === 'checkpoint' || event.type === 'started'
            ? event.occurredAt
            : currentState.lastSemanticProgressAt,
        lastHeartbeatAt:
          event.type === 'heartbeat' ? event.occurredAt : currentState.lastHeartbeatAt,
      }
    }
  }

  return { finalState: currentState, results }
}

// =============================================================================
// 13. Progress 验证
// =============================================================================

/**
 * 验证 progress payload 的一致性。
 *
 * 规则：
 * - percent 必须为 0-100 整数（如果存在）
 * - completedUnits 不能超过 totalUnits
 * - percent 不能倒退（通过 previousPercent 判断）
 * - totalUnits 不可变（一旦设置，后续事件必须一致）
 * - 无 totalUnits 时禁止 percent
 */
export function validateProgress(
  payload: ProgressPayload,
  previousPercent?: number,
  previousTotalUnits?: number,
): ProgressValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // ── percent ───────────────────────────────────────
  if (payload.percent !== undefined) {
    if (!Number.isInteger(payload.percent) || payload.percent < 0 || payload.percent > 100) {
      errors.push(`percent must be an integer 0-100, got ${payload.percent}`)
    }

    // 无 totalUnits 时禁止 percent
    if (payload.totalUnits === undefined && payload.percent > 0) {
      errors.push('percent requires stable totalUnits')
    }

    // 不能倒退
    if (previousPercent !== undefined && payload.percent < previousPercent) {
      errors.push(`percent cannot regress: ${previousPercent} -> ${payload.percent}`)
    }
  }

  // ── totalUnits ────────────────────────────────────
  if (payload.totalUnits !== undefined) {
    if (previousTotalUnits !== undefined && payload.totalUnits !== previousTotalUnits) {
      errors.push(
        `totalUnits changed from ${previousTotalUnits} to ${payload.totalUnits}; totalUnits must be stable once set`,
      )
    }
  }

  // ── phase ─────────────────────────────────────────
  if (!payload.phase || payload.phase.trim().length === 0) {
    errors.push('phase is required in progress payload')
  }

  // ── completedUnits ────────────────────────────────
  if (payload.completedUnits !== undefined && payload.totalUnits !== undefined) {
    if (payload.completedUnits > payload.totalUnits) {
      errors.push(
        `completedUnits (${payload.completedUnits}) exceeds totalUnits (${payload.totalUnits})`,
      )
    }
  }

  // ── completedUnits 不能倒退 ─────────────────────
  // （由调用方通过 previousCompletedUnits 检查，此处不做）

  return { valid: errors.length === 0, errors, warnings }
}

// =============================================================================
// 14. 敏感信息检测
// =============================================================================

/**
 * 检查对象是否包含禁止的字段名（prompt/rawOutput/token/secret/stackTrace 等）。
 * 递归检查嵌套对象的键名。
 */
export function containsForbiddenFields(
  obj: Record<string, unknown>,
  depth = 0,
): { found: boolean; fieldPath?: string } {
  if (depth > 5) return { found: false }

  for (const key of Object.keys(obj)) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(key)) {
        return { found: true, fieldPath: key }
      }
    }

    const value = obj[key]
    if (
      value !== null &&
      value !== undefined &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      const nested = containsForbiddenFields(value as Record<string, unknown>, depth + 1)
      if (nested.found) {
        return { found: true, fieldPath: `${key}.${nested.fieldPath}` }
      }
    }
  }

  return { found: false }
}

/**
 * 检查事件 envelope 中的所有字段，确保不包含敏感信息。
 */
export function validateEventSafety(event: StreamingProgressEnvelope): {
  safe: boolean
  issues: string[]
} {
  const issues: string[] = []

  // 检查 payload 字段名
  const payloadCheck = containsForbiddenFields(event.payload as Record<string, unknown>)
  if (payloadCheck.found) {
    issues.push(`Forbidden field in payload: ${payloadCheck.fieldPath}`)
  }

  // 检查 eventId（不应包含敏感数据）
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(event.eventId)) {
      issues.push(`Forbidden pattern in eventId`)
    }
  }

  // 检查 streamId（不应包含敏感数据）
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(event.streamId)) {
      issues.push(`Forbidden pattern in streamId`)
    }
  }

  return { safe: issues.length === 0, issues }
}

/**
 * WebSocket 交付元数据允许的字段名——仅用于 ack/cursor/delivery 相关字段。
 */
export const WS_DELIVERY_ALLOWLIST_FIELDS = [
  'ackSequence',
  'ackStatus',
  'transport',
  'latencyMs',
  'deliveredAt',
] as const

/** WS 交付元数据 allowlist 集合。 */
export const WS_DELIVERY_ALLOWLIST_SET = new Set<string>(WS_DELIVERY_ALLOWLIST_FIELDS)

/**
 * 检查 WebSocket 交付元数据是否包含禁止字段。
 */
export function validateWsDeliveryMetadata(metadata: Record<string, unknown>): {
  safe: boolean
  issues: string[]
} {
  const issues: string[] = []
  for (const key of Object.keys(metadata)) {
    if (!WS_DELIVERY_ALLOWLIST_SET.has(key)) {
      const isForbidden = FORBIDDEN_PATTERNS.some((pattern) => pattern.test(key))
      if (isForbidden) {
        issues.push(`Forbidden WebSocket delivery metadata field: ${key}`)
      }
    }
  }
  // 检查值中是否含敏感内容
  const payloadCheck = containsForbiddenFields(metadata)
  if (payloadCheck.found) {
    issues.push(`Forbidden content in WebSocket delivery metadata: ${payloadCheck.fieldPath}`)
  }
  return { safe: issues.length === 0, issues }
}

/**
 * 实时日志事件允许的字段名——枚举低敏日志中允许出现的字段。
 */
export const REALTIME_LOG_ALLOWLIST_FIELDS = [
  'streamId',
  'stageId',
  'phase',
  'attempt',
  'severity',
  'messageCode',
  'count',
  'durationMs',
  'safeRefs',
  'hash',
  'timestamp',
] as const

/** 实时日志 allowlist 集合。 */
export const REALTIME_LOG_ALLOWLIST_SET = new Set<string>(REALTIME_LOG_ALLOWLIST_FIELDS)

/**
 * 检查实时日志事件的字段是否符合 allowlist 且不包含敏感内容。
 * 日志中禁止出现 prompt、rawOutput、token、secret、authorization、stackTrace、full code candidate。
 */
export function validateRealtimeLogEvent(logEvent: Record<string, unknown>): {
  safe: boolean
  issues: string[]
} {
  const issues: string[] = []

  // 检查所有字段名都在 allowlist 中
  for (const key of Object.keys(logEvent)) {
    if (!REALTIME_LOG_ALLOWLIST_SET.has(key)) {
      issues.push(`Field "${key}" is not in realtime log allowlist`)
    }
  }

  // 检查值中是否含敏感内容
  const valueCheck = containsForbiddenFields(logEvent)
  if (valueCheck.found) {
    issues.push(`Forbidden content in realtime log: ${valueCheck.fieldPath}`)
  }

  return { safe: issues.length === 0, issues }
}
