/**
 * DeepSeek V4 Flash 调用包装单元测试（tasks 5.6）。
 *
 * 覆盖：
 * - 空内容检测
 * - 截断 JSON
 * - 未知字段
 * - 无效 entity ID
 * - 重试耗尽
 * - Soft unavailable 降级
 */

import { describe, expect, it } from 'vitest'
import {
  buildDimensionPrompt,
  parseDimensionResponse,
  isRetryable,
  toDimensionScore,
  type SoftEvaluatorCallConfig,
  type DimensionEvaluationInput,
} from '../../../app/services/compiler/validation/soft_orchestrator/deepseek_wrapper.js'

const sampleConfig: SoftEvaluatorCallConfig = {
  stageId: 'wbs_gate',
  dimensionId: 'SE-WBS-02',
  dimensionIds: ['SE-WBS-02'],
  attemptId: 'att-001',
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  temperature: 0.1,
  maxTokens: 4096,
  maxRetries: 2,
}

const sampleInput: DimensionEvaluationInput = {
  dimensionId: 'SE-WBS-02',
  dimensionName: '任务粒度合理性',
  rubric: '1=太粗 2=较粗 3=基本合理 4=合理 5=非常合理',
  pdmSlice: {
    tasks: [
      { id: 'T1a', duration: 10 },
      { id: 'T2b', duration: 3 },
    ],
  },
  deterministicSignals: { avgDuration: 6.5, longTaskCount: 1 },
}

describe('buildDimensionPrompt', () => {
  it('构建单维度 prompt 包含维度 ID 和 rubric', () => {
    const { systemPrompt, userPrompt } = buildDimensionPrompt(sampleInput, sampleConfig)
    expect(systemPrompt).toContain('SE-WBS-02')
    expect(systemPrompt).toContain('任务粒度合理性')
    expect(userPrompt).toContain('T1a')
    expect(userPrompt).toContain('avgDuration')
  })
})

describe('parseDimensionResponse', () => {
  const knownEntityIds = ['T1task_abc123', 'T2task_def456']

  it('合法响应通过解析', () => {
    const raw = JSON.stringify({
      dimensionId: 'SE-WBS-02',
      score: 3,
      confidence: 0.8,
      rationale: '任务粒度基本合理',
      findings: [
        {
          description: 'T1 任务周期较长',
          severity: 'warning',
          affectedEntityIds: ['T1task_abc123'],
          evidenceSnippet: 'T1: 15 days',
          suggestedReviewAction: '考虑拆分',
        },
      ],
    })
    const result = parseDimensionResponse(raw, 'SE-WBS-02', knownEntityIds)
    expect(result.success).toBe(true)
    expect(result.data?.score).toBe(3)
    expect(result.data?.findings).toHaveLength(1)
  })

  it('空内容检测失败', () => {
    const result = parseDimensionResponse('', 'SE-WBS-02', knownEntityIds)
    expect(result.success).toBe(false)
    expect(result.errorKind).toBe('empty_content')
  })

  it('空白字符判定为空', () => {
    const result = parseDimensionResponse('   \n  ', 'SE-WBS-02', knownEntityIds)
    expect(result.success).toBe(false)
    expect(result.errorKind).toBe('empty_content')
  })

  it('截断 JSON 检测', () => {
    const result = parseDimensionResponse(
      '{"dimensionId": "SE-WBS-02", "score": 3',
      'SE-WBS-02',
      knownEntityIds,
    )
    expect(result.success).toBe(false)
    expect(result.errorKind).toBe('truncated_json')
  })

  it('非法 JSON 检测', () => {
    const result = parseDimensionResponse('not json at all', 'SE-WBS-02', knownEntityIds)
    expect(result.success).toBe(false)
    expect(result.errorKind).toBe('not_json')
  })

  it('markdown 代码块中提取 JSON', () => {
    const raw =
      '```json\n{"dimensionId": "SE-WBS-02", "score": 4, "confidence": 0.9, "rationale": "好", "findings": []}\n```'
    const result = parseDimensionResponse(raw, 'SE-WBS-02', knownEntityIds)
    expect(result.success).toBe(true)
    expect(result.data?.score).toBe(4)
  })

  it('未知字段被剥离', () => {
    const raw = JSON.stringify({
      dimensionId: 'SE-WBS-02',
      score: 3,
      confidence: 0.7,
      rationale: 'ok',
      findings: [],
      extraField: 'should_be_ignored',
    })
    const result = parseDimensionResponse(raw, 'SE-WBS-02', knownEntityIds)
    expect(result.success).toBe(true)
    // extraField 被剥离
    expect(Object.keys(result.data ?? {})).not.toContain('extraField')
  })

  it('无效 entity ID 降低 confidence', () => {
    const raw = JSON.stringify({
      dimensionId: 'SE-WBS-02',
      score: 4,
      confidence: 0.9,
      rationale: 'good',
      findings: [
        {
          description: '问题',
          severity: 'warning',
          affectedEntityIds: ['NONEXISTENT_ID'],
          evidenceSnippet: 'test',
          suggestedReviewAction: 'review',
        },
      ],
    })
    const result = parseDimensionResponse(raw, 'SE-WBS-02', ['T1task_abc123'])
    expect(result.success).toBe(true)
    // entity ID 为 knownEntityIds 中的无效值 → unanchored → 被过滤为空
    expect(result.data?.findings[0].affectedEntityIds).toHaveLength(0)
    // confidence 应低于原始 0.9（因 unanchored 降权）
    expect(result.data?.confidence).toBeLessThan(0.9)
  })

  it('score 越界检测', () => {
    const raw = JSON.stringify({
      dimensionId: 'SE-WBS-02',
      score: 6,
      confidence: 0.8,
      rationale: 'test',
      findings: [],
    })
    const result = parseDimensionResponse(raw, 'SE-WBS-02', knownEntityIds)
    expect(result.success).toBe(false)
    expect(result.errorKind).toBe('invalid_score')
  })
})

describe('isRetryable', () => {
  it('空内容可重试', () => {
    expect(isRetryable('empty_content')).toBe(true)
  })
  it('非法 JSON 可重试', () => {
    expect(isRetryable('not_json')).toBe(true)
  })
  it('截断 JSON 可重试', () => {
    expect(isRetryable('truncated_json')).toBe(true)
  })
  it('provider_error 不可重试', () => {
    expect(isRetryable('provider_error')).toBe(false)
  })
  it('retry_exhausted 不可重试', () => {
    expect(isRetryable('retry_exhausted')).toBe(false)
  })
})

describe('toDimensionScore', () => {
  it('成功响应转换为 SoftDimensionScore', () => {
    const result = {
      success: true,
      data: {
        dimensionId: 'SE-WBS-02',
        score: 3,
        confidence: 0.8,
        rationale: 'reason',
        findings: [
          {
            description: 'issue',
            severity: 'warning' as const,
            affectedEntityIds: ['T1task_abc123'],
            evidenceSnippet: 'evidence',
            suggestedReviewAction: 'review',
          },
        ],
      },
      tokensUsed: 500,
      latencyMs: 1000,
      retryCount: 0,
    }
    const score = toDimensionScore(result as any, 'SE-WBS-02', sampleConfig, 500, 1000)
    expect(score.status).toBe('evaluated')
    expect(score.score).toBe(3)
    expect(score.findings).toHaveLength(1)
  })

  it('失败响应转换为 unavailable', () => {
    const result = {
      success: false,
      errorKind: 'retry_exhausted' as const,
      errorMessage: '重试耗尽',
      tokensUsed: 0,
      latencyMs: 0,
      retryCount: 2,
    }
    const score = toDimensionScore(result as any, 'SE-WBS-02', sampleConfig, 0, 0)
    expect(score.status).toBe('unavailable')
    expect(score.unavailableReason).toBe('重试耗尽')
  })
})
