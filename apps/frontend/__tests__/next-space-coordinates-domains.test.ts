/**
 * v3-ui-next-risk-change-domains W3 · tasks 3.6 —— 空间地图两域坐标注册与检索测试
 * （spec「两域与空间地图坐标注册」）。
 *
 * 覆盖：
 * - risks / change-requests 两域坐标正式注册：available / 已就绪 / 项目级
 *   `:id` 占位路径 / 图标名契约（Shield / GitPullRequest）与规范关键词；
 * - `filterSpaceCoordinates` 关键词与模糊检索精准归属（含与图表馆「风险矩阵」
 *   共享词的共存不误伤），输入非相关词不命中两域坐标；
 * - SpaceMapCard 正确映射两域图标并保持 available 可点击直达语义。
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

const risks = PRESET_SPACE_COORDINATES.find((c) => c.id === 'risks')!
const changeRequests = PRESET_SPACE_COORDINATES.find((c) => c.id === 'change-requests')!

describe('两域坐标注册（tasks 3.5/3.6，spec「风险管理/变更控制坐标」）', () => {
  test('risks 坐标：项目级占位路径 + available / 已就绪 + Shield 图标契约', () => {
    expect(risks.title).toBe('风险管理')
    expect(risks.path).toBe('/next/projects/:id/risks')
    expect(risks.description).toBe('项目风险辨识、态势评估与应对流转')
    expect(risks.status).toBe('available')
    expect(risks.badge).toBe('已就绪')
    expect(risks.iconName).toBe('Shield')
    expect(risks.keywords).toEqual(
      expect.arrayContaining(['风险', '隐患', '工作台', '矩阵', '5x5', '复查', 'risks']),
    )
  })

  test('change-requests 坐标：项目级占位路径 + available / 已就绪 + GitPullRequest 图标契约', () => {
    expect(changeRequests.title).toBe('变更请求')
    expect(changeRequests.path).toBe('/next/projects/:id/change-requests')
    expect(changeRequests.description).toBe('项目基线变更申请、六维影响分析与审批决策')
    expect(changeRequests.status).toBe('available')
    expect(changeRequests.badge).toBe('已就绪')
    expect(changeRequests.iconName).toBe('GitPullRequest')
    expect(changeRequests.keywords).toEqual(
      expect.arrayContaining(['变更', 'cr', '审批', '影响分析', '申请', 'change']),
    )
  })

  test('项目级路径解析：:id 替换为当前项目，全局视图回退首页引导（不拼装假链接）', () => {
    expect(resolveSpaceCoordinatePath(risks.path, 42)).toBe('/next/projects/42/risks')
    expect(resolveSpaceCoordinatePath(changeRequests.path, 42)).toBe(
      '/next/projects/42/change-requests',
    )
    expect(resolveSpaceCoordinatePath(risks.path, null)).toBe('/next')
    expect(resolveSpaceCoordinatePath(changeRequests.path, null)).toBe('/next')
  })
})

describe('两域坐标检索（spec「输入关键词即时模糊检索」）', () => {
  test('filterSpaceCoordinates("风险")：风险系坐标共享词共存，不误伤其它坐标', () => {
    // 「风险」为图表馆旧关键词（风险矩阵）与项目风险管理的共享词；
    // v3-ui-next-org-portfolio-domains 10.2：组织风险热力图与问题与风险入口注册后
    // 同样子串命中 → 四卡共存（复合词「组织风险热力」等仍精准归属，见 10.2 互斥断言）
    expect(filterSpaceCoordinates('风险').map((c) => c.id)).toEqual([
      'charts',
      'risks',
      'org_bi_risk_heatmap',
      'global_risks',
    ])
  })

  test('风险域专属关键词精准归属：隐患 / 复查 / 5x5；risks 与全局风险入口共享末段双命中', () => {
    expect(filterSpaceCoordinates('隐患').map((c) => c.id)).toEqual(['risks'])
    expect(filterSpaceCoordinates('复查').map((c) => c.id)).toEqual(['risks'])
    expect(filterSpaceCoordinates('5x5').map((c) => c.id)).toEqual(['risks'])
    // v3-ui-next-org-portfolio-domains 10.2：全局风险坐标路径 /next/risks 与项目
    // 风险坐标共享末段 risks → 双命中（路径段匹配语义不变）
    expect(filterSpaceCoordinates('risks').map((c) => c.id)).toEqual(['risks', 'global_risks'])
  })

  test('变更域关键词精准归属：变更 / 审批 / 申请 / change；cr 与生成剧场共享词共存', () => {
    // 批4 pmo-reports（描述含「变更冲击」）与 pmo-change-queue（关键词含「变更」）三卡共存
    expect(filterSpaceCoordinates('变更').map((c) => c.id)).toEqual([
      'change-requests',
      'pmo-reports',
      'pmo-change-queue',
    ])
    expect(filterSpaceCoordinates('变更请求').map((c) => c.id)).toEqual(['change-requests'])
    // 批4 pmo-change-queue 关键词含「审批」，与变更请求共享词共存
    expect(filterSpaceCoordinates('审批').map((c) => c.id)).toEqual([
      'change-requests',
      'pmo-change-queue',
    ])
    // v3-ui-next-pmo-domain 9.2：影响分析为变更请求（六维影响分析关键词）与 PMO
    // 影响分析坐标的共享词 → 双卡共存（互不吞没，共享词同「人员/负荷/文档」先例）
    expect(filterSpaceCoordinates('影响分析').map((c) => c.id)).toEqual([
      'change-requests',
      'pmo-impact-analysis',
    ])
    expect(filterSpaceCoordinates('申请').map((c) => c.id)).toEqual(['change-requests'])
    // 「cr」为变更域关键词，同时命中生成剧场英文关键词 create 的子串，
    // 批4 pmo-change-queue 关键词亦含字面量 「cr」→ 三卡共存互不吞没
    expect(filterSpaceCoordinates('cr').map((c) => c.id)).toEqual([
      'create',
      'change-requests',
      'pmo-change-queue',
    ])
    // 批4 pmo-change-queue 关键词字面量 'pmo-change-queue' 含子串 「change」→ 双卡共存
    expect(filterSpaceCoordinates('change').map((c) => c.id)).toEqual([
      'change-requests',
      'pmo-change-queue',
    ])
  })

  test('非相关词不误伤两域坐标（AND 语义与无关词空结果不变）', () => {
    expect(filterSpaceCoordinates('未知坐标XYZ')).toEqual([])
    expect(filterSpaceCoordinates('图书 馆')).toEqual([])
    // 「首页」/「图表」等既有归属不因两域注册漂移
    expect(filterSpaceCoordinates('首页').map((c) => c.id)).toEqual(['home'])
    expect(filterSpaceCoordinates('图表').map((c) => c.id)).toEqual(['charts'])
    // 批4 org-reports-wing（关键词含「报表」）与 pmo-reports（关键词含「报表」）与既有两卡共存
    expect(filterSpaceCoordinates('报表').map((c) => c.id)).toEqual([
      'charts',
      'reports',
      'org-reports-wing',
      'pmo-reports',
    ])
  })
})

describe('SpaceMapCard 图标映射与可用状态（tasks 3.5 图标扩充）', () => {
  test('风险管理坐标卡片：Shield 图标正常渲染、available 可点击、回调携带坐标', () => {
    const onSelect = vi.fn()
    render(
      React.createElement(SpaceMapCard, {
        coordinate: risks,
        onSelect,
      }),
    )
    const card = screen.getByRole('button', { name: /风险管理/ })
    expect(card).toHaveAttribute('data-space-coordinate', 'risks')
    expect(card).toHaveAttribute('data-status', 'available')
    expect(card).toBeEnabled()
    // 图标映射成功 → 渲染 lucide svg（映射缺失将直接抛错）
    expect(card.querySelector('svg')).not.toBeNull()
    fireEvent.click(card)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(risks)
  })

  test('变更请求坐标卡片：GitPullRequest 图标正常渲染、available 可点击', () => {
    const onSelect = vi.fn()
    render(
      React.createElement(SpaceMapCard, {
        coordinate: changeRequests,
        onSelect,
      }),
    )
    const card = screen.getByRole('button', { name: /变更请求/ })
    expect(card).toHaveAttribute('data-space-coordinate', 'change-requests')
    expect(card).toHaveAttribute('data-status', 'available')
    expect(card).toBeEnabled()
    expect(card.querySelector('svg')).not.toBeNull()
    fireEvent.click(card)
    expect(onSelect).toHaveBeenCalledWith(changeRequests)
  })

  test('两域坐标在 SpaceMapCard 上无 iconName 遗漏（契约完整性兜底）', () => {
    const iconNames = new Set(
      PRESET_SPACE_COORDINATES.map((coordinate: SpaceCoordinate) => coordinate.iconName),
    )
    expect(iconNames.has('Shield')).toBe(true)
    expect(iconNames.has('GitPullRequest')).toBe(true)
  })
})
