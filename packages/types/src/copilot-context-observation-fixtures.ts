/**
 * v3-ai-context-and-retrieval-observability —— 观测记录 fixtures。
 *
 * 覆盖五态：全命中、零结果、部分不可访问、截断、stale 阻断。
 *
 * @aiproj/types
 */

import type {
  ContextObservationRecord,
  ContextObservationSourceRecord,
  ContextObservationTruncationRecord,
  ContextObservationUncertaintyRecord,
  ContextObservationRetrievalQuality,
} from './copilot-context-observation.js'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export const OBSERVATION_FIXTURE_ORG_ID = 100
export const OBSERVATION_FIXTURE_PROJECT_ID = 42
export const OBSERVATION_FIXTURE_ACTOR_ID = 7
export const OBSERVATION_FIXTURE_ASSEMBLY_ID = 'asm_fixture_001'
export const OBSERVATION_FIXTURE_OBSERVED_AT = '2026-08-19T12:00:00.000Z'

// ---------------------------------------------------------------------------
// 逐来源 fixtures
// ---------------------------------------------------------------------------

/** 全命中的 task 来源。 */
export const fixtureSourceAllHit: ContextObservationSourceRecord = {
  retrievalKind: 'task',
  hitCount: 5,
  scoreRange: { min: 0.6, max: 0.95, median: 0.8 },
  byteShare: 0.35,
  capturedAt: '2026-08-19T11:58:00.000Z',
  staleBlocked: false,
  permissionDecision: 'granted',
}

/** 零结果的 risk 来源。 */
export const fixtureSourceZeroResult: ContextObservationSourceRecord = {
  retrievalKind: 'risk',
  hitCount: 0,
  scoreRange: { min: 0, max: 0, median: 0 },
  byteShare: 0,
  capturedAt: '2026-08-19T11:58:00.000Z',
  staleBlocked: false,
  permissionDecision: 'granted',
}

/** 部分不可访问的 comment 来源。 */
export const fixtureSourceInaccessible: ContextObservationSourceRecord = {
  retrievalKind: 'comment',
  hitCount: 3,
  scoreRange: { min: 0.4, max: 0.7, median: 0.55 },
  byteShare: 0.2,
  capturedAt: '2026-08-19T11:57:00.000Z',
  staleBlocked: false,
  permissionDecision: 'denied-hidden',
}

/** 被跳过的来源（不合格）。 */
export const fixtureSourceSkipped: ContextObservationSourceRecord = {
  retrievalKind: 'file',
  hitCount: 0,
  scoreRange: { min: 0, max: 0, median: 0 },
  byteShare: 0,
  capturedAt: '2026-08-19T11:56:00.000Z',
  staleBlocked: false,
  permissionDecision: 'skipped-ineligible',
}

/** stale 阻断的 document 来源。 */
export const fixtureSourceStaleBlocked: ContextObservationSourceRecord = {
  retrievalKind: 'document',
  hitCount: 2,
  scoreRange: { min: 0.5, max: 0.6, median: 0.55 },
  byteShare: 0.15,
  capturedAt: '2026-08-18T10:00:00.000Z',
  staleBlocked: true,
  permissionDecision: 'granted',
}

// ---------------------------------------------------------------------------
// 截断 fixtures
// ---------------------------------------------------------------------------

/** 无截断。 */
export const fixtureTruncationNone: ContextObservationTruncationRecord = {
  truncated: false,
  stage: 'none',
  omittedSourceCount: 0,
  omittedEvidenceBytes: 0,
  droppedRetrievalKinds: [],
  hitBudgetFloor: false,
  routingInputPreservationBreached: false,
}

/** 有截断：丢弃了低分来源。 */
export const fixtureTruncationWithOmission: ContextObservationTruncationRecord = {
  truncated: true,
  stage: 'retrieval',
  omittedSourceCount: 3,
  omittedEvidenceBytes: 1024,
  droppedRetrievalKinds: ['activity', 'comment'],
  hitBudgetFloor: false,
  routingInputPreservationBreached: false,
}

/** 触及预算下界。 */
export const fixtureTruncationHitFloor: ContextObservationTruncationRecord = {
  truncated: true,
  stage: 'retrieval',
  omittedSourceCount: 8,
  omittedEvidenceBytes: 4096,
  droppedRetrievalKinds: ['task', 'activity', 'comment', 'file'],
  hitBudgetFloor: true,
  routingInputPreservationBreached: false,
}

// ---------------------------------------------------------------------------
// 不确定三分 fixtures
// ---------------------------------------------------------------------------

/** 全部有结果。 */
export const fixtureUncertaintyAllResolved: ContextObservationUncertaintyRecord = {
  notExistsCount: 0,
  notAccessibleCount: 0,
  noMatchCount: 0,
}

/** 混合三分。 */
export const fixtureUncertaintyMixed: ContextObservationUncertaintyRecord = {
  notExistsCount: 1,
  notAccessibleCount: 2,
  noMatchCount: 3,
}

/** 全部零结果。 */
export const fixtureUncertaintyAllZero: ContextObservationUncertaintyRecord = {
  notExistsCount: 0,
  notAccessibleCount: 0,
  noMatchCount: 12,
}

// ---------------------------------------------------------------------------
// 检索质量聚合 fixtures
// ---------------------------------------------------------------------------

export const fixtureRetrievalQuality: readonly ContextObservationRetrievalQuality[] = [
  {
    retrievalKind: 'task',
    queryCategory: 'technical',
    totalQueries: 10,
    zeroResultCount: 1,
    avgHitCount: 4.5,
    aggregatedScoreRange: { min: 0.3, max: 0.95 },
  },
  {
    retrievalKind: 'task',
    queryCategory: 'general',
    totalQueries: 5,
    zeroResultCount: 2,
    avgHitCount: 2.0,
    aggregatedScoreRange: { min: 0.2, max: 0.7 },
  },
  {
    retrievalKind: 'document',
    queryCategory: 'technical',
    totalQueries: 8,
    zeroResultCount: 4,
    avgHitCount: 1.5,
    aggregatedScoreRange: { min: 0.1, max: 0.6 },
  },
]

// ---------------------------------------------------------------------------
// 五态完整 fixtures
// ---------------------------------------------------------------------------

/** 态 1：全命中（所有来源有结果，无截断，无不确定）。 */
export const fixtureObservationAllHit: ContextObservationRecord = {
  assemblyId: OBSERVATION_FIXTURE_ASSEMBLY_ID,
  organizationId: OBSERVATION_FIXTURE_ORG_ID,
  projectId: OBSERVATION_FIXTURE_PROJECT_ID,
  actorId: OBSERVATION_FIXTURE_ACTOR_ID,
  sources: [fixtureSourceAllHit],
  truncation: fixtureTruncationNone,
  uncertainty: fixtureUncertaintyAllResolved,
  retrievalQuality: fixtureRetrievalQuality,
  routingInputsPreserved: true,
  totalMs: 150,
  degraded: false,
  observedAt: OBSERVATION_FIXTURE_OBSERVED_AT,
}

/** 态 2：零结果（所有来源零命中）。 */
export const fixtureObservationZeroResult: ContextObservationRecord = {
  assemblyId: 'asm_fixture_002',
  organizationId: OBSERVATION_FIXTURE_ORG_ID,
  projectId: OBSERVATION_FIXTURE_PROJECT_ID,
  actorId: OBSERVATION_FIXTURE_ACTOR_ID,
  sources: [fixtureSourceZeroResult],
  truncation: fixtureTruncationNone,
  uncertainty: fixtureUncertaintyAllZero,
  retrievalQuality: [],
  routingInputsPreserved: true,
  totalMs: 80,
  degraded: false,
  observedAt: OBSERVATION_FIXTURE_OBSERVED_AT,
}

/** 态 3：部分不可访问（有 denied-hidden 来源）。 */
export const fixtureObservationPartialInaccessible: ContextObservationRecord = {
  assemblyId: 'asm_fixture_003',
  organizationId: OBSERVATION_FIXTURE_ORG_ID,
  projectId: OBSERVATION_FIXTURE_PROJECT_ID,
  actorId: OBSERVATION_FIXTURE_ACTOR_ID,
  sources: [fixtureSourceAllHit, fixtureSourceInaccessible],
  truncation: fixtureTruncationNone,
  uncertainty: fixtureUncertaintyMixed,
  retrievalQuality: [],
  routingInputsPreserved: true,
  totalMs: 200,
  degraded: false,
  observedAt: OBSERVATION_FIXTURE_OBSERVED_AT,
}

/** 态 4：截断（有来源被丢弃）。 */
export const fixtureObservationTruncated: ContextObservationRecord = {
  assemblyId: 'asm_fixture_004',
  organizationId: OBSERVATION_FIXTURE_ORG_ID,
  projectId: OBSERVATION_FIXTURE_PROJECT_ID,
  actorId: OBSERVATION_FIXTURE_ACTOR_ID,
  sources: [fixtureSourceAllHit],
  truncation: fixtureTruncationWithOmission,
  uncertainty: fixtureUncertaintyAllResolved,
  retrievalQuality: [],
  routingInputsPreserved: true,
  totalMs: 120,
  degraded: false,
  observedAt: OBSERVATION_FIXTURE_OBSERVED_AT,
}

/** 态 5：stale 阻断（有来源触发了 stale 阻断）。 */
export const fixtureObservationStaleBlocked: ContextObservationRecord = {
  assemblyId: 'asm_fixture_005',
  organizationId: OBSERVATION_FIXTURE_ORG_ID,
  projectId: OBSERVATION_FIXTURE_PROJECT_ID,
  actorId: OBSERVATION_FIXTURE_ACTOR_ID,
  sources: [fixtureSourceAllHit, fixtureSourceStaleBlocked],
  truncation: fixtureTruncationNone,
  uncertainty: fixtureUncertaintyAllResolved,
  retrievalQuality: [],
  routingInputsPreserved: true,
  totalMs: 180,
  degraded: false,
  observedAt: OBSERVATION_FIXTURE_OBSERVED_AT,
}

/** 态 6：降级（观测写入失败）。 */
export const fixtureObservationDegraded: ContextObservationRecord = {
  assemblyId: 'asm_fixture_006',
  organizationId: OBSERVATION_FIXTURE_ORG_ID,
  projectId: OBSERVATION_FIXTURE_PROJECT_ID,
  actorId: OBSERVATION_FIXTURE_ACTOR_ID,
  sources: [],
  truncation: fixtureTruncationNone,
  uncertainty: fixtureUncertaintyAllResolved,
  retrievalQuality: [],
  routingInputsPreserved: true,
  totalMs: 100,
  degraded: true,
  degradedReason: 'OBSERVATION_WRITE_FAILED',
  observedAt: OBSERVATION_FIXTURE_OBSERVED_AT,
}

/** 全部五态 fixtures 列表。 */
export const ALL_OBSERVATION_FIXTURES: readonly ContextObservationRecord[] = [
  fixtureObservationAllHit,
  fixtureObservationZeroResult,
  fixtureObservationPartialInaccessible,
  fixtureObservationTruncated,
  fixtureObservationStaleBlocked,
  fixtureObservationDegraded,
]
