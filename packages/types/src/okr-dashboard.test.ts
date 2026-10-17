import { describe, expect, it } from 'vitest'
import {
  OKR_DASHBOARD_ATTENTION_REASONS,
  OKR_DASHBOARD_ATTENTION_SORT_KEY_VALUES,
  OKR_DASHBOARD_DEFAULT_ATTENTION_LIMIT,
  OKR_DASHBOARD_DEFAULT_STALE_MINUTES,
  OKR_DASHBOARD_INCLUDE_VALUES,
  OKR_DASHBOARD_MAX_ATTENTION_LIMIT,
  OKR_DASHBOARD_MAX_SEARCH_LENGTH,
  OKR_DASHBOARD_MAX_STALE_MINUTES,
  OKR_DASHBOARD_METRIC_KEYS,
  OKR_DASHBOARD_METRIC_KEY_VALUES,
  OKR_DASHBOARD_METRIC_VERSION,
  OKR_DASHBOARD_SECTION_VALUES,
  OKR_DASHBOARD_SOURCES,
  OKR_DASHBOARD_SOURCE_VALUES,
  OKR_DASHBOARD_STATUSES,
  OKR_DASHBOARD_WARNING_CODES,
  OKR_DASHBOARD_WARNING_CODE_VALUES,
  computeOkrDashboardSummary,
  emptyOkrDashboardMetric,
  emptyOkrDashboardWarning,
  isOkrDashboardSourceStale,
  makeOkrDashboardFreshness,
  mergeOkrDashboardWarnings,
  normalizeOkrDashboardQuery,
  okrDashboardBackflowUnavailableWarning,
  okrDashboardFreshnessHash,
  okrDashboardPermissionRedactedWarning,
  okrDashboardRestrictedEvidenceWarning,
  okrDashboardStableHash,
  okrDashboardValidationDetail,
  redactedOkrDashboardMetric,
  type NormalizedOkrDashboardQuery,
  type OkrDashboardSummary,
} from './okr-dashboard.js'
import {
  makeOkrAlignment,
  makeOkrCycle,
  makeOkrEvidenceLink,
  makeOkrKeyResult,
  makeOkrObjective,
  OKR_METRIC_VERSION,
  type OkrAlignment,
  type OkrEvidenceLink,
  type OkrKeyResult,
  type OkrObjective,
} from './okr.js'

const FIXED_NOW = Date.parse('2026-07-30T12:00:00.000Z')

function baseQuery(
  overrides: Partial<NormalizedOkrDashboardQuery> = {},
): NormalizedOkrDashboardQuery {
  return {
    sections: [...OKR_DASHBOARD_SECTION_VALUES],
    includes: [...OKR_DASHBOARD_INCLUDE_VALUES],
    attentionLimit: OKR_DASHBOARD_DEFAULT_ATTENTION_LIMIT,
    attentionSort: 'risk_score',
    attentionOrder: 'desc',
    staleThresholdMinutes: OKR_DASHBOARD_DEFAULT_STALE_MINUTES,
    ...overrides,
  }
}

function baseInput(
  overrides: {
    cycleId?: number | null
    startDate?: string | null
    endDate?: string | null
    objectives?: OkrObjective[]
    keyResults?: OkrKeyResult[]
    alignments?: OkrAlignment[]
    evidence?: OkrEvidenceLink[]
    restrictedObjectiveCount?: number
    restrictedEvidenceCount?: number
    backflow?: Parameters<typeof computeOkrDashboardSummary>[0]['backflow']
  } = {},
) {
  return {
    organizationId: 10,
    actorId: 5,
    now: FIXED_NOW,
    cycle: {
      cycleId: overrides.cycleId ?? 1,
      title: 'Q3 2026',
      status: 'active' as const,
      startDate: overrides.startDate ?? '2026-06-01T00:00:00.000Z',
      endDate: overrides.endDate ?? '2026-09-30T00:00:00.000Z',
    },
    objectives: overrides.objectives ?? [],
    keyResults: overrides.keyResults ?? [],
    alignments: overrides.alignments ?? [],
    evidence: overrides.evidence ?? [],
    progressHistory: [],
    restrictedObjectiveCount: overrides.restrictedObjectiveCount ?? 0,
    restrictedKeyResultCount: 0,
    restrictedEvidenceCount: overrides.restrictedEvidenceCount ?? 0,
    freshness: {
      cycle: '2026-07-30T11:00:00.000Z',
      objective: '2026-07-30T11:00:00.000Z',
      keyResult: '2026-07-30T11:00:00.000Z',
      alignment: '2026-07-30T11:00:00.000Z',
      evidence: '2026-07-30T11:00:00.000Z',
      progressHistory: '2026-07-30T11:00:00.000Z',
    },
    normalizedQuery: baseQuery(),
    backflow: overrides.backflow,
  }
}

describe('OKR Dashboard shared contract — 稳定 key / warning / source 白名单', () => {
  it('metric key 集合稳定且无重复', () => {
    const set = new Set(OKR_DASHBOARD_METRIC_KEY_VALUES)
    expect(set.size).toBe(OKR_DASHBOARD_METRIC_KEY_VALUES.length)
    expect(OKR_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG).toBe('okr_overall_progress_avg')
  })

  it('warning code 集合稳定且无重复', () => {
    const set = new Set(OKR_DASHBOARD_WARNING_CODE_VALUES)
    expect(set.size).toBe(OKR_DASHBOARD_WARNING_CODE_VALUES.length)
    expect(OKR_DASHBOARD_WARNING_CODES.EMPTY_OKR_DASHBOARD).toBe('EMPTY_OKR_DASHBOARD')
    expect(OKR_DASHBOARD_WARNING_CODES.BACKFLOW_SUMMARY_UNAVAILABLE).toBe(
      'BACKFLOW_SUMMARY_UNAVAILABLE',
    )
  })

  it('source 集合稳定且无重复', () => {
    const set = new Set(OKR_DASHBOARD_SOURCE_VALUES)
    expect(set.size).toBe(OKR_DASHBOARD_SOURCE_VALUES.length)
    expect(OKR_DASHBOARD_SOURCES.BACKFLOW).toBe('okr_backflow')
  })

  it('metric version 派生自 OKR_METRIC_VERSION', () => {
    expect(OKR_DASHBOARD_METRIC_VERSION).toBe(`okr-dashboard.${OKR_METRIC_VERSION}`)
  })

  it('attention sort key 与 status 集合稳定', () => {
    expect(OKR_DASHBOARD_ATTENTION_SORT_KEY_VALUES).toContain('risk_score')
    expect(OKR_DASHBOARD_STATUSES.FORBIDDEN).toBe('forbidden')
  })
})

describe('normalizeOkrDashboardQuery — 白名单、上下界与截断', () => {
  it('无参时应用默认 section/include/limit', () => {
    const q = normalizeOkrDashboardQuery()
    expect(q.sections).toEqual([...OKR_DASHBOARD_SECTION_VALUES])
    expect(q.includes).toEqual([...OKR_DASHBOARD_INCLUDE_VALUES])
    expect(q.attentionLimit).toBe(OKR_DASHBOARD_DEFAULT_ATTENTION_LIMIT)
    expect(q.staleThresholdMinutes).toBe(OKR_DASHBOARD_DEFAULT_STALE_MINUTES)
  })

  it('clamp attention limit 至 [1, MAX]', () => {
    expect(normalizeOkrDashboardQuery({ attentionLimit: 0 }).attentionLimit).toBe(1)
    expect(normalizeOkrDashboardQuery({ attentionLimit: 9999 }).attentionLimit).toBe(
      OKR_DASHBOARD_MAX_ATTENTION_LIMIT,
    )
  })

  it('clamp stale threshold', () => {
    expect(normalizeOkrDashboardQuery({ staleThresholdMinutes: 0 }).staleThresholdMinutes).toBe(1)
    expect(
      normalizeOkrDashboardQuery({ staleThresholdMinutes: 1_000_000 }).staleThresholdMinutes,
    ).toBe(OKR_DASHBOARD_MAX_STALE_MINUTES)
  })

  it('过滤非法 section / include / scope / status', () => {
    const q = normalizeOkrDashboardQuery({
      sections: ['kpi', 'not_a_real_section' as never],
      include: ['backflow', 'invalid' as never],
      scope: ['team', 'bogus' as never],
      status: ['active', 'bogus' as never],
    })
    expect(q.sections).toEqual(['kpi'])
    expect(q.includes).toEqual(['backflow'])
    expect(q.scopes).toEqual(['team'])
    expect(q.statuses).toEqual(['active'])
  })

  it('截断超长 search', () => {
    const q = normalizeOkrDashboardQuery({
      search: 'x'.repeat(OKR_DASHBOARD_MAX_SEARCH_LENGTH + 100),
    })
    expect(q.search?.length).toBe(OKR_DASHBOARD_MAX_SEARCH_LENGTH)
  })
})

describe('okrDashboardStableHash / freshnessHash', () => {
  it('稳定：相同输入相同哈希', () => {
    expect(okrDashboardStableHash('abc')).toBe(okrDashboardStableHash('abc'))
    expect(okrDashboardStableHash('abc')).not.toBe(okrDashboardStableHash('abd'))
  })

  it('freshness hash 包含 source/lastUpdatedAt/status', () => {
    const f = makeOkrDashboardFreshness({
      source: OKR_DASHBOARD_SOURCES.OBJECTIVE,
      lastUpdatedAt: '2026-07-30T00:00:00.000Z',
      now: FIXED_NOW,
    })
    expect(okrDashboardFreshnessHash(f)).toHaveLength(8)
  })
})

describe('isOkrDashboardSourceStale / makeOkrDashboardFreshness', () => {
  it('null lastUpdatedAt 视为 stale', () => {
    expect(isOkrDashboardSourceStale(null, 60, FIXED_NOW)).toBe(true)
  })

  it('刚更新不为 stale', () => {
    expect(
      isOkrDashboardSourceStale(new Date(FIXED_NOW - 60 * 1000).toISOString(), 60, FIXED_NOW),
    ).toBe(false)
  })

  it('超过阈值为 stale', () => {
    expect(
      isOkrDashboardSourceStale(new Date(FIXED_NOW - 61 * 60 * 1000).toISOString(), 60, FIXED_NOW),
    ).toBe(true)
  })

  it('forbidden 优先于 stale', () => {
    const f = makeOkrDashboardFreshness({
      source: OKR_DASHBOARD_SOURCES.EVIDENCE,
      lastUpdatedAt: null,
      forbidden: true,
      now: FIXED_NOW,
    })
    expect(f.status).toBe(OKR_DASHBOARD_STATUSES.FORBIDDEN)
    expect(f.isStale).toBe(false)
  })

  it('unavailable 覆盖 stale', () => {
    const f = makeOkrDashboardFreshness({
      source: OKR_DASHBOARD_SOURCES.BACKFLOW,
      lastUpdatedAt: null,
      unavailable: true,
      now: FIXED_NOW,
    })
    expect(f.status).toBe(OKR_DASHBOARD_STATUSES.UNAVAILABLE)
  })
})

describe('warning 工厂与合并去重', () => {
  it('empty warning 稳定', () => {
    expect(emptyOkrDashboardWarning().code).toBe('EMPTY_OKR_DASHBOARD')
  })

  it('mergeOkrDashboardWarnings 按 code+source+metricKey 去重', () => {
    const merged = mergeOkrDashboardWarnings(
      [okrDashboardBackflowUnavailableWarning()],
      [okrDashboardBackflowUnavailableWarning()],
      [okrDashboardRestrictedEvidenceWarning()],
    )
    expect(merged).toHaveLength(2)
  })

  it('redacted metric 返回 forbidden 状态 + PERMISSION_REDACTED warning', () => {
    const m = redactedOkrDashboardMetric(
      OKR_DASHBOARD_METRIC_KEYS.TOTAL_OBJECTIVES,
      OKR_DASHBOARD_SOURCES.OBJECTIVE,
    )
    expect(m.status).toBe('forbidden')
    expect(m.value).toBeNull()
    expect(m.warnings?.[0]?.code).toBe('PERMISSION_REDACTED')
  })

  it('empty metric 返回 0 + empty status', () => {
    const m = emptyOkrDashboardMetric(
      OKR_DASHBOARD_METRIC_KEYS.TOTAL_OBJECTIVES,
      OKR_DASHBOARD_SOURCES.OBJECTIVE,
    )
    expect(m.value).toBe(0)
    expect(m.status).toBe('empty')
  })

  it('permission redacted warning 带 source 与 metricKey', () => {
    const w = okrDashboardPermissionRedactedWarning(
      OKR_DASHBOARD_SOURCES.EVIDENCE,
      OKR_DASHBOARD_METRIC_KEYS.STALE_EVIDENCE_COUNT,
    )
    expect(w.source).toBe('okr_evidence')
    expect(w.metricKey).toBe('okr_stale_evidence_count')
  })
})

describe('okrDashboardValidationDetail', () => {
  it('返回所有允许的白名单', () => {
    const d = okrDashboardValidationDetail()
    expect(d.allowedSections).toEqual(OKR_DASHBOARD_SECTION_VALUES)
    expect(d.allowedIncludes).toEqual(OKR_DASHBOARD_INCLUDE_VALUES)
    expect(d.maxAttentionLimit).toBe(OKR_DASHBOARD_MAX_ATTENTION_LIMIT)
  })
})

describe('computeOkrDashboardSummary — 正常与边界场景', () => {
  it('空组织：仅返回 empty warning 与 0 值 KPI', () => {
    const summary = computeOkrDashboardSummary(baseInput())
    expect(summary.warnings.some((w) => w.code === 'EMPTY_OKR_DASHBOARD')).toBe(true)
    expect(summary.warnings.some((w) => w.code === 'BACKFLOW_SUMMARY_UNAVAILABLE')).toBe(true)
    const totalKr = summary.kpis.find((k) => k.key === OKR_DASHBOARD_METRIC_KEYS.TOTAL_KEY_RESULTS)
    expect(totalKr?.status).toBe('empty')
    expect(summary.meta.metricVersion).toBe(OKR_DASHBOARD_METRIC_VERSION)
  })

  it('正常周期：objective/KR 计数正确，attention 按 risk_score 降序', () => {
    const objectives: OkrObjective[] = [
      makeOkrObjective({
        id: 1,
        organizationId: 10,
        status: 'active',
        progress: 20,
        confidence: 'low',
        scope: 'team',
      }),
      makeOkrObjective({
        id: 2,
        organizationId: 10,
        status: 'active',
        progress: 85,
        confidence: 'high',
        scope: 'team',
      }),
      makeOkrObjective({
        id: 3,
        organizationId: 10,
        status: 'completed',
        progress: 100,
        confidence: 'high',
        scope: 'team',
      }),
    ]
    const keyResults: OkrKeyResult[] = [
      makeOkrKeyResult({
        id: 11,
        organizationId: 10,
        objectiveId: 1,
        status: 'active',
        confidence: 'low',
        currentValue: 5,
        baselineValue: 0,
        targetValue: 100,
        lastUpdatedAt: '2026-05-01T00:00:00.000Z',
      }),
      makeOkrKeyResult({
        id: 12,
        organizationId: 10,
        objectiveId: 2,
        status: 'active',
        confidence: 'high',
        currentValue: 90,
        baselineValue: 0,
        targetValue: 100,
        lastUpdatedAt: '2026-07-29T11:00:00.000Z',
      }),
    ]
    const summary = computeOkrDashboardSummary(
      baseInput({
        objectives,
        keyResults,
        evidence: [
          makeOkrEvidenceLink({
            id: 1,
            organizationId: 10,
            targetType: 'key_result',
            targetId: 12,
            lastSeenAt: '2026-07-29T11:00:00.000Z',
          }),
        ],
      }),
    )
    const totalObj = summary.kpis.find((k) => k.key === OKR_DASHBOARD_METRIC_KEYS.TOTAL_OBJECTIVES)
    expect(totalObj?.value).toBe(3)
    const behindKrs = summary.kpis.find(
      (k) => k.key === OKR_DASHBOARD_METRIC_KEYS.BEHIND_KEY_RESULTS,
    )
    expect(behindKrs?.value).toBeGreaterThanOrEqual(1)
    // attention 应含至少一项，按 risk_score desc
    if (summary.attention.length >= 2) {
      expect(summary.attention[0]!.riskScore).toBeGreaterThanOrEqual(
        summary.attention[1]!.riskScore,
      )
    }
  })

  it('受限 KR：restrictedCount 反映在 meta，并附 SOURCE_PARTIAL warning', () => {
    const summary = computeOkrDashboardSummary(baseInput({ restrictedObjectiveCount: 3 }))
    expect(summary.meta.restrictedObjectiveCount).toBe(3)
    expect(summary.warnings.some((w) => w.code === 'SOURCE_PARTIAL')).toBe(true)
  })

  it('软删除 objective/KR 不参与聚合', () => {
    const softDeleted = makeOkrObjective({
      id: 99,
      organizationId: 10,
      status: 'active',
      deletedAt: '2026-07-01T00:00:00.000Z',
    })
    const summary = computeOkrDashboardSummary(baseInput({ objectives: [softDeleted] }))
    const total = summary.kpis.find((k) => k.key === OKR_DASHBOARD_METRIC_KEYS.TOTAL_OBJECTIVES)
    expect(total?.value).toBe(0)
  })

  it('过期证据：staleEvidence 计数正确', () => {
    const evidence: OkrEvidenceLink[] = [
      makeOkrEvidenceLink({
        id: 1,
        organizationId: 10,
        targetType: 'objective',
        targetId: 1,
        lastSeenAt: '2020-01-01T00:00:00.000Z',
      }),
      makeOkrEvidenceLink({
        id: 2,
        organizationId: 10,
        targetType: 'objective',
        targetId: 1,
        lastSeenAt: '2026-07-29T11:00:00.000Z',
      }),
    ]
    const summary = computeOkrDashboardSummary(baseInput({ evidence }))
    expect(summary.evidenceFreshness.staleEvidence).toBe(1)
  })

  it('孤儿 objective：alignment health 记录并告警', () => {
    const objectives: OkrObjective[] = [
      makeOkrObjective({ id: 1, organizationId: 10, scope: 'team', status: 'active' }),
    ]
    const summary = computeOkrDashboardSummary(baseInput({ objectives, alignments: [] }))
    expect(summary.alignmentHealth.orphanObjectiveCount).toBe(1)
    expect(summary.alignmentHealth.warnings.some((w) => w.code === 'ORPHAN_OBJECTIVE')).toBe(true)
  })

  it('attention 超过 limit：ATTENTION_TRUNCATED warning + 截断到 limit', () => {
    const objectives: OkrObjective[] = Array.from({ length: 20 }, (_, i) =>
      makeOkrObjective({
        id: i + 1,
        organizationId: 10,
        status: 'active',
        progress: 0,
        scope: 'team',
      }),
    )
    const alignments: OkrAlignment[] = objectives.slice(1).map((o, i) =>
      makeOkrAlignment({
        id: i + 1,
        organizationId: 10,
        childObjectiveId: o.id,
        parentObjectiveId: 1,
      }),
    )
    const summary = computeOkrDashboardSummary(
      baseInput({
        objectives,
        alignments,
        keyResults: [],
      }),
    )
    expect(summary.attention.length).toBeLessThanOrEqual(OKR_DASHBOARD_DEFAULT_ATTENTION_LIMIT)
    // 20 个 objective 均缺 KR，应超过 limit 触发截断
    expect(summary.warnings.some((w) => w.code === 'ATTENTION_TRUNCATED')).toBe(true)
  })

  it('backflow unavailable：返回 available:false 与 warning', () => {
    const summary = computeOkrDashboardSummary(baseInput({ backflow: { unavailable: true } }))
    expect(summary.backflow.available).toBe(false)
    expect(summary.backflow.warnings.some((w) => w.code === 'BACKFLOW_SUMMARY_UNAVAILABLE')).toBe(
      true,
    )
  })

  it('backflow forbidden：返回 forbidden:true 与 warning', () => {
    const summary = computeOkrDashboardSummary(baseInput({ backflow: { forbidden: true } }))
    expect(summary.backflow.forbidden).toBe(true)
    expect(summary.backflow.warnings.some((w) => w.code === 'BACKFLOW_SUMMARY_FORBIDDEN')).toBe(
      true,
    )
  })

  it('backflow available：KPI 计入 candidate/conflict', () => {
    const summary = computeOkrDashboardSummary(
      baseInput({
        backflow: { available: true, candidateCount: 4, conflictCount: 1, staleCount: 0 },
      }),
    )
    const c = summary.kpis.find((k) => k.key === OKR_DASHBOARD_METRIC_KEYS.BACKFLOW_CANDIDATE_COUNT)
    expect(c?.value).toBe(4)
  })

  it('input signature hash 稳定', () => {
    const s1 = computeOkrDashboardSummary(baseInput())
    const s2 = computeOkrDashboardSummary(baseInput())
    expect(s1.meta.inputSignatureHash).toBe(s2.meta.inputSignatureHash)
  })

  it('cycle 进度计算正确', () => {
    const summary = computeOkrDashboardSummary(baseInput())
    // 2026-06-01 到 2026-09-30，2026-07-30 大约 49% 左右
    expect(summary.cycleContext.elapsedPercent).toBeGreaterThan(30)
    expect(summary.cycleContext.elapsedPercent).toBeLessThan(70)
    expect(summary.cycleContext.daysRemaining).toBeGreaterThan(0)
  })
})

describe('契约 shape 稳定性', () => {
  it('OkrDashboardSummary 一级字段固定', () => {
    const summary: OkrDashboardSummary = computeOkrDashboardSummary(baseInput())
    expect(Object.keys(summary).sort()).toEqual(
      [
        'alignmentHealth',
        'attention',
        'backflow',
        'cycleContext',
        'evidenceFreshness',
        'kpis',
        'meta',
        'progressDistribution',
        'sourceFreshness',
        'statusDistribution',
        'warnings',
      ].sort(),
    )
  })

  it('meta 字段固定', () => {
    const summary = computeOkrDashboardSummary(baseInput())
    expect(Object.keys(summary.meta).sort()).toEqual(
      [
        'actorId',
        'attentionLimit',
        'calculatedAt',
        'cycleId',
        'inputSignatureHash',
        'metricVersion',
        'organizationId',
        'restrictedKeyResultCount',
        'restrictedObjectiveCount',
        'sections',
        'staleThresholdMinutes',
        'visibleKeyResultCount',
        'visibleObjectiveCount',
      ].sort(),
    )
  })
})

// 保护未使用变量以防摇树 dead code 检查
void makeOkrCycle

describe('okr-dashboard fixture builders', () => {
  it('makeOkrDashboardFixtureInput 生成合法默认输入', async () => {
    const { makeOkrDashboardFixtureInput } = await import('./okr-dashboard.js')
    const input = makeOkrDashboardFixtureInput()
    const summary = computeOkrDashboardSummary(input)
    expect(summary.meta.organizationId).toBe(1)
  })

  it('makeOkrDashboardLargeFixtureInput 生成 ≥1000 objective 树', async () => {
    const { makeOkrDashboardLargeFixtureInput } = await import('./okr-dashboard.js')
    const input = makeOkrDashboardLargeFixtureInput({
      objectiveCount: 1000,
      keyResultsPerObjective: 3,
    })
    expect(input.objectives.length).toBe(1000)
    expect(input.keyResults.length).toBe(3000)
  })

  it('makeOkrDashboardRestrictedEvidenceFixtureInput 附带 restricted 计数', async () => {
    const { makeOkrDashboardRestrictedEvidenceFixtureInput } = await import('./okr-dashboard.js')
    const input = makeOkrDashboardRestrictedEvidenceFixtureInput()
    expect(input.restrictedEvidenceCount).toBe(5)
    const summary = computeOkrDashboardSummary(input)
    expect(summary.evidenceFreshness.warnings.some((w) => w.code === 'RESTRICTED_EVIDENCE')).toBe(
      true,
    )
  })

  it('makeOkrDashboardBackflowFixtures 提供三种状态', async () => {
    const { makeOkrDashboardBackflowFixtures } = await import('./okr-dashboard.js')
    const fx = makeOkrDashboardBackflowFixtures()
    expect(computeOkrDashboardSummary(fx.unavailable).backflow.available).toBe(false)
    expect(computeOkrDashboardSummary(fx.available).backflow.available).toBe(true)
    expect(computeOkrDashboardSummary(fx.forbidden).backflow.forbidden).toBe(true)
  })
})

describe('okr-dashboard export chain', () => {
  it('从 index 桶入口可访问关键 symbol', async () => {
    const mod = (await import('./index.js')) as Record<string, unknown>
    expect(mod.OKR_DASHBOARD_METRIC_VERSION).toBe(OKR_DASHBOARD_METRIC_VERSION)
    expect(typeof mod.computeOkrDashboardSummary).toBe('function')
    expect(typeof mod.normalizeOkrDashboardQuery).toBe('function')
    expect(typeof mod.makeOkrDashboardFixtureInput).toBe('function')
  }, 60_000)
})
