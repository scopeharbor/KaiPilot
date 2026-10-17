/**
 * Compiler Realtime Mapper —— Compiler Stage Event → StreamingProgressEnvelope（domain=compiler）。
 *
 * 职责：
 * - 把 StageEventLogger 的输入映射为统一 streaming progress envelope。
 * - 只允许 runId/stageId/type/status/attempt/count/errorCode/time 的低敏字段。
 * - 禁止泄漏 prompt/context/raw output/artifact/secret/token。
 *
 * @file compiler_realtime_mapper.ts
 */

import type { StageEventEntry } from './stage_event_logger.js'
import {
  type StreamingProgressEnvelope,
  type StreamingEventType,
  type FsmState,
  type CompilerDomainPayload,
  DOMAIN_COMPILER,
  STREAMING_PROGRESS_CONTRACT_VERSION,
  FSM_TRANSITIONS,
  TERMINAL_EVENT_TYPES,
} from '@aiproj/types/progress-streaming'

// ── 生命周期映射 ───────────────────────────────────────────────

type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'needs_human_review'

const STATUS_TO_EVENT_TYPE: Record<StageStatus, StreamingEventType> = {
  pending: 'started',
  running: 'started',
  completed: 'completed',
  failed: 'failed',
  skipped: 'cancelled',
  needs_human_review: 'progress',
}

// ── 低敏 payload ──────────────────────────────────────────────

export interface AllowedCompilerFields {
  runId: number
  stageId: string
  phase: string
  attemptNumber: number | null
  /** 错误码（仅 code，不含 stack/message 原文）。 */
  errorCode: string | null
  durationMs: number | null
  llmCalls: number
  llmCost: number
  /** 人工审查标记。 */
  needsReview: boolean
}

/**
 * 从 StageEventEntry 中提取低敏字段。
 * 显式列出允许的字段，禁止透传自由文本。
 */
function extractAllowedFields(entry: Partial<StageEventEntry>): AllowedCompilerFields {
  return {
    runId: entry.compilerRunId ?? 0,
    stageId: entry.stageId ?? 'unknown',
    phase: entry.phase ?? 'unknown',
    attemptNumber: entry.attemptNumber ?? null,
    errorCode: typeof entry.error === 'string' ? entry.error : null,
    durationMs: entry.durationMs ?? null,
    llmCalls: entry.llmCalls ?? 0,
    llmCost: entry.llmCost ?? 0,
    needsReview: false,
  }
}

// ── Mapper ─────────────────────────────────────────────────────

let sequenceCounter = 0

/**
 * 将 StageEventEntry 映射为 StreamingProgressEnvelope。
 * sequence 使用单调递增计数器，eventId 使用 runId+stageId+timestamp 构造。
 */
export function mapStageEventToEnvelope(
  entry: Partial<StageEventEntry>,
  status: StageStatus,
): StreamingProgressEnvelope {
  sequenceCounter++
  const eventType = STATUS_TO_EVENT_TYPE[status] ?? 'progress'
  const allowed = extractAllowedFields(entry)

  const payload: CompilerDomainPayload = {
    domain: DOMAIN_COMPILER,
    runId: String(allowed.runId),
    progress: {
      stageId: allowed.stageId,
      attempt: allowed.attemptNumber ?? 1,
      errorCode: allowed.errorCode ?? undefined,
    },
  }

  const envelope: StreamingProgressEnvelope = {
    contractVersion: STREAMING_PROGRESS_CONTRACT_VERSION,
    sequence: sequenceCounter,
    eventId: `compiler:${allowed.runId}:${allowed.stageId}:${Date.now()}`,
    type: eventType,
    domain: DOMAIN_COMPILER,
    streamId: `compiler:${allowed.runId}`,
    occurredAt: entry.endedAt?.toISO?.() ?? entry.startedAt?.toISO?.() ?? new Date().toISOString(),
    payload:
      eventType === 'completed' || eventType === 'failed' || eventType === 'cancelled'
        ? { summary: `Stage ${allowed.stageId} ${status}` }
        : { phase: allowed.phase },
    _domainPayload: payload,
  }

  return envelope
}

/**
 * 验证 mapping 后的 envelope 不含敏感字段。
 */
export function validateEnvelopeSafety(envelope: StreamingProgressEnvelope): boolean {
  const serialized = JSON.stringify(envelope)
  const forbidden = ['contextPacketRef', 'inputArtifactRefs', 'modelOutputRef', 'tokenCostSummary']
  return !forbidden.some((term) => serialized.includes(term))
}

/**
 * 检查事件类型在给定 FSM state 下是否合法。
 */
export function isValidTransition(currentState: FsmState, eventType: StreamingEventType): boolean {
  const allowed = FSM_TRANSITIONS[currentState]
  if (!allowed) return false
  return allowed.includes(eventType)
}

/**
 * 是否为终态。
 */
export function isTerminalEvent(eventType: StreamingEventType): boolean {
  return (TERMINAL_EVENT_TYPES as readonly string[]).includes(eventType)
}

/** 重置计数器（测试用）。 */
export function resetSequenceCounter(): void {
  sequenceCounter = 0
}
