/**
 * copilot_answer_synthesis_service.test.ts — 合成纪律测试。
 *
 * 验证：
 * - 逐句锚定：每条结论至少锚定一条素材
 * - 校验阶段剔除无锚定结论
 * - 确定性：同一素材快照产出同一结论顺序、分组与锚定关系
 * - 模型不可用时的确定性模板降级
 * - 消费既有 uncertainty 三分
 */
import { describe, it, expect } from 'vitest'
import CopilotAnswerSynthesisService from '#services/copilot/copilot_answer_synthesis_service'
import type { SynthesisMaterialEntry } from '#services/copilot/copilot_answer_synthesis_service'
import type { CopilotUncertaintyEntry } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function createMaterial(overrides: Partial<SynthesisMaterialEntry> = {}): SynthesisMaterialEntry {
  return {
    materialId: 'mat-1',
    materialKind: 'diagnosis-item',
    summary: '测试素材',
    severity: 'medium',
    scoreImpact: -10,
    group: 'progress',
    confidence: 'medium',
    ...overrides,
  }
}

function createUncertainty(
  overrides: Partial<CopilotUncertaintyEntry> = {},
): CopilotUncertaintyEntry {
  return {
    uncertaintyId: 'unc-1',
    topic: '测试主题',
    kind: 'no-match',
    confidence: 0,
    sourceRefs: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 测试：逐句锚定
// ---------------------------------------------------------------------------

describe('copilot answer synthesis - anchoring', () => {
  it('should anchor each conclusion to at least one material', () => {
    const service = new CopilotAnswerSynthesisService()
    const materials = [
      createMaterial({ materialId: 'mat-1', summary: '逾期任务3个' }),
      createMaterial({ materialId: 'mat-2', summary: '关键路径延期' }),
    ]

    const result = service.synthesize('health', materials, [], [])

    expect(result.entries.length).toBeGreaterThan(0)
    for (const entry of result.entries) {
      expect(entry.sourceRefs.length).toBeGreaterThan(0)
    }
  })

  it('should remove unanchored conclusions', () => {
    const service = new CopilotAnswerSynthesisService()
    // 空素材应该返回空条目集合
    const result = service.synthesize('health', [], [], [])

    expect(result.entries.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 测试：确定性
// ---------------------------------------------------------------------------

describe('copilot answer synthesis - determinism', () => {
  it('should produce identical structure with same materials in different key orders', () => {
    const service = new CopilotAnswerSynthesisService()

    // 第一次构造素材
    const materials1 = [
      createMaterial({ materialId: 'mat-1', group: 'progress', summary: '逾期任务3个' }),
      createMaterial({ materialId: 'mat-2', group: 'critical_path', summary: '关键路径延期' }),
      createMaterial({ materialId: 'mat-3', group: 'risk', summary: '高风险2个' }),
    ]

    // 第二次构造素材（不同顺序）
    const materials2 = [
      createMaterial({ materialId: 'mat-3', group: 'risk', summary: '高风险2个' }),
      createMaterial({ materialId: 'mat-1', group: 'progress', summary: '逾期任务3个' }),
      createMaterial({ materialId: 'mat-2', group: 'critical_path', summary: '关键路径延期' }),
    ]

    const result1 = service.synthesize('health', materials1, [], [])
    const result2 = service.synthesize('health', materials2, [], [])

    // 结论顺序应该相同
    expect(result1.entries.length).toBe(result2.entries.length)
    for (let i = 0; i < result1.entries.length; i++) {
      expect(result1.entries[i].group).toBe(result2.entries[i].group)
      expect(result1.entries[i].sourceRefs.length).toBe(result2.entries[i].sourceRefs.length)
    }
  })
})

// ---------------------------------------------------------------------------
// 测试：模型不可用降级
// ---------------------------------------------------------------------------

describe('copilot answer synthesis - model unavailability', () => {
  it('should produce answer with fallback when model is unavailable', () => {
    const service = new CopilotAnswerSynthesisService()
    const materials = [
      createMaterial({ materialId: 'mat-1', group: 'progress', summary: '逾期任务3个' }),
    ]

    const result = service.synthesize('health', materials, [], [], false)

    expect(result.isFallback).toBe(true)
    expect(result.fallbackReason).toBeTruthy()
    expect(result.entries.length).toBeGreaterThan(0)
  })

  it('should not produce answer with fallback when model is available', () => {
    const service = new CopilotAnswerSynthesisService()
    const materials = [
      createMaterial({ materialId: 'mat-1', group: 'progress', summary: '逾期任务3个' }),
    ]

    const result = service.synthesize('health', materials, [], [], true)

    expect(result.isFallback).toBe(false)
    expect(result.fallbackReason).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 测试：consumption of uncertainty
// ---------------------------------------------------------------------------

describe('copilot answer synthesis - uncertainty consumption', () => {
  it('should lower confidence when uncertainty has no-match', () => {
    const service = new CopilotAnswerSynthesisService()
    const materials = [
      createMaterial({
        materialId: 'mat-1',
        group: 'progress',
        summary: '逾期任务3个',
        confidence: 'high',
      }),
    ]
    const uncertainty = [createUncertainty({ kind: 'no-match' })]

    const result = service.synthesize('health', materials, uncertainty, [])

    expect(result.entries.length).toBeGreaterThan(0)
    // 置信度应该被降低
    const entry = result.entries[0]
    expect(['medium', 'low', 'unknown']).toContain(entry.confidence)
  })

  it('should lower confidence when uncertainty has not-accessible', () => {
    const service = new CopilotAnswerSynthesisService()
    const materials = [
      createMaterial({
        materialId: 'mat-1',
        group: 'progress',
        summary: '逾期任务3个',
        confidence: 'high',
      }),
    ]
    const uncertainty = [createUncertainty({ kind: 'not-accessible' })]

    const result = service.synthesize('health', materials, uncertainty, [])

    expect(result.entries.length).toBeGreaterThan(0)
    const entry = result.entries[0]
    expect(['medium', 'low', 'unknown']).toContain(entry.confidence)
  })

  it('should not lower confidence when uncertainty is empty', () => {
    const service = new CopilotAnswerSynthesisService()
    const materials = [
      createMaterial({
        materialId: 'mat-1',
        group: 'progress',
        summary: '逾期任务3个',
        confidence: 'high',
      }),
    ]

    const result = service.synthesize('health', materials, [], [])

    expect(result.entries.length).toBeGreaterThan(0)
    expect(result.entries[0].confidence).toBe('high')
  })
})

// ---------------------------------------------------------------------------
// 测试：零素材时不产出结论
// ---------------------------------------------------------------------------

describe('copilot answer synthesis - zero material', () => {
  it('should not produce any conclusion when materials are empty', () => {
    const service = new CopilotAnswerSynthesisService()
    const result = service.synthesize('health', [], [], [])

    expect(result.entries.length).toBe(0)
    expect(result.isFallback).toBe(false)
  })

  it('should not fall back to generic advice when materials are empty', () => {
    const service = new CopilotAnswerSynthesisService()
    const result = service.synthesize('health', [], [], [])

    // 检查没有通用建议
    const hasGenericAdvice = result.entries.some(
      (e: any) => e.statement.includes('建议') || e.statement.includes('应该'),
    )
    expect(hasGenericAdvice).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 测试：三种答案类型
// ---------------------------------------------------------------------------

describe('copilot answer synthesis - answer kinds', () => {
  it('should work for health answer kind', () => {
    const service = new CopilotAnswerSynthesisService()
    const materials = [
      createMaterial({ materialId: 'mat-1', group: 'progress', summary: '逾期任务3个' }),
    ]

    const result = service.synthesize('health', materials, [], [])
    expect(result.entries.length).toBeGreaterThan(0)
  })

  it('should work for page-usage answer kind', () => {
    const service = new CopilotAnswerSynthesisService()
    const materials = [
      createMaterial({
        materialId: 'cmd-1',
        materialKind: 'command-metadata',
        group: 'capabilities',
        summary: '任务管理功能',
      }),
    ]

    const result = service.synthesize('page-usage', materials, [], [])
    expect(result.entries.length).toBeGreaterThan(0)
  })

  it('should work for term-explanation answer kind', () => {
    const service = new CopilotAnswerSynthesisService()
    const materials = [
      createMaterial({
        materialId: 'kb-1',
        materialKind: 'knowledge-entry',
        group: 'term',
        summary: '甘特图知识条目',
      }),
    ]

    const result = service.synthesize('term-explanation', materials, [], [])
    expect(result.entries.length).toBeGreaterThan(0)
  })
})
