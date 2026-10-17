import { test } from '@japa/runner'
import { TrizCompilerAnalysisService } from '#services/triz_compiler/triz_compiler_analysis_service'
import type { TrizAnalysisSourceRef } from '@aiproj/types'

test.group('TrizCompilerAnalysisService - idempotency key', () => {
  test('generates consistent idempotency key from same inputs', async ({ assert }) => {
    const service = new TrizCompilerAnalysisService({} as any)
    const key1 = service.generateIdempotencyKey({
      compilerRunId: 1,
      stageId: 'triz_analysis',
      projectId: 42,
      sourceHash: 'abc123',
      attemptNumber: 1,
    })
    const key2 = service.generateIdempotencyKey({
      compilerRunId: 1,
      stageId: 'triz_analysis',
      projectId: 42,
      sourceHash: 'abc123',
      attemptNumber: 1,
    })
    assert.equal(key1, key2)
    assert.isTrue(key1.startsWith('triz_analysis:'))
  })

  test('different source hash produces different key', async ({ assert }) => {
    const service = new TrizCompilerAnalysisService({} as any)
    const key1 = service.generateIdempotencyKey({
      compilerRunId: 1,
      stageId: 'triz_analysis',
      projectId: 42,
      sourceHash: 'abc123',
      attemptNumber: 1,
    })
    const key2 = service.generateIdempotencyKey({
      compilerRunId: 1,
      stageId: 'triz_analysis',
      projectId: 42,
      sourceHash: 'def456',
      attemptNumber: 1,
    })
    assert.notEqual(key1, key2)
  })

  test('different attempt number produces different key', async ({ assert }) => {
    const service = new TrizCompilerAnalysisService({} as any)
    const key1 = service.generateIdempotencyKey({
      compilerRunId: 1,
      stageId: 'triz_analysis',
      projectId: 42,
      sourceHash: 'abc123',
      attemptNumber: 1,
    })
    const key2 = service.generateIdempotencyKey({
      compilerRunId: 1,
      stageId: 'triz_analysis',
      projectId: 42,
      sourceHash: 'abc123',
      attemptNumber: 2,
    })
    assert.notEqual(key1, key2)
  })
})

test.group('TrizCompilerAnalysisService - fallback', () => {
  test('creates fallback artifact with warning for budget block', async ({ assert }) => {
    const service = new TrizCompilerAnalysisService({} as any)
    const deterministic = createMinimalArtifact()
    const fallback = service.createFallbackArtifact(deterministic, 'budget')

    assert.isNotNull(fallback)
    assert.isNull(fallback.aiNarrative)
    assert.isTrue(fallback.warnings.some((w) => w.code === 'BUDGET_BLOCKED'))
  })

  test('creates fallback artifact with warning for model failure', async ({ assert }) => {
    const service = new TrizCompilerAnalysisService({} as any)
    const deterministic = createMinimalArtifact()
    const fallback = service.createFallbackArtifact(deterministic, 'model')

    assert.isTrue(fallback.warnings.some((w) => w.code === 'MODEL_FAILURE'))
  })

  test('creates fallback artifact with warning for validation failure', async ({ assert }) => {
    const service = new TrizCompilerAnalysisService({} as any)
    const deterministic = createMinimalArtifact()
    const fallback = service.createFallbackArtifact(deterministic, 'validation')

    assert.isTrue(fallback.warnings.some((w) => w.code === 'INVALID_AI_OUTPUT'))
  })
})

test.group('TrizCompilerAnalysisService - attachAiNarrative', () => {
  test('attaches AI narrative to deterministic artifact', async ({ assert }) => {
    const service = new TrizCompilerAnalysisService({} as any)
    const deterministic = createMinimalArtifact()
    const narrative = {
      summary: '基于当前矛盾分析，建议拆分关键路径并增加缓冲',
      provider: 'test-provider',
      model: 'test-model',
      hallucinationChecked: true,
      hallucinationPassed: true,
      tokenUsage: { input: 500, output: 200, total: 700 },
    }

    const withNarrative = service.attachAiNarrative(deterministic, narrative)
    assert.equal(withNarrative.mode, 'hybrid')
    assert.isNotNull(withNarrative.aiNarrative)
    assert.equal(withNarrative.aiNarrative!.summary, narrative.summary)
    assert.equal(withNarrative.aiNarrative!.tokenUsage!.total, 700)
  })
})

test.group('TrizCompilerAnalysisService - validateAiOutput', () => {
  test('passes validation for clean AI narrative', async ({ assert }) => {
    const service = new TrizCompilerAnalysisService({} as any)
    const artifact = createMinimalArtifact()
    const narrative = {
      summary: '这是一个有意义的综合分析说明，长度超过十个字',
      provider: 'test',
      model: 'test',
      hallucinationChecked: true,
      hallucinationPassed: true,
      tokenUsage: null,
    }
    const withNarrative = service.attachAiNarrative(artifact, narrative)
    const result = service.validateAiOutput(withNarrative)
    assert.isTrue(result.passed)
  })

  test('fails when AI narrative is too short', async ({ assert }) => {
    const service = new TrizCompilerAnalysisService({} as any)
    const artifact = createMinimalArtifact()
    const narrative = {
      summary: '短',
      provider: 'test',
      model: 'test',
      hallucinationChecked: true,
      hallucinationPassed: true,
      tokenUsage: null,
    }
    const withNarrative = service.attachAiNarrative(artifact, narrative)
    const result = service.validateAiOutput(withNarrative)
    assert.isFalse(result.passed)
    assert.isTrue(result.warnings.some((w) => w.code === 'INVALID_AI_OUTPUT'))
  })

  test('flags hallucination warning when HL check fails', async ({ assert }) => {
    const service = new TrizCompilerAnalysisService({} as any)
    const artifact = createMinimalArtifact()
    const narrative = {
      summary: '这是一个有意义的综合分析说明，长度超过十个字',
      provider: 'test',
      model: 'test',
      hallucinationChecked: true,
      hallucinationPassed: false,
      tokenUsage: null,
    }
    const withNarrative = service.attachAiNarrative(artifact, narrative)
    const result = service.validateAiOutput(withNarrative)
    assert.isFalse(result.passed)
    assert.isTrue(result.warnings.some((w) => w.code === 'HALLUCINATION_WARNING'))
  })

  test('passes when no AI narrative exists', async ({ assert }) => {
    const service = new TrizCompilerAnalysisService({} as any)
    const artifact = createMinimalArtifact()
    const result = service.validateAiOutput(artifact)
    assert.isTrue(result.passed)
  })
})

test.group('TrizContextSectionBuilder - low sensitivity', () => {
  test('compact section excludes full evidence and AI explanations', async ({ assert }) => {
    const { buildTrizCompactContextSection, validateTrizSectionLowSensitivity } =
      await import('#services/triz_compiler/triz_context_section')
    const section = buildTrizCompactContextSection({
      sourceRefs: [],
      tensions: [],
      principles: [],
      warningCodes: [],
      hasDraftContradictions: false,
      hasStaleContradictions: false,
    })
    const validation = validateTrizSectionLowSensitivity(section)
    assert.isTrue(validation.passed)
  })

  test('section with empty data has estimated tokens within threshold', async ({ assert }) => {
    const { buildTrizCompactContextSection } =
      await import('#services/triz_compiler/triz_context_section')
    const section = buildTrizCompactContextSection({
      sourceRefs: [],
      tensions: [],
      principles: [],
      warningCodes: [],
      hasDraftContradictions: false,
      hasStaleContradictions: false,
    })
    assert.isAbove(section.requestedTokens, 0)
    assert.isBelow(section.requestedTokens, 5000)
  })

  test('section includes source refs from contradictions', async ({ assert }) => {
    const { buildTrizCompactContextSection } =
      await import('#services/triz_compiler/triz_context_section')
    const mockRef: TrizAnalysisSourceRef = {
      key: 'cd-001-key',
      title: '测试矛盾',
      type: 'technical',
      status: 'confirmed',
      severity: 'high',
      confidence: 0.85,
      stale: false,
      staleReason: null,
      ruleVersion: '1.0.0',
      inputSignature: 'sig-v1',
      outputHash: 'hash-v1',
      improvingParameterKey: 'duration',
      worseningParameterKey: 'cost',
      parameterKey: null,
      requirementA: null,
      requirementB: null,
      suggestedPrinciples: [{ principleId: 'segmentation', name: '分割' }],
      evidenceRefs: [],
      contradictionId: 1,
    }
    const section = buildTrizCompactContextSection({
      sourceRefs: [mockRef],
      tensions: [],
      principles: [],
      warningCodes: ['NEEDS_HUMAN_REVIEW'],
      hasDraftContradictions: true,
      hasStaleContradictions: false,
    })
    assert.equal((section.content as any).totalContradictions, 1)
    assert.isTrue((section.content as any).hasDraftContradictions)
    assert.isTrue(section.sourceRefs.length > 0)
    assert.isTrue(section.sourceRefs[0]!.startsWith('contradiction:'))
  })
})

// ── Helpers ──

function createMinimalArtifact(): any {
  return {
    schemaVersion: '1.0',
    mode: 'deterministic',
    status: 'completed',
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
    createdAt: '2026-07-16T00:00:00Z',
  }
}
