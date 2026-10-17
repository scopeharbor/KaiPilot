import { describe, expect, it } from 'vitest'
import {
  COCKPIT_ATTENTION_RULE_VERSION,
  COCKPIT_ATTENTION_REASONS,
  COCKPIT_ATTENTION_REASON_VALUES,
  COCKPIT_DEFAULT_ATTENTION_LIMIT,
  COCKPIT_DEFAULT_FRESHNESS_MINUTES,
  COCKPIT_FORBIDDEN_KEYS,
  COCKPIT_INCLUDE_VALUES,
  COCKPIT_MAPPING_KINDS,
  COCKPIT_MAPPING_KIND_VALUES,
  COCKPIT_METRIC_KEY_VALUES,
  COCKPIT_METRIC_KEYS,
  COCKPIT_SORT_KEY_VALUES,
  COCKPIT_SOURCE_STATUS_VALUES,
  COCKPIT_SOURCE_VALUES,
  COCKPIT_TARGET_KIND_VALUES,
  COCKPIT_WARNING_CODE_VALUES,
  COCKPIT_WARNING_CODES,
  STRATEGY_EXECUTION_COCKPIT_METRIC_VERSION,
  boundCockpitAttention,
  cockpitAttentionTruncatedWarning,
  cockpitEmptyStrategyWarning,
  cockpitFinancialUnsupportedWarning,
  cockpitFreshnessHash,
  cockpitPermissionRedactedWarning,
  cockpitSourceForbiddenWarning,
  cockpitSourcePartialWarning,
  cockpitSourceStaleWarning,
  cockpitSourceUnavailableWarning,
  cockpitStableHash,
  cockpitValidationDetail,
  compareCockpitAttention,
  deriveCockpitOverallStatus,
  detectCockpitForbiddenFields,
  evaluateCockpitAttentionRules,
  isCockpitSourceStale,
  makeCockpitSourceFreshness,
  mergeCockpitWarnings,
  normalizeCockpitQuery,
  projectExplicitCockpitMappings,
  redactCockpitForbiddenFields,
  validateCockpitMapping,
  type CockpitMappingFact,
  type CockpitObjectiveFact,
  type CockpitWarning,
  type NormalizedCockpitQuery,
} from './strategy-execution-cockpit.js'
import {
  buildCockpitDegradedFixture,
  buildCockpitEmptyFixture,
  buildCockpitForbiddenFixture,
  buildCockpitLargeFixture,
  buildCockpitMappingFact,
  buildCockpitNormalFixture,
  buildCockpitObjectiveFact,
  buildCockpitStaleFixture,
} from './strategy-execution-cockpit-fixtures.js'

const FIXED_NOW = Date.parse('2026-07-30T12:00:00.000Z')

function baseQuery(overrides: Partial<NormalizedCockpitQuery> = {}): NormalizedCockpitQuery {
  return {
    scopes: [],
    ownerIds: [],
    statuses: [],
    themes: [],
    includes: [...COCKPIT_INCLUDE_VALUES],
    freshnessWindowMinutes: COCKPIT_DEFAULT_FRESHNESS_MINUTES,
    attentionLimit: COCKPIT_DEFAULT_ATTENTION_LIMIT,
    sort: 'risk',
    order: 'desc',
    ...overrides,
  }
}

describe('Strategy Execution Cockpit shared contract — 稳定 vocabulary', () => {
  it('metric key 集合稳定且无重复', () => {
    const set = new Set(COCKPIT_METRIC_KEY_VALUES)
    expect(set.size).toBe(COCKPIT_METRIC_KEY_VALUES.length)
    expect(COCKPIT_METRIC_KEYS.TOTAL_OBJECTIVES).toBe('cockpit_total_objectives')
  })

  it('source / warning / attention reason 集合稳定且无重复', () => {
    expect(new Set(COCKPIT_SOURCE_VALUES).size).toBe(COCKPIT_SOURCE_VALUES.length)
    expect(new Set(COCKPIT_WARNING_CODE_VALUES).size).toBe(COCKPIT_WARNING_CODE_VALUES.length)
    expect(new Set(COCKPIT_ATTENTION_REASON_VALUES).size).toBe(
      COCKPIT_ATTENTION_REASON_VALUES.length,
    )
  })

  it('mapping kind / target kind 闭集稳定', () => {
    expect(COCKPIT_MAPPING_KIND_VALUES).toContain('direct_project_contribution')
    expect(COCKPIT_TARGET_KIND_VALUES).toContain('pmo_portfolio')
    expect(COCKPIT_WARNING_CODES.EMPTY_STRATEGY_SCOPE).toBe('EMPTY_STRATEGY_SCOPE')
  })

  it('metric version 固定且 attention rule version 固定', () => {
    expect(STRATEGY_EXECUTION_COCKPIT_METRIC_VERSION).toBe('strategy-execution-cockpit.v1.0.0')
    expect(COCKPIT_ATTENTION_RULE_VERSION).toBe('cockpit-attention-rules.v1')
  })
})

describe('normalizeCockpitQuery — 白名单、上下界与去重', () => {
  it('无参时应用默认 include/limit/freshness/sort', () => {
    const q = normalizeCockpitQuery()
    expect(q.includes).toEqual([...COCKPIT_INCLUDE_VALUES])
    expect(q.attentionLimit).toBe(COCKPIT_DEFAULT_ATTENTION_LIMIT)
    expect(q.freshnessWindowMinutes).toBe(COCKPIT_DEFAULT_FRESHNESS_MINUTES)
    expect(q.sort).toBe('risk')
  })

  it('clamp attention limit 与 freshness window', () => {
    expect(normalizeCockpitQuery({ attentionLimit: 0 }).attentionLimit).toBe(1)
    expect(normalizeCockpitQuery({ attentionLimit: 9999 }).attentionLimit).toBe(50)
    expect(normalizeCockpitQuery({ freshnessWindowMinutes: 0 }).freshnessWindowMinutes).toBe(1)
    expect(
      normalizeCockpitQuery({ freshnessWindowMinutes: 1_000_000 }).freshnessWindowMinutes,
    ).toBe(30 * 24 * 60)
  })

  it('过滤非法 include / scope / status / sort 并去重', () => {
    const q = normalizeCockpitQuery({
      include: ['objective_matrix', 'bogus' as never, 'objective_matrix'],
      scope: ['team', 'bogus' as never, 'team'],
      status: ['active', 'bogus' as never, 'active'],
      sort: 'bogus' as never,
      theme: ['theme-a', 'theme-a'],
    })
    expect(q.includes).toEqual(['objective_matrix'])
    expect(q.scopes).toEqual(['team'])
    expect(q.statuses).toEqual(['active'])
    expect(q.sort).toBe('risk')
    expect(q.themes).toEqual(['theme-a'])
  })

  it('ownerId 归一化为去重的正整数列表', () => {
    const q = normalizeCockpitQuery({ ownerId: [3, 3, 7] })
    expect(q.ownerIds).toEqual([3, 7])
  })
})

describe('cockpitStableHash / freshness', () => {
  it('stable hash 确定且区分输入', () => {
    expect(cockpitStableHash('abc')).toBe(cockpitStableHash('abc'))
    expect(cockpitStableHash('abc')).not.toBe(cockpitStableHash('abd'))
  })

  it('null lastUpdatedAt 视为 stale', () => {
    expect(isCockpitSourceStale(null, 60, FIXED_NOW)).toBe(true)
  })

  it('forbidden/unavailable/unsupported/partial 覆盖 stale', () => {
    const forbidden = makeCockpitSourceFreshness({
      source: 'okr_mapping',
      lastUpdatedAt: null,
      staleThresholdMinutes: 60,
      now: FIXED_NOW,
      forbidden: true,
    })
    expect(forbidden.status).toBe('forbidden')
    expect(forbidden.isStale).toBe(false)

    const unavailable = makeCockpitSourceFreshness({
      source: 'portfolio_traffic_light',
      lastUpdatedAt: null,
      staleThresholdMinutes: 60,
      now: FIXED_NOW,
      unavailable: true,
    })
    expect(unavailable.status).toBe('unavailable')

    const partial = makeCockpitSourceFreshness({
      source: 'investment_distribution',
      lastUpdatedAt: '2026-07-29T00:00:00.000Z',
      staleThresholdMinutes: 60,
      now: FIXED_NOW,
      partial: true,
    })
    expect(partial.status).toBe('partial')
  })

  it('freshness hash 稳定', () => {
    const f = makeCockpitSourceFreshness({
      source: 'okr_objective',
      lastUpdatedAt: '2026-07-29T00:00:00.000Z',
      staleThresholdMinutes: 60,
      now: FIXED_NOW,
    })
    expect(cockpitFreshnessHash(f)).toHaveLength(8)
  })
})

describe('deriveCockpitOverallStatus — D7 状态矩阵', () => {
  const mandatory = ['okr_cycle', 'okr_objective', 'okr_mapping'] as const

  it('mandatory 失败 → unavailable', () => {
    expect(
      deriveCockpitOverallStatus({
        sourceStatuses: ['unavailable', 'available'],
        mandatorySources: mandatory,
      }),
    ).toBe('unavailable')
  })

  it('forbidden → unavailable', () => {
    expect(
      deriveCockpitOverallStatus({
        sourceStatuses: ['forbidden', 'available'],
        mandatorySources: mandatory,
      }),
    ).toBe('unavailable')
  })

  it('optional stale / partial → degraded', () => {
    expect(
      deriveCockpitOverallStatus({
        sourceStatuses: ['available', 'stale'],
        mandatorySources: mandatory,
      }),
    ).toBe('degraded')
  })

  it('全部 available → ready', () => {
    expect(
      deriveCockpitOverallStatus({
        sourceStatuses: ['available', 'available'],
        mandatorySources: mandatory,
      }),
    ).toBe('ready')
  })

  it('unsupported 财务 → degraded', () => {
    expect(
      deriveCockpitOverallStatus({
        sourceStatuses: ['available', 'unsupported'],
        mandatorySources: mandatory,
      }),
    ).toBe('degraded')
  })
})

describe('validateCockpitMapping / projectExplicitCockpitMappings — D3', () => {
  const visible = new Set([100, 101])

  it('合法映射通过', () => {
    const m = buildCockpitMappingFact({ id: 1, organizationId: 10, projectId: 100 })
    const r = validateCockpitMapping({
      mapping: m,
      organizationId: 10,
      cycleId: 1,
      visibleProjectIds: visible,
    })
    expect(r.valid).toBe(true)
    expect(r.status).toBe('ok')
  })

  it('null 映射 → missing', () => {
    const r = validateCockpitMapping({
      mapping: null,
      organizationId: 10,
      cycleId: 1,
      visibleProjectIds: visible,
    })
    expect(r.valid).toBe(false)
    expect(r.status).toBe('missing')
    expect(r.warning?.code).toBe('EXECUTION_MAPPING_MISSING')
  })

  it('跨组织映射 → forbidden', () => {
    const m = buildCockpitMappingFact({ id: 1, organizationId: 99, projectId: 100 })
    const r = validateCockpitMapping({
      mapping: m,
      organizationId: 10,
      cycleId: 1,
      visibleProjectIds: visible,
    })
    expect(r.status).toBe('forbidden')
    expect(r.warning?.code).toBe('EXECUTION_MAPPING_FORBIDDEN')
  })

  it('删除/未激活映射 → invalid', () => {
    const r = validateCockpitMapping({
      mapping: buildCockpitMappingFact({
        id: 1,
        organizationId: 10,
        projectId: 100,
        active: false,
      }),
      organizationId: 10,
      cycleId: 1,
      visibleProjectIds: visible,
    })
    expect(r.status).toBe('invalid')
  })

  it('目标不可见 → forbidden，不在可见集合 → unavailable', () => {
    const hidden = validateCockpitMapping({
      mapping: buildCockpitMappingFact({
        id: 1,
        organizationId: 10,
        projectId: 999,
        targetVisible: false,
      }),
      organizationId: 10,
      cycleId: 1,
      visibleProjectIds: visible,
    })
    expect(hidden.status).toBe('forbidden')

    const notVisible = validateCockpitMapping({
      mapping: buildCockpitMappingFact({
        id: 1,
        organizationId: 10,
        projectId: 999,
        targetVisible: true,
      }),
      organizationId: 10,
      cycleId: 1,
      visibleProjectIds: visible,
    })
    expect(notVisible.status).toBe('unavailable')
  })

  it('坏 weight / 未知 kind → invalid', () => {
    const badWeight = validateCockpitMapping({
      mapping: buildCockpitMappingFact({ id: 1, organizationId: 10, projectId: 100, weight: -1 }),
      organizationId: 10,
      cycleId: 1,
      visibleProjectIds: visible,
    })
    expect(badWeight.status).toBe('invalid')

    const badKind = validateCockpitMapping({
      mapping: buildCockpitMappingFact({
        id: 1,
        organizationId: 10,
        projectId: 100,
        kind: 'guessed' as never,
      }),
      organizationId: 10,
      cycleId: 1,
      visibleProjectIds: visible,
    })
    expect(badKind.status).toBe('invalid')
  })

  it('projectExplicitCockpitMappings 只保留合法并统计非法/不可见', () => {
    const result = projectExplicitCockpitMappings({
      mappings: [
        buildCockpitMappingFact({ id: 1, objectiveId: 1, projectId: 100 }),
        buildCockpitMappingFact({ id: 2, objectiveId: 1, projectId: 999 }),
        buildCockpitMappingFact({ id: 3, objectiveId: 1, projectId: 101, active: false }),
      ],
      organizationId: 10,
      cycleId: 1,
      visibleProjectIds: visible,
    })
    expect(result.valid).toHaveLength(1)
    expect(result.valid[0]?.projectId).toBe(100)
    expect(result.unavailableCount).toBe(1)
    expect(result.invalidCount).toBe(1)
  })
})

describe('attention rules — D4 确定性规则', () => {
  const objective = buildCockpitObjectiveFact({ id: 1, progress: 20, priorityBand: 'high' })

  it('behind + red project → STRATEGY_PROGRESS_AT_RISK', () => {
    const rules = evaluateCockpitAttentionRules({
      objective: { ...objective, progress: 5 },
      mappedCount: 1,
      coveragePercent: 40,
      projectHealth: ['red'],
      investmentMismatch: false,
      staleSources: [],
      now: FIXED_NOW,
      elapsedPercent: 50,
    })
    expect(rules.some((r) => r.reason === 'STRATEGY_PROGRESS_AT_RISK')).toBe(true)
  })

  it('无映射 → EXECUTION_COVERAGE_GAP / UNAVAILABLE', () => {
    const gap = evaluateCockpitAttentionRules({
      objective,
      mappedCount: 0,
      coveragePercent: 0,
      projectHealth: [],
      investmentMismatch: false,
      staleSources: [],
      now: FIXED_NOW,
    })
    expect(gap.some((r) => r.reason === 'EXECUTION_COVERAGE_GAP')).toBe(true)

    const unavailable = evaluateCockpitAttentionRules({
      objective,
      mappedCount: 0,
      coveragePercent: null,
      projectHealth: [],
      investmentMismatch: false,
      staleSources: [],
      now: FIXED_NOW,
    })
    expect(unavailable.some((r) => r.reason === 'EXECUTION_COVERAGE_UNAVAILABLE')).toBe(true)
  })

  it('投入错配 → INVESTMENT_PRIORITY_MISMATCH', () => {
    const rules = evaluateCockpitAttentionRules({
      objective,
      mappedCount: 1,
      coveragePercent: 50,
      projectHealth: ['green'],
      investmentMismatch: true,
      staleSources: [],
      now: FIXED_NOW,
    })
    expect(rules.some((r) => r.reason === 'INVESTMENT_PRIORITY_MISMATCH')).toBe(true)
  })

  it('过期来源 → EXECUTION_SOURCE_STALE', () => {
    const rules = evaluateCockpitAttentionRules({
      objective,
      mappedCount: 1,
      coveragePercent: 50,
      projectHealth: ['green'],
      investmentMismatch: false,
      staleSources: ['portfolio_traffic_light'],
      now: FIXED_NOW,
    })
    expect(rules.some((r) => r.reason === 'EXECUTION_SOURCE_STALE')).toBe(true)
  })

  it('compareCockpitAttention / boundCockpitAttention 稳定且截断', () => {
    const a = { severity: 'info' as const, reason: 'A' as const }
    const b = { severity: 'critical' as const, reason: 'B' as const }
    expect(compareCockpitAttention(a, b)).toBeGreaterThan(0)
    expect(compareCockpitAttention(b, a)).toBeLessThan(0)

    const items = [
      { severity: 'info' as const, reason: COCKPIT_ATTENTION_REASONS.EXECUTION_SOURCE_STALE },
      {
        severity: 'critical' as const,
        reason: COCKPIT_ATTENTION_REASONS.STRATEGY_PROGRESS_AT_RISK,
      },
      { severity: 'warning' as const, reason: COCKPIT_ATTENTION_REASONS.EXECUTION_COVERAGE_GAP },
    ]
    const result = boundCockpitAttention(items, 2)
    expect(result.items).toHaveLength(2)
    expect(result.truncated).toBe(true)
    expect(result.items[0]?.severity).toBe('critical')
  })
})

describe('warning 工厂与 merge', () => {
  it('warning 工厂 code 稳定', () => {
    expect(cockpitEmptyStrategyWarning().code).toBe('EMPTY_STRATEGY_SCOPE')
    expect(cockpitSourceStaleWarning('okr_objective').source).toBe('okr_objective')
    expect(cockpitSourcePartialWarning('resource_risk').code).toBe('SOURCE_PARTIAL')
    expect(cockpitSourceUnavailableWarning('backflow').code).toBe('SOURCE_UNAVAILABLE')
    expect(cockpitSourceForbiddenWarning('portfolio_priority').code).toBe('SOURCE_FORBIDDEN')
    expect(cockpitFinancialUnsupportedWarning().code).toBe('FINANCIAL_UNSUPPORTED')
    expect(cockpitPermissionRedactedWarning().code).toBe('PERMISSION_REDACTED')
    expect(cockpitAttentionTruncatedWarning().code).toBe('ATTENTION_TRUNCATED')
  })

  it('mergeCockpitWarnings 按 code+source+metricKey 去重', () => {
    const a = cockpitSourceStaleWarning('okr_objective')
    const b: CockpitWarning = { ...a }
    const c = cockpitSourcePartialWarning('resource_risk')
    const merged = mergeCockpitWarnings([a], [b], [c])
    expect(merged).toHaveLength(2)
  })
})

describe('cockpitValidationDetail / forbidden-field guard', () => {
  it('validation detail 返回全部白名单', () => {
    const d = cockpitValidationDetail()
    expect(d.allowedIncludes).toEqual(COCKPIT_INCLUDE_VALUES)
    expect(d.allowedSorts).toEqual(COCKPIT_SORT_KEY_VALUES)
    expect(d.maxAttentionLimit).toBe(50)
  })

  it('detectCockpitForbiddenFields 发现嵌套敏感字段', () => {
    const payload = {
      meta: <Record<string, unknown>>{},
      data: { value: 1, prompt: 'hi', evidenceText: 'x' },
    }
    const findings = detectCockpitForbiddenFields(payload)
    expect(findings.some((f) => f.key === 'prompt')).toBe(true)
    expect(findings.some((f) => f.key === 'evidenceText')).toBe(true)
  })

  it('redactCockpitForbiddenFields 替换敏感字段而不影响其余', () => {
    const redacted = redactCockpitForbiddenFields({
      value: 1,
      token: 'abc',
      nested: { apiKey: 'xyz', keep: 2 },
    })
    expect((redacted as Record<string, unknown>).value).toBe(1)
    expect((redacted as Record<string, unknown>).token).toBe('[redacted]')
    expect((redacted as Record<string, unknown>).nested).toEqual({ apiKey: '[redacted]', keep: 2 })
  })

  it('COCKPIT_FORBIDDEN_KEYS 覆盖 prompt/model output/secret/Authorization/token/apiKey', () => {
    for (const key of ['prompt', 'modelOutput', 'secret', 'token', 'apiKey', 'authorization']) {
      expect(COCKPIT_FORBIDDEN_KEYS).toContain(key)
    }
  })
})

describe('fixtures — normal/empty/degraded/forbidden/stale/large', () => {
  it('normal fixture 产生合法映射投影', () => {
    const fx = buildCockpitNormalFixture()
    expect(fx.objectives).toHaveLength(2)
    const result = projectExplicitCockpitMappings({
      mappings: fx.mappings,
      organizationId: 10,
      cycleId: 1,
      visibleProjectIds: fx.visibleProjectIds,
    })
    expect(result.valid).toHaveLength(2)
  })

  it('empty / degraded / forbidden / stale fixtures 语义正确', () => {
    const empty = buildCockpitEmptyFixture()
    expect(empty.objectives).toHaveLength(0)

    const degraded = buildCockpitDegradedFixture()
    expect(degraded.mappings[0]?.active).toBe(false)

    const forbidden = buildCockpitForbiddenFixture()
    expect(forbidden.mappings[0]?.targetVisible).toBe(false)

    const stale = buildCockpitStaleFixture()
    expect(isCockpitSourceStale(stale.objectives[0]?.updatedAt ?? null, 60, FIXED_NOW)).toBe(true)
  })

  it('large fixture 生成 ≥1000 objectives/mappings', () => {
    const fx = buildCockpitLargeFixture(1000)
    expect(fx.objectives).toHaveLength(1000)
    expect(fx.mappings).toHaveLength(1000)
    expect(fx.visibleProjectIds.size).toBe(1000)
  })

  it('builder factories 生成合法默认值', () => {
    expect(buildCockpitObjectiveFact().organizationId).toBe(10)
    expect(buildCockpitMappingFact().kind).toBe(COCKPIT_MAPPING_KINDS.DIRECT_PROJECT_CONTRIBUTION)
  })
})

describe('barrel export chain', () => {
  it('from index 可访问关键 symbol', async () => {
    const mod = (await import('./index.js')) as Record<string, unknown>
    expect(mod.STRATEGY_EXECUTION_COCKPIT_METRIC_VERSION).toBe(
      STRATEGY_EXECUTION_COCKPIT_METRIC_VERSION,
    )
    expect(typeof mod.normalizeCockpitQuery).toBe('function')
    expect(typeof mod.projectExplicitCockpitMappings).toBe('function')
    expect(typeof mod.buildCockpitNormalFixture).toBe('function')
    // 全量 barrel 冷导入在 turbo 并行跑全仓测试时可能超过 20 秒，与同包其他 barrel 用例对齐放宽
  }, 60_000)
})
