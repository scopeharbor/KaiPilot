// @aiproj/types —— OKR 层级管理共享契约测试。
// v3-okr-hierarchy-management §2.2：类型守卫、枚举稳定性、measurement bounds、warning code 与 fixture 基础契约。

import { describe, it, expect } from 'vitest'
import {
  // 枚举常量
  OKR_MEASUREMENT_TYPES,
  OKR_MEASUREMENT_TYPE_VALUES,
  OKR_SCOPES,
  OKR_SCOPE_VALUES,
  OKR_DISABLED_SCOPES,
  OKR_STATUSES,
  OKR_STATUS_VALUES,
  OKR_ACTIVE_STATUSES,
  OKR_CLOSED_STATUSES,
  OKR_CONFIDENCE_LEVELS,
  OKR_CONFIDENCE_LEVEL_VALUES,
  OKR_EVIDENCE_SOURCE_KINDS,
  OKR_EVIDENCE_SOURCE_KIND_VALUES,
  OKR_WARNING_CODES,
  OKR_WARNING_CODE_VALUES,
  OKR_SORT_FIELDS,
  OKR_SORT_FIELD_VALUES,
  OKR_INCLUDE_OPTIONS,
  OKR_INCLUDE_VALUES,
  OKR_ALIGNMENT_CONSTRAINTS,
  OKR_MEASUREMENT_BOUNDS,
  OKR_METRIC_VERSION,
  // 类型守卫
  isOkrMeasurementType,
  isOkrScope,
  isOkrStatus,
  isOkrConfidenceLevel,
  isOkrWarningCode,
  isOkrEvidenceSourceKind,
  isOkrSortField,
  isOkrIncludeOption,
  isOkrEvidenceTargetKind,
  // 验证助手
  validateMeasurementBounds,
  validateWeight,
  validateScope,
  validateCycleDateWindow,
  // Warning helpers
  makeEmptyOkrWarning,
  makeEmptyKeyResultsWarning,
  makeRestrictedChildWarning,
  makeStaleEvidenceWarning,
  makeEvidenceUnavailableWarning,
  makeCycleDetectedWarning,
  makeMaxDepthExceededWarning,
  makeDuplicateAlignmentWarning,
  makeDisabledScopeWarning,
  makeCrossOrganizationWarning,
  makeInvalidWeightWarning,
  makeInvalidMeasurementWarning,
  makeAiDraftUnavailableWarning,
  makeAiContextRestrictedWarning,
  makeLargeTreeTruncatedWarning,
  makeCacheDegradedWarning,
  mergeOkrWarnings,
  // Rollup
  computeOkrRollup,
  // Alignment
  validateAlignment,
  // Hash / Freshness
  okrStableHash,
  makeOkrFreshness,
  mergeOkrFreshness,
  // Fixture Builders
  makeOkrCycle,
  makeOkrObjective,
  makeOkrKeyResult,
  makeOkrAlignment,
  makeOkrEvidenceLink,
  makeOkrProgressHistory,
  makeOkrAiDraftResponse,
  makeEmptyOrganizationOkrFixture,
  makeNormalOkrFixture,
  makeRestrictedEvidenceOkrFixture,
  makeLargeTreeOkrFixture,
  makeAiDraftPreviewOkrFixture,
  makeLocalFallbackOkrFixture,
} from './okr.js'

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeObjective(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    organizationId: 1,
    cycleId: null,
    projectId: null,
    teamId: null,
    ownerId: null,
    scope: 'organization',
    title: '测试目标',
    description: null,
    status: 'active',
    weight: 1,
    progress: 0,
    confidence: 'medium',
    startDate: null,
    endDate: null,
    metricVersion: OKR_METRIC_VERSION,
    calculatedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...overrides,
  } as const
}

function makeKeyResult(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    organizationId: 1,
    objectiveId: 1,
    title: '测试关键结果',
    description: null,
    measurementType: 'percent',
    unitLabel: '%',
    baselineValue: 0,
    targetValue: 100,
    currentValue: 50,
    confidence: 'medium',
    status: 'active',
    weight: 100,
    lastUpdatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...overrides,
  } as any
}

function makeAlignment(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    organizationId: 1,
    childObjectiveId: 1,
    parentObjectiveId: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...overrides,
  } as any
}

// ─── Enums Stability ──────────────────────────────────────────────────────────

describe('OKR 枚举稳定性', () => {
  it('OKR_MEASUREMENT_TYPES 包含全部 5 种度量类型', () => {
    expect(OKR_MEASUREMENT_TYPE_VALUES).toHaveLength(5)
    expect(OKR_MEASUREMENT_TYPE_VALUES).toContain('number')
    expect(OKR_MEASUREMENT_TYPE_VALUES).toContain('percent')
    expect(OKR_MEASUREMENT_TYPE_VALUES).toContain('currency_like')
    expect(OKR_MEASUREMENT_TYPE_VALUES).toContain('milestone')
    expect(OKR_MEASUREMENT_TYPE_VALUES).toContain('binary')
  })

  it('OKR_SCOPES 包含全部 4 种 scope', () => {
    expect(OKR_SCOPE_VALUES).toHaveLength(4)
    expect(OKR_SCOPE_VALUES).toContain('organization')
    expect(OKR_SCOPE_VALUES).toContain('team')
    expect(OKR_SCOPE_VALUES).toContain('project')
    expect(OKR_SCOPE_VALUES).toContain('individual')
  })

  it('individual scope 默认禁用写入', () => {
    expect(OKR_DISABLED_SCOPES).toContain('individual')
  })

  it('OKR_STATUSES 包含全部 5 种状态', () => {
    expect(OKR_STATUS_VALUES).toHaveLength(5)
    expect(OKR_STATUS_VALUES).toContain('draft')
    expect(OKR_STATUS_VALUES).toContain('active')
    expect(OKR_STATUS_VALUES).toContain('paused')
    expect(OKR_STATUS_VALUES).toContain('completed')
    expect(OKR_STATUS_VALUES).toContain('archived')
  })

  it('OKR_ACTIVE_STATUSES 不包含已完成或已归档', () => {
    expect(OKR_ACTIVE_STATUSES).not.toContain('completed')
    expect(OKR_ACTIVE_STATUSES).not.toContain('archived')
  })

  it('OKR_CLOSED_STATUSES 只包含 completed 和 archived', () => {
    expect(OKR_CLOSED_STATUSES).toEqual(['completed', 'archived'])
  })

  it('OKR_CONFIDENCE_LEVELS 包含 3 个级别', () => {
    expect(OKR_CONFIDENCE_LEVEL_VALUES).toEqual(['low', 'medium', 'high'])
  })

  it('OKR_ALIGNMENT_CONSTRAINTS 具有合理值', () => {
    expect(OKR_ALIGNMENT_CONSTRAINTS.MAX_DEPTH).toBe(5)
    expect(OKR_ALIGNMENT_CONSTRAINTS.MAX_CHILDREN_PER_OBJECTIVE).toBe(100)
    expect(OKR_ALIGNMENT_CONSTRAINTS.MAX_PARENTS_PER_OBJECTIVE).toBe(1)
  })
})

// ─── Measurement Bounds ────────────────────────────────────────────────────────

describe('OKR measurement bounds', () => {
  it('percent 类型只接受 0-100', () => {
    expect(validateMeasurementBounds('percent', 50)).toEqual({ valid: true })
    expect(validateMeasurementBounds('percent', 0)).toEqual({ valid: true })
    expect(validateMeasurementBounds('percent', 100)).toEqual({ valid: true })
    expect(validateMeasurementBounds('percent', -1).valid).toBe(false)
    expect(validateMeasurementBounds('percent', 101).valid).toBe(false)
  })

  it('binary 类型只接受 0-1', () => {
    expect(validateMeasurementBounds('binary', 0)).toEqual({ valid: true })
    expect(validateMeasurementBounds('binary', 1)).toEqual({ valid: true })
    expect(validateMeasurementBounds('binary', 2).valid).toBe(false)
  })

  it('milestone 类型只接受 0-1', () => {
    expect(validateMeasurementBounds('milestone', 0)).toEqual({ valid: true })
    expect(validateMeasurementBounds('milestone', 1)).toEqual({ valid: true })
    expect(validateMeasurementBounds('milestone', -1).valid).toBe(false)
  })

  it('number 和 currency_like 接受非负数', () => {
    expect(validateMeasurementBounds('number', 0)).toEqual({ valid: true })
    expect(validateMeasurementBounds('number', 9999)).toEqual({ valid: true })
    expect(validateMeasurementBounds('currency_like', 0)).toEqual({ valid: true })
    expect(validateMeasurementBounds('number', -1).valid).toBe(false)
  })
})

// ─── Type Guards ───────────────────────────────────────────────────────────────

describe('OKR 类型守卫', () => {
  it('isOkrMeasurementType 正确识别', () => {
    expect(isOkrMeasurementType('number')).toBe(true)
    expect(isOkrMeasurementType('percent')).toBe(true)
    expect(isOkrMeasurementType('invalid')).toBe(false)
    expect(isOkrMeasurementType(123)).toBe(false)
    expect(isOkrMeasurementType(null)).toBe(false)
    expect(isOkrMeasurementType(undefined)).toBe(false)
  })

  it('isOkrScope 正确识别', () => {
    expect(isOkrScope('organization')).toBe(true)
    expect(isOkrScope('team')).toBe(true)
    expect(isOkrScope('project')).toBe(true)
    expect(isOkrScope('individual')).toBe(true)
    expect(isOkrScope('invalid')).toBe(false)
  })

  it('isOkrStatus 正确识别', () => {
    expect(isOkrStatus('active')).toBe(true)
    expect(isOkrStatus('draft')).toBe(true)
    expect(isOkrStatus('completed')).toBe(true)
    expect(isOkrStatus('deleted')).toBe(false)
  })

  it('isOkrConfidenceLevel 正确识别', () => {
    expect(isOkrConfidenceLevel('high')).toBe(true)
    expect(isOkrConfidenceLevel('medium')).toBe(true)
    expect(isOkrConfidenceLevel('low')).toBe(true)
    expect(isOkrConfidenceLevel('critical')).toBe(false)
  })

  it('isOkrWarningCode 正确识别', () => {
    expect(isOkrWarningCode('EMPTY_OKR_RESULT')).toBe(true)
    expect(isOkrWarningCode('CYCLE_DETECTED')).toBe(true)
    expect(isOkrWarningCode('UNKNOWN')).toBe(false)
  })

  it('isOkrEvidenceSourceKind 正确识别', () => {
    expect(isOkrEvidenceSourceKind('project')).toBe(true)
    expect(isOkrEvidenceSourceKind('task')).toBe(true)
    expect(isOkrEvidenceSourceKind('pmo')).toBe(true)
    expect(isOkrEvidenceSourceKind('invalid')).toBe(false)
  })

  it('isOkrSortField 正确识别', () => {
    expect(isOkrSortField('createdAt')).toBe(true)
    expect(isOkrSortField('progress')).toBe(true)
    expect(isOkrSortField('invalid')).toBe(false)
  })

  it('isOkrIncludeOption 正确识别', () => {
    expect(isOkrIncludeOption('children')).toBe(true)
    expect(isOkrIncludeOption('keyResults')).toBe(true)
    expect(isOkrIncludeOption('invalid')).toBe(false)
  })

  it('isOkrEvidenceTargetKind 正确识别 source kinds 和 objective/key_result', () => {
    expect(isOkrEvidenceTargetKind('project')).toBe(true)
    expect(isOkrEvidenceTargetKind('objective')).toBe(true)
    expect(isOkrEvidenceTargetKind('key_result')).toBe(true)
    expect(isOkrEvidenceTargetKind('invalid')).toBe(false)
  })
})

// ─── Validation Helpers ────────────────────────────────────────────────────────

describe('OKR 验证助手', () => {
  it('validateWeight 接受 0-100', () => {
    expect(validateWeight(50)).toEqual({ valid: true })
    expect(validateWeight(0)).toEqual({ valid: true })
    expect(validateWeight(100)).toEqual({ valid: true })
    expect(validateWeight(-1).valid).toBe(false)
    expect(validateWeight(101).valid).toBe(false)
    expect(validateWeight(NaN).valid).toBe(false)
  })

  it('validateScope 拒绝 disabled scopes', () => {
    expect(validateScope('organization')).toEqual({ valid: true })
    expect(validateScope('individual').valid).toBe(false)
  })

  it('validateCycleDateWindow 检查日期合法性', () => {
    expect(validateCycleDateWindow('2026-01-01', '2026-12-31')).toEqual({ valid: true })
    expect(validateCycleDateWindow('2026-12-31', '2026-01-01').valid).toBe(false)
    expect(validateCycleDateWindow('invalid', '2026-12-31').valid).toBe(false)
  })
})

// ─── Warning Helpers ───────────────────────────────────────────────────────────

describe('OKR warning helpers', () => {
  it('makeEmptyOkrWarning 返回正确 code', () => {
    expect(makeEmptyOkrWarning().code).toBe('EMPTY_OKR_RESULT')
  })

  it('makeEmptyKeyResultsWarning 返回正确 code', () => {
    expect(makeEmptyKeyResultsWarning().code).toBe('EMPTY_KEY_RESULTS')
  })

  it('makeRestrictedChildWarning 包含数量', () => {
    const w = makeRestrictedChildWarning(5)
    expect(w.code).toBe('RESTRICTED_CHILD')
    expect(w.details?.restrictedCount).toBe(5)
  })

  it('mergeOkrWarnings 去重 code', () => {
    const merged = mergeOkrWarnings([
      [{ code: 'EMPTY_OKR_RESULT', message: 'a' }],
      [{ code: 'EMPTY_OKR_RESULT', message: 'b' }],
      [{ code: 'CYCLE_DETECTED', message: 'c' }],
    ])
    expect(merged).toHaveLength(2)
    expect(merged.map((w) => w.code)).toContain('EMPTY_OKR_RESULT')
    expect(merged.map((w) => w.code)).toContain('CYCLE_DETECTED')
  })
})

// ─── Progress Rollup ───────────────────────────────────────────────────────────

describe('OKR progress rollup', () => {
  it('空目标返回 EMPTY_KEY_RESULTS warning', () => {
    const result = computeOkrRollup([], [])
    expect(result.progress).toBe(0)
    expect(result.confidence).toBe('low')
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].code).toBe('EMPTY_KEY_RESULTS')
  })

  it('单个 KR 按权重计算进度', () => {
    const kr = makeKeyResult({ currentValue: 50, targetValue: 100, baselineValue: 0, weight: 100 })
    const result = computeOkrRollup([kr], [])
    expect(result.progress).toBe(50)
    expect(result.sourceCount).toBe(1)
  })

  it('多个 KR 按权重汇总', () => {
    const kr1 = makeKeyResult({
      id: 1,
      currentValue: 100,
      targetValue: 100,
      baselineValue: 0,
      weight: 50,
    })
    const kr2 = makeKeyResult({
      id: 2,
      currentValue: 0,
      targetValue: 100,
      baselineValue: 0,
      weight: 50,
    })
    const result = computeOkrRollup([kr1, kr2], [])
    expect(result.progress).toBe(50)
  })

  it('受限 KR（软删除）不计入汇总', () => {
    const kr1 = makeKeyResult({
      id: 1,
      currentValue: 100,
      targetValue: 100,
      baselineValue: 0,
      weight: 100,
    })
    const kr2 = makeKeyResult({
      id: 2,
      currentValue: 0,
      targetValue: 100,
      baselineValue: 0,
      weight: 100,
      deletedAt: new Date().toISOString(),
    })
    const result = computeOkrRollup([kr1, kr2], [])
    expect(result.progress).toBe(100)
  })

  it('已归档 KR 不计入汇总', () => {
    const kr1 = makeKeyResult({
      id: 1,
      currentValue: 100,
      targetValue: 100,
      baselineValue: 0,
      weight: 100,
    })
    const kr2 = makeKeyResult({
      id: 2,
      currentValue: 0,
      targetValue: 100,
      baselineValue: 0,
      weight: 100,
      status: 'archived',
    })
    const result = computeOkrRollup([kr1, kr2], [])
    expect(result.progress).toBe(100)
  })

  it('非法权重不影响其他 KR 计算', () => {
    const kr1 = makeKeyResult({
      id: 1,
      currentValue: 100,
      targetValue: 100,
      baselineValue: 0,
      weight: -1,
    })
    const result = computeOkrRollup([kr1], [])
    expect(result.progress).toBe(0) // negative weight yields 0 progress contribution but totalWeight is -1 so progress=0
  })

  it('混合 measurement 类型的 KR 正常汇总', () => {
    const kr1 = makeKeyResult({
      id: 1,
      measurementType: 'percent',
      currentValue: 80,
      targetValue: 100,
      baselineValue: 0,
      weight: 50,
    })
    const kr2 = makeKeyResult({
      id: 2,
      measurementType: 'number',
      currentValue: 5,
      targetValue: 10,
      baselineValue: 0,
      weight: 50,
    })
    const result = computeOkrRollup([kr1, kr2], [])
    expect(result.progress).toBe(65) // (80*50 + 50*50) / 100 = 65
  })

  it('子目标 rollup 正常计入', () => {
    const kr = makeKeyResult({ currentValue: 50, targetValue: 100, baselineValue: 0, weight: 50 })
    const childRollup = {
      progress: 100,
      confidence: 'high' as const,
      metricVersion: '1.0.0',
      calculatedAt: new Date().toISOString(),
      sourceCount: 1,
      restrictedCount: 0,
      warnings: [],
    }
    const result = computeOkrRollup([kr], [childRollup])
    // (50*50 + 100) / (50 + 1) = 2600 / 51 ≈ 51
    expect(result.progress).toBe(51)
  })
})

// ─── Alignment Validation ──────────────────────────────────────────────────────

describe('OKR alignment validation', () => {
  const org1 = { id: 1, organizationId: 1 }
  const org2 = { id: 2, organizationId: 2 }

  it('拒绝自父级对齐', () => {
    const obj = makeObjective({ id: 1, organizationId: 1 })
    const result = validateAlignment(obj as any, obj as any, [], [])
    expect(result.valid).toBe(false)
    expect(result.warning?.code).toBe('CYCLE_DETECTED')
  })

  it('检测循环', () => {
    const child = makeObjective({ id: 1, organizationId: 1 })
    const parent = makeObjective({ id: 2, organizationId: 1 })
    // child 的祖先中包含 child 自身 → 循环
    const result = validateAlignment(child as any, parent as any, [], [1])
    expect(result.valid).toBe(false)
    expect(result.warning?.code).toBe('CYCLE_DETECTED')
  })

  it('拒绝超过最大深度', () => {
    const child = makeObjective({ id: 10, organizationId: 1 })
    const parent = makeObjective({ id: 2, organizationId: 1 })
    const ancestors = [1, 2, 3, 4, 5] // 5 层已到 MAX_DEPTH
    const result = validateAlignment(child as any, parent as any, [], ancestors)
    expect(result.valid).toBe(false)
    expect(result.warning?.code).toBe('MAX_DEPTH_EXCEEDED')
  })

  it('拒绝跨组织父级', () => {
    const child = makeObjective({ id: 1, organizationId: 1 })
    const parent = makeObjective({ id: 2, organizationId: 2 })
    const result = validateAlignment(child as any, parent as any, [], [])
    expect(result.valid).toBe(false)
    expect(result.warning?.code).toBe('CROSS_ORGANIZATION')
  })

  it('拒绝重复活跃父级', () => {
    const child = makeObjective({ id: 1, organizationId: 1 })
    const parent = makeObjective({ id: 3, organizationId: 1 })
    const existing = [makeAlignment({ childObjectiveId: 1, parentObjectiveId: 2, deletedAt: null })]
    const result = validateAlignment(child as any, parent as any, existing as any, [])
    expect(result.valid).toBe(false)
    expect(result.warning?.code).toBe('DUPLICATE_ALIGNMENT')
  })

  it('接受合法 project/team/org 对齐', () => {
    const child = makeObjective({ id: 1, organizationId: 1, scope: 'project' })
    const parent = makeObjective({ id: 2, organizationId: 1, scope: 'organization' })
    const result = validateAlignment(child as any, parent as any, [], [])
    expect(result.valid).toBe(true)
  })

  it('允许同一组织内 team → organization 对齐', () => {
    const child = makeObjective({ id: 3, organizationId: 1, scope: 'team' })
    const parent = makeObjective({ id: 1, organizationId: 1, scope: 'organization' })
    const result = validateAlignment(child as any, parent as any, [], [1])
    expect(result.valid).toBe(true)
  })
})

// ─── Hash / Freshness ──────────────────────────────────────────────────────────

describe('OKR hash and freshness', () => {
  it('okrStableHash 输出 8 位十六进制', () => {
    const hash = okrStableHash('test')
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('okrStableHash 对相同输入产生相同输出', () => {
    expect(okrStableHash('same')).toBe(okrStableHash('same'))
  })

  it('makeOkrFreshness 检测过期', () => {
    const recent = makeOkrFreshness(new Date().toISOString())
    expect(recent.stale).toBe(false)

    const old = makeOkrFreshness(new Date(0).toISOString())
    expect(old.stale).toBe(true)
  })

  it('mergeOkrFreshness 返回最新的', () => {
    const now = new Date().toISOString()
    const past = new Date(0).toISOString()
    const merged = mergeOkrFreshness([makeOkrFreshness(past), makeOkrFreshness(now)])
    expect(merged.lastUpdatedAt).toBe(now)
  })
})

// ─── Fixture Builders ─────────────────────────────────────────────────────────

describe('OKR fixture builders', () => {
  it('makeOkrCycle 返回默认活跃周期', () => {
    const cycle = makeOkrCycle()
    expect(cycle.status).toBe('active')
    expect(cycle.title).toBe('2026 Q3')
    expect(cycle.organizationId).toBe(1)
  })

  it('makeOkrCycle 支持 override', () => {
    const cycle = makeOkrCycle({ id: 99, title: '自定义', status: 'draft' })
    expect(cycle.id).toBe(99)
    expect(cycle.title).toBe('自定义')
    expect(cycle.status).toBe('draft')
  })

  it('makeOkrObjective 返回默认组织级目标', () => {
    const obj = makeOkrObjective()
    expect(obj.scope).toBe('organization')
    expect(obj.status).toBe('active')
    expect(obj.metricVersion).toBe(OKR_METRIC_VERSION)
  })

  it('makeOkrKeyResult 返回默认 percent KR', () => {
    const kr = makeOkrKeyResult()
    expect(kr.measurementType).toBe('percent')
    expect(kr.currentValue).toBe(50)
    expect(kr.targetValue).toBe(100)
  })

  it('makeOkrAlignment 返回默认对齐', () => {
    const a = makeOkrAlignment()
    expect(a.childObjectiveId).toBe(1)
    expect(a.parentObjectiveId).toBe(2)
  })

  it('makeOkrEvidenceLink 返回默认证据链接', () => {
    const e = makeOkrEvidenceLink()
    expect(e.targetType).toBe('objective')
    expect(e.sourceKind).toBe('project')
    expect(e.hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('makeOkrProgressHistory 包含前一天与当天值', () => {
    const ph = makeOkrProgressHistory()
    expect(ph.previousValue).toBe(30)
    expect(ph.newValue).toBe(50)
    expect(ph.source).toBe('manual')
  })

  it('makeOkrAiDraftResponse 返回 mock AI 草案', () => {
    const draft = makeOkrAiDraftResponse()
    expect(draft.objectives).toHaveLength(1)
    expect(draft.objectives[0].keyResults).toHaveLength(1)
    expect(draft.assumptions.length).toBeGreaterThan(0)
  })

  it('makeEmptyOrganizationOkrFixture 只包含一个周期', () => {
    const fixture = makeEmptyOrganizationOkrFixture()
    expect(fixture.cycles).toHaveLength(1)
    expect(fixture.objectives).toHaveLength(0)
    expect(fixture.keyResults).toHaveLength(0)
  })

  it('makeNormalOkrFixture 包含三层级结构', () => {
    const fixture = makeNormalOkrFixture()
    expect(fixture.cycles).toHaveLength(1)
    expect(fixture.objectives).toHaveLength(3)
    expect(fixture.keyResults).toHaveLength(3)
    expect(fixture.alignments).toHaveLength(2)
    expect(fixture.evidenceLinks).toHaveLength(1)
  })

  it('makeRestrictedEvidenceOkrFixture 包含受限证据', () => {
    const fixture = makeRestrictedEvidenceOkrFixture()
    expect(fixture.evidenceLinks).toHaveLength(2)
    const restricted = fixture.evidenceLinks.find((e) => e.summary.includes('受限'))
    expect(restricted).toBeDefined()
    expect(restricted!.hash).toBe('[redacted]')
  })

  it('makeLargeTreeOkrFixture 按需生成指定数量节点', () => {
    const size = 100
    const fixture = makeLargeTreeOkrFixture(1, size)
    expect(fixture.objectives).toHaveLength(size)
    expect(fixture.keyResults).toHaveLength(size)
    expect(fixture.alignments).toHaveLength(size - 1)
  })

  it('makeLargeTreeOkrFixture 默认 1000 节点', () => {
    const fixture = makeLargeTreeOkrFixture()
    expect(fixture.objectives).toHaveLength(1000)
  })

  it('makeAiDraftPreviewOkrFixture 包含 AI 建议和风险', () => {
    const fixture = makeAiDraftPreviewOkrFixture()
    expect(fixture.draft.objectives).toHaveLength(1)
    expect(fixture.draft.risks.length).toBeGreaterThan(0)
    expect(fixture.draft.objectives[0].alignment).toBeDefined()
  })

  it('makeLocalFallbackOkrFixture 标记缓存降级', () => {
    const fixture = makeLocalFallbackOkrFixture()
    expect(fixture.warnings).toHaveLength(1)
    expect(fixture.warnings[0].code).toBe('CACHE_DEGRADED')
    expect(fixture.cycles[0].title).toContain('缓存')
  })
})

// ─── Cascade / Alignment Enums Stability ─────────────────────────────────────

import {
  OKR_CASCADE_PLAN_STATUSES,
  OKR_CASCADE_PLAN_STATUS_VALUES,
  OKR_CASCADE_ITEM_STATUS_VALUES,
  OKR_RELATION_TYPES,
  OKR_RELATION_TYPE_VALUES,
  OKR_RELATION_STATUS_VALUES,
  OKR_HEALTH_LEVELS,
  OKR_HEALTH_LEVEL_VALUES,
  OKR_HEALTH_SCORE_BANDS,
  isOkrCascadePlanStatus,
  isOkrRelationType,
  isOkrRelationStatus,
  isOkrHealthLevel,
  validateRelation,
  validateRelationType,
  makeDuplicateRelationKey,
  normalizeCascadeConfirmationDiff,
  computeOkrAlignmentHealth,
  makeNoParentAlignmentWarning,
  makeNoChildCoverageWarning,
  makeConflictActiveWarning,
  makeHealthUnavailableWarning,
  makeRestrictedTargetWarning,
  makeIncompatibleCycleWarning,
  makeUnsupportedRelationWarning,
  makeCascadeDiffStaleWarning,
  makeOkrCascadePlan,
  makeOkrCascadePlanItem,
  makeOkrObjectiveRelation,
  makeOkrAlignmentHealth,
  makeOkrAlignmentMatrixRow,
  makeOkrCascadeConfirmationDiff,
  makeOkrAiCascadeSuggestionResponse,
  makeValidCascadePlanFixture,
  makeInvalidScopeCascadeFixture,
  makeRelationMatrixFixture,
  makeRestrictedRelationFixture,
  makeStaleHealthFixture,
  makeAiAlignmentSuggestionFixture,
} from './okr.js'

describe('OKR 级联/对齐枚举稳定性', () => {
  it('OKR_CASCADE_PLAN_STATUSES 包含 4 种状态', () => {
    expect(OKR_CASCADE_PLAN_STATUS_VALUES).toHaveLength(4)
    expect(OKR_CASCADE_PLAN_STATUS_VALUES).toContain('draft')
    expect(OKR_CASCADE_PLAN_STATUS_VALUES).toContain('confirmed')
    expect(OKR_CASCADE_PLAN_STATUS_VALUES).toContain('rejected')
    expect(OKR_CASCADE_PLAN_STATUS_VALUES).toContain('archived')
  })

  it('OKR_RELATION_TYPES 包含 5 种关系类型', () => {
    expect(OKR_RELATION_TYPE_VALUES).toHaveLength(5)
    expect(OKR_RELATION_TYPE_VALUES).toContain('depends_on')
    expect(OKR_RELATION_TYPE_VALUES).toContain('contributes_to')
    expect(OKR_RELATION_TYPE_VALUES).toContain('supports')
    expect(OKR_RELATION_TYPE_VALUES).toContain('conflicts_with')
    expect(OKR_RELATION_TYPE_VALUES).toContain('duplicates')
  })

  it('OKR_HEALTH_LEVELS 包含 4 种健康度级别', () => {
    expect(OKR_HEALTH_LEVEL_VALUES).toHaveLength(4)
    expect(OKR_HEALTH_LEVEL_VALUES).toContain('healthy')
    expect(OKR_HEALTH_LEVEL_VALUES).toContain('needs_attention')
    expect(OKR_HEALTH_LEVEL_VALUES).toContain('at_risk')
    expect(OKR_HEALTH_LEVEL_VALUES).toContain('unavailable')
  })

  it('OKR_HEALTH_SCORE_BANDS 互不重叠', () => {
    expect(OKR_HEALTH_SCORE_BANDS.healthy.min).toBe(70)
    expect(OKR_HEALTH_SCORE_BANDS.needs_attention.min).toBe(40)
    expect(OKR_HEALTH_SCORE_BANDS.at_risk.min).toBe(0)
  })
})

// ─── Cascade / Alignment Type Guards ─────────────────────────────────────────

describe('OKR 级联/对齐类型守卫', () => {
  it('isOkrCascadePlanStatus 正确识别', () => {
    expect(isOkrCascadePlanStatus('draft')).toBe(true)
    expect(isOkrCascadePlanStatus('confirmed')).toBe(true)
    expect(isOkrCascadePlanStatus('invalid')).toBe(false)
  })

  it('isOkrRelationType 正确识别', () => {
    expect(isOkrRelationType('supports')).toBe(true)
    expect(isOkrRelationType('depends_on')).toBe(true)
    expect(isOkrRelationType('invalid')).toBe(false)
  })

  it('isOkrRelationStatus 正确识别', () => {
    expect(isOkrRelationStatus('active')).toBe(true)
    expect(isOkrRelationStatus('resolved')).toBe(true)
    expect(isOkrRelationStatus('archived')).toBe(true)
    expect(isOkrRelationStatus('invalid')).toBe(false)
  })

  it('isOkrHealthLevel 正确识别', () => {
    expect(isOkrHealthLevel('healthy')).toBe(true)
    expect(isOkrHealthLevel('at_risk')).toBe(true)
    expect(isOkrHealthLevel('unavailable')).toBe(true)
    expect(isOkrHealthLevel('invalid')).toBe(false)
  })
})

// ─── Relation Validation ──────────────────────────────────────────────────────

describe('OKR 横向关系验证', () => {
  const makeObj = (overrides: Record<string, unknown> = {}) => makeObjective(overrides) as any

  it('拒绝自关联关系', () => {
    const obj = makeObj({ id: 1, organizationId: 1 })
    const result = validateRelation(obj, obj, 'supports', [])
    expect(result.valid).toBe(false)
    expect(result.warning?.code).toBe('CYCLE_DETECTED')
  })

  it('拒绝跨组织关系', () => {
    const source = makeObj({ id: 1, organizationId: 1 })
    const target = makeObj({ id: 2, organizationId: 2 })
    const result = validateRelation(source, target, 'supports', [])
    expect(result.valid).toBe(false)
    expect(result.warning?.code).toBe('CROSS_ORGANIZATION')
  })

  it('拒绝不同周期关系', () => {
    const source = makeObj({ id: 1, organizationId: 1, cycleId: 1 })
    const target = makeObj({ id: 2, organizationId: 1, cycleId: 2 })
    const result = validateRelation(source, target, 'supports', [])
    expect(result.valid).toBe(false)
    expect(result.warning?.code).toBe('INVALID_MEASUREMENT')
  })

  it('拒绝重复活跃关系', () => {
    const source = makeObj({ id: 1, organizationId: 1 })
    const target = makeObj({ id: 2, organizationId: 1 })
    const existing = [
      { sourceObjectiveId: 1, targetObjectiveId: 2, relationType: 'supports', deletedAt: null },
    ] as any
    const result = validateRelation(source, target, 'supports', existing)
    expect(result.valid).toBe(false)
    expect(result.warning?.code).toBe('DUPLICATE_ALIGNMENT')
  })

  it('接受合法关系', () => {
    const source = makeObj({ id: 1, organizationId: 1, cycleId: 1 })
    const target = makeObj({ id: 2, organizationId: 1, cycleId: 1 })
    const result = validateRelation(source, target, 'supports', [])
    expect(result.valid).toBe(true)
  })

  it('validateRelationType 拒绝无效类型', () => {
    expect(validateRelationType('supports').valid).toBe(true)
    expect(validateRelationType('invalid').valid).toBe(false)
  })

  it('makeDuplicateRelationKey 生成唯一 key', () => {
    const key1 = makeDuplicateRelationKey(1, 2, 'supports')
    const key2 = makeDuplicateRelationKey(1, 2, 'depends_on')
    expect(key1).not.toBe(key2)
    expect(key1).toBe('rel:1:2:supports')
  })
})

// ─── Cascade Diff Normalization ────────────────────────────────────────────────

describe('OKR 级联差异归一化', () => {
  it('过滤空 after 的 diff', () => {
    const diffs = [
      makeOkrCascadeConfirmationDiff({ itemId: 1, kind: 'objective', after: {} }),
      makeOkrCascadeConfirmationDiff({ itemId: 2, kind: 'key_result', after: { title: '新KR' } }),
    ]
    const normalized = normalizeCascadeConfirmationDiff(diffs)
    expect(normalized).toHaveLength(1)
    expect(normalized[0].itemId).toBe(2)
  })

  it('按 kind 和 itemId 排序', () => {
    const diffs = [
      makeOkrCascadeConfirmationDiff({ itemId: 3, kind: 'key_result', after: { title: 'KR' } }),
      makeOkrCascadeConfirmationDiff({ itemId: 1, kind: 'objective', after: { title: 'Obj' } }),
      makeOkrCascadeConfirmationDiff({ itemId: 2, kind: 'key_result', after: { title: 'KR2' } }),
    ]
    const normalized = normalizeCascadeConfirmationDiff(diffs)
    expect(normalized[0].kind).toBe('key_result')
    expect(normalized[0].itemId).toBe(2)
    expect(normalized[1].itemId).toBe(3)
    expect(normalized[2].kind).toBe('objective')
  })
})

// ─── Alignment Health Calculation ──────────────────────────────────────────────

describe('OKR 对齐健康度计算', () => {
  const makeObj = (overrides: Record<string, unknown> = {}) => makeObjective(overrides) as any

  it('健康目标得高分', () => {
    const objective = makeObj({ id: 1, scope: 'team' })
    const kr = makeKeyResult({
      id: 1,
      weight: 100,
      currentValue: 80,
      targetValue: 100,
      baselineValue: 0,
    })
    const parentAlignment = makeAlignment({ childObjectiveId: 1, parentObjectiveId: 2 })
    const freshness = makeOkrFreshness(new Date().toISOString())

    const result = computeOkrAlignmentHealth({
      objective,
      parentAlignment: parentAlignment as any,
      childAlignments: [makeAlignment({ id: 2 }) as any],
      crossRelations: [],
      keyResults: [kr as any],
      evidenceFreshness: freshness,
      restrictedVisibilityCount: 0,
    })

    expect(result.score).toBeGreaterThanOrEqual(80)
    expect(result.level).toBe('healthy')
    expect(result.warnings).toHaveLength(0)
  })

  it('缺少 KR 的目标降分', () => {
    const objective = makeObj({ id: 1, scope: 'team' })
    const parentAlignment = makeAlignment({ childObjectiveId: 1, parentObjectiveId: 2 })
    const freshness = makeOkrFreshness(new Date().toISOString())

    const result = computeOkrAlignmentHealth({
      objective,
      parentAlignment: parentAlignment as any,
      childAlignments: [],
      crossRelations: [],
      keyResults: [],
      evidenceFreshness: freshness,
      restrictedVisibilityCount: 0,
    })

    expect(result.score).toBeLessThan(80)
    expect(result.warnings.some((w) => w.code === 'EMPTY_KEY_RESULTS')).toBe(true)
  })

  it('KR 权重不完整降分', () => {
    const objective = makeObj({ id: 1, scope: 'team' })
    const kr = makeKeyResult({ id: 1, weight: 50 })
    const parentAlignment = makeAlignment({ childObjectiveId: 1, parentObjectiveId: 2 })
    const freshness = makeOkrFreshness(new Date().toISOString())

    const result = computeOkrAlignmentHealth({
      objective,
      parentAlignment: parentAlignment as any,
      childAlignments: [],
      crossRelations: [],
      keyResults: [kr as any],
      evidenceFreshness: freshness,
      restrictedVisibilityCount: 0,
    })

    expect(result.warnings.some((w) => w.code === 'INVALID_WEIGHT')).toBe(true)
  })

  it('缺少父级对齐的非组织目标降分', () => {
    const objective = makeObj({ id: 1, scope: 'team' })
    const kr = makeKeyResult({ id: 1, weight: 100 })

    const result = computeOkrAlignmentHealth({
      objective,
      parentAlignment: null,
      childAlignments: [],
      crossRelations: [],
      keyResults: [kr as any],
      evidenceFreshness: null,
      restrictedVisibilityCount: 0,
    })

    expect(result.warnings.some((w) => w.code === 'EMPTY_OKR_RESULT')).toBe(true)
  })

  it('组织级目标不需要父级对齐', () => {
    const objective = makeObj({ id: 1, scope: 'organization' })
    const kr = makeKeyResult({ id: 1, weight: 100 })

    const result = computeOkrAlignmentHealth({
      objective,
      parentAlignment: null,
      childAlignments: [],
      crossRelations: [],
      keyResults: [kr as any],
      evidenceFreshness: null,
      restrictedVisibilityCount: 0,
    })

    // 组织级目标不因无父级对齐而降分
    expect(result.warnings.some((w) => w.code === 'EMPTY_OKR_RESULT')).toBe(false)
  })

  it('活跃冲突关系降分', () => {
    const objective = makeObj({ id: 1, scope: 'team' })
    const kr = makeKeyResult({ id: 1, weight: 100 })
    const parentAlignment = makeAlignment({ childObjectiveId: 1, parentObjectiveId: 2 })
    const conflictRelation = makeOkrObjectiveRelation({
      relationType: 'conflicts_with',
      status: 'active',
      deletedAt: null,
    })

    const result = computeOkrAlignmentHealth({
      objective,
      parentAlignment: parentAlignment as any,
      childAlignments: [],
      crossRelations: [conflictRelation],
      keyResults: [kr as any],
      evidenceFreshness: null,
      restrictedVisibilityCount: 0,
    })

    expect(result.score).toBeLessThan(85)
  })

  it('陈旧证据降分', () => {
    const objective = makeObj({ id: 1, scope: 'team' })
    const kr = makeKeyResult({ id: 1, weight: 100 })
    const parentAlignment = makeAlignment({ childObjectiveId: 1, parentObjectiveId: 2 })
    const staleFreshness = makeOkrFreshness(new Date(0).toISOString())

    const result = computeOkrAlignmentHealth({
      objective,
      parentAlignment: parentAlignment as any,
      childAlignments: [],
      crossRelations: [],
      keyResults: [kr as any],
      evidenceFreshness: staleFreshness,
      restrictedVisibilityCount: 0,
    })

    expect(result.warnings.some((w) => w.code === 'STALE_EVIDENCE')).toBe(true)
  })

  it('受限可见性降分并标记', () => {
    const objective = makeObj({ id: 1, scope: 'team' })
    const kr = makeKeyResult({ id: 1, weight: 100 })
    const parentAlignment = makeAlignment({ childObjectiveId: 1, parentObjectiveId: 2 })

    const result = computeOkrAlignmentHealth({
      objective,
      parentAlignment: parentAlignment as any,
      childAlignments: [],
      crossRelations: [],
      keyResults: [kr as any],
      evidenceFreshness: null,
      restrictedVisibilityCount: 3,
    })

    expect(result.redactedCount).toBe(3)
    expect(result.warnings.some((w) => w.code === 'RESTRICTED_CHILD')).toBe(true)
  })

  it('暂停状态降分', () => {
    const objective = makeObj({ id: 1, scope: 'team', status: 'paused' })
    const kr = makeKeyResult({ id: 1, weight: 100 })
    const parentAlignment = makeAlignment({ childObjectiveId: 1, parentObjectiveId: 2 })

    const result = computeOkrAlignmentHealth({
      objective,
      parentAlignment: parentAlignment as any,
      childAlignments: [],
      crossRelations: [],
      keyResults: [kr as any],
      evidenceFreshness: null,
      restrictedVisibilityCount: 0,
    })

    expect(result.score).toBeLessThanOrEqual(85)
    expect(result.warnings.some((w) => w.code === 'INVALID_MEASUREMENT')).toBe(true)
  })
})

// ─── Warning Helpers (Cascade/Alignment) ──────────────────────────────────────

describe('OKR 级联/对齐 warning helpers', () => {
  it('makeNoParentAlignmentWarning 返回正确 code', () => {
    const w = makeNoParentAlignmentWarning()
    expect(w.code).toBe('NO_PARENT_ALIGNMENT' as any)
    expect(w.message).toContain('父级对齐')
  })

  it('makeNoChildCoverageWarning 返回正确 code', () => {
    const w = makeNoChildCoverageWarning()
    expect(w.code).toBe('NO_CHILD_COVERAGE' as any)
    expect(w.message).toContain('下级拆解')
  })

  it('makeConflictActiveWarning 包含数量', () => {
    const w = makeConflictActiveWarning(3)
    expect(w.message).toContain('3')
  })

  it('makeHealthUnavailableWarning 返回不可用状态', () => {
    const w = makeHealthUnavailableWarning()
    expect(w.code).toBe('HEALTH_UNAVAILABLE' as any)
  })

  it('makeRestrictedTargetWarning 返回受限提示', () => {
    const w = makeRestrictedTargetWarning()
    expect(w.code).toBe('RESTRICTED_TARGET' as any)
  })

  it('makeIncompatibleCycleWarning 返回周期不兼容', () => {
    const w = makeIncompatibleCycleWarning()
    expect(w.code).toBe('INCOMPATIBLE_CYCLE' as any)
  })

  it('makeUnsupportedRelationWarning 包含关系类型', () => {
    const w = makeUnsupportedRelationWarning('unknown_type')
    expect(w.message).toContain('unknown_type')
  })

  it('makeCascadeDiffStaleWarning 返回过期提示', () => {
    const w = makeCascadeDiffStaleWarning()
    expect(w.code).toBe('CASCADE_DIFF_STALE' as any)
  })
})

// ─── Cascade / Alignment Fixture Builders ─────────────────────────────────────

describe('OKR 级联/对齐 fixture builders', () => {
  it('makeOkrCascadePlan 返回默认草案', () => {
    const plan = makeOkrCascadePlan()
    expect(plan.status).toBe('draft')
    expect(plan.coverage).toBe('partial')
    expect(plan.revisionHash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('makeOkrCascadePlanItem 返回 pending 状态', () => {
    const item = makeOkrCascadePlanItem()
    expect(item.status).toBe('pending')
    expect(item.coverageGap).toBe(false)
    expect(item.candidateObjective.scope).toBe('team')
  })

  it('makeOkrObjectiveRelation 返回默认 supports 关系', () => {
    const rel = makeOkrObjectiveRelation()
    expect(rel.relationType).toBe('supports')
    expect(rel.status).toBe('active')
    expect(rel.sourceObjectiveId).toBe(1)
    expect(rel.targetObjectiveId).toBe(2)
  })

  it('makeOkrAlignmentHealth 返回健康目标', () => {
    const health = makeOkrAlignmentHealth()
    expect(health.level).toBe('healthy')
    expect(health.score).toBe(85)
    expect(health.warnings).toHaveLength(0)
  })

  it('makeOkrAlignmentMatrixRow 返回组织级行', () => {
    const row = makeOkrAlignmentMatrixRow()
    expect(row.scope).toBe('organization')
    expect(row.restricted).toBe(false)
    expect(row.relations).toHaveLength(0)
  })

  it('makeOkrCascadeConfirmationDiff 包含 after 数据', () => {
    const diff = makeOkrCascadeConfirmationDiff()
    expect(diff.kind).toBe('objective')
    expect(diff.before).toBeNull()
    expect(diff.after).toHaveProperty('title')
  })

  it('makeOkrAiCascadeSuggestionResponse 包含建议', () => {
    const resp = makeOkrAiCascadeSuggestionResponse()
    expect(resp.cascadeCandidates).toHaveLength(1)
    expect(resp.missingAlignmentPrompts.length).toBeGreaterThan(0)
  })

  it('makeValidCascadePlanFixture 包含 team 和 project 拆解项', () => {
    const fixture = makeValidCascadePlanFixture()
    expect(fixture.items).toHaveLength(2)
    expect(fixture.items[0].candidateObjective.scope).toBe('team')
    expect(fixture.items[1].candidateObjective.scope).toBe('project')
  })

  it('makeInvalidScopeCascadeFixture 包含个人 scope 警告', () => {
    const fixture = makeInvalidScopeCascadeFixture()
    expect(fixture.items).toHaveLength(3)
    const invalidItem = fixture.items.find((i) => i.candidateObjective.scope === 'individual')
    expect(invalidItem).toBeDefined()
    expect(invalidItem!.conflictWarning).toContain('individual')
  })

  it('makeRelationMatrixFixture 生成 4 个矩阵行', () => {
    const matrix = makeRelationMatrixFixture()
    expect(matrix.matrixRows).toHaveLength(4)
    expect(matrix.relations).toHaveLength(2)
  })

  it('makeRestrictedRelationFixture 标记受限行', () => {
    const matrix = makeRestrictedRelationFixture()
    const restrictedRow = matrix.matrixRows.find((r) => r.restricted)
    expect(restrictedRow).toBeDefined()
  })

  it('makeStaleHealthFixture 返回陈旧健康度', () => {
    const fixture = makeStaleHealthFixture()
    expect(fixture.health.level).toBe('at_risk')
    expect(fixture.health.freshness.stale).toBe(true)
  })

  it('makeAiAlignmentSuggestionFixture 包含关系建议和冲突解释', () => {
    const fixture = makeAiAlignmentSuggestionFixture()
    expect(fixture.suggestions.relationSuggestions.length).toBeGreaterThan(0)
    expect(fixture.suggestions.conflictExplanations.length).toBeGreaterThan(0)
  })
})

// ─── 现有 fixture 回归测试（不改动 KR progress 语义） ────────────────────────

describe('OKR 现有 fixture 回归（无 KR progress 语义变更）', () => {
  it('makeNormalOkrFixture KR progress 不变', () => {
    const fixture = makeNormalOkrFixture()
    expect(fixture.keyResults[0].currentValue).toBe(80)
    expect(fixture.keyResults[1].currentValue).toBe(40)
    expect(fixture.keyResults[2].currentValue).toBe(50)
  })

  it('computeOkrRollup 对大树的正确性', () => {
    const krs = Array.from({ length: 10 }, (_, i) =>
      makeKeyResult({
        id: i + 1,
        weight: 10,
        currentValue: 50,
        targetValue: 100,
        baselineValue: 0,
      }),
    )
    const result = computeOkrRollup(krs as any, [])
    expect(result.progress).toBe(50)
  })
})
