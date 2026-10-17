// @aiproj/types — V2 测试：TRIZ AI Clarification Cards 共享契约与工具
// v2-triz-ai-clarification-cards / 1.3–1.5

import {
  TRIZ_CLARIFICATION_CARD_CATEGORIES,
  TRIZ_CLARIFICATION_WARNING_CODES,
  TRIZ_ANSWER_ACTIONS,
  TRIZ_ANSWER_EFFECT_TYPES,
  TRIZ_IMPACT_DOMAINS,
  type TrizClarificationSourceRef,
  type TrizClarificationCandidate,
  type TrizClarificationAnswer,
  type TrizClarificationWarning,
  type TrizCardIdentity,
  type TrizAnswerEffect,
  type TrizAnalysisClarificationHint,
  getTrizClarificationWarningLabel,
  computeTrizCardId,
  computeTrizSourceHash,
  compareTrizCandidates,
  isTrizAnswerStale,
  dedupeTrizCandidates,
  mapTrizCategoryToClarification,
  sortTrizWarningCodes,
} from './triz-clarification-cards.js'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// 1.1 & 1.2: Enum/constant values shape
// ---------------------------------------------------------------------------

describe('TRIZ clarification constants', () => {
  it('includes triz card categories', () => {
    expect(TRIZ_CLARIFICATION_CARD_CATEGORIES).toContain('trade_off')
    expect(TRIZ_CLARIFICATION_CARD_CATEGORIES).toContain('priority')
    expect(TRIZ_CLARIFICATION_CARD_CATEGORIES).toContain('constraint')
    expect(TRIZ_CLARIFICATION_CARD_CATEGORIES).toContain('assumption')
    expect(TRIZ_CLARIFICATION_CARD_CATEGORIES).toContain('solution_preference')
    expect(TRIZ_CLARIFICATION_CARD_CATEGORIES.length).toBe(5)
  })

  it('includes triz warning codes', () => {
    expect(TRIZ_CLARIFICATION_WARNING_CODES).toContain('TRIZ_ANALYSIS_UNAVAILABLE')
    expect(TRIZ_CLARIFICATION_WARNING_CODES).toContain('TRIZ_SOURCE_CONTRADICTION_STALE')
    expect(TRIZ_CLARIFICATION_WARNING_CODES).toContain('TRIZ_CANDIDATE_SOURCE_MISSING')
    expect(TRIZ_CLARIFICATION_WARNING_CODES).toContain('TRIZ_AI_WORDING_FALLBACK')
    expect(TRIZ_CLARIFICATION_WARNING_CODES).toContain('TRIZ_STALE_ANSWER')
    expect(TRIZ_CLARIFICATION_WARNING_CODES.length).toBeGreaterThanOrEqual(8)
  })

  it('includes answer actions', () => {
    expect(TRIZ_ANSWER_ACTIONS).toContain('answer')
    expect(TRIZ_ANSWER_ACTIONS).toContain('adopt_default')
    expect(TRIZ_ANSWER_ACTIONS).toContain('skip')
    expect(TRIZ_ANSWER_ACTIONS).toContain('defer_review')
    expect(TRIZ_ANSWER_ACTIONS.length).toBe(4)
  })

  it('includes answer effect types', () => {
    expect(TRIZ_ANSWER_EFFECT_TYPES).toContain('schedule_priority')
    expect(TRIZ_ANSWER_EFFECT_TYPES).toContain('quality_priority')
    expect(TRIZ_ANSWER_EFFECT_TYPES).toContain('resource_tradeoff')
    expect(TRIZ_ANSWER_EFFECT_TYPES.length).toBeGreaterThanOrEqual(6)
  })

  it('includes impact domains', () => {
    expect(TRIZ_IMPACT_DOMAINS).toContain('工期/进度')
    expect(TRIZ_IMPACT_DOMAINS).toContain('风险水平')
    expect(TRIZ_IMPACT_DOMAINS).toContain('质量')
    expect(TRIZ_IMPACT_DOMAINS.length).toBe(12)
  })
})

// ---------------------------------------------------------------------------
// 1.3: Card ID stability
// ---------------------------------------------------------------------------

describe('computeTrizCardId', () => {
  it('produces stable ID for same inputs', () => {
    const identity1: TrizCardIdentity = {
      schemaVersion: '1.0',
      field: 'schedulePriority',
      category: 'trade_off',
      source: 'triz',
      contradictionKey: 'tc-dur-vs-res',
      analysisHash: 'abc123',
      contradictionSourceHash: 'def456',
      questionPurpose: 'schedule_vs_resource',
    }
    const identity2: TrizCardIdentity = {
      schemaVersion: '1.0',
      field: 'schedulePriority',
      category: 'trade_off',
      source: 'triz',
      contradictionKey: 'tc-dur-vs-res',
      analysisHash: 'abc123',
      contradictionSourceHash: 'def456',
      questionPurpose: 'schedule_vs_resource',
    }
    expect(computeTrizCardId(identity1)).toBe(computeTrizCardId(identity2))
  })

  it('changes when contradiction key changes', () => {
    const base: TrizCardIdentity = {
      schemaVersion: '1.0',
      field: 'schedulePriority',
      category: 'trade_off',
      source: 'triz',
      contradictionKey: 'tc-dur-vs-res',
      analysisHash: 'abc123',
      contradictionSourceHash: 'def456',
      questionPurpose: 'schedule_vs_resource',
    }
    const modified = { ...base, contradictionKey: 'tc-scope-vs-quality' }
    expect(computeTrizCardId(base)).not.toBe(computeTrizCardId(modified))
  })

  it('changes when analysis hash changes', () => {
    const base: TrizCardIdentity = {
      schemaVersion: '1.0',
      field: 'schedulePriority',
      category: 'trade_off',
      source: 'triz',
      contradictionKey: 'tc-dur-vs-res',
      analysisHash: 'abc123',
      contradictionSourceHash: 'def456',
      questionPurpose: 'schedule_vs_resource',
    }
    const modified = { ...base, analysisHash: 'xyz789' }
    expect(computeTrizCardId(base)).not.toBe(computeTrizCardId(modified))
  })

  it('uses contradiction source hash when analysis hash is null', () => {
    const identity: TrizCardIdentity = {
      schemaVersion: '1.0',
      field: 'schedulePriority',
      category: 'trade_off',
      source: 'triz',
      contradictionKey: 'tc-dur-vs-res',
      analysisHash: null,
      contradictionSourceHash: 'def456',
      questionPurpose: 'schedule_vs_resource',
    }
    const id = computeTrizCardId(identity)
    expect(id).toContain('def456')
    expect(id).toContain('triz')
    expect(id).toContain('tc-dur-vs-res')
  })
})

// ---------------------------------------------------------------------------
// 1.3: Source hash computation
// ---------------------------------------------------------------------------

describe('computeTrizSourceHash', () => {
  const refs: Pick<
    TrizClarificationSourceRef,
    'key' | 'inputSignature' | 'outputHash' | 'status' | 'severity'
  >[] = [
    {
      key: 'tc-dur-vs-res',
      inputSignature: 'sig-001',
      outputHash: 'out-001',
      status: 'confirmed',
      severity: 'high',
    },
  ]

  it('produces stable hash for same inputs', () => {
    const a = computeTrizSourceHash(refs, null)
    const b = computeTrizSourceHash(refs, null)
    expect(a).toBe(b)
  })

  it('changes when contradiction status changes', () => {
    const changed = refs.map((r) => ({ ...r, status: 'dismissed' as const }))
    expect(computeTrizSourceHash(refs, null)).not.toBe(computeTrizSourceHash(changed, null))
  })

  it('changes when analysis hash is added', () => {
    expect(computeTrizSourceHash(refs, null)).not.toBe(
      computeTrizSourceHash(refs, 'artifact-hash-001'),
    )
  })

  it('starts with triz-sh- prefix', () => {
    expect(computeTrizSourceHash(refs, null)).toMatch(/^triz-sh-[0-9a-f]{8}$/)
  })
})

// ---------------------------------------------------------------------------
// 1.3: Candidate sorting
// ---------------------------------------------------------------------------

describe('compareTrizCandidates', () => {
  function makeCandidate(
    overrides: Partial<TrizClarificationCandidate>,
  ): TrizClarificationCandidate {
    return {
      cardId: overrides.cardId ?? 'test-1',
      sourceRefs: [],
      analysisHint: null,
      trizCategory: overrides.trizCategory ?? 'trade_off',
      mappedField: overrides.mappedField ?? 'schedulePriority',
      title: overrides.title ?? '测试卡片',
      description: '',
      impactScope: [],
      questionType: 'single_choice',
      quickOptions: [],
      defaultValue: null,
      confidence: overrides.confidence ?? 0.8,
      reasoning: '',
      severity: overrides.severity ?? 'medium',
      allowSkip: false,
      isRequired: true,
      warningCodes: [],
      warnings: [],
      answerEffect: { type: 'schedule_priority', description: '影响', severity: 'medium' },
      sourceHash: overrides.sourceHash ?? 'hash-001',
    }
  }

  it('sorts by severity: critical before high before medium before low', () => {
    const cards = [
      makeCandidate({ cardId: '1', severity: 'low' }),
      makeCandidate({ cardId: '2', severity: 'critical' }),
      makeCandidate({ cardId: '3', severity: 'high' }),
      makeCandidate({ cardId: '4', severity: 'medium' }),
    ]
    const sorted = cards.sort(compareTrizCandidates)
    expect(sorted[0].severity).toBe('critical')
    expect(sorted[1].severity).toBe('high')
    expect(sorted[2].severity).toBe('medium')
    expect(sorted[3].severity).toBe('low')
  })

  it('breaks ties by confidence (higher first)', () => {
    const cards = [
      makeCandidate({ cardId: '1', severity: 'high', confidence: 0.7 }),
      makeCandidate({ cardId: '2', severity: 'high', confidence: 0.9 }),
    ]
    const sorted = cards.sort(compareTrizCandidates)
    expect(sorted[0].cardId).toBe('2')
    expect(sorted[1].cardId).toBe('1')
  })

  it('breaks ties by cardId when severity and confidence match', () => {
    const cards = [
      makeCandidate({ cardId: 'b', severity: 'high', confidence: 0.8 }),
      makeCandidate({ cardId: 'a', severity: 'high', confidence: 0.8 }),
    ]
    const sorted = cards.sort(compareTrizCandidates)
    expect(sorted[0].cardId).toBe('a')
    expect(sorted[1].cardId).toBe('b')
  })
})

// ---------------------------------------------------------------------------
// 1.3: Stale answer detection
// ---------------------------------------------------------------------------

describe('isTrizAnswerStale', () => {
  const answer: TrizClarificationAnswer = {
    cardId: 'triz-1',
    action: 'answer',
    value: 'quality_first',
    adoptedDefault: false,
    sourceHash: 'hash-001',
    marker: null,
  }

  it('returns false when source hashes match', () => {
    expect(isTrizAnswerStale(answer, 'hash-001')).toBe(false)
  })

  it('returns true when source hashes differ', () => {
    expect(isTrizAnswerStale(answer, 'hash-002')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 1.3: Deduplication
// ---------------------------------------------------------------------------

describe('dedupeTrizCandidates', () => {
  function makeCandidate(
    overrides: Partial<TrizClarificationCandidate>,
  ): TrizClarificationCandidate {
    return {
      cardId: overrides.cardId ?? 'dup-id',
      sourceRefs: [],
      analysisHint: null,
      trizCategory: overrides.trizCategory ?? 'trade_off',
      mappedField: 'schedulePriority',
      title: overrides.title ?? '测试',
      description: '',
      impactScope: [],
      questionType: 'single_choice',
      quickOptions: [],
      defaultValue: null,
      confidence: overrides.confidence ?? 0.8,
      reasoning: '',
      severity: overrides.severity ?? 'medium',
      allowSkip: false,
      isRequired: true,
      warningCodes: [],
      warnings: [],
      answerEffect: { type: 'schedule_priority', description: '影响', severity: 'medium' },
      sourceHash: overrides.sourceHash ?? 'hash-001',
    }
  }

  it('deduplicates by cardId, keeping higher source hash', () => {
    const candidates = [
      makeCandidate({ cardId: 'dup-1', sourceHash: 'hash-a', severity: 'high' }),
      makeCandidate({ cardId: 'dup-1', sourceHash: 'hash-b', severity: 'medium' }),
      makeCandidate({ cardId: 'unique-2', sourceHash: 'hash-c', severity: 'critical' }),
    ]
    const deduped = dedupeTrizCandidates(candidates)
    expect(deduped.length).toBe(2)
    const dup = deduped.find((c) => c.cardId === 'dup-1')
    expect(dup).toBeDefined()
    expect(dup!.sourceHash).toBe('hash-b') // higher string
  })

  it('sorts deduplicated result by severity', () => {
    const candidates = [
      makeCandidate({ cardId: 'b', severity: 'low' }),
      makeCandidate({ cardId: 'a', severity: 'critical' }),
    ]
    const deduped = dedupeTrizCandidates(candidates)
    expect(deduped[0].cardId).toBe('a')
    expect(deduped[1].cardId).toBe('b')
  })
})

// ---------------------------------------------------------------------------
// 1.3: Category mapping
// ---------------------------------------------------------------------------

describe('mapTrizCategoryToClarification', () => {
  it('maps trade_off/critical to critical', () => {
    expect(mapTrizCategoryToClarification('trade_off', 'critical')).toBe('critical')
  })

  it('maps trade_off/low to recommended', () => {
    expect(mapTrizCategoryToClarification('trade_off', 'low')).toBe('recommended')
  })

  it('maps priority/solution_preference to recommended', () => {
    expect(mapTrizCategoryToClarification('priority', 'high')).toBe('recommended')
    expect(mapTrizCategoryToClarification('solution_preference', 'critical')).toBe('recommended')
  })

  it('maps assumption to optional', () => {
    expect(mapTrizCategoryToClarification('assumption', 'critical')).toBe('optional')
  })
})

// ---------------------------------------------------------------------------
// 1.3: Warning code label
// ---------------------------------------------------------------------------

describe('getTrizClarificationWarningLabel', () => {
  it('returns Chinese labels for known codes', () => {
    expect(getTrizClarificationWarningLabel('TRIZ_ANALYSIS_UNAVAILABLE')).toBe('TRIZ 分析不可用')
    expect(getTrizClarificationWarningLabel('TRIZ_BUDGET_BLOCKED')).toBe('预算阻断 — AI 文案已跳过')
    expect(getTrizClarificationWarningLabel('TRIZ_STALE_ANSWER')).toBe('回答已过期，需要重新确认')
  })

  it('returns code as-is for unknown codes', () => {
    expect(getTrizClarificationWarningLabel('UNKNOWN_CODE' as any)).toBe('UNKNOWN_CODE')
  })
})

// ---------------------------------------------------------------------------
// 1.3: Sort warning codes
// ---------------------------------------------------------------------------

describe('sortTrizWarningCodes', () => {
  it('returns deduplicated and sorted codes', () => {
    const result = sortTrizWarningCodes([
      'TRIZ_BUDGET_BLOCKED',
      'TRIZ_ANALYSIS_UNAVAILABLE',
      'TRIZ_BUDGET_BLOCKED',
    ])
    expect(result).toEqual(['TRIZ_ANALYSIS_UNAVAILABLE', 'TRIZ_BUDGET_BLOCKED'])
  })
})
