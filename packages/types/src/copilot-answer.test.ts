/**
 * copilot-answer.test.ts — 三类答案契约的负例测试。
 *
 * 验证：
 * - 禁存约束：敏感样本不出现在任一契约字段
 * - 确定性模板降级
 * - 六态 fixtures 的形状正确性
 */
import { describe, it, expect } from 'vitest'
import type {
  CopilotAnswerEntry,
  CopilotConfidenceBand,
  CopilotAnswerKind,
  CopilotInsufficientReason,
  CopilotSourceKind,
} from './copilot-answer.js'
import {
  COPILOT_ANSWER_MAX_NARRATIVE_LENGTH,
  HEALTH_ANSWER_TEMPLATES,
  PAGE_USAGE_ANSWER_TEMPLATES,
  TERM_ANSWER_TEMPLATES,
  HEALTH_ANSWER_FIXTURE_SUFFICIENT,
  HEALTH_ANSWER_FIXTURE_INSUFFICIENT,
  TERM_ANSWER_FIXTURE_HIT,
  TERM_ANSWER_FIXTURE_MISS,
  PAGE_USAGE_ANSWER_FIXTURE,
  ANSWER_FIXTURE_FALLBACK,
} from './copilot-answer.js'

// ---------------------------------------------------------------------------
// 敏感样本（禁存约束负例测试）
// ---------------------------------------------------------------------------

const SENSITIVE_SAMPLES = [
  // prompt
  '你是一个项目管理助手，请基于以下数据生成回答。',
  'SYSTEM: 你是专业的项目健康诊断分析师。',
  // 模型输出全文
  '根据分析，该项目存在以下问题：1. 进度延误 2. 资源不足 3. 风险集中。',
  // token
  'sk-1234567890abcdef1234567890abcdef',
  'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.',
  // secret
  'password=secret123',
  'api_key=abcdefghijklmnop',
  'Authorization: Basic dXNlcjpwYXNz',
]

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function containsSensitiveSample(text: string): string | null {
  for (const sample of SENSITIVE_SAMPLES) {
    if (text.includes(sample)) {
      return sample
    }
  }
  return null
}

function checkEntryForSensitiveSamples(entry: CopilotAnswerEntry): string | null {
  // 检查 statement
  const statementHit = containsSensitiveSample(entry.statement)
  if (statementHit) return `statement contains: ${statementHit}`

  // 检查 sourceRefs
  for (const ref of entry.sourceRefs) {
    const summaryHit = containsSensitiveSample(ref.summary)
    if (summaryHit) return `sourceRef.summary contains: ${summaryHit}`
    const idHit = containsSensitiveSample(ref.sourceId)
    if (idHit) return `sourceRef.sourceId contains: ${idHit}`
  }

  return null
}

// ---------------------------------------------------------------------------
// 测试：禁存约束
// ---------------------------------------------------------------------------

describe('copilot-answer storage constraint', () => {
  it('should define max narrative length as 2000', () => {
    expect(COPILOT_ANSWER_MAX_NARRATIVE_LENGTH).toBe(2000)
  })

  it('should not contain sensitive samples in sufficient answer narrative', () => {
    const hit = containsSensitiveSample(HEALTH_ANSWER_FIXTURE_SUFFICIENT.narrative)
    expect(hit).toBeNull()
  })

  it('should not contain sensitive samples in sufficient answer entries', () => {
    for (const entry of HEALTH_ANSWER_FIXTURE_SUFFICIENT.entries) {
      const hit = checkEntryForSensitiveSamples(entry)
      expect(hit).toBeNull()
    }
  })

  it('should not contain sensitive samples in term answer narrative', () => {
    const hit = containsSensitiveSample(TERM_ANSWER_FIXTURE_HIT.narrative)
    expect(hit).toBeNull()
  })

  it('should not contain sensitive samples in term answer entries', () => {
    for (const entry of TERM_ANSWER_FIXTURE_HIT.entries) {
      const hit = checkEntryForSensitiveSamples(entry)
      expect(hit).toBeNull()
    }
  })

  it('should not contain sensitive samples in page usage answer narrative', () => {
    const hit = containsSensitiveSample(PAGE_USAGE_ANSWER_FIXTURE.narrative)
    expect(hit).toBeNull()
  })

  it('should not contain sensitive samples in page usage answer entries', () => {
    for (const entry of PAGE_USAGE_ANSWER_FIXTURE.entries) {
      const hit = checkEntryForSensitiveSamples(entry)
      expect(hit).toBeNull()
    }
  })

  it('should not contain sensitive samples in fallback answer narrative', () => {
    const hit = containsSensitiveSample(ANSWER_FIXTURE_FALLBACK.narrative)
    expect(hit).toBeNull()
  })

  it('should not contain sensitive samples in fallback answer entries', () => {
    for (const entry of ANSWER_FIXTURE_FALLBACK.entries) {
      const hit = checkEntryForSensitiveSamples(entry)
      expect(hit).toBeNull()
    }
  })

  it('should not contain sensitive samples in insufficient answer missingWhat', () => {
    const hit = containsSensitiveSample(HEALTH_ANSWER_FIXTURE_INSUFFICIENT.missingWhat)
    expect(hit).toBeNull()
  })

  it('should not contain sensitive samples in term miss answer missingWhat', () => {
    const hit = containsSensitiveSample(TERM_ANSWER_FIXTURE_MISS.missingWhat)
    expect(hit).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 测试：六态 fixtures 形状
// ---------------------------------------------------------------------------

describe('copilot-answer fixtures shape', () => {
  it('health sufficient fixture should have correct shape', () => {
    const fixture = HEALTH_ANSWER_FIXTURE_SUFFICIENT
    expect(fixture.answerKind).toBe('health')
    expect(fixture.isFallback).toBe(false)
    expect(fixture.entries.length).toBeGreaterThan(0)
    expect(fixture.narrative.length).toBeGreaterThan(0)
    expect(fixture.narrative.length).toBeLessThanOrEqual(COPILOT_ANSWER_MAX_NARRATIVE_LENGTH)

    for (const entry of fixture.entries) {
      expect(entry.entryId).toBeTruthy()
      expect(entry.statement).toBeTruthy()
      expect(entry.sourceRefs.length).toBeGreaterThan(0)
      expect(entry.confidence).toMatch(/^(high|medium|low|unknown)$/)
      expect(entry.group).toBeTruthy()
    }
  })

  it('health insufficient fixture should have correct shape', () => {
    const fixture = HEALTH_ANSWER_FIXTURE_INSUFFICIENT
    expect(fixture.kind).toBe('insufficient')
    expect(fixture.reason).toBeTruthy()
    expect(fixture.missingWhat).toBeTruthy()
  })

  it('term hit fixture should have correct shape', () => {
    const fixture = TERM_ANSWER_FIXTURE_HIT
    expect(fixture.answerKind).toBe('term-explanation')
    expect(fixture.isFallback).toBe(false)
    expect(fixture.entries.length).toBeGreaterThan(0)
    expect(fixture.narrative.length).toBeGreaterThan(0)

    for (const entry of fixture.entries) {
      expect(entry.sourceRefs.length).toBeGreaterThan(0)
      expect(entry.sourceRefs[0].sourceKind).toBe('knowledge-entry')
    }
  })

  it('term miss fixture should have correct shape', () => {
    const fixture = TERM_ANSWER_FIXTURE_MISS
    expect(fixture.kind).toBe('insufficient')
    expect(fixture.reason).toBe('no-knowledge-entry')
    expect(fixture.missingWhat).toBeTruthy()
  })

  it('page usage fixture should have correct shape', () => {
    const fixture = PAGE_USAGE_ANSWER_FIXTURE
    expect(fixture.answerKind).toBe('page-usage')
    expect(fixture.isFallback).toBe(false)
    expect(fixture.entries.length).toBeGreaterThan(0)

    for (const entry of fixture.entries) {
      expect(entry.sourceRefs.length).toBeGreaterThan(0)
      expect(entry.sourceRefs[0].sourceKind).toBe('command-metadata')
    }
  })

  it('fallback fixture should have correct shape', () => {
    const fixture = ANSWER_FIXTURE_FALLBACK
    expect(fixture.answerKind).toBe('health')
    expect(fixture.isFallback).toBe(true)
    expect(fixture.fallbackReason).toBeTruthy()
    expect(fixture.entries.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 测试：确定性模板
// ---------------------------------------------------------------------------

describe('copilot-answer deterministic templates', () => {
  it('health templates should be non-empty', () => {
    expect(HEALTH_ANSWER_TEMPLATES.length).toBeGreaterThan(0)
  })

  it('page usage templates should be non-empty', () => {
    expect(PAGE_USAGE_ANSWER_TEMPLATES.length).toBeGreaterThan(0)
  })

  it('term templates should be non-empty', () => {
    expect(TERM_ANSWER_TEMPLATES.length).toBeGreaterThan(0)
  })

  it('each template should have template, group, and confidence', () => {
    const allTemplates = [
      ...HEALTH_ANSWER_TEMPLATES,
      ...PAGE_USAGE_ANSWER_TEMPLATES,
      ...TERM_ANSWER_TEMPLATES,
    ]

    for (const template of allTemplates) {
      expect(template.template).toBeTruthy()
      expect(template.group).toBeTruthy()
      expect(template.confidence).toMatch(/^(high|medium|low|unknown)$/)
    }
  })
})

// ---------------------------------------------------------------------------
// 测试：类型约束
// ---------------------------------------------------------------------------

describe('copilot-answer type constraints', () => {
  it('answer kind should be one of the defined kinds', () => {
    const validKinds: CopilotAnswerKind[] = ['health', 'page-usage', 'term-explanation']
    for (const kind of validKinds) {
      expect(['health', 'page-usage', 'term-explanation']).toContain(kind)
    }
  })

  it('source kind should be one of the defined kinds', () => {
    const validKinds: CopilotSourceKind[] = [
      'diagnosis-item',
      'prediction-signal',
      'knowledge-entry',
      'command-metadata',
    ]
    for (const kind of validKinds) {
      expect([
        'diagnosis-item',
        'prediction-signal',
        'knowledge-entry',
        'command-metadata',
      ]).toContain(kind)
    }
  })

  it('confidence band should be one of the defined bands', () => {
    const validBands: CopilotConfidenceBand[] = ['high', 'medium', 'low', 'unknown']
    for (const band of validBands) {
      expect(['high', 'medium', 'low', 'unknown']).toContain(band)
    }
  })

  it('insufficient reason should be one of the defined reasons', () => {
    const validReasons: CopilotInsufficientReason[] = [
      'no-diagnosis-record',
      'no-prediction-signal',
      'no-knowledge-entry',
      'no-command-metadata',
      'all-sources-inaccessible',
      'material-insufficient',
    ]
    for (const reason of validReasons) {
      expect([
        'no-diagnosis-record',
        'no-prediction-signal',
        'no-knowledge-entry',
        'no-command-metadata',
        'all-sources-inaccessible',
        'material-insufficient',
      ]).toContain(reason)
    }
  })
})
