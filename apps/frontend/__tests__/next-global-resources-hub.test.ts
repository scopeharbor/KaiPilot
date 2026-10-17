/**
 * v3-ui-next-org-portfolio-domains W7 · tasks 7.7 —— 全局资源 Hub 纯函数适配器单测。
 *
 * 覆盖（spec「全局资源入口」+ design Decision 7）：
 * - 超载判定阈值边界（100 不超载 / 100.5 超载 / 非数值安全）；
 * - 团队负荷聚合（memberCount / overloadedCount / 平均利用率：teamAverage 优先、
 *   行均值兜底、空行 null）；
 * - 类型分布（计数 / 占比 / 中文标签 / 未知类型兜底 / 空底册）；
 * - 超载成员 top 列表降序与格式化边界（null/NaN/一位小数）。
 */
import { describe, expect, test } from 'vitest'
import {
  buildProjectLoadSummary,
  buildResourceTypeDistribution,
  countActiveResources,
  countOverloadedMembers,
  formatUtilizationPercent,
  globalResourceTypeLabel,
  isUtilizationOverloaded,
  listOverloadedMembers,
  memberInitials,
} from '@/lib/next/org-resources-global/global-resources-adapter'
import type { Resource, ResourceLoadItem } from '@/lib/api/resources'

// ---------------------------------------------------------------------------

function makeLoadRow(
  resourceId: number,
  resourceName: string,
  overallUtilizationPercent: number,
): ResourceLoadItem {
  return {
    resourceId,
    resourceName,
    role: 'member',
    dailyCapacityHours: 8,
    days: [],
    overallUtilizationPercent,
  }
}

function makeResource(
  overrides: Partial<Resource> & { id: number; resourceType: Resource['resourceType'] },
): Resource {
  return {
    projectId: 42,
    userId: null,
    name: `资源 ${overrides.id}`,
    email: null,
    role: 'member',
    status: 'active',
    dailyCapacityHours: 8,
    skillTags: null,
    workDays: '1,2,3,4,5',
    timezone: 'Asia/Shanghai',
    costPerUnitCents: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

describe('超载判定阈值（>100% 严格边界）', () => {
  test('100 不超载、100.5 超载、非数值安全兜底', () => {
    expect(isUtilizationOverloaded(100)).toBe(false)
    expect(isUtilizationOverloaded(99.99)).toBe(false)
    expect(isUtilizationOverloaded(100.5)).toBe(true)
    expect(isUtilizationOverloaded(180)).toBe(true)
    expect(isUtilizationOverloaded(Number.NaN)).toBe(false)
    expect(isUtilizationOverloaded(Number.POSITIVE_INFINITY)).toBe(false)
  })

  test('行级聚合：countOverloadedMembers 只统计 >100', () => {
    const rows = [makeLoadRow(1, '甲', 80), makeLoadRow(2, '乙', 100), makeLoadRow(3, '丙', 115)]
    expect(countOverloadedMembers(rows)).toBe(1)
    expect(countOverloadedMembers([])).toBe(0)
  })
})

describe('团队负荷聚合模型', () => {
  test('teamAverage 优先；行均值兜底；空行返回 null', () => {
    const rows = [makeLoadRow(1, '甲', 80), makeLoadRow(2, '乙', 120)]
    const fromTeam = buildProjectLoadSummary(rows, 92.456)
    expect(fromTeam.memberCount).toBe(2)
    expect(fromTeam.overloadedCount).toBe(1)
    expect(fromTeam.averageUtilizationPercent).toBe(92.5)

    const fromRows = buildProjectLoadSummary(rows, null)
    expect(fromRows.averageUtilizationPercent).toBe(100)

    const empty = buildProjectLoadSummary([])
    expect(empty).toEqual({ memberCount: 0, overloadedCount: 0, averageUtilizationPercent: null })
  })

  test('含非法利用率行不污染均值', () => {
    const rows = [makeLoadRow(1, '甲', 80), makeLoadRow(2, '乙', Number.NaN)]
    expect(buildProjectLoadSummary(rows).averageUtilizationPercent).toBe(80)
  })
})

describe('资源类型分布', () => {
  const resources = [
    makeResource({ id: 1, resourceType: 'human' }),
    makeResource({ id: 2, resourceType: 'human' }),
    makeResource({ id: 3, resourceType: 'equipment', status: 'inactive' }),
    makeResource({ id: 4, resourceType: 'budget' }),
  ]

  test('计数与占比（分母含停用底册行）', () => {
    const distribution = buildResourceTypeDistribution(resources)
    const human = distribution.find((item) => item.type === 'human')
    expect(human).toMatchObject({ label: '人员', count: 2, percentOfTotal: 50 })
    expect(distribution.find((item) => item.type === 'budget')?.percentOfTotal).toBe(25)
  })

  test('中文标签映射与未知兜底；空底册返回空数组', () => {
    expect(globalResourceTypeLabel('human')).toBe('人员')
    expect(globalResourceTypeLabel('material')).toBe('物料')
    expect(globalResourceTypeLabel('equipment')).toBe('设备')
    expect(globalResourceTypeLabel('budget')).toBe('预算')
    expect(globalResourceTypeLabel('unknown_type')).toBe('unknown_type')
    expect(globalResourceTypeLabel(null)).toBe('—')
    expect(buildResourceTypeDistribution([])).toEqual([])
  })

  test('活跃资源计数', () => {
    expect(countActiveResources(resources)).toBe(3)
    expect(countActiveResources([])).toBe(0)
  })
})

describe('超载成员 top 列表与展示格式化', () => {
  test('按利用率降序输出，仅含 >100 成员', () => {
    const rows = [makeLoadRow(1, '甲', 130), makeLoadRow(2, '乙', 100), makeLoadRow(3, '丙', 145)]
    const top = listOverloadedMembers(rows)
    expect(top.map((item) => item.resourceId)).toEqual([3, 1])
    expect(top[0]).toEqual({ resourceId: 3, resourceName: '丙', utilizationPercent: 145 })
  })

  test('利用率格式化：一位小数；非法/空值 → —', () => {
    expect(formatUtilizationPercent(92.456)).toBe('92.5%')
    expect(formatUtilizationPercent(100)).toBe('100%')
    expect(formatUtilizationPercent(null)).toBe('—')
    expect(formatUtilizationPercent(undefined)).toBe('—')
    expect(formatUtilizationPercent(Number.NaN)).toBe('—')
  })

  test('姓名缩写：首字符大写；空名 → ?', () => {
    expect(memberInitials('zhang san')).toBe('Z')
    expect(memberInitials(' 张工 ')).toBe('张')
    expect(memberInitials('')).toBe('?')
    expect(memberInitials(null)).toBe('?')
  })
})
