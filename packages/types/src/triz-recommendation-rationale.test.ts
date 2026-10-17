/**
 * v2-triz-recommendation-rationale-ui —— 共享类型测试（任务 1.4）。
 */
import { describe, it, expect } from 'vitest'
import {
  RATIONALE_SOURCE_TYPES,
  RATIONALE_WARNING_CODES,
  RATIONALE_FEEDBACK_REASONS,
  RATIONALE_SECTIONS,
  RATIONALE_HANDOFF_STATUSES,
  sortEvidenceRefs,
  redactNoteText,
  deriveAvailableSections,
  isSourceHashStale,
} from './triz-recommendation-rationale.js'
import type {
  TrizRecommendationRationale,
  RationaleEvidenceRef,
  RationaleSourceRef,
  RationaleParameterTension,
  PrincipleMappingEntry,
  RationaleValidationSummary,
  RationaleAiMetadata,
  RationaleCostSummary,
  RationaleHandoffState,
  RationaleFeedbackRequest,
  RationaleFeedbackResponse,
  RationaleWarning,
} from './triz-recommendation-rationale.js'

// ---------------------------------------------------------------------------
// 1.2 — 枚举常量稳定性
// ---------------------------------------------------------------------------

describe('RATIONALE_SOURCE_TYPES', () => {
  it('includes contradiction, analysis_artifact, recommendation', () => {
    expect(RATIONALE_SOURCE_TYPES).toContain('contradiction')
    expect(RATIONALE_SOURCE_TYPES).toContain('analysis_artifact')
    expect(RATIONALE_SOURCE_TYPES).toContain('recommendation')
  })

  it('has exactly 3 members', () => {
    expect(RATIONALE_SOURCE_TYPES).toHaveLength(3)
  })
})

describe('RATIONALE_WARNING_CODES', () => {
  it('includes known warning codes', () => {
    expect(RATIONALE_WARNING_CODES).toContain('STALE_SOURCE_HASH')
    expect(RATIONALE_WARNING_CODES).toContain('AI_VALIDATION_FAILED')
    expect(RATIONALE_WARNING_CODES).toContain('SOURCE_UNAVAILABLE')
  })
})

describe('RATIONALE_FEEDBACK_REASONS', () => {
  it('includes all expected reasons', () => {
    expect(RATIONALE_FEEDBACK_REASONS).toContain('helpful')
    expect(RATIONALE_FEEDBACK_REASONS).toContain('not_relevant')
    expect(RATIONALE_FEEDBACK_REASONS).toContain('insufficient_evidence')
    expect(RATIONALE_FEEDBACK_REASONS).toContain('stale_source')
    expect(RATIONALE_FEEDBACK_REASONS).toContain('converted_to_draft')
  })

  it('has exactly 5 members', () => {
    expect(RATIONALE_FEEDBACK_REASONS).toHaveLength(5)
  })
})

describe('RATIONALE_SECTIONS', () => {
  it('includes all expected sections', () => {
    expect(RATIONALE_SECTIONS).toContain('source_summary')
    expect(RATIONALE_SECTIONS).toContain('parameter_tensions')
    expect(RATIONALE_SECTIONS).toContain('principle_mapping')
    expect(RATIONALE_SECTIONS).toContain('evidence_chain')
    expect(RATIONALE_SECTIONS).toContain('ai_explanation')
    expect(RATIONALE_SECTIONS).toContain('feedback')
    expect(RATIONALE_SECTIONS).toContain('handoff')
  })
})

describe('RATIONALE_HANDOFF_STATUSES', () => {
  it('includes none/candidate_created/stale/handed_off', () => {
    expect(RATIONALE_HANDOFF_STATUSES).toContain('none')
    expect(RATIONALE_HANDOFF_STATUSES).toContain('candidate_created')
    expect(RATIONALE_HANDOFF_STATUSES).toContain('stale')
    expect(RATIONALE_HANDOFF_STATUSES).toContain('handed_off')
  })
})

// ---------------------------------------------------------------------------
// 1.4 — 工具函数
// ---------------------------------------------------------------------------

describe('sortEvidenceRefs', () => {
  it('sorts refs by label stably', () => {
    const refs: RationaleEvidenceRef[] = [
      { label: 'parameter', description: '工期', sourceHash: 'a' },
      { label: 'artifact', description: '分析报告', sourceHash: 'b' },
      { label: 'principle', description: '分割原理', sourceHash: 'c' },
    ]
    const sorted = sortEvidenceRefs(refs)
    expect(sorted[0].label).toBe('artifact')
    expect(sorted[1].label).toBe('parameter')
    expect(sorted[2].label).toBe('principle')
  })

  it('does not mutate original array', () => {
    const refs: RationaleEvidenceRef[] = [
      { label: 'b', description: 'b', sourceHash: 'b' },
      { label: 'a', description: 'a', sourceHash: 'a' },
    ]
    sortEvidenceRefs(refs)
    expect(refs[0].label).toBe('b')
  })
})

describe('redactNoteText', () => {
  it('redacts long base64/token strings', () => {
    const result = redactNoteText('token ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890+/=')
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('ABCDEFGHIJK')
  })

  it('redacts file paths', () => {
    const result = redactNoteText('see /home/user/project/file.txt')
    expect(result).toContain('[REDACTED_PATH]')
  })

  it('preserves normal text', () => {
    const result = redactNoteText('这个建议很有帮助')
    expect(result).toBe('这个建议很有帮助')
  })
})

describe('deriveAvailableSections', () => {
  it('returns source_summary when sourceRefs exist', () => {
    const sections = deriveAvailableSections({
      sourceRefs: [{ sourceType: 'contradiction', id: 'c1', hash: 'h1', summary: 's1' }],
      parameterTensions: [],
      principleMappings: [],
      evidenceRefs: [],
      aiExplanationDraft: null,
      fallbackSummary: null,
      aiMetadata: null,
      costSummary: null,
      handoffState: null,
    })
    expect(sections).toContain('source_summary')
    expect(sections).toContain('feedback')
    expect(sections).toContain('handoff')
  })

  it('includes ai_explanation when draft exists', () => {
    const sections = deriveAvailableSections({
      sourceRefs: [],
      parameterTensions: [],
      principleMappings: [],
      evidenceRefs: [],
      aiExplanationDraft: 'AI 解释草稿',
      fallbackSummary: null,
      aiMetadata: null,
      costSummary: null,
      handoffState: null,
    })
    expect(sections).toContain('ai_explanation')
  })

  it('includes fallback_summary when fallback exists', () => {
    const sections = deriveAvailableSections({
      sourceRefs: [],
      parameterTensions: [],
      principleMappings: [],
      evidenceRefs: [],
      aiExplanationDraft: null,
      fallbackSummary: 'fallback 摘要',
      aiMetadata: null,
      costSummary: null,
      handoffState: null,
    })
    expect(sections).toContain('fallback_summary')
  })
})

describe('isSourceHashStale', () => {
  it('returns true when hash not in list', () => {
    expect(isSourceHashStale('hash1', ['hash2', 'hash3'])).toBe(true)
  })

  it('returns false when hash is in list', () => {
    expect(isSourceHashStale('hash1', ['hash1', 'hash2'])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 1.1 — DTO 类型形状验证
// ---------------------------------------------------------------------------

describe('TrizRecommendationRationale shape', () => {
  const rationale: TrizRecommendationRationale = {
    id: 'r1',
    organizationId: 1,
    projectId: 1,
    sourceType: 'contradiction',
    sourceRefs: [],
    sourceHashes: [],
    contradictionSummary: '工期与资源负载矛盾',
    parameterTensions: [],
    principleMappings: [],
    evidenceRefs: [],
    validationSummary: {
      status: 'passed',
      antiHallucinationPassed: true,
      sourceRefsValid: true,
      warnings: [],
    },
    warningSummary: null,
    aiMetadata: null,
    costSummary: null,
    deterministicSummary: '确定性规则摘要',
    aiExplanationDraft: null,
    fallbackSummary: null,
    availableSections: ['source_summary', 'feedback', 'handoff'],
    humanReviewRequirement: '需要人工审查',
    handoffState: null,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  }

  it('includes required identifier fields', () => {
    expect(rationale.id).toBe('r1')
    expect(rationale.organizationId).toBe(1)
    expect(rationale.projectId).toBe(1)
  })

  it('includes source fields', () => {
    expect(rationale.sourceType).toBe('contradiction')
    expect(rationale.sourceRefs).toEqual([])
    expect(rationale.sourceHashes).toEqual([])
  })

  it('differentiates deterministic from AI', () => {
    expect(rationale.deterministicSummary).toBeTruthy()
    expect(rationale.aiExplanationDraft).toBeNull()
    expect(rationale.fallbackSummary).toBeNull()
  })

  it('includes validation state', () => {
    expect(rationale.validationSummary.status).toBe('passed')
    expect(rationale.validationSummary.antiHallucinationPassed).toBe(true)
  })

  it('includes available sections', () => {
    expect(rationale.availableSections).toContain('feedback')
    expect(rationale.availableSections).toContain('handoff')
  })
})

describe('RationaleFeedbackRequest shape', () => {
  it('accepts helpful reason with note', () => {
    const req: RationaleFeedbackRequest = {
      reason: 'helpful',
      note: '这个建议很实用',
    }
    expect(req.reason).toBe('helpful')
    expect(req.note).toBe('这个建议很实用')
  })

  it('allows null note', () => {
    const req: RationaleFeedbackRequest = {
      reason: 'not_relevant',
    }
    expect(req.reason).toBe('not_relevant')
    expect(req.note).toBeUndefined()
  })
})

describe('RationaleWarning shape', () => {
  it('includes code, message, optional details', () => {
    const w: RationaleWarning = {
      code: 'STALE_SOURCE_HASH',
      message: '来源 hash 已过期',
      details: '建议重新运行分析',
    }
    expect(w.code).toBe('STALE_SOURCE_HASH')
    expect(w.details).toBeTruthy()
  })

  it('allows null details', () => {
    const w: RationaleWarning = { code: 'SOURCE_UNAVAILABLE', message: '来源不可用' }
    expect(w.details).toBeUndefined()
  })
})
