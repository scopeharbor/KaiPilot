/**
 * progress-streaming-fixtures —— StreamingProgressEnvelope 兼容矩阵夹具（§1.5/§5.3 P0）。
 *
 * 为 streaming-progress-envelope-v1 契约提供 4 类 fixture：
 * - current：当前版本的有效事件序列
 * - oldest：最旧支持版本（当前均为 1.0，无旧版本）
 * - unknown-fields：含未来可选字段的 fixture（验证旧 reader 安全忽略）
 * - unsupported-major：不支持的 major 版本（2.0，验证拒绝路径）
 *
 * @aiproj/types 零依赖约束。
 */
import { STREAMING_PROGRESS_CONTRACT_VERSION } from './progress-streaming.js'
import type { StreamingProgressEnvelope } from './progress-streaming.js'

// =============================================================================
// 1. Current fixture —— 当前版本的有效完整事件序列
// =============================================================================

export const CURRENT_AI_DRAFT_FIXTURE: StreamingProgressEnvelope = {
  contractVersion: STREAMING_PROGRESS_CONTRACT_VERSION,
  eventId: 'fixture-ai-draft-current',
  streamId: 'fixture-stream-001',
  domain: 'ai-draft',
  sequence: 1,
  occurredAt: '2026-07-17T00:00:00.000Z',
  type: 'started',
  payload: {},
}

export const CURRENT_PROGRESS_FIXTURE: StreamingProgressEnvelope = {
  contractVersion: STREAMING_PROGRESS_CONTRACT_VERSION,
  eventId: 'fixture-progress-001',
  streamId: 'fixture-stream-001',
  domain: 'ai-draft',
  sequence: 2,
  occurredAt: '2026-07-17T00:00:01.000Z',
  type: 'progress',
  payload: {
    phase: 'generating-tasks',
    completedUnits: 1,
    totalUnits: 5,
    percent: 20,
    messageCode: 'progress.module.completed',
  },
}

export const CURRENT_HEARTBEAT_FIXTURE: StreamingProgressEnvelope = {
  contractVersion: STREAMING_PROGRESS_CONTRACT_VERSION,
  eventId: 'fixture-hb-001',
  streamId: 'fixture-stream-001',
  domain: 'ai-draft',
  sequence: 3,
  occurredAt: '2026-07-17T00:00:02.000Z',
  type: 'heartbeat',
  payload: {},
}

export const CURRENT_COMPLETED_FIXTURE: StreamingProgressEnvelope = {
  contractVersion: STREAMING_PROGRESS_CONTRACT_VERSION,
  eventId: 'fixture-completed-001',
  streamId: 'fixture-stream-001',
  domain: 'ai-draft',
  sequence: 4,
  occurredAt: '2026-07-17T00:00:05.000Z',
  type: 'completed',
  payload: {
    resultId: 'draft-001',
    summary: 'Generation complete',
  },
}

export const ALL_CURRENT_FIXTURES: StreamingProgressEnvelope[] = [
  CURRENT_AI_DRAFT_FIXTURE,
  CURRENT_PROGRESS_FIXTURE,
  CURRENT_HEARTBEAT_FIXTURE,
  CURRENT_COMPLETED_FIXTURE,
]

// =============================================================================
// 2. Old fixture —— 旧版本兼容（当前无旧版本，使用同版本 fixture 占位）
// =============================================================================

export const ALL_OLD_FIXTURES: StreamingProgressEnvelope[] = [
  // 当前版本 1.0 的 fixture 作为 oldest（无旧版本需要迁移）
  CURRENT_AI_DRAFT_FIXTURE,
]

// =============================================================================
// 3. Unknown-field fixture —— 含未来可选字段（验证旧 reader 安全忽略）
// =============================================================================

export interface UnknownFieldsEnvelope extends StreamingProgressEnvelope {
  /** 未来版本可能添加的可选字段。 */
  futureField?: string
  metadata?: Record<string, unknown>
}

export const UNKNOWN_FIELD_FIXTURE: UnknownFieldsEnvelope = {
  contractVersion: STREAMING_PROGRESS_CONTRACT_VERSION,
  eventId: 'fixture-unknown-field',
  streamId: 'fixture-stream-002',
  domain: 'compiler',
  sequence: 1,
  occurredAt: '2026-07-17T00:00:00.000Z',
  type: 'started',
  payload: {},
  futureField: 'future-optional-value',
  metadata: {
    futureProp: true,
  },
}

export const ALL_UNKNOWN_FIELD_FIXTURES: UnknownFieldsEnvelope[] = [UNKNOWN_FIELD_FIXTURE]

// =============================================================================
// 4. Unsupported-major fixture —— 验证 major 升级拒绝
// =============================================================================

export const UNSUPPORTED_MAJOR_FIXTURE: StreamingProgressEnvelope = {
  contractVersion: '2.0',
  eventId: 'fixture-unsupported-major',
  streamId: 'fixture-stream-003',
  domain: 'ai-draft',
  sequence: 1,
  occurredAt: '2026-07-17T00:00:00.000Z',
  type: 'started',
  payload: {},
}

export const ALL_UNSUPPORTED_MAJOR_FIXTURES: StreamingProgressEnvelope[] = [
  UNSUPPORTED_MAJOR_FIXTURE,
]
