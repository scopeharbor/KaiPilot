// PMO Portfolio Dashboard 前端 API client 测试（v3-pmo-portfolio-dashboard §5.2 + §5.6）。
import { describe, test, expect } from 'vitest'
import { portfolioDashboardKeys } from '@/lib/api/portfolio-dashboard'

describe('portfolioDashboardKeys', () => {
  test('all 键稳定', () => {
    expect(portfolioDashboardKeys.all).toEqual(['pmo', 'portfolio-dashboard'])
  })

  test('summary 键结构', () => {
    expect(portfolioDashboardKeys.summary()).toEqual(['pmo', 'portfolio-dashboard', 'summary'])
  })

  test('projects 键含查询', () => {
    const q = { page: 1, perPage: 20, sort: 'name' as const, order: 'asc' as const }
    expect(portfolioDashboardKeys.projects(q)).toEqual([
      'pmo',
      'portfolio-dashboard',
      'projects',
      q,
    ])
  })

  test('groups 键含查询', () => {
    const q = { groupBy: 'status' as const, page: 1, perPage: 20 }
    expect(portfolioDashboardKeys.groups(q)).toEqual(['pmo', 'portfolio-dashboard', 'groups', q])
  })

  test('trends 键含查询', () => {
    const q = { window: 'last_30_days' as const, page: 1, perPage: 20 }
    expect(portfolioDashboardKeys.trends(q)).toEqual(['pmo', 'portfolio-dashboard', 'trends', q])
  })

  test('metricDetail 键含查询', () => {
    const q = { metricKey: 'total_projects' as const }
    expect(portfolioDashboardKeys.metricDetail(q)).toEqual([
      'pmo',
      'portfolio-dashboard',
      'metric-detail',
      q,
    ])
  })

  test('键不可变性——不同查询产生不同 key', () => {
    const q1 = { page: 1 }
    const q2 = { page: 2 }
    const k1 = portfolioDashboardKeys.projects(q1)
    const k2 = portfolioDashboardKeys.projects(q2)
    expect(k1).toEqual(['pmo', 'portfolio-dashboard', 'projects', { page: 1 }])
    expect(k2).toEqual(['pmo', 'portfolio-dashboard', 'projects', { page: 2 }])
    expect(k1).not.toEqual(k2)
  })
})
