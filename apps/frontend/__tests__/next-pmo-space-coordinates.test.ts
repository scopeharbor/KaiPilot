/**
 * v3-ui-next-pmo-domain W9 · tasks 9.2 —— PMO 组合层 8 条空间坐标注册与检索测试
 * （spec「组织级空间坐标注册与 AI 同事全域导航接线」要求 1 / scenario 检索直达）。
 *
 * 覆盖：
 * - 8 条坐标（pmo / pmo-traffic-light / pmo-grouping-views / pmo-priority-scoring /
 *   pmo-ai-priority-recommendations / pmo-decisions / pmo-dependencies /
 *   pmo-impact-analysis）全部注册：available / 已就绪 / 无 :id 占位的全局绝对路径
 *   （/next/pmo 与 /next/pmo/*）/ 图标名在扩展联合类型内且本批互不重复；决策详情
 *   [decisionId] 动态路由不设坐标（列表行内下钻承接）；
 * - 路径无占位符：resolveSpaceCoordinatePath 原样返回（单项目与全域视图均直达）；
 * - 精准检索：「组合」唯一命中组合仪表盘、「红绿灯/交通灯」唯一命中红绿灯报告、
 *   「决策」「依赖」各自唯一命中；「影响分析」为变更请求（六维影响分析）与 PMO
 *   影响分析共享词双命中；「AI」为生成剧场/报表中心/AI 优先级推荐三卡共存；
 * - 既有坐标零漂移回归：输入非相关词不误伤既有坐标。
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import {
  PRESET_SPACE_COORDINATES,
  filterSpaceCoordinates,
  resolveSpaceCoordinatePath,
  type SpaceCoordinate,
} from '@/lib/next/space-coordinates'
import { SpaceMapCard } from '@/components/next/navigation/SpaceMapCard'

const PMO_COORDINATE_IDS = [
  'pmo',
  'pmo-traffic-light',
  'pmo-grouping-views',
  'pmo-priority-scoring',
  'pmo-ai-priority-recommendations',
  'pmo-decisions',
  'pmo-dependencies',
  'pmo-impact-analysis',
] as const

describe('8 条 PMO 组合层坐标注册（tasks 9.1/9.2，spec「坐标点亮」）', () => {
  test('坐标完整注册：available / 已就绪 / 全局绝对路径 / 无 :id 占位', () => {
    for (const id of PMO_COORDINATE_IDS) {
      const coordinate = PRESET_SPACE_COORDINATES.find((c) => c.id === id)
      expect(coordinate, `坐标 ${id} 应已注册`).toBeDefined()
      expect(coordinate!.status).toBe('available')
      expect(coordinate!.badge).toBe('已就绪')
      expect(coordinate!.path.startsWith('/next/pmo')).toBe(true)
      expect(coordinate!.path.includes(':id'), `${id} 不应含 :id 占位`).toBe(false)
      expect(coordinate!.title).toBeTruthy()
      expect(coordinate!.description).toBeTruthy()
      expect(coordinate!.keywords.length).toBeGreaterThan(0)
    }
  })

  test('路径契约：组合仪表盘 /next/pmo + 7 功能页；决策详情动态路由不设坐标', () => {
    const byId = Object.fromEntries(PRESET_SPACE_COORDINATES.map((c) => [c.id, c.path]))
    expect(byId['pmo']).toBe('/next/pmo')
    expect(byId['pmo-traffic-light']).toBe('/next/pmo/traffic-light')
    expect(byId['pmo-grouping-views']).toBe('/next/pmo/grouping-views')
    expect(byId['pmo-priority-scoring']).toBe('/next/pmo/priority-scoring')
    expect(byId['pmo-ai-priority-recommendations']).toBe('/next/pmo/ai-priority-recommendations')
    expect(byId['pmo-decisions']).toBe('/next/pmo/decisions')
    expect(byId['pmo-dependencies']).toBe('/next/pmo/dependencies')
    expect(byId['pmo-impact-analysis']).toBe('/next/pmo/impact-analysis')
    // 8 项坐标 = 组合仪表盘 1 + 功能页 7（决策详情 [decisionId] 无独立坐标）
    expect(PMO_COORDINATE_IDS).toHaveLength(8)
  })

  test('图标名在本批互不重复且均落在 SpaceMapCard 映射内（lucide 渲染成功）', () => {
    const icons = PMO_COORDINATE_IDS.map(
      (id) => PRESET_SPACE_COORDINATES.find((c) => c.id === id)!.iconName,
    )
    expect(new Set(icons).size).toBe(icons.length)
    for (const iconName of icons) {
      expect(iconName).toMatch(/^[A-Z]/)
    }
    // SpaceMapCard 逐个渲染 → svg 存在即证明 iconName ↔ lucide 映射同步
    const onSelect = vi.fn()
    for (const id of PMO_COORDINATE_IDS) {
      const coordinate = PRESET_SPACE_COORDINATES.find((c) => c.id === id)!
      const { unmount } = render(React.createElement(SpaceMapCard, { coordinate, onSelect }))
      const card = screen.getByRole('button', { name: new RegExp(coordinate.title) })
      expect(card).toHaveAttribute('data-space-coordinate', id)
      expect(card.querySelector('svg')).not.toBeNull()
      fireEvent.click(card)
      expect(onSelect).toHaveBeenLastCalledWith(coordinate)
      unmount()
    }
    expect(onSelect).toHaveBeenCalledTimes(PMO_COORDINATE_IDS.length)
  })
})

describe('resolveSpaceCoordinatePath（无占位坐标恒定直达）', () => {
  test('单项目与全域视图均原样返回 PMO 路径，绝不回退首页引导', () => {
    for (const id of PMO_COORDINATE_IDS) {
      const path = PRESET_SPACE_COORDINATES.find((c) => c.id === id)!.path
      expect(resolveSpaceCoordinatePath(path, 42), id).toBe(path)
      expect(resolveSpaceCoordinatePath(path, null), id).toBe(path)
    }
  })
})

describe('PMO 坐标检索（spec「输入关键词即时模糊检索」）', () => {
  test('「组合」命中组合仪表盘（org 资源缺口「组合分析」共享词共存），「组合仪表盘」唯一命中', () => {
    // 「组合」为组合仪表盘与组织资源缺口（按…组合分析）的共享词，
    // 批 4 新增 pmo-reports 标题/关键词含「组合报表」/「组合态势」，三卡共存
    expect(filterSpaceCoordinates('组合').map((c) => c.id)).toEqual([
      'org_resource_gaps',
      'pmo',
      'pmo-reports',
    ])
    expect(filterSpaceCoordinates('组合仪表盘').map((c) => c.id)).toEqual(['pmo'])
  })

  test('「红绿灯」/「交通灯」唯一命中红绿灯报告坐标', () => {
    expect(filterSpaceCoordinates('红绿灯').map((c) => c.id)).toEqual(['pmo-traffic-light'])
    expect(filterSpaceCoordinates('交通灯').map((c) => c.id)).toEqual(['pmo-traffic-light'])
  })

  test('「决策」「依赖」「分组」「评分」「推荐」分别精准归属', () => {
    // 「决策」为变更请求（审批决策描述）、决策工作台、批4 pmo-change-queue（描述含
    // 「受控审批决策」）与 TRIZ 决策中心（收口补齐的真实决策域）→ 四卡共存
    expect(filterSpaceCoordinates('决策').map((c) => c.id)).toEqual([
      'change-requests',
      'triz-decision-center',
      'pmo-decisions',
      'pmo-change-queue',
    ])
    expect(filterSpaceCoordinates('决策工作台').map((c) => c.id)).toEqual(['pmo-decisions'])
    expect(filterSpaceCoordinates('依赖').map((c) => c.id)).toEqual(['pmo-dependencies'])
    expect(filterSpaceCoordinates('分组').map((c) => c.id)).toEqual(['pmo-grouping-views'])
    expect(filterSpaceCoordinates('评分').map((c) => c.id)).toEqual(['pmo-priority-scoring'])
    expect(filterSpaceCoordinates('推荐').map((c) => c.id)).toEqual([
      'pmo-ai-priority-recommendations',
    ])
  })

  test('「影响分析」为变更请求与 PMO 影响分析共享词 → 双卡共存（互不吞没）', () => {
    expect(filterSpaceCoordinates('影响分析').map((c) => c.id)).toEqual([
      'change-requests',
      'pmo-impact-analysis',
    ])
  })

  test('「AI」为生成剧场/报表中心/AI 优先级推荐三卡共存；「pmo」直达组合仪表盘', () => {
    expect(filterSpaceCoordinates('AI').map((c) => c.id)).toEqual([
      'create',
      'reports',
      'pmo-ai-priority-recommendations',
    ])
    // 批4 pmo-reports/pmo-change-queue 标题均含「PMO」，与组合仪表盘三卡共存
    expect(filterSpaceCoordinates('pmo').map((c) => c.id)).toEqual([
      'pmo',
      'pmo-reports',
      'pmo-change-queue',
    ])
  })

  test('非相关词不误伤既有坐标（既有归属零漂移）', () => {
    expect(filterSpaceCoordinates('未知坐标XYZ')).toEqual([])
    expect(filterSpaceCoordinates('首页').map((c) => c.id)).toEqual(['home'])
    expect(filterSpaceCoordinates('风险').map((c) => c.id)).toEqual([
      'charts',
      'risks',
      'org_bi_risk_heatmap',
      'global_risks',
    ])
    expect(filterSpaceCoordinates('资源').map((c) => c.id)).not.toContain('pmo-dependencies')
    // 批4 pmo-reports（描述含「变更冲击」）与 pmo-change-queue（关键词含「变更」）三卡共存
    expect(filterSpaceCoordinates('变更').map((c) => c.id)).toEqual([
      'change-requests',
      'pmo-reports',
      'pmo-change-queue',
    ])
    expect(filterSpaceCoordinates('成员').map((c) => c.id)).toEqual(['members'])
    expect(filterSpaceCoordinates('文件').map((c) => c.id)).toEqual(['files'])
  })
})

describe('契约完整性兜底（iconName 联合类型与映射同步）', () => {
  test('全部预置坐标的 iconName 均可由 SpaceMapCard 解析（映射缺失即渲染抛错）', () => {
    const onSelect = vi.fn()
    // 覆盖式渲染一次全部坐标：任一 iconName 未进映射会在此抛 TypeError
    for (const coordinate of PRESET_SPACE_COORDINATES as readonly SpaceCoordinate[]) {
      const { unmount } = render(React.createElement(SpaceMapCard, { coordinate, onSelect }))
      expect(screen.getByRole('button', { name: new RegExp(coordinate.title) })).toBeTruthy()
      unmount()
    }
  })
})
