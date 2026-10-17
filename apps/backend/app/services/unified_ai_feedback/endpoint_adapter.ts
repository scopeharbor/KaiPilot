/**
 * v3-unified-ai-feedback-ledger §5 — 两端点收编适配器。
 *
 * 将 triz-rationale.feedback 与 triz-assistant.feedback 的结果
 * 映射为统一反馈事件形状，不改其端点行为。
 *
 * 无法表示的字段作为声明式缺口记录，禁止近似映射。
 * 映射时机：写时映射（端点提交时同步写入反馈事件表）。
 */

import type { EvaluatedArtifactKind, FeedbackType, UnifiedFeedbackEvent } from '@aiproj/types'
import { computeFeedbackDeduplicationKey } from '@aiproj/types'

// ===========================================================================
// §5.1 triz-rationale.feedback 映射
// ===========================================================================

/** 既有的 rationale feedback reason → 统一 rejection reason 映射。 */
const RATIONALE_REASON_MAP: Record<string, string | null> = {
  useful: null, // → accepted (非 rejection)
  not_useful: 'other', // 无更细粒度映射
  incorrect: 'factual_error',
  incomplete: 'wrong_granularity',
  other: 'other',
}

/** 既有的 rationale feedback reason → 统一 feedbackType 映射。 */
const RATIONALE_TYPE_MAP: Record<string, FeedbackType> = {
  useful: 'accepted',
  not_useful: 'rejected',
  incorrect: 'rejected',
  incomplete: 'rejected',
  other: 'rejected',
}

/**
 * Rationale feedback 输入形状（来自 triz-recommendation-rationale.ts）。
 */
export interface RationaleFeedbackInput {
  readonly targetType: string
  readonly targetId: string
  readonly reason: string
  readonly rating?: number
  readonly note?: string
  readonly sourceRefs?: readonly unknown[]
  readonly organizationId: number
  readonly projectId?: number | null
  readonly actorId: number
  readonly runId?: string
}

/**
 * 将 triz-rationale.feedback 映射为 UnifiedFeedbackEvent。
 * 不改其端点行为——只创建映射后的事件对象。
 */
export function mapRationaleFeedback(input: RationaleFeedbackInput): {
  event: UnifiedFeedbackEvent
  gaps: string[]
} {
  const gaps: string[] = []
  const feedbackType = RATIONALE_TYPE_MAP[input.reason] ?? 'rejected'
  const rejectionReason = RATIONALE_REASON_MAP[input.reason] ?? 'other'

  // rating 字段无法表示为统一形状中的任何字段 → 声明式缺口
  if (input.rating != null) {
    gaps.push('rating: numeric rating not represented in unified shape')
  }

  // sourceRefs 无法直接表示 → 声明式缺口
  if (input.sourceRefs && input.sourceRefs.length > 0) {
    gaps.push('sourceRefs: source references not represented in unified shape')
  }

  // targetType → artifactKind 映射
  const artifactKind: EvaluatedArtifactKind = mapTargetTypeToArtifactKind(input.targetType)

  const deduplicationKey = computeFeedbackDeduplicationKey(
    artifactKind,
    input.targetId,
    input.organizationId,
  )

  return {
    event: {
      id: 0, // 由数据库生成
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      artifactKind,
      artifactId: input.targetId,
      capabilitySurface: 'triz',
      feedbackType,
      rejectionReason: feedbackType === 'rejected' ? (rejectionReason as any) : null,
      modificationFingerprint: null,
      note: input.note ?? null,
      proposedContentHash: null,
      finalContentHash: null,
      actorId: input.actorId,
      idempotencyKey: `rationale:${input.targetType}:${input.targetId}:${input.reason}`,
      sourceEndpoint: 'triz_rationale',
      sourceRef: input.runId ?? null,
      deduplicationKey,
      occurredAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
    gaps,
  }
}

// ===========================================================================
// §5.2 triz-assistant.feedback 映射
// ===========================================================================

/** 既有的 assistant feedback reason → 统一 rejection reason 映射。 */
const ASSISTANT_REASON_MAP: Record<string, string | null> = {
  helpful: null,
  not_helpful: 'other',
  incorrect: 'factual_error',
  incomplete: 'wrong_granularity',
  other: 'other',
}

/** 既有的 assistant feedback reason → 统一 feedbackType 映射。 */
const ASSISTANT_TYPE_MAP: Record<string, FeedbackType> = {
  helpful: 'accepted',
  not_helpful: 'rejected',
  incorrect: 'rejected',
  incomplete: 'rejected',
  other: 'rejected',
}

/**
 * Assistant feedback 输入形状（来自 ai-triz-assistant.ts）。
 */
export interface AssistantFeedbackInput {
  readonly runId: string
  readonly reason: string
  readonly rating?: number
  readonly note?: string
  readonly organizationId: number
  readonly projectId?: number | null
  readonly actorId: number
}

/**
 * 将 triz-assistant.feedback 映射为 UnifiedFeedbackEvent。
 * 不改其端点行为——只创建映射后的事件对象。
 */
export function mapAssistantFeedback(input: AssistantFeedbackInput): {
  event: UnifiedFeedbackEvent
  gaps: string[]
} {
  const gaps: string[] = []
  const feedbackType = ASSISTANT_TYPE_MAP[input.reason] ?? 'rejected'
  const rejectionReason = ASSISTANT_REASON_MAP[input.reason] ?? 'other'

  // rating 字段无法表示 → 声明式缺口
  if (input.rating != null) {
    gaps.push('rating: numeric rating not represented in unified shape')
  }

  const deduplicationKey = computeFeedbackDeduplicationKey(
    'triz_rationale',
    input.runId,
    input.organizationId,
  )

  return {
    event: {
      id: 0,
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      artifactKind: 'triz_rationale',
      artifactId: input.runId,
      capabilitySurface: 'triz',
      feedbackType,
      rejectionReason: feedbackType === 'rejected' ? (rejectionReason as any) : null,
      modificationFingerprint: null,
      note: input.note ?? null,
      proposedContentHash: null,
      finalContentHash: null,
      actorId: input.actorId,
      idempotencyKey: `assistant:${input.runId}:${input.reason}`,
      sourceEndpoint: 'triz_assistant',
      sourceRef: input.runId,
      deduplicationKey,
      occurredAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
    gaps,
  }
}

// ===========================================================================
// 辅助函数
// ===========================================================================

function mapTargetTypeToArtifactKind(targetType: string): EvaluatedArtifactKind {
  switch (targetType) {
    case 'contradiction':
    case 'recommendation':
    case 'analysis':
      return 'triz_rationale'
    default:
      return 'suggestion'
  }
}
