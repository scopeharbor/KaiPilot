/**
 * copilot_term_explanation.spec.ts — 术语解释答案测试。
 *
 * 验证：
 * - 术语检索走知识 L1 生产路径
 * - L3 Synthetic 恒排除（红线 1）
 * - 无命中时输出「知识库暂未收录」，不回落模型常识
 * - 术语解释带 SourceRef，可追溯到知识条目
 */
import { describe, it, expect } from 'vitest'
import CopilotTermExplanationService from '#services/copilot/copilot_term_explanation_service'
import CopilotAnswerSynthesisService from '#services/copilot/copilot_answer_synthesis_service'
import type { TermExplanationParams } from '#services/copilot/copilot_term_explanation_service'
import type { KnowledgeItemLowSensitiveProjection } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

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
    {
      id: 2,
      layer: 'L1',
      title: '关键路径',
      status: 'active',
      domain: 'project-management',
      purpose: '项目关键任务链',
      provenance: { sources: [] },
      isSynthetic: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ]
}

function createL3SyntheticEntries(): readonly KnowledgeItemLowSensitiveProjection[] {
  return [
    {
      id: 3,
      layer: 'L3',
      title: '合成术语',
      status: 'active',
      domain: 'test',
      purpose: '测试',
      provenance: { sources: [] },
      isSynthetic: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ]
}

function createParams(overrides: Partial<TermExplanationParams> = {}): TermExplanationParams {
  return {
    organizationId: 1,
    projectId: 1,
    userId: 1,
    term: '甘特图',
    knowledgeEntries: createKnowledgeEntries(),
    uncertainty: [],
    conclusionTrace: [],
    modelAvailable: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 测试：L1 生产路径
// ---------------------------------------------------------------------------

describe('copilot term explanation - L1 production path', () => {
  it('should only use L1 knowledge entries', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotTermExplanationService(synthesisService)
    const params = createParams()

    const result = await service.answer(params)

    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      // 所有素材都应该来自 L1
      for (const entry of result.entries) {
        for (const sourceRef of entry.sourceRefs) {
          expect(sourceRef.sourceKind).toBe('knowledge-entry')
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 测试：L3 Synthetic 排除
// ---------------------------------------------------------------------------

describe('copilot term explanation - L3 synthetic exclusion', () => {
  it('should exclude L3 synthetic entries', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotTermExplanationService(synthesisService)
    const params = createParams({
      knowledgeEntries: [...createKnowledgeEntries(), ...createL3SyntheticEntries()],
    })

    const result = await service.answer(params)

    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      // 不应该包含 L3 synthetic 的素材
      const sourceIds = result.entries.flatMap((e: any) => e.sourceRefs.map((r: any) => r.sourceId))
      expect(sourceIds).not.toContain('kb-3') // L3 synthetic 条目
    }
  })

  it('should not produce definition from L3 synthetic entries', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotTermExplanationService(synthesisService)
    const params = createParams({
      knowledgeEntries: createL3SyntheticEntries(),
    })

    const result = await service.answer(params)

    // 应该返回「知识库暂未收录」
    expect(result.kind).toBe('insufficient')
    if (result.kind === 'insufficient') {
      expect(result.reason).toBe('no-knowledge-entry')
    }
  })
})

// ---------------------------------------------------------------------------
// 测试：无命中
// ---------------------------------------------------------------------------

describe('copilot term explanation - no match', () => {
  it('should output "知识库暂未收录" when no match', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotTermExplanationService(synthesisService)
    const params = createParams({
      term: '未知术语',
      knowledgeEntries: [],
    })

    const result = await service.answer(params)

    expect(result.kind).toBe('insufficient')
    if (result.kind === 'insufficient') {
      expect(result.reason).toBe('no-knowledge-entry')
      expect(result.missingWhat).toContain('未知术语')
    }
  })

  it('should not produce definition from model general knowledge', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotTermExplanationService(synthesisService)
    const params = createParams({
      term: '未知术语',
      knowledgeEntries: [],
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
// 测试：SourceRef 可追溯
// ---------------------------------------------------------------------------

describe('copilot term explanation - traceability', () => {
  it('should have SourceRef for each explanation', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotTermExplanationService(synthesisService)
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
// 测试：模型不可用降级
// ---------------------------------------------------------------------------

describe('copilot term explanation - model unavailability', () => {
  it('should produce answer with fallback when model is unavailable', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotTermExplanationService(synthesisService)
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
