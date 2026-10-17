/**
 * v2-5-streaming-timeout-and-stall-recovery
 * PRD alias: v2-5-streaming-resume-timeout-heartbeat
 *
 * 本 change 中「resume」限定为 stream/cursor/replay/status 级断线恢复，
 * 不指 Compiler checkpoint resume/replay（归 v2-5-compiler-resume-replay-wiring）。
 * 不实现 PRD 原版 WebSocket client:resume/client:heartbeat 双向协议，
 * 若未来要恢复该协议，必须另提协议迁移 change。
 */

import {
  PROJECT_DRAFT_MODULES,
  type ProgressPhase,
  type ProjectDraftModule,
  type ProjectDraftModuleStatus,
  type ProjectDraftStreamEvent,
} from '@aiproj/types'
import type {
  StreamingProgressEnvelope,
  AiDraftDomainPayload,
  AiDraftProgressExtension,
  ContractVersion,
  ReplayResponse,
} from '@aiproj/types'
import { computeLinearEta, isEtaAvailable, type EtaConfidence } from '@/lib/realtime/eta-estimator'
import { formatEta } from '@/lib/realtime/format-eta'

// =============================================================================
// D1：客户端可解释状态机 —— 不把"慢"当失败
// =============================================================================

export type DraftProgressConnection =
  'idle' | 'connecting' | 'live' | 'recovering' | 'closed' | 'failed'

/**
 * 超时/停滞健康状态（独立于 connection，描述进度流的语义健康程度）。
 * healthy：正常推进；
 * long_running：耗时较长但 heartbeat 仍存活；
 * stale：heartbeat 超过阈值未到；
 * reconnecting：Transport 层正在重连；
 * fallback_status：正在通过 REST snapshot/detail 查询状态；
 * failed：不可恢复失败；
 * user_retry_required：需要用户显式触发重试。
 */
export type DraftProgressHealthState =
  | 'healthy'
  | 'long_running'
  | 'stale'
  | 'reconnecting'
  | 'fallback_status'
  | 'failed'
  | 'user_retry_required'

// =============================================================================
// D2：默认阈值常量（D1 命名常量，允许 apply 阶段按实测微调）
// =============================================================================

export const DEFAULT_HEARTBEAT_CADENCE_MS = 5_000
export const DEFAULT_LONG_RUNNING_MS = 30_000
/** heartbeat 超过 STALE_HEARTBEAT_MISSES 个周期判定 stale */
export const STALE_HEARTBEAT_MISSES = 3
export const DEFAULT_STALE_MS = DEFAULT_HEARTBEAT_CADENCE_MS * STALE_HEARTBEAT_MISSES
/** 最大重连尝试次数 */
export const DEFAULT_MAX_RECONNECT_ATTEMPTS = 3
/** 单次 reconnect backoff 上限 */
export const DEFAULT_RECONNECT_BACKOFF_MAX_MS = 10_000
/** Status/replay 请求超时 */
export const DEFAULT_STATUS_TIMEOUT_MS = 10_000
/** Runner TTL（沿用 transport 15 分钟量级） */
export const DEFAULT_RUNNER_TTL_MS = 15 * 60 * 1000

export interface StallThresholds {
  heartbeatCadenceMs: number
  longRunningMs: number
  staleMs: number
  maxReconnectAttempts: number
  reconnectBackoffMaxMs: number
  statusTimeoutMs: number
  runnerTtlMs: number
}

export const DEFAULT_STALL_THRESHOLDS: StallThresholds = {
  heartbeatCadenceMs: DEFAULT_HEARTBEAT_CADENCE_MS,
  longRunningMs: DEFAULT_LONG_RUNNING_MS,
  staleMs: DEFAULT_STALE_MS,
  maxReconnectAttempts: DEFAULT_MAX_RECONNECT_ATTEMPTS,
  reconnectBackoffMaxMs: DEFAULT_RECONNECT_BACKOFF_MAX_MS,
  statusTimeoutMs: DEFAULT_STATUS_TIMEOUT_MS,
  runnerTtlMs: DEFAULT_RUNNER_TTL_MS,
}

// =============================================================================
// D3：稳定低敏 reason/message code 枚举
// =============================================================================

/**
 * 流式进度 reason code —— 低敏稳定枚举。
 * 不含 prompt/rawOutput/token/secret/stackTrace/organizationId/userId/draftId。
 */
export const REASON_CODES = [
  'STREAM_LONG_RUNNING',
  'STREAM_HEARTBEAT_STALE',
  'STREAM_RECONNECTING',
  'STREAM_REPLAY_RESET_REQUIRED',
  'STREAM_RETENTION_MISS',
  'STREAM_CONTRACT_INCOMPATIBLE',
  'STREAM_PROVIDER_TIMEOUT',
  'STREAM_PROXY_TIMEOUT',
  'STREAM_STATUS_UNAVAILABLE',
  'STREAM_ORPHANED_RUNNER',
  'STREAM_UPSTREAM_FAILED',
  'STREAM_USER_RETRY_REQUIRED',
] as const
export type ReasonCode = (typeof REASON_CODES)[number]

export type DraftProgressTerminal = 'none' | 'completed' | 'failed'

// =============================================================================
// D2b：健康状态计算
// =============================================================================

/**
 * 根据投影当前状态和时间戳计算健康状态（D1 客户端可解释状态机）。
 * 任意 SSE 活动（heartbeat 或语义事件）仍新鲜 → healthy/long_running
 * 所有 SSE 活动都超过 staleMs 未到 → stale
 * 连接已断开且终端为 none → reconnecting/fallback_status
 */
export function computeHealthState(
  now: number,
  connection: DraftProgressConnection,
  terminal: DraftProgressTerminal,
  lastSemanticProgressAt: number | null,
  lastHeartbeatReceivedAt: number | null,
  elapsedMs: number,
  thresholds: StallThresholds,
  _reconnectAttempt: number,
  retryRequired: boolean,
): DraftProgressHealthState {
  // terminal failed → user needs to retry
  if (terminal === 'failed') return 'user_retry_required'
  // terminal completed → all good
  if (terminal === 'completed') return 'healthy'

  // 重试需要用户操作
  if (retryRequired) return 'user_retry_required'

  // 连接相关状态
  if (connection === 'connecting') return 'reconnecting'

  // 非活跃连接 → fallback
  if (connection !== 'live' && connection !== 'closed') {
    return 'fallback_status'
  }

  // 语义事件与 heartbeat 都证明传输仍然存活。只看 heartbeat 会在模型持续输出
  // 语义 chunk、因而无需额外 heartbeat 时把健康连接误报为 stale。
  const lastTransportActivity = Math.max(
    lastSemanticProgressAt ?? Number.NEGATIVE_INFINITY,
    lastHeartbeatReceivedAt ?? Number.NEGATIVE_INFINITY,
  )
  if (Number.isFinite(lastTransportActivity)) {
    const timeSinceLastActivity = now - lastTransportActivity
    if (timeSinceLastActivity > thresholds.staleMs) {
      return 'stale'
    }
  }

  // 语义进度超过 longRunningMs → long_running
  if (elapsedMs > thresholds.longRunningMs) {
    return 'long_running'
  }

  return 'healthy'
}

/**
 * 包装投影结果，自动计算 healthState 和 reasonCode。
 */
export function withHealthState(
  state: DraftProgressProjection,
  now?: number,
): DraftProgressProjection {
  const currentTime = now ?? Date.now()
  const healthState = computeHealthState(
    currentTime,
    state.connection,
    state.terminal,
    state.lastSemanticProgressAt,
    state.lastHeartbeatReceivedAt,
    state.elapsedMs,
    state.thresholds,
    state.reconnectAttempt,
    state.retryRequired,
  )
  const reasonCode = deriveReasonCode(
    healthState,
    state.connection,
    state.terminal,
    state.reasonCode,
  )
  return { ...state, healthState, reasonCode }
}

/**
 * 从健康状态派生低敏 reason code。
 */
export function deriveReasonCode(
  healthState: DraftProgressHealthState,
  connection: DraftProgressConnection,
  terminal: DraftProgressTerminal,
  currentReason: ReasonCode | null,
): ReasonCode | null {
  if (terminal === 'failed') {
    return currentReason ?? 'STREAM_UPSTREAM_FAILED'
  }
  switch (healthState) {
    case 'long_running':
      return 'STREAM_LONG_RUNNING'
    case 'stale':
      return 'STREAM_HEARTBEAT_STALE'
    case 'reconnecting':
      return 'STREAM_RECONNECTING'
    case 'fallback_status':
      // recovering → actively trying to reconnect
      if (connection === 'recovering') return 'STREAM_RECONNECTING'
      return 'STREAM_STATUS_UNAVAILABLE'
    case 'user_retry_required':
      return currentReason ?? 'STREAM_USER_RETRY_REQUIRED'
    case 'failed':
      return currentReason ?? 'STREAM_UPSTREAM_FAILED'
    case 'healthy':
      return null
  }
}

export interface DraftProgressRecovery {
  state: 'none' | 'gap' | 'replaying'
  expectedSequence: number | null
  targetSequence: number | null
}

export interface DraftProgressProjection {
  draftId: string | null
  version: number
  connection: DraftProgressConnection
  phase: ProgressPhase | null
  modules: Record<ProjectDraftModule, ProjectDraftModuleStatus>
  lastSequence: number
  lastEventAt: number | null
  /** 最后语义事件时间（heartbeat 不更新此字段）。 */
  lastSemanticProgressAt: number | null
  lastHeartbeatAt: number | null
  lastHeartbeatReceivedAt: number | null
  elapsedMs: number
  recovery: DraftProgressRecovery
  terminal: DraftProgressTerminal
  preparingReview: boolean
  retryRequired: boolean
  errorCode: string | null
  errorMessage: string | null
  /** 当前使用的契约版本（记录来源，用于兼容判断）。 */
  contractVersion: ContractVersion | null
  // ── V2.5 timeout/stall recovery fields ─────────────────────────────────
  /** 超时/停滞健康状态。 */
  healthState: DraftProgressHealthState
  /** 当前生效的阈值配置。 */
  thresholds: StallThresholds
  /** 稳定低敏 reason code。 */
  reasonCode: ReasonCode | null
  /** 当前重连尝试次数。 */
  reconnectAttempt: number
  /** 上次终端状态检查时间戳。 */
  lastStatusCheckAt: number | null
}

export type DraftProgressAction =
  | { kind: 'transport.connecting' }
  | { kind: 'transport.live' }
  | { kind: 'transport.disconnected'; message?: string }
  | { kind: 'transport.replaying' }
  | { kind: 'transport.reset'; draftId?: string | null; version?: number; lastSequence?: number }
  | { kind: 'review.ready' }
  | { kind: 'event'; event: ProjectDraftStreamEvent; receivedAt?: number }
  /** 来自 StreamingProgressEnvelope 的规范化事件。 */
  | { kind: 'envelope'; envelope: StreamingProgressEnvelope; receivedAt?: number }
  /** 契约不兼容时要求重置（reset-required 路径）。 */
  | { kind: 'contract.incompatible'; message: string; contractVersion?: string }

function emptyModules(): Record<ProjectDraftModule, ProjectDraftModuleStatus> {
  return Object.fromEntries(PROJECT_DRAFT_MODULES.map((module) => [module, 'pending'])) as Record<
    ProjectDraftModule,
    ProjectDraftModuleStatus
  >
}

export function createDraftProgressProjection(
  seed: Partial<
    Pick<DraftProgressProjection, 'draftId' | 'version' | 'lastSequence' | 'connection'>
  > = {},
): DraftProgressProjection {
  return {
    draftId: seed.draftId ?? null,
    version: seed.version ?? 0,
    connection: seed.connection ?? 'idle',
    phase: null,
    modules: emptyModules(),
    lastSequence: seed.lastSequence ?? 0,
    lastEventAt: null,
    lastSemanticProgressAt: null,
    lastHeartbeatAt: null,
    lastHeartbeatReceivedAt: null,
    elapsedMs: 0,
    recovery: { state: 'none', expectedSequence: null, targetSequence: null },
    terminal: 'none',
    preparingReview: false,
    retryRequired: false,
    errorCode: null,
    errorMessage: null,
    contractVersion: null,
    healthState: 'healthy',
    thresholds: { ...DEFAULT_STALL_THRESHOLDS },
    reasonCode: null,
    reconnectAttempt: 0,
    lastStatusCheckAt: null,
  }
}

function applySemanticEvent(
  state: DraftProgressProjection,
  event: Exclude<
    ProjectDraftStreamEvent,
    { type: 'draft.heartbeat' } | { type: 'generation.output' }
  >,
  receivedAt: number,
): DraftProgressProjection {
  const isNewVersion = event.version > state.version
  const base: DraftProgressProjection = {
    ...state,
    draftId: event.draftId,
    version: Math.max(state.version, event.version),
    connection: 'live',
    lastSequence: event.sequence,
    lastEventAt: receivedAt,
    lastSemanticProgressAt: receivedAt,
    retryRequired: false,
  }

  if (event.type === 'draft.started') {
    return {
      ...base,
      modules: isNewVersion ? emptyModules() : base.modules,
      phase: null,
      terminal: 'none',
      preparingReview: false,
      errorCode: null,
      errorMessage: null,
    }
  }

  if (state.terminal !== 'none') return state

  if (event.type === 'module.delta') {
    const current = state.modules[event.module]
    if (current === 'completed') return base
    const nextStatus =
      event.status === 'failed'
        ? 'failed'
        : event.status === 'completed'
          ? 'completed'
          : 'generating'
    return { ...base, modules: { ...state.modules, [event.module]: nextStatus } }
  }

  if (event.type === 'module.completed') {
    return { ...base, modules: { ...state.modules, [event.module]: 'completed' } }
  }

  if (event.type === 'draft.progress') {
    return { ...base, phase: event.phase }
  }

  if (event.type === 'validation.warning') return base

  if (event.type === 'draft.completed') {
    return {
      ...base,
      connection: 'closed',
      phase: 'persisting',
      modules: Object.fromEntries(
        PROJECT_DRAFT_MODULES.map((module) => [module, 'completed']),
      ) as Record<ProjectDraftModule, ProjectDraftModuleStatus>,
      terminal: 'completed',
      preparingReview: true,
    }
  }

  const failedModules = Object.fromEntries(
    PROJECT_DRAFT_MODULES.map((module) => [
      module,
      state.modules[module] === 'generating' ? 'failed' : state.modules[module],
    ]),
  ) as Record<ProjectDraftModule, ProjectDraftModuleStatus>
  return {
    ...base,
    connection: 'failed',
    modules: failedModules,
    terminal: 'failed',
    retryRequired: true,
    errorCode: event.errorCode,
    errorMessage: event.message,
  }
}

// ─────────────────────────────────────────────────────────────
// StreamingProgressEnvelope 适配器
// ─────────────────────────────────────────────────────────────

/** 当前前端支持的 AI Draft envelope 契约 major 版本。 */
export const SUPPORTED_CONTRACT_MAJOR = 1

/**
 * 检查 envelope 的契约版本是否兼容（major 相同即视为兼容）。
 */
export function isContractCompatible(version: string): { compatible: boolean; major: number } {
  const major = Number(version.split('.')[0]) || 0
  return { compatible: major === SUPPORTED_CONTRACT_MAJOR, major }
}

/**
 * 将旧 ProjectDraftStreamEvent 归一化为 StreamingProgressEnvelope。
 * 确保旧事件在兼容窗口内以统一格式进入 reducer。
 */
export function projectDraftEventToEnvelope(
  event: ProjectDraftStreamEvent,
): StreamingProgressEnvelope {
  const domainPayload: AiDraftDomainPayload = {
    domain: 'ai-draft',
    draftId: event.draftId,
    progress:
      event.type === 'module.delta' || event.type === 'module.completed'
        ? {
            module: event.module,
            moduleStatus: event.type === 'module.delta' ? event.status : 'completed',
          }
        : undefined,
  }

  const base = {
    contractVersion: '1.0' as const,
    eventId: `${event.draftId}-${event.sequence}`,
    streamId: event.draftId,
    domain: 'ai-draft' as const,
    sequence: event.sequence,
    occurredAt: new Date().toISOString(),
  }

  switch (event.type) {
    case 'draft.started':
      return { ...base, type: 'started' as const, payload: { phase: 'adapter_ready' } }
    case 'module.delta':
      return {
        ...base,
        type: 'progress' as const,
        payload: {
          phase: event.module,
          completedUnits: event.status === 'completed' ? 1 : 0,
          totalUnits: PROJECT_DRAFT_MODULES.length,
        },
        _domainPayload: domainPayload,
      }
    case 'module.completed':
      return {
        ...base,
        type: 'progress' as const,
        payload: { phase: event.module },
        _domainPayload: domainPayload,
      }
    case 'draft.progress':
      return {
        ...base,
        type: 'progress' as const,
        payload: { phase: event.phase },
      }
    case 'draft.heartbeat':
      return {
        ...base,
        type: 'heartbeat' as const,
        payload: {},
      }
    case 'generation.output':
      // v3-ai-draft-live-output-panel：输出事件不进 envelope 语义路径（store 特判处理），
      // 归约为 heartbeat 类活性事件的等价物，保证 switch 穷尽与兼容窗口稳定。
      return {
        ...base,
        type: 'heartbeat' as const,
        payload: {},
      }
    case 'validation.warning':
      return {
        ...base,
        type: 'progress' as const,
        payload: { phase: 'validating' },
      }
    case 'draft.completed':
      return {
        ...base,
        type: 'completed' as const,
        payload: { summary: 'draft generation completed' },
      }
    case 'draft.failed':
      return {
        ...base,
        type: 'failed' as const,
        payload: {
          errorCode: event.errorCode,
          messageCode: event.errorCode.toLowerCase().replace(/_/g, '.'),
        },
      }
  }
}

/**
 * 将 StreamingProgressEnvelope（AI Draft 域）转为 projection action。
 * 返回 null 表示应安全忽略（未知同 major 加法事件或非 AI Draft 域）。
 */
export function streamingEnvelopeToDraftAction(
  envelope: StreamingProgressEnvelope,
  receivedAt?: number,
): DraftProgressAction | null {
  // 只处理 AI Draft 域
  if (envelope.domain !== 'ai-draft') return null

  // 检查契约兼容性
  const { compatible } = isContractCompatible(envelope.contractVersion)
  if (!compatible) {
    return {
      kind: 'contract.incompatible',
      message: `Contract major version mismatch: got ${envelope.contractVersion}, expected ${SUPPORTED_CONTRACT_MAJOR}.x`,
      contractVersion: envelope.contractVersion,
    }
  }

  return {
    kind: 'envelope',
    envelope,
    receivedAt: receivedAt ?? Date.now(),
  }
}

/**
 * 将 ReplayResponse（含事件列表或 reset-required）转为 DraftProgressAction 序列。
 */
export function replayResponseToActions(response: ReplayResponse): DraftProgressAction[] {
  if (response.resetRequired) {
    return [
      {
        kind: 'contract.incompatible',
        message:
          response.resetMessage ?? 'Replay requires reset: retention expired or version mismatch.',
      },
    ]
  }
  return response.events.map((e) => ({
    kind: 'envelope' as const,
    envelope: e,
    receivedAt: Date.now(),
  }))
}

// ─────────────────────────────────────────────────────────────
// Envelope Reducer
// ─────────────────────────────────────────────────────────────

/**
 * 从 StreamingProgressEnvelope 派生投影更新。
 * heartbeat 只更新连接活性与 lastHeartbeatAt，不改变 phase/modules/terminal/lastSemanticProgressAt。
 */
function applyEnvelopeProgress(
  projection: DraftProgressProjection,
  envelope: StreamingProgressEnvelope,
  receivedAt: number,
): DraftProgressProjection {
  const dp = envelope._domainPayload as AiDraftDomainPayload | undefined
  const progressExt = dp?.progress as AiDraftProgressExtension | undefined

  const next: DraftProgressProjection = {
    ...projection,
    draftId: dp?.draftId ?? projection.draftId,
    lastSequence: envelope.sequence,
    lastEventAt: receivedAt,
    contractVersion: envelope.contractVersion,
  }

  // heartbeat —— 只更新连接活性，不更新 lastSemanticProgressAt/modules/phase/terminal
  if (envelope.type === 'heartbeat') {
    return {
      ...next,
      connection: projection.recovery.state === 'none' ? 'live' : 'recovering',
      lastHeartbeatAt: receivedAt,
      lastHeartbeatReceivedAt: receivedAt,
      retryRequired: false,
    }
  }

  // 语义事件更新 lastSemanticProgressAt
  next.lastSemanticProgressAt = receivedAt

  // started → 重置模块为 pending
  if (envelope.type === 'started') {
    return {
      ...next,
      connection: 'live',
      modules: emptyModules(),
      phase: null,
      terminal: 'none',
      preparingReview: false,
      errorCode: null,
      errorMessage: null,
      recovery: { state: 'none', expectedSequence: null, targetSequence: null },
    }
  }

  if (projection.terminal !== 'none') return projection

  // progress — 模块级或阶段级
  if (envelope.type === 'progress') {
    const phasePayload = envelope.payload as { phase?: string }
    const result: DraftProgressProjection = { ...next, connection: 'live' }

    if (phasePayload.phase) {
      if (PROJECT_DRAFT_MODULES.includes(phasePayload.phase as ProjectDraftModule)) {
        const module = phasePayload.phase as ProjectDraftModule
        const current = projection.modules[module]
        if (current !== 'completed') {
          result.modules = {
            ...projection.modules,
            [module]: progressExt?.moduleStatus === 'completed' ? 'completed' : 'generating',
          }
        }
      } else if (
        [
          'adapter_ready',
          'first_token',
          'receiving',
          'parsing',
          'validating',
          'retrying',
          'persisting',
        ].includes(phasePayload.phase)
      ) {
        result.phase = phasePayload.phase as ProgressPhase
      }
    }
    return result
  }

  // completed → 全部完成
  if (envelope.type === 'completed') {
    return {
      ...next,
      connection: 'closed',
      phase: 'persisting',
      modules: Object.fromEntries(
        PROJECT_DRAFT_MODULES.map((module) => [module, 'completed']),
      ) as Record<ProjectDraftModule, ProjectDraftModuleStatus>,
      terminal: 'completed',
      preparingReview: true,
    }
  }

  // failed → 标记生成中模块为 failed
  const failedModules = Object.fromEntries(
    PROJECT_DRAFT_MODULES.map((module) => [
      module,
      projection.modules[module] === 'generating' ? 'failed' : projection.modules[module],
    ]),
  ) as Record<ProjectDraftModule, ProjectDraftModuleStatus>
  const errPayload = envelope.payload as { errorCode?: string; messageCode?: string }
  return {
    ...next,
    connection: 'failed',
    modules: failedModules,
    terminal: 'failed',
    retryRequired: true,
    errorCode: errPayload.errorCode ?? null,
    errorMessage: errPayload.messageCode ?? null,
  }
}

/**
 * 检查 old event 通过 adapter 是否应在当前场景安全忽略。
 * 规则：event type 在已知 list 内时正常处理（兼容加法），否则视为未知加法事件。
 */
const KNOWN_EVENT_TYPES = new Set([
  'draft.started',
  'module.delta',
  'module.completed',
  'draft.progress',
  'draft.heartbeat',
  'validation.warning',
  'draft.completed',
  'draft.failed',
])

export function isKnownEventType(type: string): boolean {
  return KNOWN_EVENT_TYPES.has(type)
}

// ─────────────────────────────────────────────────────────────
// Reduce — 主入口
// ─────────────────────────────────────────────────────────────

export function reduceDraftProgress(
  state: DraftProgressProjection,
  action: DraftProgressAction,
): DraftProgressProjection {
  // ── Transport actions ────────────────────────────────────
  if (action.kind === 'transport.connecting') {
    if (state.terminal !== 'none') return state
    return withHealthState({
      ...state,
      connection: 'connecting',
      retryRequired: false,
      reasonCode: 'STREAM_RECONNECTING',
    })
  }
  if (action.kind === 'transport.live') {
    if (state.terminal !== 'none') return state
    return withHealthState({
      ...state,
      connection: 'live',
      retryRequired: false,
      reconnectAttempt: 0,
    })
  }
  if (action.kind === 'transport.disconnected') {
    if (state.terminal !== 'none') return state
    return withHealthState({
      ...state,
      connection: 'failed',
      retryRequired: true,
      errorCode: 'SSE_DISCONNECTED',
      errorMessage: action.message ?? '进度连接已中断，可从上次位置继续。',
      reasonCode: 'STREAM_PROXY_TIMEOUT',
    })
  }
  if (action.kind === 'transport.replaying') {
    if (state.terminal !== 'none') return state
    return withHealthState({
      ...state,
      connection: 'recovering',
      recovery: { ...state.recovery, state: 'replaying' },
      retryRequired: false,
      reconnectAttempt: state.reconnectAttempt + 1,
      lastStatusCheckAt: Date.now(),
      reasonCode: 'STREAM_RECONNECTING',
    })
  }
  if (action.kind === 'transport.reset') {
    return withHealthState(
      createDraftProgressProjection({
        draftId: action.draftId ?? state.draftId,
        version: action.version ?? state.version,
        lastSequence: action.lastSequence ?? 0,
        connection: 'connecting',
      }),
    )
  }
  if (action.kind === 'review.ready') {
    return { ...state, preparingReview: false }
  }

  // ── Contract incompatible ──────────────────────────────
  if (action.kind === 'contract.incompatible') {
    return withHealthState({
      ...state,
      connection: 'failed',
      terminal: 'failed',
      retryRequired: true,
      errorCode: 'CONTRACT_INCOMPATIBLE',
      errorMessage: action.message,
      recovery: { state: 'none', expectedSequence: null, targetSequence: null },
      reasonCode: 'STREAM_CONTRACT_INCOMPATIBLE',
    })
  }

  // ── Envelope action（来自 StreamingProgressEnvelope） ─
  if (action.kind === 'envelope') {
    const { envelope, receivedAt = Date.now() } = action

    // 只处理 AI Draft 域
    if (envelope.domain !== 'ai-draft') return state

    // 检查序列 gap
    if (state.lastSequence > 0 && envelope.sequence > state.lastSequence + 1) {
      return withHealthState({
        ...state,
        connection: 'recovering',
        retryRequired: false,
        recovery: {
          state: 'gap',
          expectedSequence: state.lastSequence + 1,
          targetSequence: Math.max(state.recovery.targetSequence ?? 0, envelope.sequence),
        },
      })
    }

    // 幂等：重复 sequence 忽略
    if (envelope.sequence <= state.lastSequence) return state

    const targetSequence = state.recovery.targetSequence
    const applied = applyEnvelopeProgress(state, envelope, receivedAt)

    // 仍在回放过程中（未收敛到 targetSequence）
    if (targetSequence !== null && envelope.sequence < targetSequence) {
      return withHealthState({
        ...applied,
        connection: 'recovering',
        recovery: {
          state: 'replaying',
          expectedSequence: envelope.sequence + 1,
          targetSequence,
        },
      })
    }

    return withHealthState({
      ...applied,
      recovery: { state: 'none', expectedSequence: null, targetSequence: null },
    })
  }

  // ── 旧格式事件（ProjectDraftStreamEvent） ────────────
  const event = action.event
  const receivedAt = action.receivedAt ?? Date.now()
  if (state.draftId) {
    // 占位符 'pending'：draft.started（sequence 1）到来时采纳权威 draftId，
    // 否则真实事件的 heartbeat/模块进度都会被误丢，watchdog 因无活动误报断线。
    const placeholderAdoption =
      state.draftId === 'pending' && event.type === 'draft.started' && event.sequence === 1
    if (!placeholderAdoption && event.draftId !== state.draftId) return state
  }

  if (event.type === 'draft.heartbeat') {
    if (state.terminal !== 'none') return state
    return withHealthState({
      ...state,
      draftId: event.draftId,
      version: Math.max(state.version, event.version),
      connection: state.recovery.state === 'none' ? 'live' : 'recovering',
      lastEventAt: receivedAt,
      lastHeartbeatAt: receivedAt,
      lastHeartbeatReceivedAt: receivedAt,
      // heartbeat 不更新 lastSemanticProgressAt
      elapsedMs: Math.max(state.elapsedMs, event.elapsedMs),
    })
  }

  // v3-ai-draft-live-output-panel：generation.output 是序列外瞬时通道。
  // store 已特判追加文本；此处纯防御——不推进 lastSequence、不触发 gap、
  // 不参与语义归约，只顺带更新活性时间（持续吐字=连接活跃，watchdog 不误报）。
  if (event.type === 'generation.output') {
    if (state.terminal !== 'none') return state
    return withHealthState({
      ...state,
      draftId: event.draftId,
      version: Math.max(state.version, event.version),
      connection: state.recovery.state === 'none' ? 'live' : 'recovering',
      lastEventAt: receivedAt,
    })
  }

  // 幂等：重复与乱序语义事件不回退模块、阶段或 terminal。
  if (event.sequence <= state.lastSequence) return state

  const expected = state.lastSequence + 1
  if (state.lastSequence > 0 && event.sequence > expected) {
    return withHealthState({
      ...state,
      connection: 'recovering',
      retryRequired: false,
      recovery: {
        state: 'gap',
        expectedSequence: expected,
        targetSequence: Math.max(state.recovery.targetSequence ?? 0, event.sequence),
      },
    })
  }

  const seqTarget = state.recovery.targetSequence
  const oldResult = applySemanticEvent(state, event, receivedAt)
  if (seqTarget !== null && event.sequence < seqTarget) {
    return withHealthState({
      ...oldResult,
      connection: 'recovering',
      recovery: {
        state: 'replaying' as const,
        expectedSequence: event.sequence + 1,
        targetSequence: seqTarget,
      },
    })
  }

  return withHealthState({
    ...oldResult,
    recovery: { state: 'none', expectedSequence: null, targetSequence: null },
  })
}

export function selectCompletedModuleCount(projection: DraftProgressProjection): number {
  return PROJECT_DRAFT_MODULES.filter((module) => projection.modules[module] === 'completed').length
}

export function selectDraftProgressPercent(projection: DraftProgressProjection): number | null {
  const total = PROJECT_DRAFT_MODULES.length
  return total > 0 ? Math.round((selectCompletedModuleCount(projection) / total) * 100) : null
}

// =============================================================================
// v2-5-streaming-eta-estimation：AI Draft ETA selector（纯派生，零 state 写入）
// =============================================================================

/**
 * AI Draft 剩余时间估算结果（v2-5-streaming-eta-estimation）。
 * `formatted` 为 `formatEta(etaMs)` 的中文文案，暖机/异常时为空串（UI 据此隐藏）。
 */
export interface DraftEtaSelection {
  etaMs: number | null
  confidence: EtaConfidence
  formatted: string
}

/**
 * 计算 AI Draft 生成剩余时间估算（spec: ETA MUST be a pure selector without modifying projection state）。
 *
 * 纯函数 selector，从 `DraftProgressProjection` 派生，**不修改 projection 接口、不写 reducer、
 * 不新增 dispatch action**（spec: selector 纯函数性）。算法委托 `computeLinearEta` 线性外推：
 * `remainingMs = (elapsedMs / completedModules) * (remainingModules)`。
 *
 * `now` 可选——传入时用 `now - lastEventAt` 补偿自上次事件以来流逝的时间，
 * 使 ETA 随墙钟推进而减少（spec: 不同 now 产生不同 ETA）；不传时退化为 `projection.elapsedMs`。
 *
 * 暖机期（completedModules < 2）、非 healthy、非 live/recovering 连接、终态 → etaMs=null（UI 隐藏）。
 * 全完成 → etaMs=0。零网络写入、零状态写入（spec: 零网络写入）。
 */
export function selectDraftEta(
  projection: DraftProgressProjection,
  now?: number,
): DraftEtaSelection {
  // ── 状态守卫：非 healthy / 终态 / 非活连接 → null（spec: 停滞/重连/失败时清空）──────
  if (!isEtaAvailable(projection.healthState, projection.connection, projection.terminal)) {
    return { etaMs: null, confidence: 'initial', formatted: '' }
  }

  const total = PROJECT_DRAFT_MODULES.length
  const completed = selectCompletedModuleCount(projection)

  // ── now 补偿：自上次事件以来又流逝的时间（spec: 不同 now 产生不同 ETA）──────────
  let elapsedMs = projection.elapsedMs
  if (now !== undefined && Number.isFinite(now) && projection.lastEventAt !== null) {
    const sinceLastEvent = now - projection.lastEventAt
    if (Number.isFinite(sinceLastEvent) && sinceLastEvent > 0) {
      elapsedMs = projection.elapsedMs + sinceLastEvent
    }
  }

  const result = computeLinearEta(elapsedMs, completed, total)
  return {
    etaMs: result.etaMs,
    confidence: result.confidence,
    formatted: formatEta(result.etaMs),
  }
}
