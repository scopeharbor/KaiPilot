import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CockpitQuery } from '@aiproj/types'
import {
  fetchStrategyExecutionCockpit,
  parseCockpitUrlFilters,
  serializeCockpitUrlFilters,
  strategyExecutionCockpitKeys,
} from '@/lib/api/strategy-execution-cockpit'

const apiFetchEnvelope = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({ apiFetchEnvelope }))

beforeEach(() => {
  apiFetchEnvelope.mockReset()
  apiFetchEnvelope.mockResolvedValue({
    data: { meta: { metricVersion: 'strategy-execution-cockpit.v1.0.0' } },
  })
})

describe('战略执行驾驶舱 API client', () => {
  it('请求路径带组织 ID 且默认无查询串', async () => {
    await fetchStrategyExecutionCockpit(7)
    expect(apiFetchEnvelope).toHaveBeenCalledWith('/organizations/7/strategy-execution-cockpit')
  })

  it('查询参数序列化为白名单键，数组用逗号分隔', async () => {
    await fetchStrategyExecutionCockpit(7, {
      cycleId: 3,
      include: ['objective_matrix', 'attention'],
      scope: ['team', 'project'],
      attentionLimit: 5,
      sort: 'risk',
      order: 'desc',
    })
    const path = String(apiFetchEnvelope.mock.calls[0]?.[0])
    expect(path.startsWith('/organizations/7/strategy-execution-cockpit?')).toBe(true)
    const params = new URLSearchParams(path.split('?')[1])
    expect(params.get('cycleId')).toBe('3')
    expect(params.get('include')).toBe('objective_matrix,attention')
    expect(params.get('scope')).toBe('team,project')
    expect(params.get('attentionLimit')).toBe('5')
    expect(params.get('sort')).toBe('risk')
  })

  it('parseCockpitUrlFilters 能解析合法参数并回退非法值', () => {
    const parsed = parseCockpitUrlFilters({
      cycleId: '3',
      include: 'objective_matrix,attention',
      scope: 'team,project',
      status: 'active,broken',
      attentionLimit: '10',
      sort: 'risk',
      order: 'desc',
    })
    expect(parsed.cycleId).toBe(3)
    expect(parsed.include).toEqual(['objective_matrix', 'attention'])
    expect(parsed.scope).toEqual(['team', 'project'])
    expect(parsed.attentionLimit).toBe(10)
    expect(parsed.sort).toBe('risk')
    expect(parsed.order).toBe('desc')
  })

  it('serialize → parse round-trip 保持有界筛选', () => {
    const original: CockpitQuery = {
      cycleId: 3,
      scope: ['team'],
      include: ['attention'],
      attentionLimit: 10,
      sort: 'risk',
      order: 'desc',
    }
    const qs = serializeCockpitUrlFilters(original)
    const params = new URLSearchParams(qs.replace(/^\?/, ''))
    const parsed = parseCockpitUrlFilters(Object.fromEntries(params.entries()))
    expect(parsed).toEqual(original)
  })

  it('query key 随组织与查询变化，保证缓存不串组织', () => {
    const a = strategyExecutionCockpitKeys.summary(1)
    const b = strategyExecutionCockpitKeys.summary(2)
    expect(a).not.toEqual(b)
    expect(strategyExecutionCockpitKeys.summary(1, { cycleId: 3 })).not.toEqual(a)
    expect(strategyExecutionCockpitKeys.summary(null)).toContain('none')
  })
})
