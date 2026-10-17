import { describe, expect, expectTypeOf, test } from 'vitest'
import {
  IMPACT_DIMENSIONS,
  IMPACT_SEVERITIES,
  IMPACT_ANALYSIS_STATUSES,
  IMPACT_RULE_IDS,
  SEVERITY_ORDER,
  severityScore,
  maxSeverity,
  isBlockingSeverity,
  type ChangeImpactDimension,
  type ChangeImpactSeverity,
  type ChangeImpactAnalysisStatus,
  type ImpactRuleId,
  type ChangeImpactAnalysis,
  type ChangeImpactItem,
  type ChangeImpactSummary,
  type ChangeImpactWarning,
  type MissingInput,
  type PropagationPathEntry,
  type AiExplanation,
  type AnalysisScope,
} from './change-impact-analysis.js'

describe('V2 change impact analysis types', () => {
  test('IMPACT_DIMENSIONS covers all seven dimensions', () => {
    expect(IMPACT_DIMENSIONS).toEqual([
      'scope',
      'schedule',
      'resource',
      'risk',
      'quality',
      'assumption',
      'related_object',
    ])
  })

  test('IMPACT_SEVERITIES has five levels', () => {
    expect(IMPACT_SEVERITIES).toEqual(['critical', 'high', 'medium', 'low', 'none'])
  })

  test('IMPACT_ANALYSIS_STATUSES has four statuses', () => {
    expect(IMPACT_ANALYSIS_STATUSES).toEqual(['pending', 'completed', 'failed', 'stale'])
  })

  test('IMPACT_RULE_IDS defines all nine rules', () => {
    expect(IMPACT_RULE_IDS).toEqual([
      'R001',
      'R002',
      'R003',
      'R004',
      'R005',
      'R006',
      'R007',
      'R008',
      'R009',
    ])
  })

  test('SEVERITY_ORDER is stable', () => {
    expect(SEVERITY_ORDER).toEqual(['critical', 'high', 'medium', 'low', 'none'])
  })

  test('severityScore returns correct values', () => {
    expect(severityScore('critical')).toBe(5)
    expect(severityScore('high')).toBe(4)
    expect(severityScore('medium')).toBe(3)
    expect(severityScore('low')).toBe(2)
    expect(severityScore('none')).toBe(1)
  })

  test('maxSeverity picks the more severe', () => {
    expect(maxSeverity('low', 'high')).toBe('high')
    expect(maxSeverity('critical', 'medium')).toBe('critical')
    expect(maxSeverity('low', 'none')).toBe('low')
    expect(maxSeverity('medium', 'high')).toBe('high')
  })

  test('isBlockingSeverity returns true for critical/high', () => {
    expect(isBlockingSeverity('critical')).toBe(true)
    expect(isBlockingSeverity('high')).toBe(true)
    expect(isBlockingSeverity('medium')).toBe(false)
    expect(isBlockingSeverity('low')).toBe(false)
    expect(isBlockingSeverity('none')).toBe(false)
  })

  test('ChangeImpactSeverity type is strict union', () => {
    expectTypeOf<ChangeImpactSeverity>().toEqualTypeOf<
      'critical' | 'high' | 'medium' | 'low' | 'none'
    >()
  })

  test('ChangeImpactDimension type is strict union', () => {
    expectTypeOf<ChangeImpactDimension>().toEqualTypeOf<
      'scope' | 'schedule' | 'resource' | 'risk' | 'quality' | 'assumption' | 'related_object'
    >()
  })

  test('ChangeImpactAnalysisStatus type is strict union', () => {
    expectTypeOf<ChangeImpactAnalysisStatus>().toEqualTypeOf<
      'pending' | 'completed' | 'failed' | 'stale'
    >()
  })

  test('ImpactRuleId type is strict union', () => {
    expectTypeOf<ImpactRuleId>().toEqualTypeOf<
      'R001' | 'R002' | 'R003' | 'R004' | 'R005' | 'R006' | 'R007' | 'R008' | 'R009'
    >()
  })

  test('ChangeImpactAnalysis has all required fields', () => {
    expectTypeOf<ChangeImpactAnalysis>().toHaveProperty('id')
    expectTypeOf<ChangeImpactAnalysis>().toHaveProperty('organizationId')
    expectTypeOf<ChangeImpactAnalysis>().toHaveProperty('projectId')
    expectTypeOf<ChangeImpactAnalysis>().toHaveProperty('changeRequestId')
    expectTypeOf<ChangeImpactAnalysis>().toHaveProperty('status')
    expectTypeOf<ChangeImpactAnalysis>().toHaveProperty('ruleVersion')
    expectTypeOf<ChangeImpactAnalysis>().toHaveProperty('inputSignature')
    expectTypeOf<ChangeImpactAnalysis>().toHaveProperty('summary')
    expectTypeOf<ChangeImpactAnalysis>().toHaveProperty('items')
    expectTypeOf<ChangeImpactAnalysis>().toHaveProperty('isStale')
    expectTypeOf<ChangeImpactAnalysis>().toHaveProperty('aiExplanation')
  })

  test('ChangeImpactItem has propagation path', () => {
    expectTypeOf<ChangeImpactItem['propagationPath']>().toEqualTypeOf<
      PropagationPathEntry[] | null
    >()
    expectTypeOf<ChangeImpactItem['severity']>().toEqualTypeOf<ChangeImpactSeverity>()
  })

  test('ChangeImpactSummary has severityDistribution', () => {
    expectTypeOf<ChangeImpactSummary['severityDistribution']>().toMatchTypeOf<
      Record<string, number>
    >()
  })

  test('AiExplanation has needsConfirmation flag', () => {
    expectTypeOf<AiExplanation['needsConfirmation']>().toEqualTypeOf<boolean>()
    expectTypeOf<AiExplanation['confidence']>().toEqualTypeOf<number>()
  })

  test('MissingInput has dimension and reason', () => {
    expectTypeOf<MissingInput['dimension']>().toEqualTypeOf<ChangeImpactDimension>()
    expectTypeOf<MissingInput['reason']>().toEqualTypeOf<string>()
  })

  test('AnalysisScope has dimensions array', () => {
    expectTypeOf<AnalysisScope['dimensions']>().toEqualTypeOf<ChangeImpactDimension[]>()
    expectTypeOf<AnalysisScope['maxPropagationDepth']>().toEqualTypeOf<number>()
  })

  test('ChangeImpactWarning has code and message', () => {
    expectTypeOf<ChangeImpactWarning['code']>().toEqualTypeOf<string>()
    expectTypeOf<ChangeImpactWarning['message']>().toEqualTypeOf<string>()
  })

  test('const arrays are immutable (readonly)', () => {
    // @ts-expect-error - readonly arrays should not allow push
    IMPACT_DIMENSIONS.push('new_dimension')
    // @ts-expect-error
    IMPACT_SEVERITIES.push('unknown')
    // @ts-expect-error
    IMPACT_ANALYSIS_STATUSES.push('unknown')
  })
})
