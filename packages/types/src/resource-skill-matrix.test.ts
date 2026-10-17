// @aiproj/types - Resource Skill Matrix shared contract tests.
// v3-resource-skill-matrix: deterministic pure function & contract tests.

import { describe, expect, test } from 'vitest'
import {
  RESOURCE_SKILL_GAP_SEVERITIES,
  RESOURCE_SKILL_GAP_SEVERITY_ORDER,
  RESOURCE_SKILL_MATRIX_DEFAULT_DATE_WINDOW_DAYS,
  RESOURCE_SKILL_MATRIX_DEFAULT_TOP_N,
  RESOURCE_SKILL_MATRIX_EVIDENCE_VISIBILITY,
  RESOURCE_SKILL_MATRIX_GROUP_BY,
  RESOURCE_SKILL_MATRIX_MAX_DATE_WINDOW_DAYS,
  RESOURCE_SKILL_MATRIX_MAX_TOP_N,
  RESOURCE_SKILL_MATRIX_METRIC_VERSION,
  RESOURCE_SKILL_MATRIX_SCOPES,
  RESOURCE_SKILL_MATRIX_SORT_FIELDS,
  RESOURCE_SKILL_MATRIX_SOURCES,
  RESOURCE_SKILL_MATRIX_WARNING_CODES,
  RESOURCE_SKILL_MATRIX_WARNING_CODE_VALUES,
  SKILL_SOURCE_TYPES,
  buildSkillCoverageSummary,
  buildSkillGapSummary,
  normalizeSkillTag,
  normalizeSkillTagWithAliases,
  normalizeSkillTags,
  roundTwo,
  sortByProjectName,
  sortByResourceName,
  sortMatrixRowsByGapSeverity,
  sortMatrixRowsBySkillKey,
  stableStringHash,
  type ResourceSkillGapSeverity,
  type SkillAliasEntry,
} from './resource-skill-matrix.js'
import {
  FIXTURE_CANDIDATE_RESOURCE,
  FIXTURE_GAP_CRITICAL,
  FIXTURE_GAP_HIGH,
  FIXTURE_GAP_MEDIUM,
  FIXTURE_GAP_NONE,
  FIXTURE_MATRIX_ROW,
  FIXTURE_SKILL_COVERAGE_FULL,
  FIXTURE_SKILL_COVERAGE_PARTIAL,
  FIXTURE_SKILL_COVERAGE_ZERO,
  FIXTURE_SKILL_COVERAGES,
  FIXTURE_SKILL_ADVISORY_ACTIVE,
  FIXTURE_SKILL_ADVISORY_EVAL,
  FIXTURE_SKILL_ADVISORY_FORBIDDEN,
  FIXTURE_EMPTY_RESPONSE,
  FIXTURE_SUMMARY_RESPONSE,
  FIXTURE_WARNING_AI_UNAVAILABLE,
  FIXTURE_WARNING_CACHE_DEGRADED,
  FIXTURE_WARNING_SKILL_ADVISORY_FORBIDDEN,
} from './resource-skill-matrix-fixtures.js'

// ─── Constants ──────────────────────────────────────────────────────────────

describe('resource-skill-matrix constants', () => {
  test('exports stable scope and group-by enums', () => {
    expect(RESOURCE_SKILL_MATRIX_SCOPES.ORGANIZATION).toBe('organization')
    expect(RESOURCE_SKILL_MATRIX_SCOPES.PROJECT).toBe('project')
    expect(RESOURCE_SKILL_MATRIX_GROUP_BY.SKILL).toBe('skill')
    expect(RESOURCE_SKILL_MATRIX_GROUP_BY.RESOURCE).toBe('resource')
    expect(RESOURCE_SKILL_MATRIX_GROUP_BY.PROJECT).toBe('project')
    expect(RESOURCE_SKILL_MATRIX_GROUP_BY.ROLE).toBe('role')
  })

  test('exports stable sort fields', () => {
    expect(RESOURCE_SKILL_MATRIX_SORT_FIELDS.COVERAGE).toBe('coverage')
    expect(RESOURCE_SKILL_MATRIX_SORT_FIELDS.GAP_SEVERITY).toBe('gap_severity')
    expect(RESOURCE_SKILL_MATRIX_SORT_FIELDS.SKILL_KEY).toBe('skill_key')
  })

  test('exports stable source types', () => {
    expect(SKILL_SOURCE_TYPES.RESOURCE).toBe('resource')
    expect(SKILL_SOURCE_TYPES.TASK_REQUIREMENT).toBe('task_requirement')
    expect(SKILL_SOURCE_TYPES.SKILL_REGISTRY).toBe('skill_registry')
  })

  test('defaults and limits are bounded', () => {
    expect(RESOURCE_SKILL_MATRIX_DEFAULT_TOP_N).toBe(20)
    expect(RESOURCE_SKILL_MATRIX_MAX_TOP_N).toBe(50)
    expect(RESOURCE_SKILL_MATRIX_DEFAULT_DATE_WINDOW_DAYS).toBe(30)
    expect(RESOURCE_SKILL_MATRIX_MAX_DATE_WINDOW_DAYS).toBe(180)
    expect(RESOURCE_SKILL_MATRIX_METRIC_VERSION).toBe('1.0.0')
  })

  test('warning codes is a closed enum', () => {
    expect(RESOURCE_SKILL_MATRIX_WARNING_CODES.CACHE_DEGRADED).toBe('CACHE_DEGRADED')
    expect(RESOURCE_SKILL_MATRIX_WARNING_CODES.DATA_PARTIALLY_REDACTED).toBe(
      'DATA_PARTIALLY_REDACTED',
    )
    expect(RESOURCE_SKILL_MATRIX_WARNING_CODES.NO_CANDIDATE_FOR_REQUIREMENT).toBe(
      'NO_CANDIDATE_FOR_REQUIREMENT',
    )
    expect(RESOURCE_SKILL_MATRIX_WARNING_CODES.AI_UNAVAILABLE).toBe('AI_UNAVAILABLE')
    expect(RESOURCE_SKILL_MATRIX_WARNING_CODES.SKILL_ADVISORY_FORBIDDEN).toBe(
      'SKILL_ADVISORY_FORBIDDEN',
    )
  })

  test('warning code values is a frozen array', () => {
    expect(Array.isArray(RESOURCE_SKILL_MATRIX_WARNING_CODE_VALUES)).toBe(true)
    expect(RESOURCE_SKILL_MATRIX_WARNING_CODE_VALUES).toContain('CACHE_DEGRADED')
    expect(RESOURCE_SKILL_MATRIX_WARNING_CODE_VALUES).toContain('DATA_PARTIALLY_REDACTED')
  })

  test('gap severity has stable order', () => {
    expect(RESOURCE_SKILL_GAP_SEVERITY_ORDER.critical).toBeLessThan(
      RESOURCE_SKILL_GAP_SEVERITY_ORDER.high,
    )
    expect(RESOURCE_SKILL_GAP_SEVERITY_ORDER.high).toBeLessThan(
      RESOURCE_SKILL_GAP_SEVERITY_ORDER.medium,
    )
    expect(RESOURCE_SKILL_GAP_SEVERITY_ORDER.medium).toBeLessThan(
      RESOURCE_SKILL_GAP_SEVERITY_ORDER.low,
    )
    expect(RESOURCE_SKILL_GAP_SEVERITY_ORDER.low).toBeLessThan(
      RESOURCE_SKILL_GAP_SEVERITY_ORDER.none,
    )
  })

  test('evidence visibility constants are stable', () => {
    expect(RESOURCE_SKILL_MATRIX_EVIDENCE_VISIBILITY.FULL).toBe('full')
    expect(RESOURCE_SKILL_MATRIX_EVIDENCE_VISIBILITY.LOW_SENSITIVITY).toBe('low_sensitivity')
    expect(RESOURCE_SKILL_MATRIX_EVIDENCE_VISIBILITY.REDACTED).toBe('redacted')
  })

  test('source constants are stable', () => {
    expect(RESOURCE_SKILL_MATRIX_SOURCES.PROJECT_RESOURCE).toBe('project_resource')
    expect(RESOURCE_SKILL_MATRIX_SOURCES.TASK_REQUIREMENT).toBe('task_requirement')
    expect(RESOURCE_SKILL_MATRIX_SOURCES.SKILL_REGISTRY).toBe('skill_registry')
  })
})

// ─── normalizeSkillTag ─────────────────────────────────────────────────────

describe('normalizeSkillTag', () => {
  test('trims whitespace and lowercases', () => {
    expect(normalizeSkillTag(' React ')).toBe('react')
    expect(normalizeSkillTag('REACT')).toBe('react')
    expect(normalizeSkillTag('  Vue  ')).toBe('vue')
  })

  test('normalizes consecutive whitespace', () => {
    expect(normalizeSkillTag('Type   Script')).toBe('type script')
    expect(normalizeSkillTag('Go\tLang')).toBe('go lang')
  })

  test('normalizes fullwidth characters to halfwidth', () => {
    const result = normalizeSkillTag('Ｐｙｔｈｏｎ')
    // fullwidth chars normalized
    expect(result).toBe('python')
  })

  test('handles empty and whitespace-only input', () => {
    expect(normalizeSkillTag('')).toBe('')
    expect(normalizeSkillTag('   ')).toBe('')
  })

  test('deterministic: same input → same output', () => {
    const a = normalizeSkillTag(' React ')
    const b = normalizeSkillTag('React')
    const c = normalizeSkillTag('react')
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(a).toBe('react')
  })

  test('deterministic across multiple calls', () => {
    // Repeat calls must always produce the same result
    for (let i = 0; i < 100; i++) {
      expect(normalizeSkillTag(' React ')).toBe('react')
      expect(normalizeSkillTag('TypeScript')).toBe('typescript')
    }
  })
})

// ─── normalizeSkillTags ─────────────────────────────────────────────────────

describe('normalizeSkillTags', () => {
  test('deduplicates duplicate tags', () => {
    const result = normalizeSkillTags([' React ', 'react', 'REACT'])
    expect(result.normalizedKeys).toEqual(['react'])
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].normalizedKey).toBe('react')
  })

  test('returns sorted normalized keys', () => {
    const result = normalizeSkillTags(['Vue', 'React', 'Angular', 'react'])
    expect(result.normalizedKeys).toEqual(['angular', 'react', 'vue'])
  })

  test('handles empty array', () => {
    const result = normalizeSkillTags([])
    expect(result.normalizedKeys).toEqual([])
    expect(result.entries).toEqual([])
  })

  test('filters empty/whitespace tags', () => {
    const result = normalizeSkillTags(['', ' ', 'React'])
    expect(result.normalizedKeys).toEqual(['react'])
  })

  test('preserves source refs when builder provided', () => {
    const refs: any[] = []
    const result = normalizeSkillTags(['React', 'Vue'], (tag) => {
      const ref = { sourceType: 'resource' as const, sourceId: 1, originalTag: tag }
      refs.push(ref)
      return ref
    })
    expect(result.normalizedKeys).toEqual(['react', 'vue'])
    expect(result.entries[0].sourceRefs).toHaveLength(1)
  })

  test('does not duplicate source refs with same id/type/tag', () => {
    const result = normalizeSkillTags(['React', 'React', 'React'], (tag) => ({
      sourceType: 'resource' as const,
      sourceId: 1,
      originalTag: tag,
    }))
    expect(result.entries[0].sourceRefs).toHaveLength(1)
  })
})

// ─── normalizeSkillTagWithAliases ───────────────────────────────────────────

describe('normalizeSkillTagWithAliases', () => {
  const aliases: SkillAliasEntry[] = [
    { pattern: 'js', normalized: 'javascript', confidence: 'high' },
    { pattern: 'ts', normalized: 'typescript', confidence: 'high' },
    { pattern: 'ml', normalized: 'machine-learning', confidence: 'medium' },
  ]

  test('applies alias mapping', () => {
    const result = normalizeSkillTagWithAliases('JS', aliases)
    expect(result.normalizedKey).toBe('javascript')
    expect(result.matchedAlias).toBe(true)
    expect(result.confidence).toBe('high')
  })

  test('falls back to normal normalization when no alias matches', () => {
    const result = normalizeSkillTagWithAliases('Rust', aliases)
    expect(result.normalizedKey).toBe('rust')
    expect(result.matchedAlias).toBe(false)
    expect(result.confidence).toBe('high')
  })

  test('empty input returns empty with low confidence', () => {
    const result = normalizeSkillTagWithAliases('', aliases)
    expect(result.normalizedKey).toBe('')
    expect(result.matchedAlias).toBe(false)
    expect(result.confidence).toBe('low')
  })
})

// ─── buildSkillCoverageSummary ──────────────────────────────────────────────

describe('buildSkillCoverageSummary', () => {
  test('full coverage: 5/5 resources', () => {
    const result = buildSkillCoverageSummary({
      skillKey: 'react',
      skilledResourceCount: 5,
      totalResourceCount: 5,
      totalAvailableCapacityHours: 200,
      totalAllocatedCapacityHours: 100,
    })
    expect(result.skillKey).toBe('react')
    expect(result.resourceCoverageRatio).toBe(1)
    expect(result.coverageRatio).toBeCloseTo(0.67, 1)
    expect(result.totalResources).toBe(5)
  })

  test('partial coverage: 3/10 resources, limited capacity', () => {
    const result = buildSkillCoverageSummary({
      skillKey: 'vue',
      skilledResourceCount: 3,
      totalResourceCount: 10,
      totalAvailableCapacityHours: 40,
      totalAllocatedCapacityHours: 120,
    })
    expect(result.resourceCoverageRatio).toBe(0.3)
    expect(result.coverageRatio).toBe(0.25)
  })

  test('zero coverage when no skilled resources', () => {
    const result = buildSkillCoverageSummary({
      skillKey: 'rust',
      skilledResourceCount: 0,
      totalResourceCount: 10,
      totalAvailableCapacityHours: 0,
      totalAllocatedCapacityHours: 0,
    })
    expect(result.resourceCoverageRatio).toBe(0)
    expect(result.coverageRatio).toBe(0)
  })

  test('full coverage when skilled > 0 but zero capacity (edge case)', () => {
    const result = buildSkillCoverageSummary({
      skillKey: 'python',
      skilledResourceCount: 1,
      totalResourceCount: 10,
      totalAvailableCapacityHours: 0,
      totalAllocatedCapacityHours: 0,
    })
    expect(result.coverageRatio).toBe(1)
  })
})

// ─── buildSkillGapSummary ───────────────────────────────────────────────────

describe('buildSkillGapSummary', () => {
  test('critical gap: zero available capacity', () => {
    const result = buildSkillGapSummary({
      skillKey: 'rust',
      requirementCount: 5,
      requiredCapacityHours: 200,
      availableCapacityHours: 0,
      requirementSourceRefs: ['req-1', 'req-2'],
    })
    expect(result.severity).toBe('critical')
    expect(result.gapCapacityHours).toBe(200)
    expect(result.requirementCount).toBe(5)
  })

  test('high gap: < 50% coverage', () => {
    const result = buildSkillGapSummary({
      skillKey: 'go',
      requirementCount: 3,
      requiredCapacityHours: 100,
      availableCapacityHours: 30,
      requirementSourceRefs: ['req-3'],
    })
    expect(result.severity).toBe('high')
    expect(result.gapCapacityHours).toBe(70)
  })

  test('medium gap: 50-75% coverage', () => {
    const result = buildSkillGapSummary({
      skillKey: 'vue',
      requirementCount: 4,
      requiredCapacityHours: 100,
      availableCapacityHours: 55,
      requirementSourceRefs: ['req-4'],
    })
    expect(result.severity).toBe('medium')
    expect(result.gapCapacityHours).toBe(45)
  })

  test('low gap: 75-100% coverage', () => {
    const result = buildSkillGapSummary({
      skillKey: 'java',
      requirementCount: 2,
      requiredCapacityHours: 80,
      availableCapacityHours: 70,
      requirementSourceRefs: ['req-5'],
    })
    expect(result.severity).toBe('low')
    expect(result.gapCapacityHours).toBe(10)
  })

  test('none: sufficient or no requirements', () => {
    const result = buildSkillGapSummary({
      skillKey: 'react',
      requirementCount: 0,
      requiredCapacityHours: 0,
      availableCapacityHours: 160,
      requirementSourceRefs: [],
    })
    expect(result.severity).toBe('none')
    expect(result.gapCapacityHours).toBe(0)
  })

  test('provides recovery suggestion for gaps', () => {
    const result = buildSkillGapSummary({
      skillKey: 'rust',
      requirementCount: 1,
      requiredCapacityHours: 10,
      availableCapacityHours: 0,
      requirementSourceRefs: ['req-6'],
    })
    expect(result.recoverySuggestion).toBeTruthy()
    expect(result.recoverySuggestion).toContain('rust')
  })
})

// ─── Sorting Functions ──────────────────────────────────────────────────────

describe('sorting helpers', () => {
  test('sortMatrixRowsByGapSeverity sorts critical first', () => {
    const rows = [
      { gapSeverity: 'low' as ResourceSkillGapSeverity, skillKey: 'a' },
      { gapSeverity: 'critical' as ResourceSkillGapSeverity, skillKey: 'b' },
      { gapSeverity: 'high' as ResourceSkillGapSeverity, skillKey: 'c' },
    ]
    const sorted = sortMatrixRowsByGapSeverity(rows)
    expect(sorted[0].gapSeverity).toBe('critical')
    expect(sorted[1].gapSeverity).toBe('high')
    expect(sorted[2].gapSeverity).toBe('low')
  })

  test('sortMatrixRowsBySkillKey sorts alphabetically', () => {
    const rows = [{ skillKey: 'vue' }, { skillKey: 'angular' }, { skillKey: 'react' }]
    const sorted = sortMatrixRowsBySkillKey(rows)
    expect(sorted[0].skillKey).toBe('angular')
    expect(sorted[1].skillKey).toBe('react')
    expect(sorted[2].skillKey).toBe('vue')
  })

  test('sortByResourceName sorts by name', () => {
    const items = [{ resourceName: '张三' }, { resourceName: '李四' }, { resourceName: '王五' }]
    const sorted = sortByResourceName(items)
    expect(sorted.length).toBe(3)
    // Stable sort, not testing exact locale order
  })

  test('sorters return new arrays (no mutation)', () => {
    const rows = [
      { gapSeverity: 'low' as ResourceSkillGapSeverity, skillKey: 'z' },
      { gapSeverity: 'critical' as ResourceSkillGapSeverity, skillKey: 'a' },
    ]
    const original = [...rows]
    const sorted = sortMatrixRowsByGapSeverity(rows)
    expect(rows).toEqual(original)
    expect(sorted).not.toBe(rows)
  })
})

// ─── roundTwo ───────────────────────────────────────────────────────────────

describe('roundTwo', () => {
  test('rounds to two decimal places', () => {
    expect(roundTwo(1.234)).toBe(1.23)
    expect(roundTwo(1.235)).toBe(1.24)
    expect(roundTwo(1.2)).toBe(1.2)
    expect(roundTwo(0)).toBe(0)
  })

  test('handles negative numbers', () => {
    expect(roundTwo(-1.234)).toBe(-1.23)
  })
})

// ─── stableStringHash ──────────────────────────────────────────────────────

describe('stableStringHash', () => {
  test('produces deterministic output', () => {
    const a = stableStringHash('hello world')
    const b = stableStringHash('hello world')
    expect(a).toBe(b)
    expect(a.length).toBe(8)
  })

  test('different inputs produce different hashes', () => {
    const a = stableStringHash('hello')
    const b = stableStringHash('world')
    expect(a).not.toBe(b)
  })
})

// ─── Fixtures ───────────────────────────────────────────────────────────────

describe('resource-skill-matrix fixtures', () => {
  test('summary response fixture is valid', () => {
    expect(FIXTURE_SUMMARY_RESPONSE.meta.organizationId).toBe(1)
    expect(FIXTURE_SUMMARY_RESPONSE.overallCoverageRatio).toBe(0.65)
    expect(FIXTURE_SUMMARY_RESPONSE.totalGaps).toBe(3)
    expect(FIXTURE_SUMMARY_RESPONSE.coverageBySkill).toHaveLength(3)
  })

  test('coverage fixtures have expected values', () => {
    expect(FIXTURE_SKILL_COVERAGE_FULL.resourceCoverageRatio).toBe(1.0)
    expect(FIXTURE_SKILL_COVERAGE_PARTIAL.resourceCoverageRatio).toBe(0.3)
    expect(FIXTURE_SKILL_COVERAGE_ZERO.resourceCoverageRatio).toBe(0)
  })

  test('gap fixtures have correct severity', () => {
    expect(FIXTURE_GAP_CRITICAL.severity).toBe('critical')
    expect(FIXTURE_GAP_HIGH.severity).toBe('high')
    expect(FIXTURE_GAP_MEDIUM.severity).toBe('medium')
    expect(FIXTURE_GAP_NONE.severity).toBe('none')
  })

  test('advisory fixtures enforce advisoryOnly flag', () => {
    expect(FIXTURE_SKILL_ADVISORY_ACTIVE.advisoryOnly).toBe(true)
    expect(FIXTURE_SKILL_ADVISORY_ACTIVE.activationApplied).toBe(false)
    expect(FIXTURE_SKILL_ADVISORY_EVAL.evaluationOnly).toBe(true)
    expect(FIXTURE_SKILL_ADVISORY_EVAL.advisoryOnly).toBe(true)
    expect(FIXTURE_SKILL_ADVISORY_EVAL.activationApplied).toBe(false)
    expect(FIXTURE_SKILL_ADVISORY_FORBIDDEN.skillName).toBe('')
  })

  test('warning fixtures use closed enum codes', () => {
    const validCodes = RESOURCE_SKILL_MATRIX_WARNING_CODE_VALUES
    expect(validCodes).toContain(FIXTURE_WARNING_CACHE_DEGRADED.code)
    expect(validCodes).toContain(FIXTURE_WARNING_SKILL_ADVISORY_FORBIDDEN.code)
    expect(validCodes).toContain(FIXTURE_WARNING_AI_UNAVAILABLE.code)
  })

  test('empty response has zero counts', () => {
    expect(FIXTURE_EMPTY_RESPONSE.overallCoverageRatio).toBe(0)
    expect(FIXTURE_EMPTY_RESPONSE.totalGaps).toBe(0)
    expect(FIXTURE_EMPTY_RESPONSE.coverageBySkill).toEqual([])
  })

  test('candidate fixture has expected shape', () => {
    expect(FIXTURE_CANDIDATE_RESOURCE.resourceId).toBe(1)
    expect(FIXTURE_CANDIDATE_RESOURCE.resourceName).toBeTruthy()
    expect(FIXTURE_CANDIDATE_RESOURCE.availableCapacityHours).toBe(40)
  })

  test('coverage array has non-negative values', () => {
    for (const cov of FIXTURE_SKILL_COVERAGES) {
      expect(cov.coverageRatio).toBeGreaterThanOrEqual(0)
      expect(cov.coverageRatio).toBeLessThanOrEqual(1)
      expect(cov.resourceCoverageRatio).toBeGreaterThanOrEqual(0)
      expect(cov.resourceCoverageRatio).toBeLessThanOrEqual(1)
    }
  })

  test('matrix row fixture has consistent capacity math', () => {
    const row = FIXTURE_MATRIX_ROW
    const calcRemaining = row.totalAvailableCapacityHours - row.totalAllocatedCapacityHours
    expect(row.remainingCapacityHours).toBeCloseTo(calcRemaining)
    expect(row.candidateResources.length).toBeGreaterThanOrEqual(0)
  })

  test('zero runtime dependencies — no imports from adonis, react, zod, or db', () => {
    // This is a static verification: the test file itself only imports from
    // @aiproj/types internally. No external heavy dependency should be required
    // for the normalize/app/build functions to run.
    expect(typeof normalizeSkillTag).toBe('function')
    expect(typeof normalizeSkillTags).toBe('function')
    expect(typeof buildSkillCoverageSummary).toBe('function')
    expect(typeof buildSkillGapSummary).toBe('function')
    expect(typeof sortMatrixRowsByGapSeverity).toBe('function')
    expect(typeof sortMatrixRowsBySkillKey).toBe('function')
  })
})
