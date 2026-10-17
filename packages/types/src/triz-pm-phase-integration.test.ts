/**
 * triz-pm-phase-integration types 包测试
 *
 * 覆盖：taxonomy · stable id · deterministic hash · mapping output ·
 * readiness · stale blocking · warning aggregation · redaction ·
 * no-AI deterministic behavior · fixture builders
 */

import { describe, it, expect, test, vi } from 'vitest'
import {
  PM_PHASE_IDS,
  PM_PHASE_LABELS,
  PM_PHASE_ORDER,
  PM_SOURCE_KINDS,
  PHASE_READINESS_STATES,
  PHASE_WARNING_CODES,
  PHASE_ACTION_KINDS,
  PHASE_HANDOFF_TARGETS,
  PHASE_RUN_STATUSES,
  isPmPhaseId,
  isPmSourceKind,
  isPhaseReadinessState,
  isPhaseWarningCode,
  isPhaseActionKind,
  isPhaseHandoffTarget,
  isPhaseRunStatus,
  generatePhaseRunId,
  generatePhaseSnapshotId,
  generateRecommendationId,
  computePhaseRunIdempotencyKey,
  computePhaseHandoffIdempotencyKey,
  computePhaseRunOutputHash,
  simpleHash8,
  buildSourceMappingKey,
  isPhaseBeforeOrEqual,
  nextPhase,
  prevPhase,
  isValidPhaseTransition,
  trizSourceToPrimaryPhases,
  criticalSourcesForPhase,
  recommendedTrizToolsForPhase,
  computeReadiness,
  computeSourceFreshness,
  isSourceStale,
  detectStaleSources,
  isPhaseStale,
  sortPhaseWarningsBySeverity,
  aggregatePhaseWarnings,
  maxWarningSeverity,
  redactSourceRef,
  redactSourceRefs,
  redactPhaseSnapshot,
  validatePhaseHandoffInput,
  sortPhaseRecommendations,
  buildPmSourceRef,
  buildPhaseGap,
  buildPhaseRecommendation,
  buildPhaseWarning,
  buildPhaseSnapshot,
  buildCompletePhaseIntegrationRun,
  buildSparsePhaseIntegrationRun,
  buildStalePhaseIntegrationRun,
  buildPermissionRestrictedPhaseIntegrationRun,
  buildLargePhaseIntegrationPacket,
  PHASE_INTEGRATION_NO_AI_CONTRACT,
} from '../src/triz-pm-phase-integration'
import type {
  PmPhaseId,
  PmSourceKind,
  PhaseReadinessState,
  PhaseWarningCode,
  PhaseActionKind,
  PhaseHandoffTarget,
  PhaseSnapshot,
  PhaseWarning,
  PhaseRecommendation,
} from '../src/triz-pm-phase-integration'

// ─── §2.1 Taxonomy ────────────────────────────────────────────────────────

describe('PM Phase Taxonomy', () => {
  it('has exactly five phases', () => {
    expect(PM_PHASE_IDS).toHaveLength(5)
  })

  it('each phase has a label', () => {
    for (const pid of PM_PHASE_IDS) {
      expect(PM_PHASE_LABELS[pid]).toBeTruthy()
    }
  })

  it('phase ordering is correct', () => {
    expect(PM_PHASE_ORDER.initiation).toBe(0)
    expect(PM_PHASE_ORDER.planning).toBe(1)
    expect(PM_PHASE_ORDER.execution).toBe(2)
    expect(PM_PHASE_ORDER.monitoring).toBe(3)
    expect(PM_PHASE_ORDER.change_control).toBe(4)
  })

  it('labels are in Chinese', () => {
    expect(PM_PHASE_LABELS.initiation).toBe('启动')
    expect(PM_PHASE_LABELS.planning).toBe('规划')
    expect(PM_PHASE_LABELS.execution).toBe('执行')
    expect(PM_PHASE_LABELS.monitoring).toBe('监控')
    expect(PM_PHASE_LABELS.change_control).toBe('变更管理')
  })
})

describe('Source Kind Taxonomy', () => {
  it('has the expected source kinds', () => {
    expect(PM_SOURCE_KINDS).toHaveLength(22)
    expect(PM_SOURCE_KINDS).toContain('project_metadata')
    expect(PM_SOURCE_KINDS).toContain('risk_summary')
    expect(PM_SOURCE_KINDS).toContain('contradiction_ref')
    expect(PM_SOURCE_KINDS).toContain('evolution_trend_ref')
    expect(PM_SOURCE_KINDS).toContain('clarification_ref')
  })
})

describe('Enum Guards', () => {
  it('isPmPhaseId validates correctly', () => {
    expect(isPmPhaseId('initiation')).toBe(true)
    expect(isPmPhaseId('execution')).toBe(true)
    expect(isPmPhaseId('unknown')).toBe(false)
    expect(isPmPhaseId('')).toBe(false)
  })

  it('isPmSourceKind validates correctly', () => {
    expect(isPmSourceKind('risk_summary')).toBe(true)
    expect(isPmSourceKind('ifr_ref')).toBe(true)
    expect(isPmSourceKind('not_a_kind')).toBe(false)
  })

  it('isPhaseReadinessState validates correctly', () => {
    expect(isPhaseReadinessState('ready')).toBe(true)
    expect(isPhaseReadinessState('blocked_stale')).toBe(true)
    expect(isPhaseReadinessState('invalid')).toBe(false)
  })

  it('isPhaseWarningCode validates correctly', () => {
    expect(isPhaseWarningCode('SOURCE_STALE')).toBe(true)
    expect(isPhaseWarningCode('SOURCE_UNAVAILABLE')).toBe(true)
    expect(isPhaseWarningCode('NONEXISTENT')).toBe(false)
  })

  it('isPhaseActionKind validates correctly', () => {
    expect(isPhaseActionKind('review_contradiction')).toBe(true)
    expect(isPhaseActionKind('open_workbench')).toBe(true)
    expect(isPhaseActionKind('auto_apply')).toBe(false)
  })

  it('isPhaseHandoffTarget validates correctly', () => {
    expect(isPhaseHandoffTarget('workbench')).toBe(true)
    expect(isPhaseHandoffTarget('risk_review')).toBe(true)
    expect(isPhaseHandoffTarget('auto_apply')).toBe(false)
  })

  it('isPhaseRunStatus validates correctly', () => {
    expect(isPhaseRunStatus('pending')).toBe(true)
    expect(isPhaseRunStatus('completed')).toBe(true)
    expect(isPhaseRunStatus('cancelled')).toBe(false)
  })
})

// ─── §2.3 Stable IDs ──────────────────────────────────────────────────────

describe('Stable IDs', () => {
  it('generatePhaseRunId produces expected format', () => {
    const id = generatePhaseRunId(42, 'abcdef01')
    expect(id).toMatch(/^phaserun_42_\d+_abcdef01$/)
  })

  it('generatePhaseRunId is deterministic with same rand', () => {
    // id 内嵌 Date.now()，跨毫秒调用必然不同——冻结时钟后才谈得上「同 rand 同 id」，
    // 否则该断言只是碰运气（曾在毫秒边界随机失败）。
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-18T00:00:00.000Z'))
    try {
      const id1 = generatePhaseRunId(1, 'deadbeef')
      const id2 = generatePhaseRunId(1, 'deadbeef')
      expect(id1).toBe(id2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('generatePhaseRunId differs with different projectId', () => {
    const id1 = generatePhaseRunId(1, 'aaaa')
    const id2 = generatePhaseRunId(2, 'aaaa')
    expect(id1).not.toBe(id2)
  })

  it('generatePhaseSnapshotId produces expected format', () => {
    const id = generatePhaseSnapshotId('run-1', 'planning', 'abc123')
    expect(id).toBe('phasesnap_run-1_planning_abc123')
  })

  it('generateRecommendationId produces expected format', () => {
    const id = generateRecommendationId('run-1', 'execution', 7)
    expect(id).toBe('phaserec_run-1_execution_7')
  })

  it('computePhaseRunIdempotencyKey is deterministic', () => {
    const k1 = computePhaseRunIdempotencyKey(1, 'abcdef')
    const k2 = computePhaseRunIdempotencyKey(1, 'abcdef')
    expect(k1).toBe(k2)
  })

  it('computePhaseRunIdempotencyKey differs with different hash', () => {
    const k1 = computePhaseRunIdempotencyKey(1, 'aaaa')
    const k2 = computePhaseRunIdempotencyKey(1, 'bbbb')
    expect(k1).not.toBe(k2)
  })

  it('computePhaseHandoffIdempotencyKey is deterministic', () => {
    const k1 = computePhaseHandoffIdempotencyKey('r1', 'planning', 'rec0', 'workbench')
    const k2 = computePhaseHandoffIdempotencyKey('r1', 'planning', 'rec0', 'workbench')
    expect(k1).toBe(k2)
  })

  it('simpleHash8 is stable', () => {
    expect(simpleHash8('hello')).toBe(simpleHash8('hello'))
    expect(simpleHash8('hello')).toHaveLength(8)
  })

  it('simpleHash8 differs for different inputs', () => {
    expect(simpleHash8('hello')).not.toBe(simpleHash8('world'))
  })

  it('buildSourceMappingKey combines kind and id', () => {
    expect(buildSourceMappingKey('risk_summary', 'r1')).toBe('risk_summary:r1')
  })
})

// ─── §2.4 Phase Ordering ──────────────────────────────────────────────────

describe('Phase Ordering', () => {
  it('isPhaseBeforeOrEqual works correctly', () => {
    expect(isPhaseBeforeOrEqual('initiation', 'planning')).toBe(true)
    expect(isPhaseBeforeOrEqual('initiation', 'initiation')).toBe(true)
    expect(isPhaseBeforeOrEqual('execution', 'planning')).toBe(false)
  })

  it('nextPhase returns correct next', () => {
    expect(nextPhase('initiation')).toBe('planning')
    expect(nextPhase('planning')).toBe('execution')
    expect(nextPhase('execution')).toBe('monitoring')
    expect(nextPhase('monitoring')).toBe('change_control')
    expect(nextPhase('change_control')).toBeNull()
  })

  it('prevPhase returns correct previous', () => {
    expect(prevPhase('change_control')).toBe('monitoring')
    expect(prevPhase('monitoring')).toBe('execution')
    expect(prevPhase('execution')).toBe('planning')
    expect(prevPhase('planning')).toBe('initiation')
    expect(prevPhase('initiation')).toBeNull()
  })

  it('isValidPhaseTransition respects transitions', () => {
    expect(isValidPhaseTransition('initiation', 'planning')).toBe(true)
    expect(isValidPhaseTransition('planning', 'execution')).toBe(true)
    expect(isValidPhaseTransition('execution', 'monitoring')).toBe(true)
    expect(isValidPhaseTransition('monitoring', 'change_control')).toBe(true)
    // Invalid: skip
    expect(isValidPhaseTransition('initiation', 'execution')).toBe(false)
    expect(isValidPhaseTransition('planning', 'change_control')).toBe(false)
  })
})

// ─── §2.5 TRIZ-to-Phase Mapping ───────────────────────────────────────────

describe('TRIZ-to-Phase Mapping', () => {
  it('maps technical_analyzer_ref to planning and execution', () => {
    const phases = trizSourceToPrimaryPhases('technical_analyzer_ref')
    expect(phases).toContain('planning')
    expect(phases).toContain('execution')
  })

  it('maps contradiction_ref to initiation, planning, execution', () => {
    const phases = trizSourceToPrimaryPhases('contradiction_ref')
    expect(phases).toContain('initiation')
    expect(phases).toContain('planning')
    expect(phases).toContain('execution')
  })

  it('maps risk_summary to all five phases', () => {
    const phases = trizSourceToPrimaryPhases('risk_summary')
    expect(phases).toHaveLength(5)
  })

  it('maps decision_ref to all five phases', () => {
    const phases = trizSourceToPrimaryPhases('decision_ref')
    expect(phases).toHaveLength(5)
  })

  it('unknown source returns empty array', () => {
    const phases = trizSourceToPrimaryPhases('unknown' as PmSourceKind)
    expect(phases).toEqual([])
  })

  it('criticalSourcesForPhase returns expected sources for each phase', () => {
    expect(criticalSourcesForPhase('initiation').length).toBeGreaterThan(0)
    expect(criticalSourcesForPhase('planning').length).toBeGreaterThan(0)
    expect(criticalSourcesForPhase('execution').length).toBeGreaterThan(0)
    expect(criticalSourcesForPhase('monitoring').length).toBeGreaterThan(0)
    expect(criticalSourcesForPhase('change_control').length).toBeGreaterThan(0)
  })

  it('recommendedTrizToolsForPhase returns tools for each phase', () => {
    for (const pid of PM_PHASE_IDS) {
      expect(recommendedTrizToolsForPhase(pid).length).toBeGreaterThan(0)
    }
  })

  it('recommended tools use review-oriented action kinds', () => {
    for (const pid of PM_PHASE_IDS) {
      const tools = recommendedTrizToolsForPhase(pid)
      for (const t of tools) {
        // Must NOT contain auto-apply, auto-execute
        expect(t).not.toContain('auto')
        expect(t).not.toContain('apply')
      }
    }
  })
})

// ─── §2.6 Readiness ───────────────────────────────────────────────────────

describe('Readiness Calculation', () => {
  it('returns blocked_stale when staleCount > 0', () => {
    expect(computeReadiness(1.0, 0, 1, 0, 'low', true, false)).toBe('blocked_stale')
  })

  it('returns insufficient_evidence when missingCriticalCount >= 2', () => {
    expect(computeReadiness(0.8, 0, 0, 2, 'low', true, false)).toBe('insufficient_evidence')
  })

  it('returns requires_human_confirmation when flag is true', () => {
    expect(computeReadiness(0.6, 0, 0, 1, 'low', true, true)).toBe('requires_human_confirmation')
  })

  it('returns needs_review when freshness low', () => {
    expect(computeReadiness(0.3, 0, 0, 0, 'low', true, false)).toBe('needs_review')
  })

  it('returns needs_review when many unresolved decisions', () => {
    expect(computeReadiness(0.9, 5, 0, 0, 'low', true, false)).toBe('needs_review')
  })

  it('returns needs_review when warning severity high', () => {
    expect(computeReadiness(0.9, 0, 0, 0, 'high', true, false)).toBe('needs_review')
  })

  it('returns ready when all conditions met', () => {
    expect(computeReadiness(0.9, 0, 0, 0, 'low', true, false)).toBe('ready')
  })

  it('staleCount has highest priority', () => {
    // Even with everything else perfect, stale overrides
    expect(computeReadiness(1.0, 0, 1, 0, 'low', true, false)).toBe('blocked_stale')
  })
})

describe('Source Freshness', () => {
  it('returns 1.0 when no stale/missing', () => {
    expect(computeSourceFreshness(10, 0)).toBe(1.0)
  })

  it('returns 0.5 when half stale', () => {
    expect(computeSourceFreshness(10, 5)).toBe(0.5)
  })

  it('returns 0.0 when total sources is 0', () => {
    expect(computeSourceFreshness(0, 0)).toBe(0)
  })

  it('saturates at 0.0 when all stale', () => {
    expect(computeSourceFreshness(5, 10)).toBe(0)
  })
})

// ─── §2.7 Stale Detection ─────────────────────────────────────────────────

describe('Stale Detection', () => {
  it('isSourceStale returns true when hashes differ', () => {
    expect(isSourceStale('abc', 'def')).toBe(true)
  })

  it('isSourceStale returns false when hashes match', () => {
    expect(isSourceStale('abc', 'abc')).toBe(false)
  })

  it('isSourceStale returns false when current is empty', () => {
    expect(isSourceStale('', 'abc')).toBe(false)
  })

  it('detectStaleSources finds mismatches', () => {
    const current = { a: 'hash1', b: 'hash2', c: 'hash3' }
    const snapshotted = { a: 'hash1', b: 'old_hash', c: 'hash3' }
    const stale = detectStaleSources(current, snapshotted)
    expect(stale).toEqual(['b'])
  })

  it('detectStaleSources returns empty when all match', () => {
    const current = { a: 'hash1', b: 'hash2' }
    const snapshotted = { a: 'hash1', b: 'hash2' }
    expect(detectStaleSources(current, snapshotted)).toHaveLength(0)
  })

  it('isPhaseStale returns true when any source stale', () => {
    const current = { a: 'hash1' }
    const snapshotted = { a: 'old' }
    expect(isPhaseStale(current, snapshotted)).toBe(true)
  })

  it('isPhaseStale returns false when all fresh', () => {
    const current = { a: 'hash1' }
    const snapshotted = { a: 'hash1' }
    expect(isPhaseStale(current, snapshotted)).toBe(false)
  })
})

// ─── §2.7 Warning Aggregation ─────────────────────────────────────────────

describe('Warning Aggregation', () => {
  it('sorts warnings by severity', () => {
    const warnings: PhaseWarning[] = [
      { code: 'SOURCE_STALE', message: 'low', severity: 'low' },
      { code: 'SOURCE_UNAVAILABLE', message: 'high', severity: 'high' },
      { code: 'MISSING_CRITICAL_CATEGORY', message: 'medium', severity: 'medium' },
    ]
    const sorted = sortPhaseWarningsBySeverity(warnings)
    expect(sorted[0].severity).toBe('high')
    expect(sorted[1].severity).toBe('medium')
    expect(sorted[2].severity).toBe('low')
  })

  it('aggregatePhaseWarnings deduplicates', () => {
    const w1: PhaseWarning[] = [
      { code: 'SOURCE_STALE', message: 'stale', severity: 'medium', sourceKind: 'risk_summary' },
    ]
    const w2: PhaseWarning[] = [
      { code: 'SOURCE_STALE', message: 'stale', severity: 'medium', sourceKind: 'risk_summary' },
    ]
    expect(aggregatePhaseWarnings(w1, w2)).toHaveLength(1)
  })

  it('aggregatePhaseWarnings sorts by severity', () => {
    const w1: PhaseWarning[] = [
      { code: 'SOURCE_STALE', message: 'low', severity: 'low', sourceKind: 'a' },
    ]
    const w2: PhaseWarning[] = [
      { code: 'SOURCE_UNAVAILABLE', message: 'high', severity: 'high', sourceKind: 'b' },
    ]
    const ag = aggregatePhaseWarnings(w1, w2)
    expect(ag[0].severity).toBe('high')
  })

  it('maxWarningSeverity returns highest', () => {
    const ws: PhaseWarning[] = [
      { code: 'SOURCE_STALE', message: 'l', severity: 'low' },
      { code: 'SOURCE_PERMISSION_DENIED', message: 'm', severity: 'medium' },
    ]
    expect(maxWarningSeverity(ws)).toBe('medium')
    expect(maxWarningSeverity([])).toBe('low')
  })
})

// ─── §2.8 Redaction ──────────────────────────────────────────────────────

describe('Redaction', () => {
  it('redactSourceRef hides title and navigation when no permission', () => {
    const ref = buildPmSourceRef({ title: 'Secret', hasNavigation: true })
    const redacted = redactSourceRef(ref, false)
    expect(redacted.title).toBe('')
    expect(redacted.hasNavigation).toBe(false)
    expect(redacted.redactionReason).toBe('SOURCE_PERMISSION_DENIED')
  })

  it('redactSourceRef preserves when has permission', () => {
    const ref = buildPmSourceRef({ title: 'Visible' })
    const redacted = redactSourceRef(ref, true)
    expect(redacted.title).toBe('Visible')
    expect(redacted.hasNavigation).toBe(true)
    expect(redacted.redactionReason).toBeUndefined()
  })

  it('redactSourceRefs batch handles permissions', () => {
    const refs = [
      buildPmSourceRef({ sourceKind: 'risk_summary', sourceId: 'r1', title: 'Risk 1' }),
      buildPmSourceRef({ sourceKind: 'contradiction_ref', sourceId: 'c1', title: 'Hidden' }),
    ]
    const permMap: Record<string, boolean> = {
      'risk_summary:r1': true,
      'contradiction_ref:c1': false,
    }
    const redacted = redactSourceRefs(refs, permMap)
    expect(redacted[0].title).toBe('Risk 1')
    expect(redacted[1].title).toBe('')
  })

  it('redactPhaseSnapshot filters recommendations with no allowed sources', () => {
    const snapshot = buildPhaseSnapshot('planning', {
      sourceRefs: [buildPmSourceRef({ sourceKind: 'risk_summary', sourceId: 'r1' })],
      recommendations: [
        buildPhaseRecommendation({
          sourceRefs: [buildPmSourceRef({ sourceKind: 'risk_summary', sourceId: 'r1' })],
        }),
      ],
    })
    const permMap: Record<string, boolean> = { 'risk_summary:r1': false }
    const redacted = redactPhaseSnapshot(snapshot, permMap)
    expect(redacted.recommendations).toHaveLength(0)
  })
})

// ─── §2.11/2.12 Deterministic Outputs ─────────────────────────────────────

describe('Deterministic Output Hashes', () => {
  it('computePhaseRunOutputHash is stable', () => {
    const s1 = buildPhaseSnapshot('initiation')
    const s2 = buildPhaseSnapshot('planning')
    const h1 = computePhaseRunOutputHash([s1, s2])
    const h2 = computePhaseRunOutputHash([s1, s2])
    expect(h1).toBe(h2)
  })

  it('computePhaseRunOutputHash changes with different snapshots', () => {
    const s1 = buildPhaseSnapshot('initiation', { readiness: 'ready' })
    const s2 = buildPhaseSnapshot('initiation', { readiness: 'blocked_stale' })
    const h1 = computePhaseRunOutputHash([s1])
    const h2 = computePhaseRunOutputHash([s2])
    expect(h1).not.toBe(h2)
  })

  it('validatePhaseHandoffInput catches invalid phaseId', () => {
    const warnings = validatePhaseHandoffInput({
      phaseId: 'invalid_phase',
      recommendationId: 'rec1',
      target: 'workbench',
    })
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.some((w) => w.severity === 'high')).toBe(true)
  })

  it('validatePhaseHandoffInput passes valid input', () => {
    const warnings = validatePhaseHandoffInput({
      phaseId: 'planning',
      recommendationId: 'rec1',
      target: 'workbench',
    })
    expect(warnings).toHaveLength(0)
  })

  it('sortPhaseRecommendations sorts by priority', () => {
    const recs: PhaseRecommendation[] = [
      buildPhaseRecommendation({ priority: 3, recommendationId: 'c' }),
      buildPhaseRecommendation({ priority: 1, recommendationId: 'a' }),
      buildPhaseRecommendation({ priority: 2, recommendationId: 'b' }),
    ]
    const sorted = sortPhaseRecommendations(recs)
    expect(sorted[0].priority).toBe(1)
    expect(sorted[1].priority).toBe(2)
    expect(sorted[2].priority).toBe(3)
  })
})

// ─── §2.9 Fixture Builders ────────────────────────────────────────────────

describe('Fixture Builders', () => {
  it('buildPmSourceRef returns valid ref', () => {
    const ref = buildPmSourceRef()
    expect(ref.sourceKind).toBeTruthy()
    expect(ref.sourceHash).toHaveLength(8)
    expect(ref.hasNavigation).toBe(true)
  })

  it('buildPhaseGap returns valid gap', () => {
    const gap = buildPhaseGap()
    expect(gap.severity).toBe('medium')
    expect(gap.previewOnly).toBe(true)
    expect(gap.requiresUserConfirmation).toBe(true)
  })

  it('buildPhaseRecommendation is previewOnly', () => {
    const rec = buildPhaseRecommendation()
    expect(rec.previewOnly).toBe(true)
    expect(rec.requiresUserConfirmation).toBe(true)
  })

  it('buildPhaseSnapshot returns valid snapshot', () => {
    const snap = buildPhaseSnapshot('execution')
    expect(snap.phaseId).toBe('execution')
    expect(snap.runId).toBe('run-1')
  })

  it('buildCompletePhaseIntegrationRun has 5 phases', () => {
    const run = buildCompletePhaseIntegrationRun()
    expect(run.phases).toHaveLength(5)
    expect(run.status).toBe('completed')
    // All phases are ready by default
    for (const p of run.phases) {
      expect(p.readiness).toBe('ready')
    }
  })

  it('buildCompletePhaseIntegrationRun has recommendations per phase', () => {
    const run = buildCompletePhaseIntegrationRun()
    for (const p of run.phases) {
      expect(p.recommendations.length).toBeGreaterThan(0)
    }
  })

  it('buildSparsePhaseIntegrationRun has insufficient evidence', () => {
    const run = buildSparsePhaseIntegrationRun()
    for (const p of run.phases) {
      expect(p.readiness).toBe('insufficient_evidence')
      expect(p.warnings.length).toBeGreaterThan(0)
    }
  })

  it('buildStalePhaseIntegrationRun has blocked stale status', () => {
    const run = buildStalePhaseIntegrationRun()
    for (const p of run.phases) {
      expect(p.readiness).toBe('blocked_stale')
      expect(p.stale).toBe(true)
      expect(p.warnings.some((w) => w.code === 'SOURCE_STALE')).toBe(true)
    }
  })

  it('buildPermissionRestrictedPhaseIntegrationRun has permission warnings', () => {
    const run = buildPermissionRestrictedPhaseIntegrationRun()
    for (const p of run.phases) {
      expect(p.warnings.some((w) => w.code === 'SOURCE_PERMISSION_DENIED')).toBe(true)
      // Has hidden refs
      const hiddenRefs = p.sourceRefs.filter((r) => r.redactionReason)
      expect(hiddenRefs.length).toBe(2)
    }
  })

  it('fixture recommendations use review-oriented language', () => {
    const run = buildCompletePhaseIntegrationRun()
    for (const p of run.phases) {
      for (const r of p.recommendations) {
        // Must not contain "自动应用" or "一键执行"
        expect(r.title).not.toContain('自动')
        expect(r.description).not.toContain('一键')
        expect(r.description).not.toContain('自动应用')
      }
    }
  })
})

// ─── §2.13 Large Fixture Performance ──────────────────────────────────────

describe('Large Fixture Performance', () => {
  it('buildLargePhaseIntegrationPacket generates 1000 source refs', () => {
    const { run, sourceRefCount, recommendationCount } = buildLargePhaseIntegrationPacket()
    expect(sourceRefCount).toBe(1000)
    expect(recommendationCount).toBe(500)
    expect(run.phases).toHaveLength(5)
    const totalRefs = run.phases.reduce((s, p) => s + p.sourceRefs.length, 0)
    expect(totalRefs).toBe(1000)
    const totalRecs = run.phases.reduce((s, p) => s + p.recommendations.length, 0)
    expect(totalRecs).toBe(500)
  })

  it('large packet output hash is stable', () => {
    const { run: r1 } = buildLargePhaseIntegrationPacket()
    const { run: r2 } = buildLargePhaseIntegrationPacket()
    // Different run IDs (timestamp-based) but same structure
    expect(r1.phases).toHaveLength(r2.phases.length)
    // Output hash should be deterministic given same inputs
    const h1 = computePhaseRunOutputHash(r1.phases)
    const h2 = computePhaseRunOutputHash(r1.phases)
    expect(h1).toBe(h2)
  })

  it('large packet generation is fast (< 100ms)', () => {
    const start = performance.now()
    buildLargePhaseIntegrationPacket()
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(100)
  })

  it('1000 refs + 500 recs hash computation is fast (< 50ms)', () => {
    const { run } = buildLargePhaseIntegrationPacket()
    const start = performance.now()
    computePhaseRunOutputHash(run.phases)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(50)
  })
})

// ─── §2.12 No-AI Contract ────────────────────────────────────────────────

describe('No-AI Deterministic Contract', () => {
  it('PHASE_INTEGRATION_NO_AI_CONTRACT specifies no AI calls', () => {
    expect(PHASE_INTEGRATION_NO_AI_CONTRACT.noAIGatewayCall).toBe(true)
    expect(PHASE_INTEGRATION_NO_AI_CONTRACT.allPureFunctions).toBe(true)
    expect(PHASE_INTEGRATION_NO_AI_CONTRACT.zeroSideEffects).toBe(true)
  })

  test('all mapping functions are pure: same input → same output', () => {
    // trizSourceToPrimaryPhases
    const r1 = trizSourceToPrimaryPhases('contradiction_ref')
    const r2 = trizSourceToPrimaryPhases('contradiction_ref')
    expect(r1).toEqual(r2)

    // criticalSourcesForPhase
    expect(criticalSourcesForPhase('planning')).toEqual(criticalSourcesForPhase('planning'))

    // recommendedTrizToolsForPhase
    expect(recommendedTrizToolsForPhase('execution')).toEqual(
      recommendedTrizToolsForPhase('execution'),
    )

    // computeReadiness
    expect(computeReadiness(0.8, 2, 0, 0, 'medium', true, false)).toBe(
      computeReadiness(0.8, 2, 0, 0, 'medium', true, false),
    )
  })
})

// ─── Consistency: preview/confirmation flags ──────────────────────────────

describe('Safety Guards in Fixtures', () => {
  it('gaps always have previewOnly=true', () => {
    for (const pid of PM_PHASE_IDS) {
      const snap = buildPhaseSnapshot(pid, {
        gaps: [buildPhaseGap(), buildPhaseGap({ recommendedAction: 'review_risk' })],
      })
      for (const g of snap.gaps) {
        expect(g.previewOnly).toBe(true)
      }
    }
  })

  it('recommendations always have previewOnly=true', () => {
    for (const pid of PM_PHASE_IDS) {
      const rec = buildPhaseRecommendation({ actionKind: 'open_workbench' })
      expect(rec.previewOnly).toBe(true)
    }
  })

  it('no fixture contains auto-apply or auto-execute wording', () => {
    const fixtures = [
      buildCompletePhaseIntegrationRun(),
      buildSparsePhaseIntegrationRun(),
      buildStalePhaseIntegrationRun(),
      buildPermissionRestrictedPhaseIntegrationRun(),
    ]
    for (const f of fixtures) {
      for (const p of f.phases) {
        for (const r of p.recommendations) {
          const combined = `${r.title} ${r.description}`
          expect(combined).not.toMatch(/自动应用|一键执行|auto.apply|auto.execute/i)
        }
      }
    }
  })
})
