/**
 * v3-unified-ai-feedback-ledger —— 反馈事件 fixtures。
 *
 * 覆盖七态：接受、拒绝含原因、修改后接受、跳过、待决、低覆盖率、投影去重。
 * 全部为低敏确定性数据；不包含 prompt/输出全文/密钥。
 */

import type { UnifiedFeedbackEvent, AdoptionRateResult } from './unified-ai-feedback.js'
import { computeAdoptionRate, computeFeedbackDeduplicationKey } from './unified-ai-feedback.js'

export const FEEDBACK_FIXTURE_ORG_A = 101
export const FEEDBACK_FIXTURE_ORG_B = 202
export const FEEDBACK_FIXTURE_PROJECT = 7

const BASE_TIME = '2026-08-01T00:00:00.000Z'

export function unifiedFeedbackEventFixture(
  overrides?: Partial<UnifiedFeedbackEvent>,
): UnifiedFeedbackEvent {
  return {
    id: 1,
    organizationId: FEEDBACK_FIXTURE_ORG_A,
    projectId: FEEDBACK_FIXTURE_PROJECT,
    artifactKind: 'draft_layer_change',
    artifactId: 'dlc-fixture-001',
    capabilitySurface: 'draft',
    feedbackType: 'accepted',
    rejectionReason: null,
    modificationFingerprint: null,
    note: null,
    proposedContentHash: 'a1b2c3d4e5f6',
    finalContentHash: null,
    actorId: 42,
    idempotencyKey: 'ik-feedback-001',
    sourceEndpoint: 'draft_layer',
    sourceRef: 'dlc-123',
    deduplicationKey: computeFeedbackDeduplicationKey(
      'draft_layer_change',
      'dlc-fixture-001',
      FEEDBACK_FIXTURE_ORG_A,
    ),
    occurredAt: BASE_TIME,
    createdAt: BASE_TIME,
    ...overrides,
  }
}

// ── 七态 fixtures ──

/** 1. 接受态。 */
export function feedbackAcceptedFixture(
  overrides?: Partial<UnifiedFeedbackEvent>,
): UnifiedFeedbackEvent {
  return unifiedFeedbackEventFixture({
    feedbackType: 'accepted',
    rejectionReason: null,
    modificationFingerprint: null,
    ...overrides,
  })
}

/** 2. 拒绝含原因。 */
export function feedbackRejectedFixture(
  overrides?: Partial<UnifiedFeedbackEvent>,
): UnifiedFeedbackEvent {
  return unifiedFeedbackEventFixture({
    id: 2,
    feedbackType: 'rejected',
    rejectionReason: 'factual_error',
    note: '日期计算有误',
    ...overrides,
  })
}

/** 3. 修改后接受。 */
export function feedbackModifiedFixture(
  overrides?: Partial<UnifiedFeedbackEvent>,
): UnifiedFeedbackEvent {
  return unifiedFeedbackEventFixture({
    id: 3,
    feedbackType: 'modified',
    rejectionReason: null,
    modificationFingerprint: {
      changedField: 'duration',
      magnitudeBand: 'medium',
      proposedValueHash: 'hash_proposed_001',
      finalValueHash: 'hash_final_001',
    },
    ...overrides,
  })
}

/** 4. 跳过。 */
export function feedbackSkippedFixture(
  overrides?: Partial<UnifiedFeedbackEvent>,
): UnifiedFeedbackEvent {
  return unifiedFeedbackEventFixture({
    id: 4,
    feedbackType: 'skipped',
    rejectionReason: null,
    ...overrides,
  })
}

/** 5. 待决。 */
export function feedbackPendingFixture(
  overrides?: Partial<UnifiedFeedbackEvent>,
): UnifiedFeedbackEvent {
  return unifiedFeedbackEventFixture({
    id: 5,
    feedbackType: 'pending',
    rejectionReason: null,
    ...overrides,
  })
}

/** 6. 低覆盖率（少量决策）。 */
export function feedbackLowCoverageFixture(): AdoptionRateResult {
  // 只有 2 个决策，8 个待决 → 覆盖率 20%
  return computeAdoptionRate(1, 0, 1, 0, 8)
}

/** 7. 投影去重（同一决策经两路出现）。 */
export function feedbackProjectionDeduplicationFixture() {
  const dedupKey = computeFeedbackDeduplicationKey(
    'draft_layer_change',
    'dlc-dedup-001',
    FEEDBACK_FIXTURE_ORG_A,
  )
  return {
    // 从投影来的
    projection: unifiedFeedbackEventFixture({
      id: 10,
      artifactId: 'dlc-dedup-001',
      feedbackType: 'accepted',
      sourceEndpoint: 'draft_layer_projection',
      deduplicationKey: dedupKey,
    }),
    // 从新反馈事件来的（同一决策）
    event: unifiedFeedbackEventFixture({
      id: 11,
      artifactId: 'dlc-dedup-001',
      feedbackType: 'accepted',
      sourceEndpoint: 'copilot_action',
      deduplicationKey: dedupKey,
    }),
    dedupKey,
  }
}

/** 跨组织 fixture。 */
export function feedbackCrossOrgFixture() {
  return {
    orgA: unifiedFeedbackEventFixture({
      id: 20,
      organizationId: FEEDBACK_FIXTURE_ORG_A,
    }),
    orgB: unifiedFeedbackEventFixture({
      id: 21,
      organizationId: FEEDBACK_FIXTURE_ORG_B,
    }),
  }
}
