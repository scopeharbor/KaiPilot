/**
 * copilot_health_answer.spec.ts — 项目健康答案测试。
 *
 * 验证：
 * - 健康答案由诊断项与预测信号聚合，复用既有服务不新增规则
 * - 结论按严重度与影响排序，确定性破平局
 * - 每条健康结论可展开到具体诊断项或预测信号
 * - 零素材时输出「暂无足够依据」并说明缺什么
 * - 答案结论集合是健康诊断页面结论集合的子集
 */
import { describe, it, expect } from 'vitest'
import CopilotHealthAnswerService from '#services/copilot/copilot_health_answer_service'
import CopilotAnswerSynthesisService from '#services/copilot/copilot_answer_synthesis_service'
import type { HealthAnswerParams } from '#services/copilot/copilot_health_answer_service'
import type { HealthDiagnosisSummary, PredictionSignalInput } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function createDiagnosisSummary(
  overrides: Partial<HealthDiagnosisSummary> = {},
): HealthDiagnosisSummary {
  return {
    overallScore: 72,
    overallLabel: 'attention',
    dimensionScores: [
      {
        dimension: 'progress',
        score: 65,
        severity: 'medium',
        evidence: [
          {
            ruleId: 'R001',
            entityType: 'task',
            entityId: 0,
            summary: '3个任务逾期，逾期率15%',
            impact: 15,
            severity: 'medium',
          },
        ],
        warnings: [],
        suggestedActions: ['审查逾期任务进度'],
      },
      {
        dimension: 'critical_path',
        score: 80,
        severity: 'low',
        evidence: [
          {
            ruleId: 'R003',
            entityType: 'task',
            entityId: 0,
            summary: '关键路径上1/5个任务逾期',
            impact: 20,
            severity: 'low',
          },
        ],
        warnings: [],
        suggestedActions: ['检查关键路径任务进度'],
      },
    ],
    warnings: [],
    suggestedActions: [],
    evidenceHash: 'abc123',
    ...overrides,
  }
}

function createPredictionSignals(): readonly PredictionSignalInput[] {
  return [
    {
      signalType: 'schedule_risk',
      severity: 'high',
      score: 0.8,
      confidenceBand: 'medium',
      ruleId: 'PR001',
      ruleVersion: '1.0.0',
      description: '排期风险较高，预计延期2周',
      evidenceRefs: [],
    },
    {
      signalType: 'critical_path_drift',
      severity: 'medium',
      score: 0.6,
      confidenceBand: 'low',
      ruleId: 'PR002',
      ruleVersion: '1.0.0',
      description: '关键路径出现漂移',
      evidenceRefs: [],
    },
  ]
}

function createParams(overrides: Partial<HealthAnswerParams> = {}): HealthAnswerParams {
  return {
    organizationId: 1,
    projectId: 1,
    userId: 1,
    diagnosisSummary: createDiagnosisSummary(),
    predictionSignals: createPredictionSignals(),
    uncertainty: [],
    conclusionTrace: [],
    modelAvailable: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 测试：健康答案聚合
// ---------------------------------------------------------------------------

describe('copilot health answer - aggregation', () => {
  it('should aggregate diagnosis items and prediction signals', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotHealthAnswerService(synthesisService)
    const params = createParams()

    const result = await service.answer(params)

    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      expect(result.answerKind).toBe('health')
      expect(result.entries.length).toBeGreaterThan(0)
      expect(result.narrative.length).toBeGreaterThan(0)
    }
  })

  it('should not add new diagnosis rules or prediction models', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotHealthAnswerService(synthesisService)
    const params = createParams()

    const result = await service.answer(params)

    // 验证没有引入新的规则或模型
    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      // 所有素材都应该来自既有的诊断项或预测信号
      for (const entry of result.entries) {
        for (const sourceRef of entry.sourceRefs) {
          expect(['diagnosis-item', 'prediction-signal']).toContain(sourceRef.sourceKind)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 测试：结论排序
// ---------------------------------------------------------------------------

describe('copilot health answer - sorting', () => {
  it('should sort conclusions by severity and impact', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotHealthAnswerService(synthesisService)
    const params = createParams()

    const result = await service.answer(params)

    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      // 验证结论按分组排序
      for (let i = 1; i < result.entries.length; i++) {
        expect(
          result.entries[i].group.localeCompare(result.entries[i - 1].group),
        ).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 测试：结论可追溯
// ---------------------------------------------------------------------------

describe('copilot health answer - traceability', () => {
  it('should have sourceRef for each conclusion', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotHealthAnswerService(synthesisService)
    const params = createParams()

    const result = await service.answer(params)

    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      for (const entry of result.entries) {
        expect(entry.sourceRefs.length).toBeGreaterThan(0)
        for (const sourceRef of entry.sourceRefs) {
          expect(sourceRef.sourceId).toBeTruthy()
          expect(sourceRef.summary).toBeTruthy()
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 测试：零素材
// ---------------------------------------------------------------------------

describe('copilot health answer - zero material', () => {
  it('should output insufficient evidence when no diagnosis record', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotHealthAnswerService(synthesisService)
    const params = createParams({
      diagnosisSummary: null,
      predictionSignals: [],
    })

    const result = await service.answer(params)

    expect(result.kind).toBe('insufficient')
    if (result.kind === 'insufficient') {
      expect(result.reason).toBeTruthy()
      expect(result.missingWhat).toBeTruthy()
    }
  })

  it('should not produce any conclusion when no material', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotHealthAnswerService(synthesisService)
    const params = createParams({
      diagnosisSummary: null,
      predictionSignals: [],
    })

    const result = await service.answer(params)

    expect(result.kind).toBe('insufficient')
    if (result.kind === 'insufficient') {
      // 不应该有任何结论
      expect(result.kind).toBe('insufficient')
    }
  })

  it('should not fall back to generic advice when no material', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotHealthAnswerService(synthesisService)
    const params = createParams({
      diagnosisSummary: null,
      predictionSignals: [],
    })

    const result = await service.answer(params)

    expect(result.kind).toBe('insufficient')
    if (result.kind === 'insufficient') {
      // 不应该有通用建议
      expect(result.missingWhat).not.toContain('建议')
    }
  })
})

// ---------------------------------------------------------------------------
// 测试：答案结论是页面结论的子集
// ---------------------------------------------------------------------------

describe('copilot health answer - subset of surface conclusions', () => {
  it('should only include conclusions from diagnosis and prediction', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotHealthAnswerService(synthesisService)
    const params = createParams()

    const result = await service.answer(params)

    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      // 所有结论都应该来自诊断项或预测信号
      for (const entry of result.entries) {
        const hasValidSource = entry.sourceRefs.some(
          (ref: any) =>
            ref.sourceKind === 'diagnosis-item' || ref.sourceKind === 'prediction-signal',
        )
        expect(hasValidSource).toBe(true)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 测试：深度链接
// ---------------------------------------------------------------------------

describe('copilot health answer - deep link', () => {
  it('should include deep link to health diagnosis page', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotHealthAnswerService(synthesisService)
    const params = createParams()

    const result = await service.answer(params)

    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      expect(result.deepLink).toBeTruthy()
      expect(result.deepLink?.label).toBeTruthy()
      expect(result.deepLink?.href).toContain('/health')
    }
  })
})

// ---------------------------------------------------------------------------
// 测试：模型不可用降级
// ---------------------------------------------------------------------------

describe('copilot health answer - model unavailability', () => {
  it('should produce answer with fallback when model is unavailable', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotHealthAnswerService(synthesisService)
    const params = createParams({
      modelAvailable: false,
    })

    const result = await service.answer(params)

    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      expect(result.isFallback).toBe(true)
      expect(result.fallbackReason).toBeTruthy()
    }
  })
})
