/**
 * 利害关系人登记与四象限镜头定向测试（v3-chart-gallery-tier2-governance-matrices W2 · task 2.6）。
 *
 * 覆盖：
 * 1. Adapter 纯函数：4 象限桶聚合（manageClosely/keepSatisfied/keepInformed/monitor）、态度标签与空态；
 * 2. 镜头组件渲染：四象限 2×2 网格卡片呈现与态度徽标；
 * 3. 视图 Tab 切换：四象限矩阵 ↔ 登记底册表格平滑切换；
 * 4. 空数据项目安全渲染标准空态（ChartLensEmptyState）；
 * 5. RL-01 零写网络断言：全程零写请求（POST/PATCH/PUT/DELETE 恒为 0）；
 * 6. DOM 中性措辞断言：正则全局扫描零「告警/预警/危险」词汇。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { StakeholderItem, StakeholderQuadrantData } from '@/lib/api/stakeholders'
import { buildStakeholderViewModel } from '@/lib/next/charts/stakeholder-adapter'
import { StakeholderChartLens } from '@/components/next/charts/lenses/StakeholderChartLens'
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

function makeSampleStakeholders(): StakeholderQuadrantData {
  const item1: StakeholderItem = {
    id: 1,
    organizationId: 1,
    projectId: 42,
    userId: 10,
    name: '赵赞助人',
    organizationName: '集团战略投资部',
    roleTitle: '项目发起人',
    stakeholderType: 'internal',
    powerLevel: 'high',
    interestLevel: 'high',
    attitude: 'supportive',
    expectations: '按期上线并达成 ROI 预期',
    managementStrategy: 'manage_closely',
    contactInfo: {},
  }

  const item2: StakeholderItem = {
    id: 2,
    organizationId: 1,
    projectId: 42,
    userId: null,
    name: '钱法务总监',
    organizationName: '法务合规中心',
    roleTitle: '合规负责人',
    stakeholderType: 'internal',
    powerLevel: 'high',
    interestLevel: 'low',
    attitude: 'neutral',
    expectations: '严格遵守数据出境规范',
    managementStrategy: 'keep_satisfied',
    contactInfo: {},
  }

  const item3: StakeholderItem = {
    id: 3,
    organizationId: 1,
    projectId: 42,
    userId: null,
    name: '孙终端用户',
    organizationName: '渠道分销商',
    roleTitle: '一线运营',
    stakeholderType: 'external',
    powerLevel: 'low',
    interestLevel: 'high',
    attitude: 'resistant',
    expectations: '系统迁移不能打断现有发货节奏',
    managementStrategy: 'keep_informed',
    contactInfo: {},
  }

  const item4: StakeholderItem = {
    id: 4,
    organizationId: 1,
    projectId: 42,
    userId: null,
    name: '李行业观察员',
    organizationName: '第三方智库',
    roleTitle: '分析师',
    stakeholderType: 'external',
    powerLevel: 'low',
    interestLevel: 'low',
    attitude: 'neutral',
    expectations: '获取定期行业公开报告',
    managementStrategy: 'monitor',
    contactInfo: {},
  }

  return {
    summary: {
      manageClosely: 1,
      keepSatisfied: 1,
      keepInformed: 1,
      monitor: 1,
    },
    quadrants: {
      manageClosely: [item1],
      keepSatisfied: [item2],
      keepInformed: [item3],
      monitor: [item4],
    },
  }
}

describe('利害关系人适配器纯函数测试 (stakeholder-adapter.ts)', () => {
  test('四象限桶归集与卡片字段格式化', () => {
    const data = makeSampleStakeholders()
    const model = buildStakeholderViewModel(data)

    expect(model.isEmpty).toBe(false)
    expect(model.totalCount).toBe(4)
    expect(model.summary.manageClosely).toBe(1)
    expect(model.summary.keepSatisfied).toBe(1)
    expect(model.summary.keepInformed).toBe(1)
    expect(model.summary.monitor).toBe(1)

    // 重点管理桶
    const closely = model.quadrantBuckets.manageClosely
    expect(closely.count).toBe(1)
    expect(closely.stakeholders[0]!.name).toBe('赵赞助人')
    expect(closely.stakeholders[0]!.attitudeLabel).toBe('支持')

    // 抵制态度中性标签
    const informed = model.quadrantBuckets.keepInformed
    expect(informed.stakeholders[0]!.attitudeLabel).toBe('抵制')
    expect(informed.stakeholders[0]!.attitudeLabel).not.toMatch(/告警|预警|危险/)

    // 表格展平
    expect(model.tableRows).toHaveLength(4)
  })

  test('空数据信封安全降级', () => {
    const emptyModel = buildStakeholderViewModel(null)
    expect(emptyModel.isEmpty).toBe(true)
    expect(emptyModel.totalCount).toBe(0)
    expect(emptyModel.tableRows).toHaveLength(0)
  })
})

describe('StakeholderChartLens 镜头组件渲染与交互测试', () => {
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

  test('完整数据流：默认渲染四象限网格，可切换到底册表格，全程零写', async () => {
    const sample = makeSampleStakeholders()
    const { records } = installFetchRouter((path, method) => {
      if (path.startsWith('/projects/42/stakeholders') && method === 'GET') {
        if (path.includes('view=quadrant')) {
          return jsonResponse(200, { data: sample })
        }
        return jsonResponse(200, {
          data: Object.values(sample.quadrants).flat(),
          meta: { total: 4, page: 1, perPage: 50, totalPages: 1 },
        })
      }
      return null
    })

    render(
      <QueryClientProvider client={queryClient}>
        <StakeholderChartLens projectId={42} />
      </QueryClientProvider>,
    )

    // 等待视口就绪
    await waitFor(() => {
      expect(document.querySelector('[data-chart-viewport-slot]')).not.toBeNull()
    })
    expect(document.querySelector('[data-chart-lens-root="stakeholder"]')).not.toBeNull()

    // 顶部统计
    expect(screen.getByText(/登记总数：4 位/)).toBeInTheDocument()

    // 四象限 4 桶呈现
    await screen.findByText('赵赞助人')
    expect(screen.getByText('钱法务总监')).toBeInTheDocument()
    expect(screen.getByText('孙终端用户')).toBeInTheDocument()
    expect(screen.getByText('李行业观察员')).toBeInTheDocument()

    // 态度徽标
    expect(screen.getByText('支持')).toBeInTheDocument()
    expect(screen.getByText('抵制')).toBeInTheDocument()

    // 切换到登记底册 Tab
    const tableTab = screen.getByRole('tab', { name: '登记底册' })
    fireEvent.click(tableTab)

    // 表格视图渲染
    await screen.findByRole('table', { name: '利害关系人登记底册表格' })
    expect(screen.getByText('姓名 / 头衔')).toBeInTheDocument()
    expect(screen.getByText('核心诉求与期望')).toBeInTheDocument()
    expect(screen.getByText('按期上线并达成 ROI 预期')).toBeInTheDocument()

    // RL-01 零写网络断言
    expect(writeMethods(records)).toHaveLength(0)

    // DOM 中性措辞断言
    expect(screen.queryByText(/告警|预警|危险/)).toBeNull()
  })

  test('空数据项目安全渲染标准空态', async () => {
    installFetchRouter((path, method) => {
      if (path.startsWith('/projects/99/stakeholders') && method === 'GET') {
        return jsonResponse(200, {
          data: {
            summary: { manageClosely: 0, keepSatisfied: 0, keepInformed: 0, monitor: 0 },
            quadrants: { manageClosely: [], keepSatisfied: [], keepInformed: [], monitor: [] },
          },
        })
      }
      return null
    })

    render(
      <QueryClientProvider client={queryClient}>
        <StakeholderChartLens projectId={99} />
      </QueryClientProvider>,
    )

    await screen.findByRole('status', { name: '利害关系人为空' })
    expect(screen.getByText('暂无利害关系人数据')).toBeInTheDocument()
    expect(screen.getByText('当前项目尚未登记利害关系人。')).toBeInTheDocument()

    // DOM 中性措辞
    expect(screen.queryByText(/告警|预警|危险/)).toBeNull()
  })
})
