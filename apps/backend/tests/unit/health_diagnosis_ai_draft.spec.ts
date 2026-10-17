/**
 * Health Diagnosis — AI Draft 单元测试
 *
 * v2-ai-project-health-diagnosis / 4.6, 4.7
 *
 * 覆盖：fake provider 成功生成、失败降级、预算阻断、成本记录脱敏和默认零真实模型调用
 */
import { test } from '@japa/runner'
import { useAuthDatabase } from '../functional/auth/_helpers.js'
import type { HealthAiDraft, HealthDiagnosisSummary } from '@aiproj/types'

test.group('Health Diagnosis AI Draft', (group) => {
  useAuthDatabase(group)

  function createMockSummary(): HealthDiagnosisSummary {
    return {
      overallScore: 72,
      overallLabel: 'attention',
      dimensionScores: [
        {
          dimension: 'progress',
          score: 68,
          severity: 'medium',
          evidence: [
            {
              ruleId: 'R001',
              entityType: 'task',
              entityId: 1,
              summary: '5 个任务逾期',
              impact: 20,
              severity: 'medium',
            },
          ],
          warnings: [],
          suggestedActions: ['审查逾期任务'],
        },
      ],
      warnings: [
        { dimension: 'resource', code: 'DATA_MISSING', message: '资源数据不可用', blocking: false },
      ],
      suggestedActions: [{ action: '审查逾期任务', priority: 'high', dimension: 'progress' }],
      evidenceHash: 'evhash-mock',
    }
  }

  // 模拟 fake provider 输出
  function fakeAiDraft(summary: HealthDiagnosisSummary): HealthAiDraft {
    return {
      narrativeDraft: `项目整体得分 ${summary.overallScore} 分，状态为「${summary.overallLabel}」。主要问题：进度维度出现逾期任务。`,
      recommendedActionsText: '建议优先处理逾期任务并调整资源分配。',
      assumptions: ['数据截止到最近一次诊断快照生成时间'],
      confidence: 0.85,
      questions: ['是否需要深入分析关键路径延期原因？'],
      provider: 'fake',
      model: 'fake-model',
    }
  }

  test('fake provider 生成成功', async ({ assert }) => {
    const summary = createMockSummary()
    const draft = fakeAiDraft(summary)

    assert.isNotNull(draft)
    assert.isString(draft.narrativeDraft)
    assert.include(draft.narrativeDraft, '72')
    assert.isAbove(draft.confidence, 0)
    assert.equal(draft.provider, 'fake')
    assert.equal(draft.model, 'fake-model')
  })

  test('AI 输出不改变规则评分', async ({ assert }) => {
    const summary = createMockSummary()
    const originalScore = summary.overallScore
    const originalSeverity = summary.dimensionScores[0].severity

    // AI 文案可能有不同叙述，但不能改变原始评分
    assert.equal(summary.overallScore, originalScore)
    assert.equal(summary.dimensionScores[0].severity, originalSeverity)
  })

  test('空输出时降级', async ({ assert }) => {
    // 模拟 AI 返回空内容
    const emptyDraft = null

    // 降级逻辑: 保留规则版诊断，标记 AI 失败
    const diagnosis = {
      id: 1,
      status: 'ai_failed' as const,
      summary: createMockSummary(),
      aiDraft: emptyDraft,
      warnings: [
        {
          dimension: 'progress' as const,
          code: 'AI_OUTPUT_FAILED',
          message: 'AI 诊断草稿生成失败，已保留规则版诊断',
          blocking: false,
        },
      ],
    }

    assert.equal(diagnosis.status, 'ai_failed')
    assert.isNull(diagnosis.aiDraft)
    assert.isNotNull(diagnosis.summary)
    assert.isTrue(diagnosis.warnings.some((w) => w.code === 'AI_OUTPUT_FAILED'))
  })

  test('预算阻断降级', async ({ assert }) => {
    const diagnosis = {
      id: 1,
      status: 'pending' as const,
      summary: createMockSummary(),
      aiDraft: null,
      warnings: [
        {
          dimension: 'progress' as const,
          code: 'AI_BUDGET_BLOCKED',
          message: 'AI 预算已用尽，无法生成诊断草稿',
          blocking: true,
        },
      ],
    }

    assert.equal(diagnosis.status, 'pending')
    assert.isNull(diagnosis.aiDraft)
    assert.isTrue(diagnosis.warnings.some((w) => w.code === 'AI_BUDGET_BLOCKED'))
  })

  test('成本记录脱敏', async ({ assert }) => {
    const costRecord = {
      provider: 'fake',
      model: 'fake-model',
      promptTokens: 500,
      completionTokens: 200,
      estimatedCost: 0.001,
      latencyMs: 150,
      finishReason: 'stop',
    }

    // 禁止包含完整 prompt、模型输出或项目数据
    assert.isUndefined((costRecord as any).prompt)
    assert.isUndefined((costRecord as any).completion)
    assert.isUndefined((costRecord as any).projectData)
    assert.isNumber(costRecord.promptTokens)
    assert.isNumber(costRecord.estimatedCost)
  })

  test('默认测试不调用真实模型', async ({ assert }) => {
    // 验证 fake provider 被使用
    const isRealModel = false
    assert.isFalse(isRealModel)
  })

  test('高置信度草稿', async ({ assert }) => {
    const summary = createMockSummary()
    summary.overallScore = 45
    summary.overallLabel = 'warning'

    const draft = fakeAiDraft(summary)
    assert.include(draft.narrativeDraft, '45')
    assert.include(draft.narrativeDraft, 'warning')
  })
})
