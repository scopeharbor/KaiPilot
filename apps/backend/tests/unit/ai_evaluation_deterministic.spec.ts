/**
 * v3-ai-automated-evaluation §4.7–4.9 — 确定性评测器测试。
 *
 * 覆盖：
 * - 六维度各自的通过与失败路径
 * - 确定性：相同输入两次评测产出相同分值与标签
 * - 纯函数边界：不依赖时钟与随机源
 *
 * @aiproj/backend tests — 零网络零 provider
 */

import { describe, it, expect } from 'vitest'
import type { DeterministicEvaluatorInput, EvaluationDimension } from '@aiproj/types'
import {
  draftStructuralComplianceEvaluator,
  antiHallucinationHitEvaluator,
  routingDestinationChangedEvaluator,
  clarificationMatchedRealGapEvaluator,
  narrationCitesOutOfContextFactEvaluator,
  suggestionAdoptionEvaluator,
  DETERMINISTIC_EVALUATORS,
  runDeterministicEvaluation,
} from '../../app/services/ai_evaluation/deterministic_evaluators.js'

// ── 辅助函数 ──────────────────────────────────────────────────────────

function makeInput(
  dimension: EvaluationDimension,
  features: Record<string, unknown> = {},
): DeterministicEvaluatorInput {
  return {
    dimension,
    artifact: {
      artifactKind: 'draft_version',
      artifactRef: 'test:1',
      contentHash: 'fnv1a:test',
    },
    features,
    organizationId: 1,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4.7 六维度通过与失败路径
// ═══════════════════════════════════════════════════════════════════════════════

describe('draft_structural_compliance evaluator', () => {
  it('passes when all required fields present', () => {
    const result = draftStructuralComplianceEvaluator(
      makeInput('draft_structural_compliance', {
        wbsNodes: [{ id: 1 }, { id: 2 }],
        taskDependencies: [{ from: 1, to: 2 }],
        acceptanceCriteria: ['Criteria 1'],
      }),
    )
    expect(result.scoreLabel).toBe('pass')
    expect(result.scoreValue).toBe(1)
  })

  it('fails when required fields missing', () => {
    const result = draftStructuralComplianceEvaluator(
      makeInput('draft_structural_compliance', {
        wbsNodes: [],
      }),
    )
    expect(result.scoreLabel).toBe('fail')
    expect(result.scoreValue).toBe(0)
    expect(result.explanation).toContain('missing')
  })

  it('fails when fields are null', () => {
    const result = draftStructuralComplianceEvaluator(
      makeInput('draft_structural_compliance', {
        wbsNodes: null,
        taskDependencies: null,
        acceptanceCriteria: null,
      }),
    )
    expect(result.scoreLabel).toBe('fail')
  })
})

describe('anti_hallucination_hit evaluator', () => {
  it('passes when anti-hallucination check passed', () => {
    const result = antiHallucinationHitEvaluator(
      makeInput('anti_hallucination_hit', {
        antiHallucination: {
          passed: true,
          totalChecks: 10,
          passedChecks: 10,
          failedChecks: [],
        },
      }),
    )
    expect(result.scoreLabel).toBe('pass')
    expect(result.scoreValue).toBe(1)
  })

  it('fails when anti-hallucination check failed', () => {
    const result = antiHallucinationHitEvaluator(
      makeInput('anti_hallucination_hit', {
        antiHallucination: {
          passed: false,
          totalChecks: 10,
          passedChecks: 7,
          failedChecks: ['HL-001', 'HL-002', 'HL-003'],
        },
      }),
    )
    expect(result.scoreLabel).toBe('fail')
    expect(result.scoreValue).toBe(0)
  })

  it('returns not-evaluated when no check result', () => {
    const result = antiHallucinationHitEvaluator(makeInput('anti_hallucination_hit', {}))
    expect(result.scoreLabel).toBe('not-evaluated')
  })
})

describe('routing_destination_changed evaluator', () => {
  it('passes when user accepted recommendation', () => {
    const result = routingDestinationChangedEvaluator(
      makeInput('routing_destination_changed', {
        routing: {
          recommendedDestination: 'project-new-task',
          userChosenDestination: 'project-new-task',
        },
      }),
    )
    expect(result.scoreLabel).toBe('pass')
    expect(result.scoreValue).toBe(1)
  })

  it('fails when user changed destination', () => {
    const result = routingDestinationChangedEvaluator(
      makeInput('routing_destination_changed', {
        routing: {
          recommendedDestination: 'project-new-task',
          userChosenDestination: 'project-edit',
        },
      }),
    )
    expect(result.scoreLabel).toBe('fail')
    expect(result.scoreValue).toBe(0)
  })

  it('returns not-evaluated when no routing decision', () => {
    const result = routingDestinationChangedEvaluator(makeInput('routing_destination_changed', {}))
    expect(result.scoreLabel).toBe('not-evaluated')
  })
})

describe('clarification_matched_real_gap evaluator', () => {
  it('passes when clarification matched real gaps', () => {
    const result = clarificationMatchedRealGapEvaluator(
      makeInput('clarification_matched_real_gap', {
        clarification: {
          matchedRealGap: true,
          matchedGaps: 3,
          totalClarifications: 5,
        },
      }),
    )
    expect(result.scoreLabel).toBe('pass')
    expect(result.scoreValue).toBe(1)
  })

  it('fails when clarification did not match', () => {
    const result = clarificationMatchedRealGapEvaluator(
      makeInput('clarification_matched_real_gap', {
        clarification: {
          matchedRealGap: false,
          matchedGaps: 0,
          totalClarifications: 5,
        },
      }),
    )
    expect(result.scoreLabel).toBe('fail')
    expect(result.scoreValue).toBe(0)
  })

  it('returns not-evaluated when no clarification result', () => {
    const result = clarificationMatchedRealGapEvaluator(
      makeInput('clarification_matched_real_gap', {}),
    )
    expect(result.scoreLabel).toBe('not-evaluated')
  })
})

describe('narration_cites_out_of_context_fact evaluator', () => {
  it('passes when narration stays within context', () => {
    const result = narrationCitesOutOfContextFactEvaluator(
      makeInput('narration_cites_out_of_context_fact', {
        narration: {
          citesOutOfContext: false,
          outOfContextCount: 0,
          totalFacts: 10,
        },
      }),
    )
    expect(result.scoreLabel).toBe('pass')
    expect(result.scoreValue).toBe(1)
  })

  it('fails when narration cites out-of-context facts', () => {
    const result = narrationCitesOutOfContextFactEvaluator(
      makeInput('narration_cites_out_of_context_fact', {
        narration: {
          citesOutOfContext: true,
          outOfContextCount: 3,
          totalFacts: 10,
        },
      }),
    )
    expect(result.scoreLabel).toBe('fail')
    expect(result.scoreValue).toBe(0)
  })

  it('returns not-evaluated when no narration check', () => {
    const result = narrationCitesOutOfContextFactEvaluator(
      makeInput('narration_cites_out_of_context_fact', {}),
    )
    expect(result.scoreLabel).toBe('not-evaluated')
  })
})

describe('suggestion_adoption evaluator', () => {
  it('passes when suggestions adopted', () => {
    const result = suggestionAdoptionEvaluator(
      makeInput('suggestion_adoption', {
        suggestionAdoption: {
          adopted: true,
          adoptedCount: 5,
          totalCount: 8,
        },
      }),
    )
    expect(result.scoreLabel).toBe('pass')
    expect(result.scoreValue).toBe(1)
  })

  it('fails when no suggestions adopted', () => {
    const result = suggestionAdoptionEvaluator(
      makeInput('suggestion_adoption', {
        suggestionAdoption: {
          adopted: false,
          adoptedCount: 0,
          totalCount: 5,
        },
      }),
    )
    expect(result.scoreLabel).toBe('fail')
    expect(result.scoreValue).toBe(0)
  })

  it('returns not-evaluated when feedback ledger unavailable (fallback)', () => {
    const result = suggestionAdoptionEvaluator(makeInput('suggestion_adoption', {}))
    expect(result.scoreLabel).toBe('not-evaluated')
    expect(result.explanation).toContain('Feedback ledger not available')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §4.8 确定性：相同输入两次评测产出相同分值与标签
// ═══════════════════════════════════════════════════════════════════════════════

describe('deterministic reproducibility', () => {
  const testCases: Array<{ dimension: EvaluationDimension; features: Record<string, unknown> }> = [
    {
      dimension: 'draft_structural_compliance',
      features: { wbsNodes: [1], taskDependencies: [1], acceptanceCriteria: [1] },
    },
    {
      dimension: 'anti_hallucination_hit',
      features: {
        antiHallucination: { passed: true, totalChecks: 5, passedChecks: 5, failedChecks: [] },
      },
    },
    {
      dimension: 'routing_destination_changed',
      features: { routing: { recommendedDestination: 'a', userChosenDestination: 'a' } },
    },
    {
      dimension: 'clarification_matched_real_gap',
      features: { clarification: { matchedRealGap: true, matchedGaps: 2, totalClarifications: 3 } },
    },
    {
      dimension: 'narration_cites_out_of_context_fact',
      features: { narration: { citesOutOfContext: false, outOfContextCount: 0, totalFacts: 5 } },
    },
    {
      dimension: 'suggestion_adoption',
      features: { suggestionAdoption: { adopted: true, adoptedCount: 3, totalCount: 5 } },
    },
  ]

  for (const { dimension, features } of testCases) {
    it(`${dimension}: same input produces identical output`, () => {
      const input = makeInput(dimension, features)
      const result1 = runDeterministicEvaluation(input)
      const result2 = runDeterministicEvaluation(input)
      expect(result1.scoreValue).toBe(result2.scoreValue)
      expect(result1.scoreLabel).toBe(result2.scoreLabel)
      expect(result1.explanation).toBe(result2.explanation)
    })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// §4.9 纯函数边界：不依赖时钟与随机源
// ═══════════════════════════════════════════════════════════════════════════════

describe('pure function boundary', () => {
  it('evaluator registry covers all six dimensions', () => {
    expect(Object.keys(DETERMINISTIC_EVALUATORS)).toHaveLength(6)
    expect(DETERMINISTIC_EVALUATORS.draft_structural_compliance).toBeDefined()
    expect(DETERMINISTIC_EVALUATORS.anti_hallucination_hit).toBeDefined()
    expect(DETERMINISTIC_EVALUATORS.routing_destination_changed).toBeDefined()
    expect(DETERMINISTIC_EVALUATORS.clarification_matched_real_gap).toBeDefined()
    expect(DETERMINISTIC_EVALUATORS.narration_cites_out_of_context_fact).toBeDefined()
    expect(DETERMINISTIC_EVALUATORS.suggestion_adoption).toBeDefined()
  })

  it('unknown dimension returns not-evaluated', () => {
    const result = runDeterministicEvaluation(
      makeInput('unknown_dimension' as EvaluationDimension, {}),
    )
    expect(result.scoreLabel).toBe('not-evaluated')
  })

  it('evaluator functions do not use Date.now() or Math.random() - verified by reproducibility', () => {
    // If evaluators used Date.now() or Math.random(), the reproducibility test above would fail
    // This test explicitly verifies by running the same input 100 times
    const input = makeInput('draft_structural_compliance', {
      wbsNodes: [1],
      taskDependencies: [1],
      acceptanceCriteria: [1],
    })
    const results = Array.from({ length: 100 }, () => runDeterministicEvaluation(input))
    const uniqueResults = new Set(
      results.map((r) => `${r.scoreValue}:${r.scoreLabel}:${r.explanation}`),
    )
    expect(uniqueResults.size).toBe(1)
  })
})
