/**
 * v3-copilot-feedback-driven-ranking — 禁存约束负例测试
 *
 * 证明敏感样本不出现在任一契约字段中。
 */

import { describe, it, expect } from 'vitest'
import {
  validateRankingNoStorageViolation,
  RANKING_FORBIDDEN_FIELDS,
  type FeedbackWeightedProjection,
  type FeedbackSortExplanation,
} from '../src/copilot-feedback-ranking.js'

describe('Ranking No-Storage Constraint', () => {
  // 敏感样本：建议正文、prompt、模型输出、token、secret
  const sensitiveSamples = [
    { suggestionBody: '请将任务 A 分配给张三' },
    { suggestionText: '建议增加资源投入' },
    { body: '这是一段建议正文' },
    { content: 'AI 生成的内容' },
    { prompt: '你是一个项目管理助手' },
    { systemPrompt: '请分析项目风险' },
    { modelOutput: '根据分析，项目存在以下风险...' },
    { response: '这是模型的响应' },
    { token: 'sk-1234567890abcdef' },
    { secret: 'my-secret-key' },
    { apiKey: 'ak-1234567890abcdef' },
    { authorization: 'Bearer sk-1234567890abcdef' },
    { password: 'my-password' },
    { credential: 'my-credential' },
  ]

  it('rejects projection with suggestion body', () => {
    const projection: Record<string, unknown> = {
      actorId: 1,
      organizationId: 1,
      problemKind: 'resource_overload',
      rejectionCount: 3,
      adoptionCount: 1,
      weight: -3,
      projectionVersion: 'v1',
      suggestionBody: '请将任务 A 分配给张三', // 敏感
    }
    const result = validateRankingNoStorageViolation(projection)
    expect(result.valid).toBe(false)
    expect(result.violations).toContain('suggestionBody')
  })

  it('rejects projection with prompt', () => {
    const projection: Record<string, unknown> = {
      actorId: 1,
      organizationId: 1,
      problemKind: 'resource_overload',
      rejectionCount: 3,
      adoptionCount: 1,
      weight: -3,
      projectionVersion: 'v1',
      prompt: '你是一个项目管理助手', // 敏感
    }
    const result = validateRankingNoStorageViolation(projection)
    expect(result.valid).toBe(false)
    expect(result.violations).toContain('prompt')
  })

  it('rejects explanation with model output', () => {
    const explanation: Record<string, unknown> = {
      entryId: 'entry-001',
      originalPosition: 0,
      newPosition: 2,
      reason: '因您此前拒绝过 3 条同类建议而降权',
      rejectionCount: 3,
      modelOutput: '这是模型的输出', // 敏感
    }
    const result = validateRankingNoStorageViolation(explanation)
    expect(result.valid).toBe(false)
    expect(result.violations).toContain('modelOutput')
  })

  it('rejects explanation with token', () => {
    const explanation: Record<string, unknown> = {
      entryId: 'entry-001',
      originalPosition: 0,
      newPosition: 2,
      reason: '因您此前拒绝过 3 条同类建议而降权',
      rejectionCount: 3,
      token: 'sk-1234567890abcdef', // 敏感
    }
    const result = validateRankingNoStorageViolation(explanation)
    expect(result.valid).toBe(false)
    expect(result.violations).toContain('token')
  })

  it('accepts valid projection without forbidden fields', () => {
    const projection: Record<string, unknown> = {
      actorId: 1,
      organizationId: 1,
      problemKind: 'resource_overload',
      rejectionCount: 3,
      adoptionCount: 1,
      weight: -3,
      projectionVersion: 'v1',
    }
    const result = validateRankingNoStorageViolation(projection)
    expect(result.valid).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('accepts valid explanation without forbidden fields', () => {
    const explanation: Record<string, unknown> = {
      entryId: 'entry-001',
      originalPosition: 0,
      newPosition: 2,
      reason: '因您此前拒绝过 3 条同类建议而降权',
      rejectionCount: 3,
    }
    const result = validateRankingNoStorageViolation(explanation)
    expect(result.valid).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('rejects nested forbidden field', () => {
    const projection: Record<string, unknown> = {
      actorId: 1,
      organizationId: 1,
      problemKind: 'resource_overload',
      rejectionCount: 3,
      adoptionCount: 1,
      weight: -3,
      projectionVersion: 'v1',
      metadata: {
        inner: {
          token: 'sk-1234567890abcdef', // 敏感（嵌套）
        },
      },
    }
    const result = validateRankingNoStorageViolation(projection)
    expect(result.valid).toBe(false)
    expect(result.violations).toContain('metadata.inner.token')
  })
})
