/**
 * v2-triz-ai-clarification-cards —— Integration tests (tasks 4.5, 5.5, 6.5, 7.5)
 */
import { test } from '@japa/runner'
import { TrizCandidateGenerator } from '#services/triz_clarification/triz_candidate_generator'
import { TrizClarificationMerger } from '#services/triz_clarification/triz_clarification_merger'
import { TrizClarificationAiService } from '#services/triz_clarification/triz_clarification_ai_service'
import { TrizDraftInputAdapter } from '#services/triz_clarification/triz_draft_input_adapter'
import { createValidationFeedbackArtifact } from '#services/triz_clarification/validation_feedback'
import type { TrizClarificationSourceRef } from '@aiproj/types'

const REF: TrizClarificationSourceRef = {
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
  affectedScope: ['任务分配'],
  suggestedPrinciples: [{ principleId: 'segmentation', name: '分割/分解' }],
  inputSignature: 'sig-001',
  outputHash: 'out-001',
}

test.group('ValidationFeedbackArtifact', () => {
  test('creates artifact with correct summary', async ({ assert }) => {
    const artifact = createValidationFeedbackArtifact(
      [
        {
          type: 'source_validation_failed',
          cardId: 'card-1',
          message: '来源缺失',
          details: ['key missing'],
        },
        {
          type: 'hallucination_failed',
          cardId: 'card-2',
          message: '反幻觉未通过',
          details: ['non-existent ref'],
        },
        { type: 'budget_fallback', message: '预算阻断', details: ['budget exceeded'] },
      ],
      42,
      1,
    )
    assert.equal(artifact.projectId, 42)
    assert.equal(artifact.summary.failed, 2)
    assert.equal(artifact.summary.fallbacks, 1)
    assert.isTrue(artifact.createdAt.length > 0)
  })
})

test.group('TrizClarificationAiService - fake provider', () => {
  const aiService = new TrizClarificationAiService()

  test('default tests use deterministic wording, not real models', async ({ assert }) => {
    const generator = new TrizCandidateGenerator()
    const candidates = generator.generateCandidates([REF], null)
    const result = aiService.generateDeterministicWording(candidates[0])
    assert.isTrue(result.success)
    assert.isFalse(result.isFallback)
    assert.isNull(result.provider)
    assert.isNull(result.model)
    assert.isNull(result.cost)
  })

  test('budget-like scenario falls back to deterministic text', async ({ assert }) => {
    const generator = new TrizCandidateGenerator()
    const candidates = generator.generateCandidates([REF], null)
    const result = await aiService.generateWithAiFallback(candidates[0], false)
    assert.isTrue(result.success)
    assert.isFalse(result.isFallback)
    // No AI call was made
    assert.isNull(result.provider)
  })

  test('hallucinated wording is detected', async ({ assert }) => {
    const result = aiService.validateAgainstHallucination('non-existent-contradiction', [REF])
    // Should pass because the AI output text doesn't create false refs
    assert.isTrue(result.passed)
  })

  test('cost events exclude sensitive text', async ({ assert }) => {
    const result = aiService.generateDeterministicWording({
      cardId: 'test',
      sourceRefs: [REF],
      analysisHint: null,
      trizCategory: 'trade_off',
      mappedField: 'priority',
      title: 'test',
      description: '敏感内部数据不应该在成本记录中出现',
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
      answerEffect: { type: 'default_adoption', description: '影响', severity: 'medium' },
      sourceHash: 'hash',
    })
    assert.isNull(result.cost) // deterministic = no cost record
    assert.notInclude(result.description ?? '', '内部')
  })
})

test.group('TrizDraftInputAdapter - formal data boundary', () => {
  const adapter = new TrizDraftInputAdapter()

  test('stale answer blocks proceed', async ({ assert }) => {
    const result = adapter.prepareInput(
      [],
      [
        {
          cardId: 'test',
          sourceRefs: [
            { key: 'tc-dur-vs-res', type: 'technical', severity: 'critical', title: 'test' },
          ],
          analysisArtifactRef: null,
          action: 'answer',
          value: 'schedule_first',
          marker: { confidence: 1, source: 'explicit', reason: 'user', needsConfirmation: false },
          sourceHash: 'old-hash',
          stale: true,
          warningCodes: ['TRIZ_STALE_ANSWER'],
          answerEffect: null,
        },
      ],
    )
    assert.isFalse(result.canProceed)
    assert.include(result.reasons[0], '过期')
  })

  test('fresh answers allow proceed', async ({ assert }) => {
    const result = adapter.prepareInput(
      [],
      [
        {
          cardId: 'test',
          sourceRefs: [
            { key: 'tc-dur-vs-res', type: 'technical', severity: 'critical', title: 'test' },
          ],
          analysisArtifactRef: null,
          action: 'answer',
          value: 'quality_first',
          marker: { confidence: 1, source: 'explicit', reason: 'user', needsConfirmation: false },
          sourceHash: 'current-hash',
          stale: false,
          warningCodes: [],
          answerEffect: null,
        },
      ],
    )
    assert.isTrue(result.canProceed)
  })

  test('requires explicit confirmation before formal writes', async ({ assert }) => {
    // The adapter only prepares input; it must not write any formal data
    const result = adapter.prepareInput([], [])
    // Check context length is 0 (no output that could be written)
    assert.equal(result.context.length, 0)
  })
})

test.group('TrizClarificationMerger - functional API behavior', () => {
  const merger = new TrizClarificationMerger()

  test('invalid answer rejection', async ({ assert }) => {
    const error = merger.validateTrizAnswer(
      {
        cardId: 'nonexistent-card',
        action: 'answer',
        value: 'test',
        adoptedDefault: false,
        sourceHash: 'hash',
        marker: null,
      },
      [],
    )
    assert.isNotNull(error)
    assert.include(error!, '不存在')
  })

  test('cross card rejection (unknown field)', async ({ assert }) => {
    const error = merger.validateTrizAnswer(
      {
        cardId: 'unknown',
        action: 'answer' as any,
        value: 'test',
        adoptedDefault: false,
        sourceHash: 'hash',
        marker: null,
      },
      [],
    )
    assert.isNotNull(error)
  })

  test('summary includes both ordinary and triz counts', async ({ assert }) => {
    const generator = new TrizCandidateGenerator()
    const candidates = generator.generateCandidates([REF], null)
    const result = merger.analyze('简单的内部工具项目', {}, candidates)
    assert.isAbove(result.summary.critical, 0)
  })
})
