/**
 * v3-ui-next-org-portfolio-domains W10 · tasks 10.2 —— 17 条组织/全局空间坐标注册与
 * 检索互斥单测（spec「组织级空间坐标与 AI 同事全域导航闭环」要求 1）。
 *
 * 覆盖：
 * - 17 条坐标（org_overview…global_risks）全部注册：available / 已就绪 /
 *   无 :id 占位的全局绝对路径（/next/organization/**、/next/resources/**、/next/risks）
 *   / 图标名在扩展联合类型内；
 * - 路径无占位符：resolveSpaceCoordinatePath 原样返回（单项目与全域视图均直达，
 *   绝不回退首页引导）；
 * - 复合关键词互斥检索：组织资源池 / 组织风险热力 / 组织 OKR / OKR 仪表盘 / 技能矩阵 /
 *   插件目录 / 容量环 命中各自组织坐标，不被项目级 resources/risks/reports 坐标误吞
 *   （断言命中集合为组织坐标且不含项目级 id）；
 * - 既有项目级坐标零漂移回归：成员/文件/变更/帮助/知识/首页 专属词归属不变。
 */
import { describe, expect, test } from 'vitest'
import {
  PRESET_SPACE_COORDINATES,
  filterSpaceCoordinates,
  resolveSpaceCoordinatePath,
} from '@/lib/next/space-coordinates'

const ORG_COORDINATE_IDS = [
  'org_overview',
  'org_bi_dashboards',
  'org_bi_risk_heatmap',
  'org_bi_trends',
  'org_okrs',
  'org_okr_dashboard',
  'org_resource_pool',
  'org_resource_gaps',
  'org_resource_contentions',
  'org_resource_demand',
  'org_capacity_loops',
  'org_cross_project_allocation',
  'org_plugin_directory',
  'org_plugin_policies',
  'global_resources',
  'global_skill_matrix',
  'global_risks',
] as const

const PROJECT_LEVEL_IDS = [
  'home',
  'create',
  'charts',
  'reports',
  'risks',
  'change-requests',
  'resources',
  'members',
  'files',
  'help',
  'knowledge',
]

describe('17 条组织/全局坐标注册（tasks 10.1，spec「坐标点亮」）', () => {
  test('坐标完整注册：available / 已就绪 / 图标契约 / 全局绝对路径', () => {
    for (const id of ORG_COORDINATE_IDS) {
      const coordinate = PRESET_SPACE_COORDINATES.find((c) => c.id === id)
      expect(coordinate, `坐标 ${id} 应已注册`).toBeDefined()
      expect(coordinate!.status).toBe('available')
      expect(coordinate!.badge).toBe('已就绪')
      expect(coordinate!.path.startsWith('/next/')).toBe(true)
      expect(coordinate!.path.includes(':id')).toBe(false)
      expect(coordinate!.title).toBeTruthy()
      expect(coordinate!.description).toBeTruthy()
      expect(coordinate!.keywords.length).toBeGreaterThan(0)
    }
  })

  test('路径契约：容量环详情动态路由不设坐标（落列表页）；org/global 前缀齐备', () => {
    const byId = Object.fromEntries(PRESET_SPACE_COORDINATES.map((c) => [c.id, c.path]))
    expect(byId['org_capacity_loops']).toBe('/next/organization/resource-capacity-loops')
    expect(byId['org_overview']).toBe('/next/organization')
    expect(byId['org_okr_dashboard']).toBe('/next/organization/okrs/dashboard')
    expect(byId['org_plugin_policies']).toBe('/next/organization/plugin-policies')
    expect(byId['global_resources']).toBe('/next/resources')
    expect(byId['global_skill_matrix']).toBe('/next/resources/skill-matrix')
    expect(byId['global_risks']).toBe('/next/risks')
    // 17 条 = 14 条组织层 + 3 条全局
    const orgLens = ORG_COORDINATE_IDS.filter((id) => id.startsWith('org_'))
    const globalLens = ORG_COORDINATE_IDS.filter((id) => id.startsWith('global_'))
    expect(orgLens).toHaveLength(14)
    expect(globalLens).toHaveLength(3)
  })

  test('图标名在扩展联合类型内（与 SpaceMapCard lucide 映射契约同步）', () => {
    const orgIconNames = ORG_COORDINATE_IDS.map(
      (id) => PRESET_SPACE_COORDINATES.find((c) => c.id === id)!.iconName,
    )
    // 17 条组织坐标图标互不重复（既有坐标沿用 Users 双卡先例不受此约束）
    expect(new Set(orgIconNames).size).toBe(orgIconNames.length)
    for (const iconName of orgIconNames) {
      expect(iconName).toMatch(/^[A-Z]/)
    }
  })
})

describe('resolveSpaceCoordinatePath（无占位坐标恒定直达）', () => {
  test('单项目与全域视图均原样返回组织/全局路径，绝不回退首页引导', () => {
    for (const id of ORG_COORDINATE_IDS) {
      const path = PRESET_SPACE_COORDINATES.find((c) => c.id === id)!.path
      expect(resolveSpaceCoordinatePath(path, 42), id).toBe(path)
      expect(resolveSpaceCoordinatePath(path, null), id).toBe(path)
    }
  })
})

describe('复合关键词互斥检索（不被项目级坐标误吞）', () => {
  test('「组织资源池」唯一命中 org_resource_pool（不含项目级 resources）', () => {
    expect(filterSpaceCoordinates('组织资源池').map((c) => c.id)).toEqual(['org_resource_pool'])
  })

  test('「组织风险热力」唯一命中 org_bi_risk_heatmap（不含项目级 risks/charts）', () => {
    expect(filterSpaceCoordinates('组织风险热力').map((c) => c.id)).toEqual(['org_bi_risk_heatmap'])
  })

  test('「组织 OKR」命中 OKR 双坐标且不含项目级坐标；「OKR 仪表盘」唯一命中仪表盘', () => {
    const okrs = filterSpaceCoordinates('组织 OKR').map((c) => c.id)
    expect(okrs).toEqual(expect.arrayContaining(['org_okrs', 'org_okr_dashboard']))
    expect(okrs.every((id) => id.startsWith('org_'))).toBe(true)
    expect(okrs).not.toEqual(expect.arrayContaining(PROJECT_LEVEL_IDS))
    expect(filterSpaceCoordinates('OKR 仪表盘').map((c) => c.id)).toEqual(['org_okr_dashboard'])
    expect(filterSpaceCoordinates('组织 OKR 仪表盘').map((c) => c.id)).toEqual([
      'org_okr_dashboard',
    ])
  })

  test('「技能矩阵」唯一命中 global_skill_matrix', () => {
    expect(filterSpaceCoordinates('技能矩阵').map((c) => c.id)).toEqual(['global_skill_matrix'])
  })

  test('「插件目录」唯一命中 org_plugin_directory（不含插件策略）', () => {
    expect(filterSpaceCoordinates('插件目录').map((c) => c.id)).toEqual(['org_plugin_directory'])
    expect(filterSpaceCoordinates('插件策略').map((c) => c.id)).toEqual(['org_plugin_policies'])
  })

  test('「容量环」/「容量闭环」唯一命中 org_capacity_loops', () => {
    expect(filterSpaceCoordinates('容量环').map((c) => c.id)).toEqual(['org_capacity_loops'])
    expect(filterSpaceCoordinates('容量闭环').map((c) => c.id)).toEqual(['org_capacity_loops'])
  })

  test('「跨项目调配」「全局资源」「问题与风险」分别精准归属', () => {
    expect(filterSpaceCoordinates('跨项目调配').map((c) => c.id)).toEqual([
      'org_cross_project_allocation',
    ])
    expect(filterSpaceCoordinates('全局资源').map((c) => c.id)).toEqual(['global_resources'])
    expect(filterSpaceCoordinates('问题与风险').map((c) => c.id)).toEqual(['global_risks'])
    expect(filterSpaceCoordinates('组织概览').map((c) => c.id)).toEqual(['org_overview'])
    expect(filterSpaceCoordinates('需求预测').map((c) => c.id)).toEqual(['org_resource_demand'])
    expect(filterSpaceCoordinates('资源缺口').map((c) => c.id)).toEqual(['org_resource_gaps'])
    expect(filterSpaceCoordinates('资源争用').map((c) => c.id)).toEqual([
      'org_resource_contentions',
    ])
    expect(filterSpaceCoordinates('趋势分析').map((c) => c.id)).toEqual(['org_bi_trends'])
    expect(filterSpaceCoordinates('BI 仪表盘').map((c) => c.id)).toEqual(['org_bi_dashboards'])
  })
})

describe('既有坐标归属零漂移回归（组织层注册不吞旧语义）', () => {
  test('成员/文件/变更/帮助/知识/首页等专属词归属不变', () => {
    expect(filterSpaceCoordinates('成员').map((c) => c.id)).toEqual(['members'])
    expect(filterSpaceCoordinates('文件').map((c) => c.id)).toEqual(['files'])
    // v3-ui-next-batch4-reports-change-queue：pmo-reports 描述含「变更冲击」、pmo-change-queue 关键词含「变更」，与既有变更请求坐标共享词共存
    expect(filterSpaceCoordinates('变更').map((c) => c.id)).toEqual([
      'change-requests',
      'pmo-reports',
      'pmo-change-queue',
    ])
    expect(filterSpaceCoordinates('帮助').map((c) => c.id)).toEqual(['help'])
    expect(filterSpaceCoordinates('知识库').map((c) => c.id)).toEqual(['knowledge'])
    expect(filterSpaceCoordinates('首页').map((c) => c.id)).toEqual(['home'])
    expect(filterSpaceCoordinates('甘特').map((c) => c.id)).toEqual(['charts'])
    expect(filterSpaceCoordinates('周报').map((c) => c.id)).toEqual(['reports'])
    expect(filterSpaceCoordinates('未知坐标XYZ')).toEqual([])
  })
})
