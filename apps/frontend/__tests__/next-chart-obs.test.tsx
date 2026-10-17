/**
 * OBS 组织分解结构镜头定向测试（v3-chart-gallery-tier2-org-contract-plans W2 · task 2.2）。
 *
 * 覆盖：
 * 1. Adapter 纯函数：树形信封解析、自底向上卷算统计、节点 Keys 收集、关键词过滤与高亮祖先收集；
 * 2. 镜头组件渲染：树形缩进排版、部门名称与编码、负责人缺省占位、工时负荷指标胶囊；
 * 3. 交互行为：节点折叠/展开、一键展开全部/收起全部、关键词即时过滤；
 * 4. 空数据标准空态回退（ChartLensEmptyState）；
 * 5. RL-01 零写网络断言：交互全程写请求（POST/PATCH/PUT/DELETE）恒为 0；
 * 6. DOM 中性措辞断言：正则扫描全局 DOM 树零「告警/预警/危险」词汇。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ObsTreeNode } from '@/lib/api/project-metrics'
import {
  buildObsTreeViewModel,
  collectMatchingNodeKeys,
  collectObsNodeKeys,
  filterObsTreeByKeyword,
  OBS_DEFAULT_LEADER_TEXT,
} from '@/lib/next/charts/obs-adapter'
import { ObsTreeChartLens } from '@/components/next/charts/lenses/ObsTreeChartLens'
import {
  installFetchRouter,
  jsonResponse,
  resetFetchRouter,
  writeMethods,
} from './helpers/chart-gallery-network'

if (typeof window.PointerEvent === 'undefined') {
  class PointerEventMock extends MouseEvent {}
  window.PointerEvent = PointerEventMock as unknown as typeof PointerEvent
}

if (typeof window.matchMedia === 'undefined') {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function makeSampleObsData(): ObsTreeNode[] {
  return [
    {
      id: 1,
      name: '技术研发中心',
      code: 'RD',
      depth: 0,
      path: '/1/',
      leaderName: '陈总监',
      metrics: {
        memberCount: 15,
        taskCount: 30,
        completedTaskCount: 18,
        totalEstimatedHours: 240,
      },
      children: [
        {
          id: 2,
          name: '前端架构组',
          code: 'FE',
          depth: 1,
          path: '/1/2/',
          leaderName: '赵组长',
          metrics: {
            memberCount: 6,
            taskCount: 12,
            completedTaskCount: 8,
            totalEstimatedHours: 96,
          },
          children: [],
        },
        {
          id: 3,
          name: '后端服务组',
          code: 'BE',
          depth: 1,
          path: '/1/3/',
          leaderName: null,
          metrics: {
            memberCount: 9,
            taskCount: 18,
            completedTaskCount: 10,
            totalEstimatedHours: 144,
          },
          children: [],
        },
      ],
    },
  ]
}

describe('OBS 适配器纯函数测试 (obs-adapter.ts)', () => {
  test('buildObsTreeViewModel 解析层级树并卷算汇总指标', () => {
    const raw = makeSampleObsData()
    const model = buildObsTreeViewModel(raw)

    expect(model.isEmpty).toBe(false)
    expect(model.totalDepartments).toBe(3)
    expect(model.totalMembers).toBe(15)
    expect(model.totalTasks).toBe(30)
    expect(model.totalCompletedTasks).toBe(18)
    expect(model.totalEstimatedHours).toBe(240)
    expect(model.allNodeKeys).toEqual(['obs-node-1', 'obs-node-2', 'obs-node-3'])

    // 检查根节点
    const root = model.rootNodes[0]!
    expect(root.name).toBe('技术研发中心')
    expect(root.leaderName).toBe('陈总监')
    expect(root.hasChildren).toBe(true)
    expect(root.children).toHaveLength(2)

    // 检查子节点缺省负责人
    const beNode = root.children[1]!
    expect(beNode.name).toBe('后端服务组')
    expect(beNode.leaderName).toBe(OBS_DEFAULT_LEADER_TEXT)
  })

  test('collectObsNodeKeys 递归遍历全部节点 Key', () => {
    const model = buildObsTreeViewModel(makeSampleObsData())
    const keys = collectObsNodeKeys(model.rootNodes)
    expect(keys).toEqual(['obs-node-1', 'obs-node-2', 'obs-node-3'])
  })

  test('filterObsTreeByKeyword 关键词过滤保留命中节点与祖先', () => {
    const model = buildObsTreeViewModel(makeSampleObsData())

    // 搜索前端组
    const filteredFe = filterObsTreeByKeyword(model.rootNodes, '前端')
    expect(filteredFe).toHaveLength(1)
    expect(filteredFe[0]!.name).toBe('技术研发中心')
    expect(filteredFe[0]!.children).toHaveLength(1)
    expect(filteredFe[0]!.children[0]!.name).toBe('前端架构组')

    // 搜索代码 BE
    const filteredBe = filterObsTreeByKeyword(model.rootNodes, 'be')
    expect(filteredBe).toHaveLength(1)
    expect(filteredBe[0]!.children).toHaveLength(1)
    expect(filteredBe[0]!.children[0]!.code).toBe('BE')

    // 无匹配
    const noMatch = filterObsTreeByKeyword(model.rootNodes, '不存在部门')
    expect(noMatch).toHaveLength(0)
  })

  test('collectMatchingNodeKeys 收集命中节点及其所有祖先用于自动展开', () => {
    const model = buildObsTreeViewModel(makeSampleObsData())
    const matched = collectMatchingNodeKeys(model.rootNodes, '前端')
    expect(matched.has('obs-node-1')).toBe(true)
    expect(matched.has('obs-node-2')).toBe(true)
    expect(matched.has('obs-node-3')).toBe(false)
  })

  test('空数据信封安全回退为 isEmpty', () => {
    const emptyModel = buildObsTreeViewModel([])
    expect(emptyModel.isEmpty).toBe(true)
    expect(emptyModel.totalDepartments).toBe(0)
    expect(emptyModel.totalMembers).toBe(0)
    expect(emptyModel.rootNodes).toHaveLength(0)
  })
})

describe('ObsTreeChartLens 镜头组件渲染与门禁测试', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
  })

  afterEach(() => {
    resetFetchRouter()
    queryClient.clear()
  })

  test('完整数据流：渲染树形层级、负责人、工时徽标、展开收起与即时检索', async () => {
    const sample = makeSampleObsData()
    const { records } = installFetchRouter((path, method) => {
      if (path === '/projects/42/obs-tree' && method === 'GET') {
        return jsonResponse(200, { data: sample })
      }
      return null
    })

    render(
      <QueryClientProvider client={queryClient}>
        <ObsTreeChartLens projectId={42} />
      </QueryClientProvider>,
    )

    // 等待骨架屏消失并渲染主视口
    await waitFor(() => {
      expect(document.querySelector('[data-chart-viewport-slot]')).not.toBeNull()
    })

    // 断言部门树节点存在
    await screen.findByText('技术研发中心')
    expect(screen.getByText('前端架构组')).toBeInTheDocument()
    expect(screen.getByText('后端服务组')).toBeInTheDocument()

    // 断言负责人信息
    expect(screen.getByText('(陈总监)')).toBeInTheDocument()
    expect(screen.getByText('(赵组长)')).toBeInTheDocument()
    expect(screen.getByText(`(${OBS_DEFAULT_LEADER_TEXT})`)).toBeInTheDocument()

    // 断言顶部度量汇总
    expect(screen.getByText('部门 3 个')).toBeInTheDocument()
    expect(screen.getByText('成员 15 位')).toBeInTheDocument()
    expect(screen.getByText('任务 30 项')).toBeInTheDocument()
    expect(screen.getByText('完成 18 项')).toBeInTheDocument()
    expect(screen.getByText('工时 240h')).toBeInTheDocument()

    // 交互：折叠前端架构组
    const collapseBtn = screen.getByRole('button', { name: '折叠部门 技术研发中心' })
    fireEvent.click(collapseBtn)
    expect(screen.queryByText('前端架构组')).toBeNull()

    // 交互：一键展开全部
    fireEvent.click(screen.getByRole('button', { name: '展开全部' }))
    expect(screen.getByText('前端架构组')).toBeInTheDocument()

    // 交互：搜索关键词「前端」
    const searchInput = screen.getByRole('searchbox')
    fireEvent.change(searchInput, { target: { value: '前端' } })
    expect(screen.getByText('前端架构组')).toBeInTheDocument()
    expect(screen.queryByText('后端服务组')).toBeNull()

    // 清空搜索
    fireEvent.change(searchInput, { target: { value: '' } })
    expect(screen.getByText('后端服务组')).toBeInTheDocument()

    // RL-01 零写断言：写方法恒为 0
    expect(writeMethods(records)).toHaveLength(0)

    // DOM 中性措辞断言：绝对排除告警/预警/危险
    expect(screen.queryByText(/告警|预警|危险/)).toBeNull()
  })

  test('空数据态：无部门配置时渲染标准 EmptyState', async () => {
    installFetchRouter((path, method) => {
      if (path === '/projects/99/obs-tree' && method === 'GET') {
        return jsonResponse(200, { data: [] })
      }
      return null
    })

    render(
      <QueryClientProvider client={queryClient}>
        <ObsTreeChartLens projectId={99} />
      </QueryClientProvider>,
    )

    await screen.findByRole('status', { name: '组织分解结构为空' })
    expect(screen.getByText('暂无组织分解结构数据')).toBeInTheDocument()
    expect(screen.getByText('当前项目尚未挂载部门组织架构或工时数据。')).toBeInTheDocument()

    // DOM 中性措辞断言
    expect(screen.queryByText(/告警|预警|危险/)).toBeNull()
  })
})
