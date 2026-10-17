import { describe, expect, expectTypeOf, test } from 'vitest'
import {
  CONTRADICTION_TYPES,
  CONTRADICTION_STATUSES,
  CONTRADICTION_SEVERITIES,
  CONTRADICTION_RULE_IDS,
  CONTRADICTION_RULESET_VERSION,
  PROJECT_PARAMETER_KEYS,
  PROJECT_PARAMETERS,
  INVENTIVE_PRINCIPLE_IDS,
  INVENTIVE_PRINCIPLES,
  CONTRADICTION_SEVERITY_ORDER,
  getParameter,
  isProjectParameterKey,
  getInventivePrinciple,
  isInventivePrincipleId,
  severityRank,
  maxContradictionSeverity,
  compareCandidateContradiction,
  computeInputSignature,
  computeDedupeKey,
  computeOutputHash,
  deterministicHash,
  type ContradictionType,
  type ContradictionStatus,
  type ContradictionSeverity,
  type ContradictionRuleId,
  type ProjectParameterKey,
  type InventivePrincipleId,
  type CandidateContradiction,
  type ContradictionInputSnapshot,
} from './triz-contradiction.js'

function baseSnapshot(over: Partial<ContradictionInputSnapshot> = {}): ContradictionInputSnapshot {
  return {
    organizationId: 1,
    projectId: 10,
    taskTotal: 20,
    overdueTaskCount: 2,
    criticalPathTaskCount: 5,
    criticalPathDensity: 0.25,
    resourceUtilization: 0.8,
    resourceOverloadCount: 1,
    activeRiskCount: 3,
    highRiskCount: 1,
    milestoneTotal: 4,
    changeRequestCount: 1,
    plannedDurationDays: 60,
    scopeItemCount: 25,
    warnings: [],
    ruleVersion: CONTRADICTION_RULESET_VERSION,
    ...over,
  }
}

function techCandidate(over: Partial<CandidateContradiction> = {}): CandidateContradiction {
  return {
    type: 'technical',
    ruleId: 'CD-001',
    severity: 'high',
    confidence: 0.8,
    improvingParameterKey: 'duration',
    worseningParameterKey: 'cost',
    improvingDirection: '工期缩短',
    worseningDirection: '成本上升',
    parameterKey: null,
    requirementA: null,
    requirementB: null,
    title: '压缩工期会抬高成本',
    evidence: [],
    affectedScope: ['schedule', 'cost'],
    ...over,
  }
}

describe('V2 TRIZ contradiction catalogs', () => {
  test('CONTRADICTION_TYPES covers technical and physical', () => {
    expect(CONTRADICTION_TYPES).toEqual(['technical', 'physical'])
  })

  test('CONTRADICTION_STATUSES has four statuses', () => {
    expect(CONTRADICTION_STATUSES).toEqual(['draft', 'confirmed', 'dismissed', 'superseded'])
  })

  test('CONTRADICTION_SEVERITIES has four levels (no none)', () => {
    expect(CONTRADICTION_SEVERITIES).toEqual(['critical', 'high', 'medium', 'low'])
  })

  test('CONTRADICTION_RULE_IDS defines CD-001..CD-006', () => {
    expect(CONTRADICTION_RULE_IDS).toEqual([
      'CD-001',
      'CD-002',
      'CD-003',
      'CD-004',
      'CD-005',
      'CD-006',
    ])
  })

  test('PROJECT_PARAMETER_KEYS has all 12 parameter keys', () => {
    expect(PROJECT_PARAMETER_KEYS).toEqual([
      'duration',
      'cost',
      'resource_load',
      'quality',
      'scope',
      'risk_level',
      'flexibility',
      'stability',
      'information_completeness',
      'maintainability',
      'uncertainty',
      'throughput',
    ])
  })

  test('every catalog parameter has Chinese name and improving/worsening semantics', () => {
    expect(PROJECT_PARAMETERS.length).toBe(PROJECT_PARAMETER_KEYS.length)
    for (const p of PROJECT_PARAMETERS) {
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.description.length).toBeGreaterThan(0)
      expect(p.improving.length).toBeGreaterThan(0)
      expect(p.worsening.length).toBeGreaterThan(0)
    }
  })

  test('INVENTIVE_PRINCIPLE_IDS has all 10 principles', () => {
    expect(INVENTIVE_PRINCIPLE_IDS).toEqual([
      'segmentation',
      'preliminary_action',
      'dynamics',
      'periodic_action',
      'mechanics_substitution',
      'parameter_change',
      'inversion',
      'intermediary',
      'self_service',
      'before_in_conclusion',
    ])
  })

  test('every catalog principle has Chinese name and project advice', () => {
    expect(INVENTIVE_PRINCIPLES.length).toBe(INVENTIVE_PRINCIPLE_IDS.length)
    for (const p of INVENTIVE_PRINCIPLES) {
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.description.length).toBeGreaterThan(0)
      expect(p.projectAdvice.length).toBeGreaterThan(0)
    }
  })

  test('getParameter looks up catalog by key and degrades for unknown', () => {
    expect(getParameter('duration')?.name).toBe('工期/进度')
    expect(getParameter('scope')?.name).toBe('范围')
    expect(getParameter('not_a_param')).toBeUndefined()
  })

  test('getInventivePrinciple looks up catalog by id and degrades for unknown', () => {
    expect(getInventivePrinciple('segmentation')?.name).toBe('分割/分解')
    expect(getInventivePrinciple('nope')).toBeUndefined()
  })

  test('type guards distinguish catalog members', () => {
    expect(isProjectParameterKey('cost')).toBe(true)
    expect(isProjectParameterKey('costx')).toBe(false)
    expect(isInventivePrincipleId('inversion')).toBe(true)
    expect(isInventivePrincipleId('inversionX')).toBe(false)
  })
})

describe('V2 TRIZ contradiction strict types', () => {
  test('ContradictionType is strict union', () => {
    expectTypeOf<ContradictionType>().toEqualTypeOf<'technical' | 'physical'>()
  })

  test('ContradictionStatus is strict union', () => {
    expectTypeOf<ContradictionStatus>().toEqualTypeOf<
      'draft' | 'confirmed' | 'dismissed' | 'superseded'
    >()
  })

  test('ContradictionSeverity is strict union', () => {
    expectTypeOf<ContradictionSeverity>().toEqualTypeOf<'critical' | 'high' | 'medium' | 'low'>()
  })

  test('ContradictionRuleId is strict union', () => {
    expectTypeOf<ContradictionRuleId>().toEqualTypeOf<
      'CD-001' | 'CD-002' | 'CD-003' | 'CD-004' | 'CD-005' | 'CD-006'
    >()
  })

  test('ProjectParameterKey matches catalog keys', () => {
    expectTypeOf<ProjectParameterKey>().toEqualTypeOf<(typeof PROJECT_PARAMETER_KEYS)[number]>()
  })

  test('InventivePrincipleId matches catalog ids', () => {
    expectTypeOf<InventivePrincipleId>().toEqualTypeOf<(typeof INVENTIVE_PRINCIPLE_IDS)[number]>()
  })

  test('const arrays are immutable (readonly)', () => {
    // @ts-expect-error - readonly arrays should not allow push
    CONTRADICTION_TYPES.push('third')
    // @ts-expect-error
    PROJECT_PARAMETERS.push({} as any)
    // @ts-expect-error
    INVENTIVE_PRINCIPLES.push({} as any)
  })
})

describe('V2 TRIZ contradiction ordering', () => {
  test('severityRank is stable', () => {
    expect(CONTRADICTION_SEVERITY_ORDER).toEqual(['critical', 'high', 'medium', 'low'])
    expect(severityRank('critical')).toBeGreaterThan(severityRank('high'))
    expect(severityRank('high')).toBeGreaterThan(severityRank('medium'))
    expect(severityRank('medium')).toBeGreaterThan(severityRank('low'))
  })

  test('maxContradictionSeverity picks the more severe', () => {
    expect(maxContradictionSeverity('low', 'high')).toBe('high')
    expect(maxContradictionSeverity('critical', 'medium')).toBe('critical')
  })

  test('compareCandidateContradiction sorts by severity then confidence then rule then title', () => {
    const a = techCandidate({ severity: 'high', confidence: 0.9, title: 'b' })
    const b = techCandidate({ severity: 'medium', confidence: 0.99, title: 'a' })
    // high severity first despite lower confidence
    expect(compareCandidateContradiction(a, b)).toBeLessThan(0)

    const c = techCandidate({ severity: 'high', confidence: 0.9, ruleId: 'CD-002', title: 'z' })
    const d = techCandidate({ severity: 'high', confidence: 0.9, ruleId: 'CD-001', title: 'a' })
    // same severity/confidence → CD-001 before CD-002
    expect(compareCandidateContradiction(c, d)).toBeGreaterThan(0)
  })

  test('compareCandidateContradiction is deterministic (stable)', () => {
    const a = techCandidate()
    expect(compareCandidateContradiction(a, a)).toBe(0)
  })
})

describe('V2 TRIZ contradiction signature / hash / dedupeKey stability', () => {
  test('deterministicHash is stable for identical input', () => {
    expect(deterministicHash('abc')).toBe(deterministicHash('abc'))
    expect(deterministicHash('abc')).not.toBe(deterministicHash('abd'))
  })

  test('computeInputSignature is idempotent for identical snapshots', () => {
    const s = baseSnapshot()
    expect(computeInputSignature(s)).toBe(computeInputSignature(structuredClone(s)))
  })

  test('computeInputSignature changes when underlying facts change', () => {
    const s = baseSnapshot({ overdueTaskCount: 2 })
    const s2 = baseSnapshot({ overdueTaskCount: 5 })
    expect(computeInputSignature(s)).not.toBe(computeInputSignature(s2))
  })

  test('computeInputSignature ignores floating noise (4-digit rounding)', () => {
    const s = baseSnapshot({ criticalPathDensity: 0.250001 })
    const s2 = baseSnapshot({ criticalPathDensity: 0.250009 })
    expect(computeInputSignature(s)).toBe(computeInputSignature(s2))
  })

  test('computeDedupeKey merges identical technical pair regardless of order', () => {
    const c1 = techCandidate({ improvingParameterKey: 'duration', worseningParameterKey: 'cost' })
    const c2 = techCandidate({ improvingParameterKey: 'cost', worseningParameterKey: 'duration' })
    expect(computeDedupeKey(10, c1)).toBe(computeDedupeKey(10, c2))
  })

  test('computeDedupeKey differs across projects', () => {
    const c = techCandidate()
    expect(computeDedupeKey(10, c)).not.toBe(computeDedupeKey(11, c))
  })

  test('computeDedupeKey for physical merges symmetric requirement pair', () => {
    const physical: CandidateContradiction = {
      ...techCandidate(),
      type: 'physical',
      ruleId: 'CD-006',
      parameterKey: 'scope',
      requirementA: '要全',
      requirementB: '要快',
      improvingParameterKey: null,
      worseningParameterKey: null,
      improvingDirection: null,
      worseningDirection: null,
    }
    const swapped: CandidateContradiction = {
      ...physical,
      requirementA: '要快',
      requirementB: '要全',
    }
    expect(computeDedupeKey(10, physical)).toBe(computeDedupeKey(10, swapped))
  })

  test('computeOutputHash is stable for identical candidate set regardless of order', () => {
    const set1 = [techCandidate(), techCandidate({ ruleId: 'CD-002' })]
    const set2 = [techCandidate({ ruleId: 'CD-002' }), techCandidate()]
    expect(computeOutputHash(set1)).toBe(computeOutputHash(set2))
  })

  test('computeOutputHash changes when candidate set changes', () => {
    const set1 = [techCandidate()]
    const set2 = [techCandidate(), techCandidate({ ruleId: 'CD-002' })]
    expect(computeOutputHash(set1)).not.toBe(computeOutputHash(set2))
  })

  test('computeOutputHash on empty set is still a stable string', () => {
    expect(typeof computeOutputHash([])).toBe('string')
    expect(computeOutputHash([]).startsWith('out-')).toBe(true)
  })
})
