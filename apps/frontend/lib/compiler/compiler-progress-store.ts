/**
 * Compiler Progress Store —— Compiler Run 的前端进度投影（V2.5 W2）。
 *
 * 使用 streaming progress contract 的不变量（幂等、gap、FSM）。
 * 复用 `v2-5-streaming-timeout-and-stall-recovery` 的 heartbeat/stale/status fallback 语义。
 *
 * @file compiler-progress-store.ts
 */

import { create } from 'zustand'
import type {
  StreamingProgressEnvelope,
  StreamingEventType,
  FsmState,
} from '@aiproj/types/progress-streaming'
import { DOMAIN_COMPILER } from '@aiproj/types/progress-streaming'

// ── 类型 ───────────────────────────────────────────────────────

export interface CompilerRunState {
  /** run ID */
  runId: number
  /** 各 stage 的最新状态。 */
  stages: Map<string, StageProgressState>
  /** 汇总状态。 */
  overallStatus: 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'
  /** 上次事件 sequence。 */
  lastSequence: number
  /** 最后事件时间。 */
  lastEventTime: string | null
  /** 心跳状态。 */
  heartbeatStale: boolean
  /** 连接状态。 */
  connected: boolean
}

export interface StageProgressState {
  stageId: string
  phase: string
  status: StreamingEventType
  fsmState: FsmState
  attemptNumber: number | null
  durationMs: number | null
  llmCalls: number
  llmCost: number
  needsReview: boolean
  errorCode: string | null
  timestamp: string | null
}

// ── Reducer ────────────────────────────────────────────────────

function reduceEvent(currentState: FsmState, eventType: StreamingEventType): FsmState {
  const FSM_TRANSITIONS: Record<string, readonly StreamingEventType[]> = {
    initial: ['started'],
    started: ['progress', 'heartbeat', 'checkpoint', 'completed', 'failed', 'cancelled'],
    running: ['progress', 'heartbeat', 'checkpoint', 'completed', 'failed', 'cancelled'],
    completed: [],
    failed: [],
    cancelled: [],
  }

  const allowed = FSM_TRANSITIONS[currentState]
  if (!allowed?.includes(eventType)) return currentState // 非法转换忽略

  if (eventType === 'completed') return 'completed'
  if (eventType === 'failed') return 'failed'
  if (eventType === 'cancelled') return 'cancelled'
  if (currentState === 'initial' && eventType === 'started') return 'started'
  if (currentState === 'started' || currentState === 'running') return 'running'
  return currentState
}

interface CompilerEnvelopeProjection {
  runId: number
  stageId: string
  phase: string
  attemptNumber: number | null
  durationMs: number | null
  llmCalls: number
  llmCost: number
  needsReview: boolean
  errorCode: string | null
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function booleanField(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function runIdFromStreamId(streamId: string): number | null {
  const match = /^compiler:(\d+)$/.exec(streamId)
  if (!match) return null
  return Number(match[1])
}

function projectCompilerEnvelope(
  envelope: StreamingProgressEnvelope,
): CompilerEnvelopeProjection | null {
  if (envelope.domain !== DOMAIN_COMPILER) return null

  const legacyPayload = envelope.payload as Record<string, unknown>
  const domainPayload =
    envelope._domainPayload?.domain === DOMAIN_COMPILER ? envelope._domainPayload : undefined

  const runId =
    numberField(legacyPayload.runId) ??
    (domainPayload?.runId ? Number(domainPayload.runId) : null) ??
    runIdFromStreamId(envelope.streamId)
  if (!runId || !Number.isFinite(runId)) return null

  const stageId =
    stringField(legacyPayload.stageId) ??
    domainPayload?.progress?.stageId ??
    stringField(legacyPayload.phase) ??
    'unknown'

  return {
    runId,
    stageId,
    phase: stringField(legacyPayload.phase) ?? stageId,
    attemptNumber:
      numberField(legacyPayload.attemptNumber) ?? domainPayload?.progress?.attempt ?? null,
    durationMs: numberField(legacyPayload.durationMs),
    llmCalls: numberField(legacyPayload.llmCalls) ?? 0,
    llmCost: numberField(legacyPayload.llmCost) ?? 0,
    needsReview: booleanField(legacyPayload.needsReview) ?? false,
    errorCode: stringField(legacyPayload.errorCode) ?? domainPayload?.progress?.errorCode ?? null,
  }
}

// ── Store ──────────────────────────────────────────────────────

export interface CompilerProgressStore {
  /** 当前 run 状态。 */
  runs: Map<number, CompilerRunState>

  /** 应用一个 Compiler progress envelope。 */
  applyEnvelope: (envelope: StreamingProgressEnvelope) => void

  /** 获取某 run 的状态。 */
  getRunState: (runId: number) => CompilerRunState | undefined

  /** 标记连接断开。 */
  setDisconnected: (runId: number) => void

  /** 标记心跳超时。 */
  markHeartbeatStale: (runId: number) => void

  /** 重置 run。 */
  resetRun: (runId: number) => void

  /** 清除所有。 */
  clear: () => void
}

export const useCompilerProgressStore = create<CompilerProgressStore>((set, get) => ({
  runs: new Map(),

  applyEnvelope: (envelope) => {
    const payload = projectCompilerEnvelope(envelope)
    if (!payload) return
    const { runId, stageId, phase } = payload

    set((state) => {
      const runs = new Map(state.runs)
      let run = runs.get(runId)
      if (!run) {
        run = {
          runId,
          stages: new Map(),
          overallStatus: 'unknown',
          lastSequence: 0,
          lastEventTime: null,
          heartbeatStale: false,
          connected: true,
        }
      }

      // 更新 lastSequence（防止旧事件覆盖新事件）
      if (envelope.sequence <= run.lastSequence) return state // 旧事件忽略
      run.lastSequence = envelope.sequence

      // 更新 stage 状态
      const stages = new Map(run.stages)
      const currentStage = stages.get(stageId)
      const currentFsm = currentStage?.fsmState ?? 'initial'
      const nextFsm = reduceEvent(currentFsm, envelope.type)

      stages.set(stageId, {
        stageId,
        phase: phase ?? 'unknown',
        status: envelope.type,
        fsmState: nextFsm,
        attemptNumber: payload.attemptNumber ?? null,
        durationMs: payload.durationMs ?? null,
        llmCalls: payload.llmCalls ?? 0,
        llmCost: payload.llmCost ?? 0,
        needsReview: payload.needsReview ?? false,
        errorCode: payload.errorCode ?? null,
        timestamp: envelope.occurredAt ?? null,
      })

      // 计算汇总状态
      const terminalStages = [...stages.values()].filter(
        (s) => s.fsmState === 'completed' || s.fsmState === 'failed' || s.fsmState === 'cancelled',
      )
      const failedStages = [...stages.values()].filter((s) => s.fsmState === 'failed')
      const cancelledStages = [...stages.values()].filter((s) => s.fsmState === 'cancelled')

      let overallStatus: CompilerRunState['overallStatus'] = 'running'
      if (failedStages.length > 0) overallStatus = 'failed'
      else if (cancelledStages.length > 0) overallStatus = 'cancelled'
      else if (terminalStages.length === stages.size && stages.size > 0) overallStatus = 'completed'

      runs.set(runId, {
        ...run,
        stages,
        overallStatus,
        lastEventTime: envelope.occurredAt ?? null,
        connected: true,
      })

      return { runs }
    })
  },

  getRunState: (runId) => get().runs.get(runId),

  setDisconnected: (runId) => {
    set((state) => {
      const runs = new Map(state.runs)
      const run = runs.get(runId)
      if (!run) return state
      runs.set(runId, { ...run, connected: false })
      return { runs }
    })
  },

  markHeartbeatStale: (runId) => {
    set((state) => {
      const runs = new Map(state.runs)
      const run = runs.get(runId)
      if (!run) return state
      runs.set(runId, { ...run, heartbeatStale: true })
      return { runs }
    })
  },

  resetRun: (runId) => {
    set((state) => {
      const runs = new Map(state.runs)
      runs.delete(runId)
      return { runs }
    })
  },

  clear: () => set({ runs: new Map() }),
}))
