// @aiproj/types — PMO 组合分组视图共享契约测试。
// v3-pmo-portfolio-grouping-views §2.5。

import { describe, it, expect } from 'vitest'
import {
  PMO_GROUPING_VIEW_PRIMARY_KEYS,
  PMO_GROUPING_VIEW_SECONDARY_KEYS,
  PMO_GROUPING_VIEW_COMPARE_MODES,
  PMO_GROUPING_VIEW_SCOPES,
  PMO_GROUPING_VIEW_SORT_KEYS,
  PMO_GROUPING_VIEW_WARNING_CODES,
  PMO_GROUPING_VIEW_DEFINITION_VERSION,
  PMO_GROUPING_VIEW_SYSTEM_PRESET_IDS,
  PMO_GROUPING_VIEW_MAX_PER_PAGE,
  PMO_GROUPING_VIEW_MAX_GROUP_CARDINALITY,
  PMO_GROUPING_VIEW_MAX_SECONDARY_GROUPS,
  PMO_GROUPING_VIEW_MAX_TOP_BOTTOM_N,
  PMO_GROUPING_VIEW_MAX_NAME_LENGTH,
  getSystemPresetViews,
  isSystemPresetId,
  isSystemPreset,
  normalizeGroupingViewQuery,
  validateGroupingViewKeys,
  containsSensitiveContent,
  hashGroupingViewQuery,
  toLowSensitiveGroupingWarning,
  groupTruncatedWarning,
  dimensionRedactedWarning,
  groupingTrafficLightUnavailableWarning,
  systemPresetImmutableWarning,
  isAllGroupsRedacted,
} from './pmo-portfolio-grouping-views.js'
import type {
  PmoGroupingViewQueryDefinition,
  PmoGroupingViewWarning,
} from './pmo-portfolio-grouping-views.js'
import {
  makePersonalGroupingView,
  makeOrganizationGroupingView,
  makeRedactedDimensionPreview,
  makeInvalidSensitivePayload,
  makeLargePortfolioGroupingInput,
  makeStaleSourceGroupingPreview,
  makeSecondaryGroupingPreview,
} from './pmo-portfolio-grouping-views-fixtures.js'

// ─── §2.1 DTO 形状 ──────────────────────────────────────────────────────────────

describe('PmoGroupingViewDefinition DTO shape', () => {
  it('personal view has all required fields', () => {
    const view = makePersonalGroupingView()
    expect(view.id).toBeTypeOf('string')
    expect(view.scope).toBe('personal')
    expect(view.organizationId).toBeTypeOf('number')
    expect(view.name).toBeTypeOf('string')
    expect(view.definitionVersion).toBe(PMO_GROUPING_VIEW_DEFINITION_VERSION)
    expect(view.query.primaryGrouping).toBeTypeOf('string')
    expect(view.capabilities.canEdit).toBe(true)
    expect(view.capabilities.isReadonly).toBe(false)
    expect(view.createdAt).toBeTypeOf('string')
  })

  it('organization view has management capabilities', () => {
    const view = makeOrganizationGroupingView()
    expect(view.scope).toBe('organization')
    expect(view.capabilities.canSetOrgDefault).toBe(true)
    expect(view.capabilities.canEdit).toBe(true)
  })

  it('system preset is readonly', () => {
    const presets = getSystemPresetViews(1)
    for (const preset of presets) {
      expect(preset.scope).toBe('system')
      expect(preset.capabilities.isReadonly).toBe(true)
      expect(preset.capabilities.canEdit).toBe(false)
      expect(preset.capabilities.canDelete).toBe(false)
    }
  })
})

// ─── §2.2 常量 ──────────────────────────────────────────────────────────────────

describe('Stable constants', () => {
  it('primary keys have 8 values', () => {
    expect(Object.keys(PMO_GROUPING_VIEW_PRIMARY_KEYS).length).toBe(8)
  })

  it('secondary keys are subset of primary-related', () => {
    const secondaryValues = Object.values(PMO_GROUPING_VIEW_SECONDARY_KEYS)
    expect(secondaryValues.length).toBeGreaterThanOrEqual(3)
    // secondary keys should not include manager/department/source_freshness
    expect(secondaryValues).not.toContain('manager')
    expect(secondaryValues).not.toContain('department')
    expect(secondaryValues).not.toContain('source_freshness')
  })

  it('compare modes have 3 values', () => {
    expect(Object.keys(PMO_GROUPING_VIEW_COMPARE_MODES).length).toBe(3)
    expect(PMO_GROUPING_VIEW_COMPARE_MODES.NONE).toBe('none')
    expect(PMO_GROUPING_VIEW_COMPARE_MODES.SIDE_BY_SIDE).toBe('side_by_side')
  })

  it('view scopes have 3 values', () => {
    expect(Object.keys(PMO_GROUPING_VIEW_SCOPES).length).toBe(3)
    expect(PMO_GROUPING_VIEW_SCOPES.SYSTEM).toBe('system')
    expect(PMO_GROUPING_VIEW_SCOPES.PERSONAL).toBe('personal')
    expect(PMO_GROUPING_VIEW_SCOPES.ORGANIZATION).toBe('organization')
  })

  it('warning codes have at least 10 values', () => {
    const codes = Object.values(PMO_GROUPING_VIEW_WARNING_CODES)
    expect(codes.length).toBeGreaterThanOrEqual(10)
  })

  it('definition version is stable', () => {
    expect(PMO_GROUPING_VIEW_DEFINITION_VERSION).toBe('grouping-view.v1')
  })

  it('bounds are reasonable', () => {
    expect(PMO_GROUPING_VIEW_MAX_PER_PAGE).toBe(100)
    expect(PMO_GROUPING_VIEW_MAX_GROUP_CARDINALITY).toBe(30)
    expect(PMO_GROUPING_VIEW_MAX_SECONDARY_GROUPS).toBe(8)
    expect(PMO_GROUPING_VIEW_MAX_TOP_BOTTOM_N).toBe(20)
    expect(PMO_GROUPING_VIEW_MAX_NAME_LENGTH).toBe(120)
  })
})

// ─── §2.2 系统预设 ──────────────────────────────────────────────────────────────

describe('System presets', () => {
  it('generates 6 preset views', () => {
    const presets = getSystemPresetViews(1)
    expect(presets.length).toBe(6)
  })

  it('all presets have stable ids', () => {
    const presets = getSystemPresetViews(1)
    const ids = presets.map((p) => p.id)
    expect(ids).toContain('system-by-status')
    expect(ids).toContain('system-by-health')
    expect(ids).toContain('system-by-traffic-light')
    expect(ids).toContain('system-by-manager')
    expect(ids).toContain('system-by-department')
    expect(ids).toContain('system-by-lifecycle')
  })

  it('all presets are organization-scoped', () => {
    const presets = getSystemPresetViews(5)
    for (const p of presets) {
      expect(p.organizationId).toBe(5)
    }
  })

  it('isSystemPresetId detects valid system preset ids', () => {
    expect(isSystemPresetId('system-by-status')).toBe(true)
    expect(isSystemPresetId('system-by-health')).toBe(true)
    expect(isSystemPresetId('user-created-view')).toBe(false)
    expect(isSystemPresetId('')).toBe(false)
  })

  it('isSystemPreset detects system scope and system ids', () => {
    expect(isSystemPreset({ scope: 'system', id: 'anything' })).toBe(true)
    expect(isSystemPreset({ scope: 'personal', id: 'system-by-status' })).toBe(true)
    expect(isSystemPreset({ scope: 'personal', id: 'my-view' })).toBe(false)
  })
})

// ─── §2.3 查询规范化 ────────────────────────────────────────────────────────────

describe('normalizeGroupingViewQuery', () => {
  it('fills missing sort and order', () => {
    const result = normalizeGroupingViewQuery({
      primaryGrouping: 'status',
    })
    expect(result.sort).toBe('project_count')
    expect(result.order).toBe('desc')
  })

  it('fills missing trendWindow', () => {
    const result = normalizeGroupingViewQuery({
      primaryGrouping: 'health',
    })
    expect(result.trendWindow).toBe('last_30_days')
  })

  it('fills missing compareMode', () => {
    const result = normalizeGroupingViewQuery({
      primaryGrouping: 'status',
    })
    expect(result.compareMode).toBe('none')
  })

  it('fills missing displayMetricKeys', () => {
    const result = normalizeGroupingViewQuery({
      primaryGrouping: 'status',
    })
    expect(result.displayMetricKeys).toEqual(['total_projects'])
  })

  it('preserves explicit values', () => {
    const result = normalizeGroupingViewQuery({
      primaryGrouping: 'traffic_light',
      sort: 'group_name',
      order: 'asc',
      trendWindow: 'last_90_days',
      compareMode: 'side_by_side',
      displayMetricKeys: ['total_projects', 'active_projects'],
    })
    expect(result.sort).toBe('group_name')
    expect(result.order).toBe('asc')
    expect(result.trendWindow).toBe('last_90_days')
    expect(result.compareMode).toBe('side_by_side')
    expect(result.displayMetricKeys).toEqual(['total_projects', 'active_projects'])
  })
})

// ─── §2.3 分组键验证 ───────────────────────────────────────────────────────────

describe('validateGroupingViewKeys', () => {
  it('accepts valid primary key', () => {
    const errors = validateGroupingViewKeys({
      primaryGrouping: 'status',
    })
    expect(errors).toEqual([])
  })

  it('rejects invalid primary key', () => {
    const errors = validateGroupingViewKeys({
      primaryGrouping: 'invalid_key',
    })
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain('不支持的主分组维度')
  })

  it('rejects secondary key same as primary', () => {
    const errors = validateGroupingViewKeys({
      primaryGrouping: 'status',
      secondaryGrouping: 'status',
    })
    expect(errors.some((e) => e.includes('不能与主分组维度相同'))).toBe(true)
  })

  it('rejects invalid secondary key', () => {
    const errors = validateGroupingViewKeys({
      primaryGrouping: 'status',
      secondaryGrouping: 'invalid_secondary',
    })
    expect(errors.some((e) => e.includes('不支持的二级分组维度'))).toBe(true)
  })

  it('rejects invalid compare mode', () => {
    const errors = validateGroupingViewKeys({
      primaryGrouping: 'status',
      compareMode: 'invalid_mode',
    })
    expect(errors.some((e) => e.includes('不支持比较模式'))).toBe(true)
  })

  it('rejects invalid sort key', () => {
    const errors = validateGroupingViewKeys({
      primaryGrouping: 'status',
      sort: 'invalid_sort',
    })
    expect(errors.some((e) => e.includes('不支持排序字段'))).toBe(true)
  })

  it('rejects out-of-bounds topN', () => {
    const errors = validateGroupingViewKeys({
      primaryGrouping: 'status',
      topN: 100,
    })
    expect(errors.some((e) => e.includes('topN'))).toBe(true)
  })

  it('rejects negative topN', () => {
    const errors = validateGroupingViewKeys({
      primaryGrouping: 'status',
      topN: -1,
    })
    expect(errors.some((e) => e.includes('topN'))).toBe(true)
  })

  it('rejects out-of-bounds bottomN', () => {
    const errors = validateGroupingViewKeys({
      primaryGrouping: 'status',
      bottomN: 100,
    })
    expect(errors.some((e) => e.includes('bottomN'))).toBe(true)
  })
})

// ─── §2.3 敏感内容检测 ─────────────────────────────────────────────────────────

describe('containsSensitiveContent', () => {
  it('rejects payload with projectResults', () => {
    const payload = { name: 'test', projectResults: [] }
    const result = containsSensitiveContent(payload)
    expect(result.found).toBe(true)
    expect(result.reason).toBeDefined()
  })

  it('rejects payload with evidenceText', () => {
    const payload = { name: 'test', evidenceText: 'sensitive' }
    expect(containsSensitiveContent(payload).found).toBe(true)
  })

  it('rejects payload with prompt', () => {
    const payload = { name: 'test', prompt: 'generate something' }
    expect(containsSensitiveContent(payload).found).toBe(true)
  })

  it('rejects payload with apiKey', () => {
    const payload = { name: 'test', apiKey: 'sk-12345' }
    expect(containsSensitiveContent(payload).found).toBe(true)
  })

  it('rejects invalid sensitive payload from fixture', () => {
    const payload = makeInvalidSensitivePayload()
    expect(containsSensitiveContent(payload).found).toBe(true)
  })

  it('accepts valid view definition', () => {
    const view = makePersonalGroupingView()
    expect(containsSensitiveContent(view).found).toBe(false)
  })

  it('accepts simple query definition', () => {
    const result = containsSensitiveContent({
      name: 'Valid View',
      query: { primaryGrouping: 'status' },
    })
    expect(result.found).toBe(false)
  })
})

// ─── §2.3 哈希稳定性 ───────────────────────────────────────────────────────────

describe('hashGroupingViewQuery', () => {
  it('produces same hash for same input', () => {
    const q: PmoGroupingViewQueryDefinition = { primaryGrouping: 'status' }
    const h1 = hashGroupingViewQuery(q)
    const h2 = hashGroupingViewQuery(q)
    expect(h1).toBe(h2)
  })

  it('produces different hash for different input', () => {
    const q1: PmoGroupingViewQueryDefinition = { primaryGrouping: 'status' }
    const q2: PmoGroupingViewQueryDefinition = { primaryGrouping: 'health' }
    expect(hashGroupingViewQuery(q1)).not.toBe(hashGroupingViewQuery(q2))
  })

  it('hash has expected prefix', () => {
    const h = hashGroupingViewQuery({ primaryGrouping: 'status' })
    expect(h.startsWith('gv-')).toBe(true)
    expect(h.length).toBe(11) // 'gv-' + 8 hex chars
  })

  it('normalization produces stable hash regardless of missing fields', () => {
    const q1: PmoGroupingViewQueryDefinition = { primaryGrouping: 'status' }
    const q2: PmoGroupingViewQueryDefinition = {
      primaryGrouping: 'status',
      sort: 'project_count',
      order: 'desc',
    }
    // After normalization, q1 gets defaults including sort='project_count', order='desc'
    expect(hashGroupingViewQuery(q1)).toBe(hashGroupingViewQuery(q2))
  })
})

// ─── §2.3 Warning 投影 ─────────────────────────────────────────────────────────

describe('toLowSensitiveGroupingWarning', () => {
  it('strips groupKey and keeps code and message', () => {
    const w: PmoGroupingViewWarning = {
      code: 'DIMENSION_REDACTED',
      message: 'test message',
      groupKey: 'risk',
      metricKey: 'risk_high_percent',
    }
    const result = toLowSensitiveGroupingWarning(w)
    expect(result.code).toBe('DIMENSION_REDACTED')
    expect(result.message).toBe('test message')
    expect(result.groupKey).toBe('risk')
    expect((result as any).metricKey).toBeUndefined()
  })
})

describe('groupTruncatedWarning', () => {
  it('includes groupKey and cardinality in message', () => {
    const w = groupTruncatedWarning('status', 50, 30)
    expect(w.code).toBe('GROUP_TRUNCATED')
    expect(w.message).toContain('status')
    expect(w.message).toContain('50')
    expect(w.message).toContain('30')
    expect(w.groupKey).toBe('status')
  })
})

describe('dimensionRedactedWarning', () => {
  it('creates redacted warning', () => {
    const w = dimensionRedactedWarning('health')
    expect(w.code).toBe('DIMENSION_REDACTED')
    expect(w.groupKey).toBe('health')
  })
})

describe('groupingTrafficLightUnavailableWarning', () => {
  it('creates traffic light unavailable warning', () => {
    const w = groupingTrafficLightUnavailableWarning()
    expect(w.code).toBe('TRAFFIC_LIGHT_UNAVAILABLE')
  })
})

describe('systemPresetImmutableWarning', () => {
  it('includes view id in message', () => {
    const w = systemPresetImmutableWarning('system-by-status')
    expect(w.code).toBe('SYSTEM_PRESET_IMMUTABLE')
    expect(w.message).toContain('system-by-status')
  })
})

describe('isAllGroupsRedacted', () => {
  it('returns true when all warnings are redacted', () => {
    const warnings: PmoGroupingViewWarning[] = [
      { code: 'DIMENSION_REDACTED', message: 'a' },
      { code: 'METRIC_FORBIDDEN', message: 'b' },
    ]
    expect(isAllGroupsRedacted(warnings)).toBe(true)
  })

  it('returns false when mixed with non-redacted', () => {
    const warnings: PmoGroupingViewWarning[] = [
      { code: 'DIMENSION_REDACTED', message: 'a' },
      { code: 'SOURCE_STALE', message: 'b' },
    ]
    expect(isAllGroupsRedacted(warnings)).toBe(false)
  })
})

// ─── §2.4 Fixtures ──────────────────────────────────────────────────────────────

describe('Fixtures', () => {
  it('personal view fixture is valid', () => {
    const view = makePersonalGroupingView()
    expect(view.scope).toBe('personal')
    expect(view.capabilities.canSetOrgDefault).toBe(false)
  })

  it('organization view fixture is valid', () => {
    const view = makeOrganizationGroupingView()
    expect(view.scope).toBe('organization')
    expect(view.capabilities.canSetOrgDefault).toBe(true)
  })

  it('redacted dimension preview has expected shape', () => {
    const preview = makeRedactedDimensionPreview()
    expect(preview.groups.length).toBe(1)
    expect(preview.warnings.some((w) => w.code === 'DIMENSION_REDACTED')).toBe(true)
    expect(preview.meta.truncated).toBe(false)
  })

  it('large portfolio input generates correct count', () => {
    const input = makeLargePortfolioGroupingInput(100)
    expect(input.projects.length).toBe(100)
    expect(input.query.primaryGrouping).toBe('status')
    expect(input.query.secondaryGrouping).toBe('health')
  })

  it('stale source preview has stale freshness', () => {
    const preview = makeStaleSourceGroupingPreview()
    expect(preview.freshness.some((f) => f.isStale)).toBe(true)
    expect(preview.warnings.some((w) => w.code === 'SOURCE_STALE')).toBe(true)
  })

  it('secondary grouping preview has nested groups', () => {
    const preview = makeSecondaryGroupingPreview()
    expect(preview.groups.length).toBe(2)
    expect(preview.groups[0].secondaryGroups).toBeDefined()
    expect(preview.groups[0].secondaryGroups!.length).toBeGreaterThan(0)
    expect(preview.meta.secondaryGroupCount).toBe(3)
  })
})

// ─── §2.5 边界条件 ──────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('normalize handles empty object', () => {
    // Should not throw
    const result = normalizeGroupingViewQuery({
      primaryGrouping: 'status',
    } as PmoGroupingViewQueryDefinition)
    expect(result).toBeDefined()
  })

  it('validate returns empty for valid complex query', () => {
    const errors = validateGroupingViewKeys({
      primaryGrouping: 'health',
      secondaryGrouping: 'status',
      sort: 'project_count',
      compareMode: 'none',
      topN: 10,
      bottomN: 5,
    })
    expect(errors).toEqual([])
  })

  it('hash is deterministic across calls', () => {
    const q: PmoGroupingViewQueryDefinition = {
      primaryGrouping: 'department',
      secondaryGrouping: 'health',
      topN: 15,
    }
    const results = new Set(Array.from({ length: 20 }, () => hashGroupingViewQuery(q)))
    expect(results.size).toBe(1)
  })

  it('sensitive content detection is case-sensitive for field names', () => {
    // JSON stringify uses double quotes; field name matching is exact
    expect(containsSensitiveContent({ PROJECTRESULTS: [] }).found).toBe(false)
    expect(containsSensitiveContent({ projectResults: [] }).found).toBe(true)
  })
})
