/**
 * 生成剧场 SSE 流式客户端（W1 · v3-ui-next-theater-generation）。
 *
 * 职责边界：
 * - 只消费、过滤并转发服务端真实事件；绝不伪造进度（RL-07）。
 *   本文件内仅有的定时器用途为：停滞健康检查（默认 15s 未收帧 → `stale`）
 *   与断线重连指数退避 —— 二者只影响连接健康信号与重连节奏，绝不驱动模块进度。
 * - 零自动落库 / 零自动转正（RL-01）：`draft.completed` 仅作为事件转发，
 *   由接线方（页面）决定 store 调用；本模块不发起任何 confirm 请求。
 *
 * 对外契约（W4 接线锚点）：
 * - `runDraftGenerationStream(options)` → `Promise<TheaterStreamOutcome>`，永不 reject；
 * - `onEvent` 只收到通过单调过滤器的事件；`STREAM_RETENTION_MISS` /
 *   `STREAM_REPLAY_RESET_REQUIRED` 重置事件不转发、不判死，走快照降级；
 * - 断线自动向 `GET /:id/events?after=:seq` 续传（`Last-Event-ID` 头由
 *   defaultTheaterTransport 附加），最多 3 次指数退避（1s/2s/4s，上限 10s）；
 * - 游标失效降级：拉取 `GET /:id` 快照并回放其 events 重建本地进度，
 *   然后通过 `onSnapshotResolved(detail)` 交给接线方决定落定（settled）或续传。
 */

import type {
  ConfirmedProjectContext,
  GenerateProjectDraftRequest,
  ProjectDraftDetail,
  ProjectDraftStreamEvent,
} from '@aiproj/types'
import { AI_CONNECTION_REQUIRED_MESSAGE, isAiConnectionRequiredError } from '@aiproj/types'
import { consumeDraftSse } from '@/lib/api/ai-draft'
import { apiFetch, apiRawFetch } from '@/lib/api-client'
import {
  computeHealthState,
  DEFAULT_STALL_THRESHOLDS,
  type DraftProgressHealthState,
} from '@/lib/ai-draft/progress-projection'

// ---------------------------------------------------------------------------
// 连接健康度（客户端视角；与 store 投影的 healthState 语义对齐）
// ---------------------------------------------------------------------------

export type TheaterConnectionHealth = 'healthy' | 'long_running' | 'stale' | 'reconnecting'

export interface TheaterStallThresholds {
  /** 连续未收到任何帧超过该时长 → stale（默认 15s = 3 个心跳周期）。 */
  staleMs: number
  /** 生成耗时超过该时长但帧仍持续到达 → long_running。 */
  longRunningMs: number
  /** 断线续传最大尝试次数（默认 3）。 */
  maxReconnectAttempts: number
  /** 指数退避基准（第 n 次 = base * 2^(n-1)）。 */
  reconnectBackoffBaseMs: number
  /** 单次退避上限。 */
  reconnectBackoffMaxMs: number
  /** 硬性等待上限：超过该时长未完成且无心跳 → 不可恢复失败。 */
  hardDeadlineMs: number
}

export const THEATER_STREAM_DEFAULTS: TheaterStallThresholds = {
  staleMs: DEFAULT_STALL_THRESHOLDS.staleMs,
  longRunningMs: DEFAULT_STALL_THRESHOLDS.longRunningMs,
  maxReconnectAttempts: DEFAULT_STALL_THRESHOLDS.maxReconnectAttempts,
  reconnectBackoffBaseMs: 1_000,
  reconnectBackoffMaxMs: DEFAULT_STALL_THRESHOLDS.reconnectBackoffMaxMs,
  hardDeadlineMs: 180_000,
}

// ---------------------------------------------------------------------------
// 单调递增序列过滤器（设计 Decision 3，RL-07）
// ---------------------------------------------------------------------------

export interface MonotonicSequenceFilterState {
  lastSequence: number
}

export function createSequenceFilter(): MonotonicSequenceFilterState {
  return { lastSequence: 0 }
}

/** 无序号保活通道与瞬时输出通道：恒放行，不参与、不推进序列游标。 */
const SEQUENCE_PASS_THROUGH_TYPES = new Set<ProjectDraftStreamEvent['type']>([
  'draft.heartbeat',
  'generation.output',
])

export function isSequencePassThroughEvent(type: ProjectDraftStreamEvent['type']): boolean {
  return SEQUENCE_PASS_THROUGH_TYPES.has(type)
}

export function filterAndAcceptEvent(
  event: ProjectDraftStreamEvent,
  state: MonotonicSequenceFilterState,
): boolean {
  if (isSequencePassThroughEvent(event.type)) return true
  if (event.sequence > state.lastSequence) {
    state.lastSequence = event.sequence
    return true
  }
  console.debug(
    `[TheaterSSE] Discarded out-of-order event sequence ${event.sequence} <= ${state.lastSequence}`,
  )
  return false
}

// ---------------------------------------------------------------------------
// 游标失效重置错误码（快照降级，不判死）
// ---------------------------------------------------------------------------

export const STREAM_RESET_ERROR_CODES = new Set([
  'STREAM_RETENTION_MISS',
  'STREAM_REPLAY_RESET_REQUIRED',
])

export function isStreamResetErrorCode(errorCode: string): boolean {
  return STREAM_RESET_ERROR_CODES.has(errorCode)
}

// ---------------------------------------------------------------------------
// 传输层（可注入；默认实现复用 api-client 的认证/刷新封装）
// ---------------------------------------------------------------------------

export interface TheaterSseTransport {
  /** POST /ai/project-drafts/stream：发起生成请求。 */
  openStream(input: GenerateProjectDraftRequest, signal?: AbortSignal): Promise<Response>
  /** POST /ai/project-drafts/:id/retry：复用会话重跑生成（checkpoint 断点续跑）。
   *  可选：仅 defaultTheaterTransport 与重试场景需要；缺省时 retryOf 直接判失败。 */
  openRetry?(
    draftId: string,
    input: GenerateProjectDraftRequest,
    signal?: AbortSignal,
  ): Promise<Response>
  /** GET /ai/project-drafts/:id/events?after=:seq：断点续传（Last-Event-ID 头）。 */
  openReplay(draftId: string, lastSequence: number, signal?: AbortSignal): Promise<Response>
  /** GET /ai/project-drafts/:id：游标失效时的权威全量快照。 */
  fetchSnapshot(draftId: string, signal?: AbortSignal): Promise<ProjectDraftDetail>
}

export const defaultTheaterTransport: TheaterSseTransport = {
  openStream: (input, signal) =>
    apiRawFetch('/ai/project-drafts/stream', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    }),
  openRetry: (draftId, input, signal) =>
    apiRawFetch(`/ai/project-drafts/${draftId}/retry`, {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    }),
  openReplay: (draftId, lastSequence, signal) =>
    apiRawFetch(`/ai/project-drafts/${draftId}/events?after=${lastSequence}`, {
      headers: { 'Last-Event-ID': String(lastSequence) },
      ...(signal ? { signal } : {}),
    }),
  fetchSnapshot: (draftId, signal) =>
    apiFetch<ProjectDraftDetail>(`/ai/project-drafts/${draftId}`, {
      ...(signal ? { signal } : {}),
    }),
}

// ---------------------------------------------------------------------------
// 客户端选项与终态结果
// ---------------------------------------------------------------------------

export interface TheaterSseClientOptions {
  /** 已确认的项目上下文（就绪态沉淀）。 */
  context: ConfirmedProjectContext
  connectionId?: number
  modelId?: number
  /**
   * 已知草案断点（页面刷新 / 重试时）：直接从 events 端点续传，跳过 POST stream。
   * 需要 draftId 与 lastSequence 均有效，否则忽略。
   */
  resume?: { draftId: string; lastSequence: number } | null
  /**
   * 生成失败后的重试：复用该 draftId 的会话 POST /retry（服务端 checkpoint
   * 断点续跑，已完成阶段不调模型），而非开新会话从 0 生成。与 resume 互斥。
   */
  retryOf?: string | null
  /** 外部中止通道（页面卸载 / 重新开始 / 重试切换）。 */
  signal?: AbortSignal
  thresholds?: Partial<TheaterStallThresholds>
  now?: () => number
  transport?: TheaterSseTransport
  /** 通过单调过滤器后的真实事件（含保活/输出通道）。 */
  onEvent: (event: ProjectDraftStreamEvent) => void
  onHealthChange?: (health: TheaterConnectionHealth) => void
  onReconnect?: (attempt: number, lastSequence: number, delayMs: number) => void
  /** 游标失效降级：快照已获取并回放完成（接线方据此决定落定或继续）。 */
  onSnapshotResolved?: (detail: ProjectDraftDetail) => void
}

export interface TheaterStreamOutcome {
  status: 'completed' | 'failed' | 'aborted'
  draftId: string | null
  lastSequence: number
  errorCode: string | null
  message: string | null
  /** true 表示经 STREAM_RETENTION_MISS 快照降级后落定。 */
  recoveredFromSnapshot: boolean
}

type ReopenResult =
  { kind: 'response'; response: Response } | { kind: 'aborted' } | { kind: 'failed' }

type SnapshotRecoveryResult =
  | { kind: 'aborted' }
  | { kind: 'settled' }
  | { kind: 'continue' }
  | { kind: 'failed'; errorCode: string; message: string }

/** 支持中止的等待：返回 true 表示等待期间被中止。 */
async function pauseWithAbort(ms: number, signal: AbortSignal | null): Promise<boolean> {
  if (signal?.aborted) return true
  return await new Promise<boolean>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const settle = (aborted: boolean): void => {
      if (timer !== null) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(aborted)
    }
    const onAbort = (): void => settle(true)
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => settle(false), ms)
  })
}

// ---------------------------------------------------------------------------
// 主入口：生成流 / 续传流编排
// ---------------------------------------------------------------------------

export async function runDraftGenerationStream(
  options: TheaterSseClientOptions,
): Promise<TheaterStreamOutcome> {
  const thresholds: TheaterStallThresholds = { ...THEATER_STREAM_DEFAULTS, ...options.thresholds }
  const now = options.now ?? Date.now
  const transport = options.transport ?? defaultTheaterTransport
  const callerSignal = options.signal ?? null
  const resume =
    options.resume && options.resume.draftId && options.resume.lastSequence > 0
      ? options.resume
      : null
  const retryOf = !resume && options.retryOf ? options.retryOf : null

  const filter = createSequenceFilter()
  if (resume) filter.lastSequence = resume.lastSequence

  let draftId: string | null = resume?.draftId ?? retryOf
  let terminal: 'completed' | 'failed' | null = null
  let terminalErrorCode: string | null = null
  let terminalMessage: string | null = null
  let recoveredFromSnapshot = false
  let permanentFailure: { errorCode: string; message: string } | null = null

  const startedAt = now()
  let lastFrameAt: number | null = null
  let lastEmittedHealth: TheaterConnectionHealth | null = null
  let reconnectWindow = false
  let liveAttempts = 0

  let ended = false
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null
  let stallController = new AbortController()

  const readSignal = (): AbortSignal => stallController.signal
  const resetStall = (): void => {
    stallController = new AbortController()
  }
  const onCallerAbort = (): void => stallController.abort()
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true })

  function currentBaseHealth(): DraftProgressHealthState {
    return computeHealthState(
      now(),
      'live',
      terminal === 'completed' ? 'completed' : terminal === 'failed' ? 'failed' : 'none',
      lastFrameAt,
      lastFrameAt,
      lastFrameAt === null ? 0 : now() - startedAt,
      {
        ...DEFAULT_STALL_THRESHOLDS,
        staleMs: thresholds.staleMs,
        longRunningMs: thresholds.longRunningMs,
      },
      0,
      false,
    )
  }

  function emitHealth(health: TheaterConnectionHealth): void {
    if (ended || health === lastEmittedHealth) return
    lastEmittedHealth = health
    options.onHealthChange?.(health)
  }

  function refreshHealth(): void {
    if (reconnectWindow) return
    const base = currentBaseHealth()
    emitHealth(base === 'stale' ? 'stale' : base === 'long_running' ? 'long_running' : 'healthy')
  }

  /** 停滞看门狗：只做健康标记与硬性超时判定，绝不触碰模块进度（RL-07）。 */
  function scheduleWatchdog(): void {
    if (watchdogTimer !== null) clearTimeout(watchdogTimer)
    if (ended) {
      watchdogTimer = null
      return
    }
    watchdogTimer = setTimeout(onWatchdogTick, thresholds.staleMs)
  }

  function onWatchdogTick(): void {
    watchdogTimer = null
    if (ended || callerSignal?.aborted) return
    if (reconnectWindow) {
      scheduleWatchdog()
      return
    }
    // computeHealthState 用严格 > 判定 stale，看门狗恰好在阈值当刻触发时会差一 tick，
    // 这里以「距最后帧 >= staleMs」为准，保证 15s 未收帧即标记 stale（规格场景）。
    const stalled =
      (lastFrameAt === null ? now() - startedAt : now() - lastFrameAt) >= thresholds.staleMs
    if (stalled) {
      emitHealth('stale')
      if (now() - startedAt >= thresholds.hardDeadlineMs) {
        permanentFailure = {
          errorCode: 'STREAM_PROVIDER_TIMEOUT',
          message: '生成请求超过 180 秒未完成且无心跳，已中止连接。',
        }
      }
      // 半开连接：中止当前流以驱动 Last-Event-ID 续传
      stallController.abort()
    } else {
      refreshHealth()
    }
    scheduleWatchdog()
  }

  function handleFrame(event: ProjectDraftStreamEvent): 'accepted' | 'ignored' | 'reset' {
    lastFrameAt = now()
    if (event.type === 'draft.failed' && isStreamResetErrorCode(event.errorCode)) {
      if (event.draftId !== 'pending' && draftId === null) draftId = event.draftId
      return 'reset'
    }
    if (!filterAndAcceptEvent(event, filter)) return 'ignored'
    if (event.draftId !== 'pending' && draftId === null) draftId = event.draftId
    options.onEvent(event)
    if (event.type === 'draft.completed') {
      terminal = 'completed'
    } else if (event.type === 'draft.failed') {
      terminal = 'failed'
      terminalErrorCode = event.errorCode
      terminalMessage = event.message
    }
    refreshHealth()
    return 'accepted'
  }

  function abortedOutcome(): TheaterStreamOutcome {
    return {
      status: 'aborted',
      draftId,
      lastSequence: filter.lastSequence,
      errorCode: null,
      message: null,
      recoveredFromSnapshot,
    }
  }

  function failedOutcome(errorCode: string, message: string): TheaterStreamOutcome {
    return {
      status: 'failed',
      draftId,
      lastSequence: filter.lastSequence,
      errorCode,
      message,
      recoveredFromSnapshot,
    }
  }

  /**
   * 读取硬性失败标记。permanentFailure 是闭包内赋值、循环回边参与的 let 变量，
   * 直接对其做 !== null 收窄会被 CFA 误判为 never；经函数返回声明类型再收窄。
   */
  function getPermanentFailure(): { errorCode: string; message: string } | null {
    return permanentFailure
  }

  /** 断点续传：指数退避（最多 maxReconnectAttempts 次）重开 events 端点。 */
  async function reopenWithBackoff(draftIdForReplay: string): Promise<ReopenResult> {
    const maxAttempts = Math.max(1, thresholds.maxReconnectAttempts)
    reconnectWindow = true
    while (liveAttempts < maxAttempts) {
      liveAttempts += 1
      const delayMs = Math.min(
        thresholds.reconnectBackoffBaseMs * 2 ** (liveAttempts - 1),
        thresholds.reconnectBackoffMaxMs,
      )
      emitHealth('reconnecting')
      options.onReconnect?.(liveAttempts, filter.lastSequence, delayMs)
      const aborted = await pauseWithAbort(delayMs, callerSignal)
      if (aborted || callerSignal?.aborted || permanentFailure !== null) {
        return permanentFailure !== null ? { kind: 'failed' } : { kind: 'aborted' }
      }
      try {
        const response = await transport.openReplay(
          draftIdForReplay,
          filter.lastSequence,
          readSignal(),
        )
        return { kind: 'response', response }
      } catch {
        // 单次尝试失败 → 按退避继续下一轮
      }
    }
    return { kind: 'failed' }
  }

  /** 游标失效降级：拉取快照 → 回放 events 重建进度 → 落定或续传。 */
  async function recoverFromSnapshot(): Promise<SnapshotRecoveryResult> {
    const recoverDraftId = draftId
    if (!recoverDraftId) {
      return {
        kind: 'failed',
        errorCode: 'STREAM_RETENTION_MISS_RECOVERY_FAILED',
        message: '游标已失效且无法定位草案，请重新开始生成。',
      }
    }
    reconnectWindow = true
    emitHealth('reconnecting')
    try {
      const detail = await transport.fetchSnapshot(recoverDraftId, readSignal())
      if (callerSignal?.aborted) return { kind: 'aborted' }
      reconnectWindow = false
      for (const event of detail.events) {
        if (callerSignal?.aborted) return { kind: 'aborted' }
        if (terminal !== null) break
        handleFrame(event)
        if (terminal !== null) break
      }
      options.onSnapshotResolved?.(detail)
      recoveredFromSnapshot = true
      if (terminal === 'completed') return { kind: 'settled' }
      if (terminal === 'failed') {
        return {
          kind: 'failed',
          errorCode: terminalErrorCode ?? 'SSE_CONNECTION_FAILED',
          message: terminalMessage ?? '草案生成失败。',
        }
      }
      if (detail.draft && detail.validation) return { kind: 'settled' }
      return { kind: 'continue' }
    } catch {
      if (callerSignal?.aborted) return { kind: 'aborted' }
      reconnectWindow = false
      liveAttempts += 1
      if (liveAttempts >= Math.max(1, thresholds.maxReconnectAttempts)) {
        return {
          kind: 'failed',
          errorCode: 'STREAM_SNAPSHOT_FAILED',
          message: '游标失效降级失败：无法获取草案快照，请检查网络后重试。',
        }
      }
      return { kind: 'continue' }
    }
  }

  try {
    const openRetry = transport.openRetry
    if (retryOf && !openRetry) {
      return failedOutcome('SSE_RETRY_UNAVAILABLE', '重试通道不可用，请刷新后重试。')
    }
    let response: Response | null
    try {
      response = resume
        ? await transport.openReplay(resume.draftId, filter.lastSequence, readSignal())
        : retryOf && openRetry
          ? await openRetry(
              retryOf,
              {
                context: options.context,
                connectionId: options.connectionId,
                modelId: options.modelId,
              },
              readSignal(),
            )
          : await transport.openStream(
              {
                context: options.context,
                connectionId: options.connectionId,
                modelId: options.modelId,
              },
              readSignal(),
            )
    } catch (error) {
      if (callerSignal?.aborted) return abortedOutcome()
      // 没有可用 AI 连接：服务端不开流直接返回提示，保留错误码交给错误卡给出设置入口
      if (isAiConnectionRequiredError(error)) {
        return failedOutcome('AI_CONNECTION_REQUIRED', AI_CONNECTION_REQUIRED_MESSAGE)
      }
      if (resume && filter.lastSequence > 0) {
        // 已知断点：初始续传失败走退避重试
        response = null
      } else {
        return failedOutcome('SSE_CONNECTION_FAILED', '生成连接建立失败，请稍后重试。')
      }
    }

    while (true) {
      if (callerSignal?.aborted) return abortedOutcome()
      const failure = getPermanentFailure()
      if (failure !== null) {
        return failedOutcome(failure.errorCode, failure.message)
      }

      if (response === null) {
        const reopenDraftId = draftId
        if (!reopenDraftId || filter.lastSequence <= 0) {
          return failedOutcome(
            'SSE_RESUME_UNAVAILABLE',
            '连接中断且未取得可恢复的进度游标，请重试生成。',
          )
        }
        const reopened = await reopenWithBackoff(reopenDraftId)
        if (reopened.kind === 'aborted') return abortedOutcome()
        if (reopened.kind === 'failed') {
          return failedOutcome(
            'SSE_RECONNECT_EXHAUSTED',
            '进度连接多次恢复失败，请检查网络后重试。',
          )
        }
        response = reopened.response
      }

      reconnectWindow = false
      scheduleWatchdog()
      let framesInThisStream = 0
      let resetRequested = false
      try {
        for await (const event of consumeDraftSse(response, readSignal())) {
          if (callerSignal?.aborted) return abortedOutcome()
          const loopFailure = getPermanentFailure()
          if (loopFailure !== null) {
            return failedOutcome(loopFailure.errorCode, loopFailure.message)
          }
          if (terminal !== null) break
          const handled = handleFrame(event)
          if (handled === 'accepted') framesInThisStream += 1
          if (handled === 'reset') {
            resetRequested = true
            break
          }
          scheduleWatchdog()
        }
      } catch {
        // 传输层错误：与 EOF 同等对待 → 断点续传
      }
      resetStall()

      if (callerSignal?.aborted) return abortedOutcome()
      const tailFailure = getPermanentFailure()
      if (tailFailure !== null) {
        return failedOutcome(tailFailure.errorCode, tailFailure.message)
      }

      if (resetRequested) {
        const recovery = await recoverFromSnapshot()
        if (recovery.kind === 'aborted') return abortedOutcome()
        if (recovery.kind === 'settled') {
          return {
            status: 'completed',
            draftId,
            lastSequence: filter.lastSequence,
            errorCode: null,
            message: null,
            recoveredFromSnapshot: true,
          }
        }
        if (recovery.kind === 'failed') {
          return failedOutcome(recovery.errorCode, recovery.message)
        }
        response = null
        continue
      }

      if (terminal === 'completed') {
        return {
          status: 'completed',
          draftId,
          lastSequence: filter.lastSequence,
          errorCode: null,
          message: null,
          recoveredFromSnapshot,
        }
      }
      if (terminal === 'failed') {
        return failedOutcome(
          terminalErrorCode ?? 'SSE_CONNECTION_FAILED',
          terminalMessage ?? '草案生成失败。',
        )
      }

      // 流以 EOF 或传输错误结束且未达终态 → 断点续传
      if (framesInThisStream > 0) liveAttempts = 0
      response = null
    }
  } finally {
    ended = true
    if (watchdogTimer !== null) clearTimeout(watchdogTimer)
    stallController.abort()
    callerSignal?.removeEventListener('abort', onCallerAbort)
  }
}
