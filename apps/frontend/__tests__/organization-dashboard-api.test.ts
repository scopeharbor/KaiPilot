import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ORGANIZATION_DASHBOARD_NORMAL_FIXTURE,
  ORGANIZATION_DASHBOARD_RESTRICTED_FIXTURE,
} from '@aiproj/types'
import {
  fetchOrganizationDashboard,
  organizationDashboardKeys,
} from '@/lib/api/organization-dashboard'
import {
  ORGANIZATION_METRIC_LABELS,
  formatOrganizationMetricValue,
  formatOrganizationWarning,
  formatRelativeTime,
  isEmptyOrganizationDashboard,
  isMetricRedacted,
  selectKpiStrip,
  staleSources,
} from '@/lib/organization-dashboard-ui'

const apiFetchEnvelope = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({ apiFetchEnvelope }))

beforeEach(() => {
  apiFetchEnvelope.mockReset()
  apiFetchEnvelope.mockResolvedValue({ data: ORGANIZATION_DASHBOARD_NORMAL_FIXTURE })
})

describe('组织 Dashboard API client', () => {
  it('请求路径带组织 ID 且默认无查询串', async () => {
    await fetchOrganizationDashboard(7)
    expect(apiFetchEnvelope).toHaveBeenCalledWith('/organizations/7/dashboard')
  })

  it('查询参数序列化为白名单键，sections 用逗号分隔', async () => {
    await fetchOrganizationDashboard(7, {
      sections: ['kpi', 'activity'],
      attentionLimit: 5,
      activityLimit: 10,
      attentionSort: 'attention_score',
      attentionOrder: 'desc',
      filterStatus: 'active',
      filterHealth: 'at_risk',
      search: '平台',
    })
    const path = String(apiFetchEnvelope.mock.calls[0]?.[0])
    expect(path.startsWith('/organizations/7/dashboard?')).toBe(true)
    const params = new URLSearchParams(path.split('?')[1])
    expect(params.get('sections')).toBe('kpi,activity')
    expect(params.get('attentionLimit')).toBe('5')
    expect(params.get('filterStatus')).toBe('active')
    expect(params.get('search')).toBe('平台')
  })

  it('解包 envelope 的 data 字段', async () => {
    const result = await fetchOrganizationDashboard(7)
    expect(result.meta.metricVersion).toBe('organization-dashboard.v1')
  })

  it('query key 随组织与查询变化，保证缓存不串组织', () => {
    const a = organizationDashboardKeys.summary(1)
    const b = organizationDashboardKeys.summary(2)
    expect(a).not.toEqual(b)
    expect(organizationDashboardKeys.summary(1, { sections: ['kpi'] })).not.toEqual(a)
    expect(organizationDashboardKeys.summary(null)).toContain('none')
  })
})

describe('组织 Dashboard 展示层辅助', () => {
  it('null 指标显示 --，百分比带单位', () => {
    expect(
      formatOrganizationMetricValue({
        key: 'org_total_projects',
        value: null,
        unit: 'count',
        source: 'project',
        status: 'forbidden',
      } as never),
    ).toBe('--')
    expect(
      formatOrganizationMetricValue({
        key: 'org_overall_progress_avg',
        value: 58,
        unit: 'percent',
        source: 'project',
        status: 'ok',
      } as never),
    ).toBe('58%')
  })

  it('脱敏指标被正确识别', () => {
    const redacted = ORGANIZATION_DASHBOARD_RESTRICTED_FIXTURE.kpis.find(
      (metric) => metric.status === 'forbidden',
    )
    expect(redacted).toBeTruthy()
    expect(isMetricRedacted(redacted!)).toBe(true)
  })

  it('warning 文案有中文映射', () => {
    expect(
      formatOrganizationWarning({
        code: 'PMO_SUMMARY_UNAVAILABLE',
        message: 'raw',
      } as never),
    ).toBe('PMO 摘要暂不可用')
  })

  it('KPI 条按固定顺序挑选且跳过缺失 key', () => {
    const strip = selectKpiStrip(ORGANIZATION_DASHBOARD_NORMAL_FIXTURE)
    expect(strip.map((metric) => metric.key)).toEqual([
      'org_total_projects',
      'org_active_projects',
      'org_attention_projects',
      'org_overall_progress_avg',
    ])
    expect(selectKpiStrip(undefined)).toEqual([])
  })

  it('stale 来源可被筛出，空组织可被识别', () => {
    expect(staleSources(ORGANIZATION_DASHBOARD_NORMAL_FIXTURE).length).toBeGreaterThan(0)
    expect(isEmptyOrganizationDashboard(ORGANIZATION_DASHBOARD_NORMAL_FIXTURE)).toBe(false)
    expect(isEmptyOrganizationDashboard(undefined)).toBe(false)
  })

  it('相对时间按中文分级，null 回落到未知', () => {
    const now = Date.parse('2026-07-28T12:00:00.000Z')
    expect(formatRelativeTime(null, now)).toBe('未知')
    expect(formatRelativeTime('2026-07-28T11:59:40.000Z', now)).toBe('刚刚')
    expect(formatRelativeTime('2026-07-28T11:30:00.000Z', now)).toBe('30 分钟前')
    expect(formatRelativeTime('2026-07-28T09:00:00.000Z', now)).toBe('3 小时前')
    expect(formatRelativeTime('2026-07-25T12:00:00.000Z', now)).toBe('3 天前')
  })

  it('所有指标 key 都有中文标签', () => {
    for (const metric of ORGANIZATION_DASHBOARD_NORMAL_FIXTURE.kpis) {
      expect(ORGANIZATION_METRIC_LABELS[metric.key]).toBeTruthy()
    }
  })
})
