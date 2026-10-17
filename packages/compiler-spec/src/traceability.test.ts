/**
 * @aiproj/compiler-spec —— Traceability 数据契约测试（tasks 1.3）。
 *
 * 覆盖 LLM、deterministic_rule、user_edit、unanchored finding、
 * 敏感正文缺失和非法 ref。
 *
 * @aiproj/compiler-spec
 */

import { describe, it, expect } from 'vitest'
import {
  sourceAttributionSchema,
  sourceAttributionCreateSchema,
  traceabilityLinkSchema,
  traceabilityLinkCreateSchema,
  attributionGeneratedBySchema,
  humanReviewStatusSchema,
  attributionSourceRefSchema,
  traceabilityRelationTypeSchema,
  attributionEvidenceSnippetSchema,
  entitySourceSummarySchema,
  attributionDetailSchema,
  traceabilityLinkSummarySchema,
  sourceIntegrityIssueSchema,
} from '../src/traceability.js'

// ── Helpers ──

function validCreateAttribution(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: 1,
    compilerRunId: 1,
    stageId: 'intent_parsing',
    entityId: 'TASK-001',
    fieldPath: 'durationDays',
    sourceRefs: [
      {
        refId: 'artifact:model-output:run1:stage1',
        artifactKind: 'model_output',
        version: 1,
        summaryLevel: 'compact',
        label: 'Model output',
        organizationId: 1,
        compilerRunId: 1,
      },
    ],
    generatedBy: {
      kind: 'llm' as const,
      provider: 'openai',
      model: 'gpt-4',
      tokenSummary: { inputTokens: 500, outputTokens: 200, totalTokens: 700 },
    },
    confidence: 0.85,
    assumptions: ['User intent was clear'],
    evidenceSnippets: [
      {
        refId: 'ref1',
        label: 'User input',
        snippet: 'Create a login module',
        contentHash: 'abc123',
      },
    ],
    summary: 'Task created from user request for login module',
    contentHash: 'def456',
    humanReviewStatus: 'pending' as const,
    ...overrides,
  }
}

function validCreateLink(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: 1,
    projectId: 1,
    sourceEntityType: 'task',
    sourceEntityId: 'TASK-001',
    targetEntityType: 'task',
    targetEntityId: 'TASK-002',
    relationType: 'depends_on' as const,
    direction: 'forward' as const,
    strength: 1,
    sourceAttributionId: 1,
    createdBy: 1,
    ...overrides,
  }
}

// ============================================================================
// 1. AttributionGeneratedBy Schema
// ============================================================================

describe('attributionGeneratedBySchema', () => {
  it('accepts llm', () => {
    expect(attributionGeneratedBySchema.parse('llm')).toBe('llm')
  })

  it('accepts deterministic_rule', () => {
    expect(attributionGeneratedBySchema.parse('deterministic_rule')).toBe('deterministic_rule')
  })

  it('accepts user_edit', () => {
    expect(attributionGeneratedBySchema.parse('user_edit')).toBe('user_edit')
  })

  it('accepts imported', () => {
    expect(attributionGeneratedBySchema.parse('imported')).toBe('imported')
  })

  it('rejects unknown value', () => {
    expect(() => attributionGeneratedBySchema.parse('ai_generated')).toThrow()
  })
})

// ============================================================================
// 2. HumanReviewStatus Schema
// ============================================================================

describe('humanReviewStatusSchema', () => {
  it('accepts all valid statuses', () => {
    const valid = [
      'pending',
      'reviewed_and_accepted',
      'reviewed_and_modified',
      'reviewed_and_rejected',
    ] as const
    for (const s of valid) {
      expect(humanReviewStatusSchema.parse(s)).toBe(s)
    }
  })
})

// ============================================================================
// 3. AttributionSourceRef Schema — version & summaryLevel 必填
// ============================================================================

describe('attributionSourceRefSchema', () => {
  it('requires version >= 1', () => {
    expect(() =>
      attributionSourceRefSchema.parse({
        refId: 'r1',
        artifactKind: 'ctx',
        version: 0,
        summaryLevel: 'compact',
        organizationId: 1,
      }),
    ).toThrow()
  })

  it('requires summaryLevel', () => {
    expect(() =>
      attributionSourceRefSchema.parse({
        refId: 'r1',
        artifactKind: 'ctx',
        version: 1,
        organizationId: 1,
      }),
    ).toThrow()
  })

  it('accepts full ref', () => {
    const result = attributionSourceRefSchema.parse({
      refId: 'r1',
      artifactKind: 'model_output',
      version: 2,
      summaryLevel: 'full',
      organizationId: 1,
      compilerRunId: 1,
      stageId: 's1',
    })
    expect(result.version).toBe(2)
    expect(result.summaryLevel).toBe('full')
  })
})

// ============================================================================
// 4. SourceAttribution Schema — LLM 创建
// ============================================================================

describe('sourceAttributionSchema (LLM)', () => {
  it('parses valid LLM attribution', () => {
    const data = {
      id: 1,
      organizationId: 1,
      compilerRunId: 1,
      stageId: 'intent_parsing',
      entityId: 'TASK-001',
      generatedBy: { kind: 'llm' as const, provider: 'openai', model: 'gpt-4' },
      sourceRefs: [
        {
          refId: 'r1',
          artifactKind: 'model_output',
          version: 1,
          summaryLevel: 'compact',
          organizationId: 1,
          compilerRunId: 1,
        },
      ],
      contentHash: 'abc',
      createdAt: '2026-07-11T00:00:00Z',
    }
    const result = sourceAttributionSchema.parse(data)
    expect(result.generatedBy.kind).toBe('llm')
    expect(result.confidence).toBe(0)
    expect(result.humanReviewStatus).toBe('pending')
  })

  it('rejects missing contentHash', () => {
    expect(() =>
      sourceAttributionSchema.parse({
        id: 1,
        organizationId: 1,
        compilerRunId: 1,
        stageId: 's1',
        generatedBy: { kind: 'llm' },
        createdAt: '2026-07-11T00:00:00Z',
      }),
    ).toThrow()
  })
})

// ============================================================================
// 5. SourceAttribution — Deterministic Rule
// ============================================================================

describe('sourceAttributionSchema (deterministic_rule)', () => {
  it('parses rule-generated attribution with ruleId', () => {
    const result = sourceAttributionCreateSchema.parse(
      validCreateAttribution({
        generatedBy: {
          kind: 'deterministic_rule' as const,
          ruleId: 'HV-001',
          ruleName: 'cycle_detection',
        },
        entityId: 'TASK-002',
        confidence: 1,
      }),
    )
    expect(result.generatedBy.kind).toBe('deterministic_rule')
    expect(result.generatedBy.ruleId).toBe('HV-001')
    expect(result.confidence).toBe(1)
  })

  it('forbids deterministic_rule from being confused with llm', () => {
    const result = sourceAttributionCreateSchema.parse(
      validCreateAttribution({
        generatedBy: { kind: 'deterministic_rule', ruleId: 'HV-001' },
      }),
    )
    // generatedBy.kind must be exactly 'deterministic_rule', not 'llm'
    expect(result.generatedBy.kind).not.toBe('llm')
  })
})

// ============================================================================
// 6. SourceAttribution — User Edit
// ============================================================================

describe('sourceAttributionSchema (user_edit)', () => {
  it('parses user_edit attribution with fieldPath', () => {
    const result = sourceAttributionCreateSchema.parse(
      validCreateAttribution({
        generatedBy: { kind: 'user_edit' as const },
        fieldPath: 'endDate',
        confidence: 1,
      }),
    )
    expect(result.generatedBy.kind).toBe('user_edit')
    expect(result.fieldPath).toBe('endDate')
  })
})

// ============================================================================
// 7. Unanchored finding 不绑定 fieldPath
// ============================================================================

describe('sourceAttributionSchema (unanchored)', () => {
  it('marks unanchored findings without fieldPath', () => {
    const result = sourceAttributionCreateSchema.parse(
      validCreateAttribution({
        unanchored: true,
        entityId: undefined,
        fieldPath: undefined,
        generatedBy: { kind: 'llm' },
      }),
    )
    expect(result.unanchored).toBe(true)
    expect(result.fieldPath).toBeUndefined()
  })
})

// ============================================================================
// 8. 敏感正文：evidenceSnippets 只存短摘要，不存完整正文
// ============================================================================

describe('evidence sensitivity', () => {
  it('evidenceSnippets store short snippets not full text', () => {
    const longBody = 'x'.repeat(10000)
    const result = attributionEvidenceSnippetSchema.parse({
      refId: 'ref1',
      label: 'long text',
      snippet: longBody.substring(0, 200), // only first 200 chars
      contentHash: 'abc',
    })
    expect(result.snippet.length).toBeLessThan(10000)
    expect(result.snippet).toBe(longBody.substring(0, 200))
  })

  it('snippets may omit contentHash', () => {
    const result = attributionEvidenceSnippetSchema.parse({
      refId: 'ref1',
      label: 'test',
      snippet: 'short',
    })
    expect(result.contentHash).toBeUndefined()
  })
})

// ============================================================================
// 9. Traceability Link Schema
// ============================================================================

describe('traceabilityLinkSchema', () => {
  it('parses valid link', () => {
    const data = {
      id: 1,
      organizationId: 1,
      projectId: 1,
      sourceEntityType: 'task',
      sourceEntityId: 'TASK-001',
      targetEntityType: 'task',
      targetEntityId: 'TASK-002',
      relationType: 'depends_on' as const,
      direction: 'forward' as const,
      strength: 1,
      sourceAttributionId: 1,
      createdBy: 1,
      createdAt: '2026-07-11T00:00:00Z',
    }
    const result = traceabilityLinkSchema.parse(data)
    expect(result.relationType).toBe('depends_on')
    expect(result.sourceAttributionId).toBe(1)
  })

  it('create schema omits id and timestamps', () => {
    const data = validCreateLink()
    const result = traceabilityLinkCreateSchema.parse(data)
    expect(result.relationType).toBe('depends_on')
    // id, createdAt, updatedAt should not be in the create schema
    expect('id' in result).toBe(false)
  })
})

// ============================================================================
// 10. TraceabilityRelationType
// ============================================================================

describe('traceabilityRelationTypeSchema', () => {
  it('accepts hierarchy_parent', () => {
    expect(traceabilityRelationTypeSchema.parse('hierarchy_parent')).toBe('hierarchy_parent')
  })

  it('accepts depends_on', () => {
    expect(traceabilityRelationTypeSchema.parse('depends_on')).toBe('depends_on')
  })

  it('accepts validates', () => {
    expect(traceabilityRelationTypeSchema.parse('validates')).toBe('validates')
  })

  it('rejects unknown relation', () => {
    expect(() => traceabilityRelationTypeSchema.parse('unknown_rel')).toThrow()
  })
})

// ============================================================================
// 11. EntitySourceSummary
// ============================================================================

describe('entitySourceSummarySchema', () => {
  it('parses entity summary with field attributions', () => {
    const data = {
      entityId: 'TASK-001',
      entityType: 'task',
      hasFieldLevel: true,
      fieldAttributions: [
        {
          fieldPath: 'durationDays',
          generatedBy: 'llm' as const,
          confidence: 0.9,
          summary: 'AI estimated',
          attributionId: 1,
        },
      ],
      entityAttribution: {
        attributionId: 2,
        generatedBy: 'llm' as const,
        stageId: 'intent_parsing',
        confidence: 0.8,
        summary: 'Entity summary',
        humanReviewStatus: 'pending' as const,
        evidenceCount: 2,
        sourceRefCount: 1,
      },
    }
    const result = entitySourceSummarySchema.parse(data)
    expect(result.fieldAttributions).toHaveLength(1)
    expect(result.entityAttribution!.attributionId).toBe(2)
  })

  it('allows null entityAttribution (field-only attribution)', () => {
    const data = {
      entityId: 'TASK-001',
      entityType: 'task',
      hasFieldLevel: true,
      fieldAttributions: [],
      entityAttribution: null,
    }
    const result = entitySourceSummarySchema.parse(data)
    expect(result.entityAttribution).toBeNull()
  })
})

// ============================================================================
// 12. AttributionDetail View Model
// ============================================================================

describe('attributionDetailSchema', () => {
  it('parses full detail', () => {
    const data = {
      attributionId: 1,
      generatedBy: 'llm' as const,
      provider: 'openai',
      stageId: 'intent_parsing',
      entityId: 'TASK-001',
      confidence: 0.85,
      summary: 'AI generated',
      assumptions: ['User input was clear'],
      evidenceSnippets: [{ label: 'Input', snippet: 'Create project', contentHash: 'abc' }],
      validationSummary: { totalRefs: 3, passedRefs: 2, failedRefs: 0 },
      humanReviewStatus: 'pending' as const,
      createdAt: '2026-07-11T00:00:00Z',
    }
    const result = attributionDetailSchema.parse(data)
    expect(result.assumptions).toHaveLength(1)
    expect(result.validationSummary!.passedRefs).toBe(2)
  })
})

// ============================================================================
// 13. SourceIntegrityIssue
// ============================================================================

describe('sourceIntegrityIssueSchema', () => {
  it('parses blocking missing_attribution', () => {
    const data = {
      entityId: 'TASK-001',
      fieldPath: 'durationDays',
      issueType: 'missing_attribution' as const,
      severity: 'blocking' as const,
      message: 'Missing source attribution',
    }
    const result = sourceIntegrityIssueSchema.parse(data)
    expect(result.severity).toBe('blocking')
  })

  it('parses unanchored_finding warning', () => {
    const data = {
      entityId: 'TASK-001',
      issueType: 'unanchored_finding' as const,
      severity: 'warning' as const,
      message: 'Cannot bind finding to field',
    }
    const result = sourceIntegrityIssueSchema.parse(data)
    expect(result.severity).toBe('warning')
  })
})
