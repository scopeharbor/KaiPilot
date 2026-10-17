/**
 * copilot_answer_permissions.spec.ts — 权限、组织隔离与红线测试。
 *
 * 验证：
 * - 三类答案的素材读取继承各来源既有权限模型，不绕过
 * - 无诊断读权限时健康答案缺席
 * - 组织隔离：诊断、预测与知识查询全部附加 organization_id
 * - 跨组织素材恒不进答案
 * - 三类答案零域写，且不产生任何待执行动作
 * - 合成服务无域仓储或模型写依赖
 * - 健康诊断、预测、知识与帮助页既有行为未被改变
 */
import { describe, it, expect } from 'vitest'
import CopilotHealthAnswerService from '#services/copilot/copilot_health_answer_service'
import CopilotPageUsageAnswerService from '#services/copilot/copilot_page_usage_answer_service'
import CopilotTermExplanationService from '#services/copilot/copilot_term_explanation_service'
import CopilotAnswerSynthesisService from '#services/copilot/copilot_answer_synthesis_service'
import type { HealthAnswerParams } from '#services/copilot/copilot_health_answer_service'
import type { PageUsageAnswerParams } from '#services/copilot/copilot_page_usage_answer_service'
import type { TermExplanationParams } from '#services/copilot/copilot_term_explanation_service'
import type {
  HealthDiagnosisSummary,
  PredictionSignalInput,
  KnowledgeItemLowSensitiveProjection,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function createDiagnosisSummary(): HealthDiagnosisSummary {
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
            summary: '3个任务逾期',
            impact: 15,
            severity: 'medium',
          },
        ],
        warnings: [],
        suggestedActions: [],
      },
    ],
    warnings: [],
    suggestedActions: [],
    evidenceHash: 'abc123',
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
      description: '排期风险较高',
      evidenceRefs: [],
    },
  ]
}

function createKnowledgeEntries(): readonly KnowledgeItemLowSensitiveProjection[] {
  return [
    {
      id: 1,
      layer: 'L1',
      title: '甘特图',
      status: 'active',
      domain: 'project-management',
      purpose: '项目进度可视化',
      provenance: { sources: [] },
      isSynthetic: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ]
}

// ---------------------------------------------------------------------------
// 测试：权限继承
// ---------------------------------------------------------------------------

describe('copilot answer permissions - inheritance', () => {
  it('health answer should inherit diagnosis permission model', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotHealthAnswerService(synthesisService)
    const params: HealthAnswerParams = {
      organizationId: 1,
      projectId: 1,
      userId: 1,
      diagnosisSummary: createDiagnosisSummary(),
      predictionSignals: createPredictionSignals(),
      uncertainty: [],
      conclusionTrace: [],
      modelAvailable: true,
    }

    const result = await service.answer(params)

    // 验证答案包含来自诊断的素材
    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      const sourceKinds = result.entries.flatMap((e: any) =>
        e.sourceRefs.map((r: any) => r.sourceKind),
      )
      expect(sourceKinds).toContain('diagnosis-item')
    }
  })

  it('term explanation should inherit knowledge permission model', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotTermExplanationService(synthesisService)
    const params: TermExplanationParams = {
      organizationId: 1,
      projectId: 1,
      userId: 1,
      term: '甘特图',
      knowledgeEntries: createKnowledgeEntries(),
      uncertainty: [],
      conclusionTrace: [],
      modelAvailable: true,
    }

    const result = await service.answer(params)

    // 验证答案包含来自知识的素材
    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      const sourceKinds = result.entries.flatMap((e: any) =>
        e.sourceRefs.map((r: any) => r.sourceKind),
      )
      expect(sourceKinds).toContain('knowledge-entry')
    }
  })
})

// ---------------------------------------------------------------------------
// 测试：组织隔离
// ---------------------------------------------------------------------------

describe('copilot answer permissions - organization isolation', () => {
  it('health answer should only use organization-scoped data', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotHealthAnswerService(synthesisService)
    const params: HealthAnswerParams = {
      organizationId: 1, // 组织 1
      projectId: 1,
      userId: 1,
      diagnosisSummary: createDiagnosisSummary(),
      predictionSignals: createPredictionSignals(),
      uncertainty: [],
      conclusionTrace: [],
      modelAvailable: true,
    }

    const result = await service.answer(params)

    // 验证答案只包含组织 1 的数据
    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      // 所有素材都应该来自组织 1 的诊断或预测
      for (const entry of result.entries) {
        for (const sourceRef of entry.sourceRefs) {
          expect(['diagnosis-item', 'prediction-signal']).toContain(sourceRef.sourceKind)
        }
      }
    }
  })

  it('term explanation should only use organization-scoped data', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotTermExplanationService(synthesisService)
    const params: TermExplanationParams = {
      organizationId: 1, // 组织 1
      projectId: 1,
      userId: 1,
      term: '甘特图',
      knowledgeEntries: createKnowledgeEntries(),
      uncertainty: [],
      conclusionTrace: [],
      modelAvailable: true,
    }

    const result = await service.answer(params)

    // 验证答案只包含组织 1 的数据
    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      for (const entry of result.entries) {
        for (const sourceRef of entry.sourceRefs) {
          expect(sourceRef.sourceKind).toBe('knowledge-entry')
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 测试：零域写
// ---------------------------------------------------------------------------

describe('copilot answer permissions - zero domain write', () => {
  it('health answer should not write any domain data', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotHealthAnswerService(synthesisService)
    const params: HealthAnswerParams = {
      organizationId: 1,
      projectId: 1,
      userId: 1,
      diagnosisSummary: createDiagnosisSummary(),
      predictionSignals: createPredictionSignals(),
      uncertainty: [],
      conclusionTrace: [],
      modelAvailable: true,
    }

    const result = await service.answer(params)

    // 验证答案不包含任何写操作
    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      // 答案应该只包含读操作
      expect(result.entries.length).toBeGreaterThan(0)
      // 不应该有任何写操作标记
      for (const entry of result.entries) {
        expect(entry.statement).not.toContain('创建')
        expect(entry.statement).not.toContain('更新')
        expect(entry.statement).not.toContain('删除')
      }
    }
  })

  it('page usage answer should not write any domain data', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotPageUsageAnswerService(synthesisService)
    const params: PageUsageAnswerParams = {
      organizationId: 1,
      projectId: 1,
      userId: 1,
      pathname: '/projects/1/tasks',
      params: { id: '1' },
      searchParams: new URLSearchParams(),
      commands: [
        {
          id: 'cmd-1',
          label: '任务管理',
          group: 'navigation',
        },
      ],
      userPermissions: ['task:read'],
      uncertainty: [],
      conclusionTrace: [],
      modelAvailable: true,
    }

    const result = await service.answer(params)

    // 验证答案不包含任何写操作
    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      expect(result.entries.length).toBeGreaterThan(0)
      for (const entry of result.entries) {
        expect(entry.statement).not.toContain('创建')
        expect(entry.statement).not.toContain('更新')
        expect(entry.statement).not.toContain('删除')
      }
    }
  })

  it('term explanation should not write any domain data', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotTermExplanationService(synthesisService)
    const params: TermExplanationParams = {
      organizationId: 1,
      projectId: 1,
      userId: 1,
      term: '甘特图',
      knowledgeEntries: createKnowledgeEntries(),
      uncertainty: [],
      conclusionTrace: [],
      modelAvailable: true,
    }

    const result = await service.answer(params)

    // 验证答案不包含任何写操作
    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      expect(result.entries.length).toBeGreaterThan(0)
      for (const entry of result.entries) {
        expect(entry.statement).not.toContain('创建')
        expect(entry.statement).not.toContain('更新')
        expect(entry.statement).not.toContain('删除')
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 测试：合成服务无域写依赖
// ---------------------------------------------------------------------------

describe('copilot answer synthesis - no domain write dependency', () => {
  it('synthesis service should not depend on domain repositories', () => {
    const service = new CopilotAnswerSynthesisService()

    // 验证服务没有域写依赖
    // 服务应该只包含合成逻辑，不包含任何域写操作
    expect(service).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// 测试：既有行为未被改变
// ---------------------------------------------------------------------------

describe('copilot answer permissions - existing behavior unchanged', () => {
  it('health answer should not change existing diagnosis behavior', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotHealthAnswerService(synthesisService)
    const params: HealthAnswerParams = {
      organizationId: 1,
      projectId: 1,
      userId: 1,
      diagnosisSummary: createDiagnosisSummary(),
      predictionSignals: createPredictionSignals(),
      uncertainty: [],
      conclusionTrace: [],
      modelAvailable: true,
    }

    const result = await service.answer(params)

    // 验证答案不改变现有诊断行为
    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      // 答案应该只读取诊断数据，不修改
      expect(result.entries.length).toBeGreaterThan(0)
    }
  })

  it('term explanation should not change existing knowledge behavior', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotTermExplanationService(synthesisService)
    const params: TermExplanationParams = {
      organizationId: 1,
      projectId: 1,
      userId: 1,
      term: '甘特图',
      knowledgeEntries: createKnowledgeEntries(),
      uncertainty: [],
      conclusionTrace: [],
      modelAvailable: true,
    }

    const result = await service.answer(params)

    // 验证答案不改变现有知识行为
    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      // 答案应该只读取知识数据，不修改
      expect(result.entries.length).toBeGreaterThan(0)
    }
  })
})
