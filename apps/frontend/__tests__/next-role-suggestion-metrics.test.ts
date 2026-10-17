/**
 * 角色首页建议卡真实数据派生测试（role-suggestion-metrics + use-role-suggestion-items）。
 *
 * 覆盖：
 * - 五桶 × 3 卡的 id/标题/描述沿用 ROLE_HOME_CONFIGS（IA 不变）；
 * - metricLabel 不再出现「待接入」；
 * - admin/pm/observer 桶从组织 Dashboard KPI/成员概览派生真实指标；
 * - member 桶从我的任务聚合（今日到期/进行中/阻塞）派生；
 * - 加载中「…」、错误「暂缺」、0 值如实显示；
 * - unknown 桶为静态真实提示（Ctrl+M 等），零查询语义。
 */
import { describe, expect, it } from 'vitest'
import type { OrganizationDashboardSummary } from '@aiproj/types'
import {
  buildRoleSuggestionCards,
  metricText,
  type RoleSuggestionSourceData,
} from '@/lib/next/role-suggestion-metrics'
import { aggregateMyTasks } from '@/hooks/use-role-suggestion-items'
import { ROLE_HOME_CONFIGS } from '@/lib/next/role-bucket'

function summaryFixture(): OrganizationDashboardSummary {
  return {
    kpis: [
      {
        key: 'org_total_projects',
        value: 12,
        unit: 'count',
        source: 'organization',
        status: 'available',
      },
      {
        key: 'org_attention_projects',
        value: 3,
        unit: 'count',
        source: 'organization',
        status: 'available',
      },
      {
        key: 'org_overdue_projects',
        value: 2,
        unit: 'count',
        source: 'organization',
        status: 'available',
      },
      {
        key: 'org_due_soon_projects',
        value: 4,
        unit: 'count',
        source: 'organization',
        status: 'available',
      },
      {
        key: 'org_high_risk_count',
        value: 5,
        unit: 'count',
        source: 'organization',
        status: 'available',
      },
      {
        key: 'org_open_risk_count',
        value: 9,
        unit: 'count',
        source: 'organization',
        status: 'available',
      },
      {
        key: 'org_recent_activity_count',
        value: 27,
        unit: 'count',
        source: 'organization',
        status: 'available',
      },
      {
        key: 'org_overall_progress_avg',
        value: 46,
        unit: 'percent',
        source: 'organization',
        status: 'available',
      },
    ],
    memberOverview: {
      available: true,
      forbidden: false,
      totalMembers: 18,
      activeMembers: 15,
      roleDistribution: [
        { key: 'project_manager', count: 3 },
        { key: 'member', count: 12 },
      ],
      target: null,
      warnings: [],
    },
  } as unknown as OrganizationDashboardSummary
}

const READY: Pick<RoleSuggestionSourceData, 'loading' | 'error'> = { loading: false, error: false }

describe('buildRoleSuggestionCards：五桶 IA 与真实指标', () => {
  it('每桶恰 3 卡，id/标题/描述沿用 ROLE_HOME_CONFIGS，且无「待接入」字样', () => {
    for (const bucket of ['admin', 'pm', 'member', 'observer', 'unknown'] as const) {
      const cards = buildRoleSuggestionCards(bucket, {
        summary: summaryFixture(),
        auditWeeklyTotal: 34,
        myTasks: { dueToday: 2, inProgress: 5, blocked: 1 },
        ...READY,
      })
      expect(cards).toHaveLength(3)
      const slots = ROLE_HOME_CONFIGS[bucket].suggestionSlots
      cards.forEach((card, index) => {
        expect(card.id).toBe(slots[index]!.id)
        expect(card.title).toBe(slots[index]!.title)
        expect(card.desc).toBe(slots[index]!.desc)
        expect(card.metricLabel).not.toContain('待接入')
      })
    }
  })

  it('admin 桶：租户资源/权限矩阵/审计概览真实派生', () => {
    const cards = buildRoleSuggestionCards('admin', {
      summary: summaryFixture(),
      auditWeeklyTotal: 34,
      ...READY,
    })
    expect(cards[0]!.metricLabel).toBe('12 项目 · 15 活跃成员')
    expect(cards[1]!.metricLabel).toBe('2 类角色 · 15 人在册')
    expect(cards[2]!.metricLabel).toBe('34 事件 / 7 日')
  })

  it('pm 桶：健康巡检/关键路径风险/排程偏离真实派生', () => {
    const cards = buildRoleSuggestionCards('pm', { summary: summaryFixture(), ...READY })
    expect(cards[0]!.metricLabel).toBe('关注 3 · 逾期 2')
    expect(cards[1]!.metricLabel).toBe('高危 5 · 开放 9')
    expect(cards[2]!.metricLabel).toBe('逾期 2 · 将到期 4')
  })

  it('member 桶：今日聚焦/协作焦点/前置阻塞来自我的任务聚合', () => {
    const cards = buildRoleSuggestionCards('member', {
      myTasks: { dueToday: 2, inProgress: 5, blocked: 1 },
      ...READY,
    })
    expect(cards[0]!.metricLabel).toBe('2 项今日到期')
    expect(cards[1]!.metricLabel).toBe('5 项进行中')
    expect(cards[2]!.metricLabel).toBe('1 项阻塞')
  })

  it('observer 桶：报表概览/里程碑进度/健康态势真实派生', () => {
    const cards = buildRoleSuggestionCards('observer', { summary: summaryFixture(), ...READY })
    expect(cards[0]!.metricLabel).toBe('27 条近期动态')
    expect(cards[1]!.metricLabel).toBe('46 % 平均进度')
    expect(cards[2]!.metricLabel).toBe('高危 5 · 逾期 2')
  })

  it('unknown 桶：静态真实提示（Ctrl+M / 3 档 / 问 AI）', () => {
    const cards = buildRoleSuggestionCards('unknown', { ...READY })
    expect(cards[0]!.metricLabel).toBe('随时问 AI')
    expect(cards[1]!.metricLabel).toBe('Ctrl+M 呼出')
    expect(cards[2]!.metricLabel).toBe('3 档可调')
  })
})

describe('诚实降级（RL-07/RL-14）', () => {
  it('加载中显示「…」，错误显示「暂缺」，0 值如实显示', () => {
    expect(metricText(5, '项', { loading: true, error: false })).toBe('…')
    expect(metricText(5, '项', { loading: false, error: true })).toBe('暂缺')
    expect(metricText(null, '项', READY)).toBe('暂缺')
    expect(metricText(0, '项', READY)).toBe('0 项')
  })

  it('pm 桶加载中全卡「…」，错误全卡「暂缺」', () => {
    const loading = buildRoleSuggestionCards('pm', { loading: true, error: false })
    loading.forEach((card) => expect(card.metricLabel).toBe('…'))
    const errored = buildRoleSuggestionCards('pm', { loading: false, error: true })
    errored.forEach((card) => expect(card.metricLabel).toBe('暂缺'))
  })
})

describe('aggregateMyTasks：我的任务聚合', () => {
  it('今日到期/进行中/阻塞三计数正确（已完成与取消不计到期）', () => {
    const today = '2026-09-17'
    const result = aggregateMyTasks(
      [
        {
          data: [
            { endDate: '2026-09-17', status: 'in_progress' },
            { endDate: '2026-09-10', status: 'not_started' },
            { endDate: '2026-09-16', status: 'completed' },
            { endDate: null, status: 'blocked' },
            { endDate: '2026-09-30', status: 'in_progress' },
          ],
        },
        undefined,
        { data: [{ endDate: '2026-09-17', status: 'cancelled' }] },
      ],
      today,
    )
    expect(result).toEqual({ dueToday: 2, inProgress: 2, blocked: 1 })
  })
})
