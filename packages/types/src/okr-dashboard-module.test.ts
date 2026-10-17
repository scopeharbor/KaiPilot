// v3-okr-dashboard §4.6：组织 Dashboard OKR 摘要模块渲染 adapter 测试。
//
// 覆盖：
//   - 有 summary → 正常 status/kpis/attention/warningCodes 投影
//   - 无 summary + canView=false → forbidden 状态，emptyStateKey 生效
//   - 无 summary + canView=true → unavailable 状态
//   - stale warning → status=stale
//   - 空组织 → status=empty
//   - kpi 白名单：仅返回 OKR_DASHBOARD_MODULE_KPI_KEYS 中的指标
//   - attention limit → 只取前 N
//   - 布局不同尺寸下同一 summary 指标语义不变（限制只体现在 attention 数量）
//   - render props 不含任何敏感字符（prompt/token/authorization/evidence 明文）

import { describe, expect, it } from 'vitest'
import {
  buildOkrDashboardModuleRenderProps,
  computeOkrDashboardSummary,
  OKR_DASHBOARD_METRIC_KEYS,
  OKR_DASHBOARD_METRIC_VERSION,
  OKR_DASHBOARD_MODULE_KPI_KEYS,
  OKR_DASHBOARD_STATUSES,
  OKR_DASHBOARD_WARNING_CODES,
  OKR_METRIC_VERSION,
  type OkrDashboardSummary,
} from './okr-dashboard.js'

function makeSummary(
  overrides: {
    visibleObjectiveCount?: number
    visibleKeyResultCount?: number
    addStaleWarning?: boolean
    organizationId?: number
  } = {},
): OkrDashboardSummary {
  const now = new Date('2026-07-30T00:00:00Z').getTime()
  const summary = computeOkrDashboardSummary({
    organizationId: overrides.organizationId ?? 42,
    actorId: 7,
    now,
    cycle: {
      cycleId: 100,
      title: '2026 Q3',
      status: 'active',
      startDate: '2026-07-01',
      endDate: '2026-09-30',
    },
    objectives:
      (overrides.visibleObjectiveCount ?? 1) > 0
        ? [
            {
              id: 1,
              organizationId: overrides.organizationId ?? 42,
              cycleId: 100,
              projectId: null,
              teamId: null,
              ownerId: 7,
              scope: 'organization',
              title: 'Objective',
              description: null,
              status: 'active',
              weight: 1,
              progress: 30,
              confidence: 'medium',
              startDate: '2026-07-01',
              endDate: '2026-09-30',
              metricVersion: OKR_METRIC_VERSION,
              calculatedAt: null,
              createdAt: '2026-07-01T00:00:00Z',
              updatedAt: '2026-07-01T00:00:00Z',
              deletedAt: null,
            },
          ]
        : [],
    keyResults: [],
    alignments: [],
    evidence: [],
    progressHistory: [],
    normalizedQuery: {} as any,
  })
  if (overrides.addStaleWarning) {
    summary.warnings.push({
      code: OKR_DASHBOARD_WARNING_CODES.SOURCE_STALE,
      message: 'stale',
    })
  }
  return summary
}

describe('buildOkrDashboardModuleRenderProps —— 常规', () => {
  it('有 summary 且有 objective → status=ok 且 metricVersion 与 summary 一致', () => {
    const summary = makeSummary()
    const props = buildOkrDashboardModuleRenderProps({
      summary,
      actorCanView: true,
      moduleEmptyStateKey: 'OKR 数据暂不可用',
    })
    expect(props.status).toBe(OKR_DASHBOARD_STATUSES.OK)
    expect(props.reasonCode).toBe('ok')
    expect(props.metricVersion).toBe(OKR_DASHBOARD_METRIC_VERSION)
    expect(props.cycleTitle).toBe('2026 Q3')
    expect(props.cycleStatus).toBe('active')
    expect(props.navigationTarget).toEqual({ type: 'okr_dashboard', organizationId: 42 })
  })

  it('kpis 只包含 OKR_DASHBOARD_MODULE_KPI_KEYS 白名单', () => {
    const summary = makeSummary()
    const props = buildOkrDashboardModuleRenderProps({
      summary,
      actorCanView: true,
      moduleEmptyStateKey: 'OKR 数据暂不可用',
    })
    for (const k of props.kpis) {
      expect(OKR_DASHBOARD_MODULE_KPI_KEYS).toContain(k.key)
    }
  })

  it('attention limit 生效', () => {
    const summary = makeSummary()
    // 塞 5 条 attention
    summary.attention = Array.from({ length: 5 }, (_, i) => ({
      key: `k-${i}`,
      objectiveId: 1,
      objectiveTitle: `目标 ${i}`,
      keyResultId: null,
      keyResultTitle: null,
      severity: 'medium' as const,
      reasonCodes: [],
      lastActivityAt: null,
      restricted: false,
      target: { type: 'okr_objective', id: 1 },
    }))
    const props = buildOkrDashboardModuleRenderProps({
      summary,
      actorCanView: true,
      moduleEmptyStateKey: 'OKR 数据暂不可用',
      attentionLimit: 2,
    })
    expect(props.attentionTop).toHaveLength(2)
  })

  it('attentionLimit 默认为 3、下限 1、上限 10', () => {
    const summary = makeSummary()
    summary.attention = Array.from({ length: 20 }, (_, i) => ({
      key: `k-${i}`,
      objectiveId: 1,
      objectiveTitle: `目标 ${i}`,
      keyResultId: null,
      keyResultTitle: null,
      severity: 'medium' as const,
      reasonCodes: [],
      lastActivityAt: null,
      restricted: false,
      target: { type: 'okr_objective', id: 1 },
    }))
    expect(
      buildOkrDashboardModuleRenderProps({
        summary,
        actorCanView: true,
        moduleEmptyStateKey: 'x',
      }).attentionTop,
    ).toHaveLength(3)
    expect(
      buildOkrDashboardModuleRenderProps({
        summary,
        actorCanView: true,
        moduleEmptyStateKey: 'x',
        attentionLimit: 99,
      }).attentionTop,
    ).toHaveLength(10)
    expect(
      buildOkrDashboardModuleRenderProps({
        summary,
        actorCanView: true,
        moduleEmptyStateKey: 'x',
        attentionLimit: 0,
      }).attentionTop,
    ).toHaveLength(1)
  })
})

describe('buildOkrDashboardModuleRenderProps —— 状态分支', () => {
  it('无 summary + actorCanView=false → forbidden', () => {
    const props = buildOkrDashboardModuleRenderProps({
      summary: null,
      actorCanView: false,
      moduleEmptyStateKey: 'OKR 数据暂不可用',
    })
    expect(props.reasonCode).toBe('forbidden')
    expect(props.emptyStateKey).toBe('OKR 数据暂不可用')
    expect(props.kpis).toEqual([])
  })

  it('无 summary + actorCanView=true → unavailable', () => {
    const props = buildOkrDashboardModuleRenderProps({
      summary: null,
      actorCanView: true,
      moduleEmptyStateKey: 'OKR 数据暂不可用',
    })
    expect(props.reasonCode).toBe('unavailable')
    expect(props.status).toBe(OKR_DASHBOARD_STATUSES.UNAVAILABLE)
  })

  it('空组织 → status=empty', () => {
    const summary = makeSummary({ visibleObjectiveCount: 0 })
    const props = buildOkrDashboardModuleRenderProps({
      summary,
      actorCanView: true,
      moduleEmptyStateKey: 'OKR 数据暂不可用',
    })
    expect(props.status).toBe(OKR_DASHBOARD_STATUSES.EMPTY)
    expect(props.reasonCode).toBe('empty')
  })

  it('summary 包含 SOURCE_STALE warning → status=stale', () => {
    const summary = makeSummary({ addStaleWarning: true })
    const props = buildOkrDashboardModuleRenderProps({
      summary,
      actorCanView: true,
      moduleEmptyStateKey: 'OKR 数据暂不可用',
    })
    expect(props.status).toBe(OKR_DASHBOARD_STATUSES.STALE)
    expect(props.reasonCode).toBe('stale')
  })
})

describe('buildOkrDashboardModuleRenderProps —— 语义与安全', () => {
  it('render props 序列化后不含 prompt / token / authorization / bearer / apikey 等敏感字符', () => {
    const summary = makeSummary()
    const props = buildOkrDashboardModuleRenderProps({
      summary,
      actorCanView: true,
      moduleEmptyStateKey: 'OKR 数据暂不可用',
    })
    const serialized = JSON.stringify(props)
    expect(serialized).not.toMatch(/prompt/i)
    expect(serialized).not.toMatch(/bearer/i)
    expect(serialized).not.toMatch(/authorization/i)
    expect(serialized).not.toMatch(/apikey/i)
    // token 是很常见词，但这里所有字段都不该出现它
    expect(serialized).not.toMatch(/token/i)
  })

  it('不同 attention 尺寸不会改变 kpis 语义（组织 Dashboard 指标语义稳定）', () => {
    const summary = makeSummary()
    const small = buildOkrDashboardModuleRenderProps({
      summary,
      actorCanView: true,
      moduleEmptyStateKey: 'x',
      attentionLimit: 1,
    })
    const large = buildOkrDashboardModuleRenderProps({
      summary,
      actorCanView: true,
      moduleEmptyStateKey: 'x',
      attentionLimit: 10,
    })
    expect(small.kpis).toEqual(large.kpis)
    expect(small.cycleTitle).toEqual(large.cycleTitle)
  })

  it('warningCodes 直接映射 summary.warnings', () => {
    const summary = makeSummary({ addStaleWarning: true })
    const props = buildOkrDashboardModuleRenderProps({
      summary,
      actorCanView: true,
      moduleEmptyStateKey: 'x',
    })
    expect(props.warningCodes).toContain(OKR_DASHBOARD_WARNING_CODES.SOURCE_STALE)
  })

  it('navigationTarget 只声明 type + organizationId，不含跨组织 id', () => {
    const summary = makeSummary({ organizationId: 999 })
    const props = buildOkrDashboardModuleRenderProps({
      summary,
      actorCanView: true,
      moduleEmptyStateKey: 'x',
    })
    expect(props.navigationTarget.organizationId).toBe(999)
    expect(Object.keys(props.navigationTarget).sort()).toEqual(['organizationId', 'type'].sort())
  })

  it('OKR_DASHBOARD_MODULE_KPI_KEYS 仍在 OKR_DASHBOARD_METRIC_KEYS 白名单内', () => {
    const all = Object.values(OKR_DASHBOARD_METRIC_KEYS)
    for (const key of OKR_DASHBOARD_MODULE_KPI_KEYS) {
      expect(all).toContain(key)
    }
  })
})
