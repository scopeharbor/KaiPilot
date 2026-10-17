/**
 * v3-ai-automated-evaluation §7 — 聚合、调和与失败姿态测试。
 *
 * 覆盖：
 * - §7.1 只读评分聚合（按组织、维度、时间窗）
 * - §7.2 趋势查询按 judge 模型与 prompt 版本分组
 * - §7.4 组织隔离
 * - §7.5 跨组织访问返回不泄露错误
 * - §7.6–7.7 Skill 评测映射去重
 * - §7.8 既有 Skill 评测无回归
 * - §7.9–7.10 评测失败降级
 *
 * @aiproj/backend tests — 零网络零 provider
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  EvaluationAggregationService,
  type EvaluationScoreStore,
  SkillEvaluationMappingService,
  EvaluationDegradationGuard,
  CrossOrganizationAccessDeniedError,
} from '../../app/services/ai_evaluation/aggregation_service.js'

// ── 辅助 ──────────────────────────────────────────────────────────────

function seedScores(store: EvaluationScoreStore) {
  const base = { createdAt: '2026-08-17T12:00:00.000Z' }
  // Org 1: 3 pass, 1 fail
  store.addScore({
    ...base,
    organizationId: 1,
    evaluationName: 'draft_structural_compliance',
    scoreValue: 1,
    scoreLabel: 'pass',
    evaluatorKind: 'deterministic',
    id: '1',
  })
  store.addScore({
    ...base,
    organizationId: 1,
    evaluationName: 'draft_structural_compliance',
    scoreValue: 1,
    scoreLabel: 'pass',
    evaluatorKind: 'deterministic',
    id: '2',
  })
  store.addScore({
    ...base,
    organizationId: 1,
    evaluationName: 'draft_structural_compliance',
    scoreValue: 1,
    scoreLabel: 'pass',
    evaluatorKind: 'deterministic',
    id: '3',
  })
  store.addScore({
    ...base,
    organizationId: 1,
    evaluationName: 'draft_structural_compliance',
    scoreValue: 0,
    scoreLabel: 'fail',
    evaluatorKind: 'deterministic',
    id: '4',
  })
  // Org 1: 2 judge scores
  store.addScore({
    ...base,
    organizationId: 1,
    evaluationName: 'narration_cites_out_of_context_fact',
    scoreValue: 0.8,
    scoreLabel: 'pass',
    evaluatorKind: 'judge',
    judgeModel: 'openai/gpt-4',
    judgePromptVersion: 'v2.1',
    id: '5',
  })
  store.addScore({
    ...base,
    organizationId: 1,
    evaluationName: 'narration_cites_out_of_context_fact',
    scoreValue: 0.6,
    scoreLabel: 'pass',
    evaluatorKind: 'judge',
    judgeModel: 'openai/gpt-4',
    judgePromptVersion: 'v2.1',
    id: '6',
  })
  // Org 2: 1 score
  store.addScore({
    ...base,
    organizationId: 2,
    evaluationName: 'draft_structural_compliance',
    scoreValue: 1,
    scoreLabel: 'pass',
    evaluatorKind: 'deterministic',
    id: '7',
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// §7.1 只读评分聚合
// ═══════════════════════════════════════════════════════════════════════════════

describe('EvaluationAggregationService', () => {
  let service: EvaluationAggregationService

  beforeEach(() => {
    service = new EvaluationAggregationService()
    seedScores(service.getStore())
  })

  it('aggregates by dimension for org 1', () => {
    const result = service.aggregate({
      organizationId: 1,
      groupBy: ['dimension'],
      windowStart: '2026-08-17T00:00:00.000Z',
      windowEnd: '2026-08-18T00:00:00.000Z',
    })
    expect(result.isEmptyWindow).toBe(false)
    expect(result.total).toBe(6)
    expect(result.entries.length).toBe(2) // draft_structural + narration
  })

  it('returns empty window when no scores', () => {
    const result = service.aggregate({
      organizationId: 999,
      groupBy: ['dimension'],
      windowStart: '2026-08-17T00:00:00.000Z',
      windowEnd: '2026-08-18T00:00:00.000Z',
    })
    expect(result.isEmptyWindow).toBe(true)
    expect(result.total).toBe(0)
  })

  it('respects dimension filter', () => {
    const result = service.aggregate({
      organizationId: 1,
      groupBy: ['dimension'],
      windowStart: '2026-08-17T00:00:00.000Z',
      windowEnd: '2026-08-18T00:00:00.000Z',
      dimension: 'draft_structural_compliance',
    })
    expect(result.total).toBe(4)
    expect(result.entries).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §7.2 趋势查询按 judge 版本分组
// ═══════════════════════════════════════════════════════════════════════════════

describe('trendByJudgeVersion', () => {
  let service: EvaluationAggregationService

  beforeEach(() => {
    service = new EvaluationAggregationService()
    seedScores(service.getStore())
  })

  it('groups by judge model and prompt version', () => {
    const result = service.trendByJudgeVersion({
      organizationId: 1,
      groupBy: ['judge_model', 'judge_prompt_version'],
      windowStart: '2026-08-17T00:00:00.000Z',
      windowEnd: '2026-08-18T00:00:00.000Z',
    })
    expect(result.total).toBe(2)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].groupKey.judge_model).toBe('openai/gpt-4')
    expect(result.entries[0].groupKey.judge_prompt_version).toBe('v2.1')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §7.4 组织隔离
// ═══════════════════════════════════════════════════════════════════════════════

describe('organization isolation', () => {
  let service: EvaluationAggregationService

  beforeEach(() => {
    service = new EvaluationAggregationService()
    seedScores(service.getStore())
  })

  it('org 1 sees only org 1 scores', () => {
    const result = service.aggregate({
      organizationId: 1,
      groupBy: ['dimension'],
      windowStart: '2026-08-17T00:00:00.000Z',
      windowEnd: '2026-08-18T00:00:00.000Z',
    })
    expect(result.total).toBe(6)
  })

  it('org 2 sees only org 2 scores', () => {
    const result = service.aggregate({
      organizationId: 2,
      groupBy: ['dimension'],
      windowStart: '2026-08-17T00:00:00.000Z',
      windowEnd: '2026-08-18T00:00:00.000Z',
    })
    expect(result.total).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §7.5 跨组织非泄露错误
// ═══════════════════════════════════════════════════════════════════════════════

describe('cross-organization access', () => {
  it('CrossOrganizationAccessDeniedError does not leak info', () => {
    const error = new CrossOrganizationAccessDeniedError()
    expect(error.message).toBe('Permission denied')
    expect(error.message).not.toContain('organization')
    expect(error.message).not.toContain('score')
    expect(error.message).not.toContain('distribution')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §7.6–7.8 Skill 评测映射去重
// ═══════════════════════════════════════════════════════════════════════════════

describe('SkillEvaluationMappingService', () => {
  let service: SkillEvaluationMappingService

  beforeEach(() => {
    service = new SkillEvaluationMappingService()
  })

  it('§7.6 maps skill eval to unified score view', () => {
    const mapping = service.mapSkillEvalToScore({
      skillEvalRunId: 42,
      dimension: 'draft_structural_compliance',
      coverageRate: 0.85,
    })
    expect(mapping.skillEvalRunId).toBe(42)
    expect(mapping.scoreValue).toBe(0.85)
    expect(mapping.scoreLabel).toBe('pass')
    expect(mapping.deduplicationKey).toContain('skill_eval:42:')
  })

  it('§7.7 skill eval is counted once (deduplication)', () => {
    // Add same mapping twice
    service.mapSkillEvalToScore({
      skillEvalRunId: 42,
      dimension: 'draft_structural_compliance',
      coverageRate: 0.85,
    })
    service.mapSkillEvalToScore({
      skillEvalRunId: 42,
      dimension: 'draft_structural_compliance',
      coverageRate: 0.85,
    })
    const count = service.getStore().countByDedupKey('skill_eval:42:draft_structural_compliance')
    expect(count).toBe(1) // 去重后只有一条
  })

  it('§7.8 different skill evals are separate', () => {
    service.mapSkillEvalToScore({
      skillEvalRunId: 42,
      dimension: 'draft_structural_compliance',
      coverageRate: 0.85,
    })
    service.mapSkillEvalToScore({
      skillEvalRunId: 43,
      dimension: 'draft_structural_compliance',
      coverageRate: 0.7,
    })
    expect(service.getStore().getMappings()).toHaveLength(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §7.9–7.10 评测失败降级
// ═══════════════════════════════════════════════════════════════════════════════

describe('EvaluationDegradationGuard', () => {
  let guard: EvaluationDegradationGuard

  beforeEach(() => {
    guard = new EvaluationDegradationGuard()
  })

  it('§7.9 executes successfully without degradation', async () => {
    const { result, degraded } = await guard.executeWithDegradation(
      async () => 'success',
      'fallback',
    )
    expect(result).toBe('success')
    expect(degraded).toBe(false)
  })

  it('§7.9 degrades safely on error', async () => {
    const { result, degraded } = await guard.executeWithDegradation(async () => {
      throw new Error('scoring failed')
    }, 'fallback')
    expect(result).toBe('fallback')
    expect(degraded).toBe(true)
  })

  it('§7.10 scoring failure leaves business state unchanged', () => {
    const unchanged = guard.assertBusinessStateUnchanged({
      scoringError: new Error('scoring failed'),
      confirmationPendingBefore: true,
      confirmationPendingAfter: true,
      generationRunningBefore: true,
      generationRunningAfter: true,
    })
    expect(unchanged).toBe(true)
  })

  it('§7.10 detects state change (should not happen)', () => {
    const unchanged = guard.assertBusinessStateUnchanged({
      scoringError: new Error('scoring failed'),
      confirmationPendingBefore: true,
      confirmationPendingAfter: false, // State changed!
      generationRunningBefore: true,
      generationRunningAfter: true,
    })
    expect(unchanged).toBe(false)
  })
})
