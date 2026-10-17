/**
 * v2-triz-ai-clarification-cards —— Unit tests for TRIZ clarification services (tasks 2.6, 3.6)
 */
import { test } from '@japa/runner'
import { TrizCandidateGenerator } from '#services/triz_clarification/triz_candidate_generator'
import { TrizClarificationMerger } from '#services/triz_clarification/triz_clarification_merger'
import { TrizClarificationSourceAdapter } from '#services/triz_clarification/triz_clarification_source_adapter'
import { TrizAnalysisArtifactAdapter } from '#services/triz_clarification/triz_analysis_adapter'
import type {
  TrizClarificationSourceRef,
  TrizClarificationCandidate,
  TrizClarificationAnswer,
  TrizAnalysisClarificationHint,
} from '@aiproj/types'
import type { TrizAnalysisArtifact } from '@aiproj/types'
import type User from '#models/user'

// ── Fixtures ──

const REF_CONFIRMED_DUR_RES: TrizClarificationSourceRef = {
  contradictionId: 1,
  key: 'tc-dur-vs-res',
  type: 'technical',
  status: 'confirmed',
  severity: 'critical',
  confidence: 0.92,
  stale: false,
  staleReason: null,
  improvingParameterKey: 'duration',
  worseningParameterKey: 'resource_load',
  parameterKey: null,
  title: '压缩工期会导致资源负载过高',
  affectedScope: ['任务分配', '资源计划'],
  suggestedPrinciples: [{ principleId: 'segmentation', name: '分割/分解' }],
  inputSignature: 'sig-001',
  outputHash: 'out-001',
}

const REF_CONFIRMED_SCOPE_QUALITY: TrizClarificationSourceRef = {
  contradictionId: 2,
  key: 'tc-scope-vs-quality',
  type: 'technical',
  status: 'confirmed',
  severity: 'high',
  confidence: 0.85,
  stale: false,
  staleReason: null,
  improvingParameterKey: 'scope',
  worseningParameterKey: 'quality',
  parameterKey: null,
  title: '扩大范围会降低交付质量',
  affectedScope: ['需求范围'],
  suggestedPrinciples: [{ principleId: 'dynamics', name: '动态化' }],
  inputSignature: 'sig-002',
  outputHash: 'out-002',
}

const REF_STALE: TrizClarificationSourceRef = {
  contradictionId: 3,
  key: 'tc-stale',
  type: 'technical',
  status: 'confirmed',
  severity: 'medium',
  confidence: 0.7,
  stale: true,
  staleReason: '基础数据已更新',
  improvingParameterKey: 'cost',
  worseningParameterKey: 'risk_level',
  parameterKey: null,
  title: '降低成本会增加项目风险',
  affectedScope: ['预算'],
  suggestedPrinciples: [],
  inputSignature: 'sig-003',
  outputHash: 'out-003',
}

const ANALYSIS_HINT: TrizAnalysisClarificationHint = {
  artifactId: 'triz-artifact-001',
  version: 1,
  contentHash: 'abc123',
  sourceKeys: ['tc-dur-vs-res'],
  topTensions: ['工期 ↔ 资源负载'],
  principleRefs: [{ principleId: 'segmentation', name: '分割/分解', relevance: 'high' }],
  resolutionPathHints: [{ pathId: 'rp-001', name: '分段交付', suggestionType: 'split' }],
  warningCodes: [],
  hasAiNarrative: false,
}

// ── Tests ──

test.group('TrizClarificationSourceAdapter - read-only boundary', () => {
  test('returns empty array when policy denies view', async ({ assert }) => {
    const policy = { view: async () => false } as any
    const adapter = new TrizClarificationSourceAdapter(policy)
    const user = {} as User
    const result = await adapter.getAuthorizedSnapshots(user, 1, 42)
    assert.deepEqual(result, [])
  })

  test('returns empty array silently without revealing existence for cross-org', async ({
    assert,
  }) => {
    const policy = { view: async () => false } as any
    const adapter = new TrizClarificationSourceAdapter(policy)
    const user = {} as User
    const result = await adapter.hasVisibleContradictions(user, 1, 999)
    assert.isFalse(result)
  })
})

test.group('TrizAnalysisArtifactAdapter - artifact availability', () => {
  const adapter = new TrizAnalysisArtifactAdapter()

  test('returns unavailable warning when artifact is null', async ({ assert }) => {
    const result = adapter.extractHints(null)
    assert.isNull(result.hint)
    assert.include(result.warningCodes, 'TRIZ_ANALYSIS_UNAVAILABLE')
  })

  test('extracts hints from valid artifact', async ({ assert }) => {
    const mockArtifact: TrizAnalysisArtifact = {
      schemaVersion: '1.0',
      mode: 'deterministic',
      status: 'completed',
      sourceContradictions: [
        {
          key: 'tc-dur-vs-res',
          type: 'technical',
          title: 'test',
          status: 'confirmed',
          severity: 'critical',
          confidence: 0.9,
          stale: false,
          staleReason: null,
          ruleVersion: '1.0',
          inputSignature: 'sig',
          outputHash: 'out',
          improvingParameterKey: 'duration',
          worseningParameterKey: 'resource_load',
          parameterKey: null,
          requirementA: null,
          requirementB: null,
          suggestedPrinciples: [],
          evidenceRefs: [],
          contradictionId: 1,
        },
      ],
      parameterTensions: [
        {
          improvingKey: 'duration',
          worseningKey: 'resource_load',
          technicalSummary: '工期 ↔ 资源负载',
          physicalSummary: null,
          sourceKeys: ['tc-dur-vs-res'],
        },
      ],
      principleCandidates: [
        {
          principleId: 'segmentation',
          name: '分割/分解',
          chineseName: '分割/分解',
          relevance: 'high',
          sourceKeys: ['tc-dur-vs-res'],
        },
      ],
      resolutionPaths: [],
      warnings: [],
      requiresHumanReview: false,
      sourceHashes: { inputSignatures: ['sig'], outputHash: 'out', contentHash: 'content-123' },
      handoff: {
        status: 'none',
        draftSessionRef: null,
        selectedPathId: null,
        handedOffAt: null,
        blockedReason: null,
      },
      aiNarrative: null,
      createdAt: '2026-07-16T00:00:00.000Z',
    }
    const result = adapter.extractHints(mockArtifact)
    assert.isNotNull(result.hint)
    assert.equal(result.hint!.sourceKeys[0], 'tc-dur-vs-res')
    assert.include(result.hint!.topTensions[0], '工期')
    assert.isFalse(result.hint!.hasAiNarrative)
  })

  test('is not usable when artifact is failed', async ({ assert }) => {
    const mockArtifact = {
      schemaVersion: '1.0',
      mode: 'deterministic',
      status: 'failed',
      sourceContradictions: [],
      parameterTensions: [],
      principleCandidates: [],
      resolutionPaths: [],
      warnings: [],
      requiresHumanReview: false,
      sourceHashes: { inputSignatures: [], outputHash: '', contentHash: '' },
      handoff: {
        status: 'none',
        draftSessionRef: null,
        selectedPathId: null,
        handedOffAt: null,
        blockedReason: null,
      },
      aiNarrative: null,
      createdAt: '',
    }
    assert.isFalse(adapter.isArtifactUsable(mockArtifact as TrizAnalysisArtifact))
  })
})

test.group('TrizCandidateGenerator - deterministic generation', () => {
  const generator = new TrizCandidateGenerator()

  test('generates candidate from confirmed contradiction', async ({ assert }) => {
    const candidates = generator.generateCandidates([REF_CONFIRMED_DUR_RES], ANALYSIS_HINT, {
      maxCards: 5,
    })
    assert.isNotEmpty(candidates)
    assert.equal(candidates[0].sourceRefs[0].key, 'tc-dur-vs-res')
    assert.equal(candidates[0].severity, 'critical')
    assert.isFalse(candidates[0].allowSkip)
    assert.isTrue(candidates[0].isRequired)
  })

  test('returns empty array for empty refs', async ({ assert }) => {
    const candidates = generator.generateCandidates([], null)
    assert.isEmpty(candidates)
  })

  test('skips stale contradictions', async ({ assert }) => {
    const candidates = generator.generateCandidates([REF_STALE], null)
    assert.isEmpty(candidates)
  })

  test('respects maxCards limit', async ({ assert }) => {
    const refs = [REF_CONFIRMED_DUR_RES, REF_CONFIRMED_SCOPE_QUALITY]
    const candidates = generator.generateCandidates(refs, null, { maxCards: 1 })
    assert.lengthOf(candidates, 1)
  })

  test('stable ordering - same input produces same order', async ({ assert }) => {
    const refs = [REF_CONFIRMED_SCOPE_QUALITY, REF_CONFIRMED_DUR_RES]
    const r1 = generator.generateCandidates(refs, ANALYSIS_HINT)
    const r2 = generator.generateCandidates([...refs].reverse(), ANALYSIS_HINT)
    assert.equal(r1.length, r2.length)
    for (const [i, element] of r1.entries()) {
      assert.equal(element.cardId, r2[i].cardId)
    }
  })

  test('includes TRIZ_ANALYSIS_UNAVAILABLE warning when no hint', async ({ assert }) => {
    const candidates = generator.generateCandidates([REF_CONFIRMED_DUR_RES], null)
    assert.isNotEmpty(candidates)
    assert.include(candidates[0].warningCodes, 'TRIZ_ANALYSIS_UNAVAILABLE')
  })

  test('source validation detects missing key', async ({ assert }) => {
    const invalidRef = { ...REF_CONFIRMED_DUR_RES, key: '' }
    const generator2 = new TrizCandidateGenerator()
    const warnings = generator2.validateSourceIntegrity({
      cardId: 'test',
      sourceRefs: [invalidRef],
      analysisHint: null,
      trizCategory: 'trade_off',
      mappedField: 'priority',
      title: 'test',
      description: '',
      impactScope: [],
      questionType: 'single_choice',
      quickOptions: [],
      defaultValue: null,
      confidence: 0.5,
      reasoning: '',
      severity: 'medium',
      allowSkip: true,
      isRequired: false,
      warningCodes: [],
      warnings: [],
      answerEffect: { type: 'default_adoption', description: 'test', severity: 'medium' },
      sourceHash: 'hash',
    } as TrizClarificationCandidate)
    assert.isNotEmpty(warnings)
  })
})

test.group('TrizClarificationMerger - card merge', () => {
  const merger = new TrizClarificationMerger()

  test('returns ordinary cards when no TRIZ candidates', async ({ assert }) => {
    const result = merger.analyze('开发一个简单的内部工具', {}, [])
    assert.isNotEmpty(result.cards)
    assert.equal(result.branch, 'clarify')
    // TRIZ should not appear
    const trizCards = result.cards.filter((c: any) => (c as any).source === 'triz')
    assert.isEmpty(trizCards)
  })

  test('merges TRIZ cards with ordinary cards', async ({ assert }) => {
    const generator = new TrizCandidateGenerator()
    const trizCandidates = generator.generateCandidates([REF_CONFIRMED_DUR_RES], ANALYSIS_HINT)

    const result = merger.analyze('开发一个内部工具，工期很紧', {}, trizCandidates)
    const trizCards = result.cards.filter((c: any) => (c as any).source === 'triz')
    assert.isNotEmpty(trizCards)
    assert.equal(trizCards[0].cardId, trizCandidates[0].cardId)
  })

  test('branch stays clarify when critical TRIZ card unanswered', async ({ assert }) => {
    const generator = new TrizCandidateGenerator()
    const trizCandidates = generator.generateCandidates([REF_CONFIRMED_DUR_RES], ANALYSIS_HINT)
    // All ordinary fields resolved
    const result = merger.analyze(
      '开发一个内部管理工具，团队5人，使用 React，敏捷开发，从7月20日开始',
      {},
      trizCandidates,
    )
    assert.equal(result.branch, 'clarify') // TRIZ critical card unanswered
  })

  test('validates TRIZ answer correctly', async ({ assert }) => {
    const generator = new TrizCandidateGenerator()
    const candidates = generator.generateCandidates([REF_CONFIRMED_DUR_RES], ANALYSIS_HINT)
    const dtos = candidates.map((c) => ({
      cardId: c.cardId,
      field: c.mappedField,
      category: 'critical' as any,
      trizCategory: c.trizCategory,
      source: 'triz' as const,
      title: c.title,
      description: c.description,
      impactScope: c.impactScope,
      questionType: c.questionType,
      quickOptions: c.quickOptions,
      defaultValue: c.defaultValue,
      defaultValueMarker: null,
      confidence: c.confidence,
      reasoning: c.reasoning,
      allowSkip: c.allowSkip,
      isRequired: c.isRequired,
      sourceRefs: c.sourceRefs.map((r) => ({
        key: r.key,
        type: r.type,
        severity: r.severity,
        title: r.title,
      })),
      analysisArtifactRef: c.analysisHint?.contentHash ?? null,
      warningCodes: c.warningCodes,
      warnings: c.warnings,
      answerEffect: c.answerEffect,
      sourceHash: c.sourceHash,
    }))

    const validAnswer: TrizClarificationAnswer = {
      cardId: candidates[0].cardId,
      action: 'answer',
      value: 'resource_first',
      adoptedDefault: false,
      sourceHash: candidates[0].sourceHash,
      marker: { confidence: 1, source: 'explicit', reason: '用户选择', needsConfirmation: false },
    }
    assert.isNull(merger.validateTrizAnswer(validAnswer, dtos))

    const invalidAnswer: TrizClarificationAnswer = {
      ...validAnswer,
      action: 'skip',
    }
    assert.isNotNull(merger.validateTrizAnswer(invalidAnswer, dtos))
  })

  test('marks stale answer', async ({ assert }) => {
    const generator = new TrizCandidateGenerator()
    const candidates = generator.generateCandidates([REF_CONFIRMED_DUR_RES], ANALYSIS_HINT)
    const dtos = candidates.map((c) => ({
      cardId: c.cardId,
      field: c.mappedField,
      category: 'critical' as any,
      trizCategory: c.trizCategory,
      source: 'triz' as const,
      title: c.title,
      description: c.description,
      impactScope: c.impactScope,
      questionType: c.questionType,
      quickOptions: c.quickOptions,
      defaultValue: c.defaultValue,
      defaultValueMarker: null,
      confidence: c.confidence,
      reasoning: c.reasoning,
      allowSkip: c.allowSkip,
      isRequired: c.isRequired,
      sourceRefs: c.sourceRefs.map((r) => ({
        key: r.key,
        type: r.type,
        severity: r.severity,
        title: r.title,
      })),
      analysisArtifactRef: c.analysisHint?.contentHash ?? null,
      warningCodes: c.warningCodes,
      warnings: c.warnings,
      answerEffect: c.answerEffect,
      sourceHash: c.sourceHash,
    }))

    const staleAnswer: TrizClarificationAnswer = {
      cardId: candidates[0].cardId,
      action: 'answer',
      value: 'schedule_first',
      adoptedDefault: false,
      sourceHash: 'triz-sh-old-version',
      marker: null,
    }
    const validationResult = merger.validateTrizAnswer(staleAnswer, dtos)
    assert.isNotNull(validationResult)
    assert.include(validationResult!, '过期')
  })
})
