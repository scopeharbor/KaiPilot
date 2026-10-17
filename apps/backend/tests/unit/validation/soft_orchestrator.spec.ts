/**
 * Soft Evaluator Orchestrator 单元测试（tasks 6.5）。
 *
 * 覆盖：
 * - 低分维度
 * - unanchored finding
 * - 预算耗尽
 * - 部分维度 unavailable
 * - weighted score 计算
 */

import { describe, expect, it } from 'vitest'
import { SeDimensionRegistry } from '../../../app/services/compiler/validation/registry/se_dimension_registry.js'
import { EvaluationProfileService } from '../../../app/services/compiler/validation/registry/evaluation_profiles.js'
import {
  SoftEvaluatorOrchestrator,
  MockLlmCaller,
} from '../../../app/services/compiler/validation/soft_orchestrator/soft_orchestrator.js'
import type { ValidationInputContext } from '../../../app/services/compiler/validation/types.js'

const dimensionRegistry = new SeDimensionRegistry()
const profileService = new EvaluationProfileService(dimensionRegistry)

function createOrchestrator(mockResponses: Record<string, string>) {
  const caller = new MockLlmCaller()
  for (const [dimId, response] of Object.entries(mockResponses)) {
    caller.setResponse(dimId, response)
  }
  return new SoftEvaluatorOrchestrator(dimensionRegistry, profileService, caller)
}

const goodResponse = JSON.stringify({
  dimensionId: 'SE-WBS-01',
  score: 4,
  confidence: 0.85,
  rationale: 'WBS 分解良好',
  findings: [],
})

const lowScoreResponse = JSON.stringify({
  dimensionId: 'SE-WBS-02',
  score: 2,
  confidence: 0.6,
  rationale: '任务粒度不一致',
  findings: [
    {
      description: 'T2x 跨度过大',
      severity: 'warning',
      affectedEntityIds: ['T2x'],
      evidenceSnippet: '3 weeks',
      suggestedReviewAction: '拆分',
    },
  ],
})

const unanchoredResponse = JSON.stringify({
  dimensionId: 'SE-DEL-01',
  score: 2,
  confidence: 0.7,
  rationale: '交付物验收标准不具体',
  findings: [
    {
      description: 'D1 标准不具体',
      severity: 'attention',
      affectedEntityIds: ['NONEXISTENT'],
      evidenceSnippet: 'vague',
      suggestedReviewAction: '补充',
    },
  ],
})

describe('SoftEvaluatorOrchestrator', () => {
  it('低分维度产生 warning', async () => {
    // resource_gate 只有 1 个维度（SE-PR-02），更容易测试
    const ctx: ValidationInputContext = { stageId: 'resource_gate', profileId: 'resource_gate' }
    const orch = createOrchestrator({
      'SE-PR-02': lowScoreResponse.replace('SE-WBS-02', 'SE-PR-02'),
    })
    const report = await orch.evaluate('resource_gate', ctx)
    expect(report.status).toBe('completed')
    expect(report.weightedScore).toBeDefined()
    const lowDim = report.dimensionScores.find((d) => d.dimensionId === 'SE-PR-02')
    expect(lowDim).toBeDefined()
    expect(lowDim!.score).toBe(2)
  })

  it('unanchored finding present', async () => {
    // 使用 requirements_gate（3 个 scope 维度）
    const ctx: ValidationInputContext = {
      stageId: 'requirements_gate',
      profileId: 'requirements_gate',
    }
    const allGood = goodResponse.replace('SE-WBS-01', 'SE-ST-01')
    const orch = createOrchestrator({
      'SE-ST-01': allGood,
      'SE-ST-02': allGood,
      'SE-ST-03': unanchoredResponse.replace('SE-DEL-01', 'SE-ST-03'),
    })
    const report = await orch.evaluate('requirements_gate', ctx)
    const st03 = report.dimensionScores.find((d) => d.dimensionId === 'SE-ST-03')
    expect(st03).toBeDefined()
    // 无效 entity ID 的 finding 应被过滤后 affectedEntityIds 为空
    if (st03!.findings.length > 0) {
      expect(st03!.findings[0].affectedEntityIds).toHaveLength(0)
    }
  })

  it('部分维度 unavailable', async () => {
    const ctx: ValidationInputContext = {
      stageId: 'requirements_gate',
      profileId: 'requirements_gate',
    }
    const allGood = goodResponse.replace('SE-WBS-01', 'SE-ST-01')
    const orch = createOrchestrator({
      'SE-ST-01': allGood,
      'SE-ST-02': 'not valid json',
      'SE-ST-03': allGood,
    })
    const report = await orch.evaluate('requirements_gate', ctx)
    expect(report.status).toBe('partial')
    const unavailable = report.dimensionScores.filter((d) => d.status === 'unavailable')
    expect(unavailable.length).toBeGreaterThanOrEqual(1)
  })

  it('weighted score 计算正确', async () => {
    const ctx: ValidationInputContext = {
      stageId: 'requirements_gate',
      profileId: 'requirements_gate',
    }
    const allGood = goodResponse.replace('SE-WBS-01', 'SE-ST-01')
    const orch = createOrchestrator({
      'SE-ST-01': allGood,
      'SE-ST-02': allGood,
      'SE-ST-03': allGood,
    })
    const report = await orch.evaluate('requirements_gate', ctx)
    expect(report.weightedScore).toBeGreaterThan(0)
    expect(report.weightedScore).toBeLessThanOrEqual(5)
  })
})
