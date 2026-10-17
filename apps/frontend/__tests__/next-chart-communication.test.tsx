/**
 * 沟通管理计划镜头定向测试（v3-chart-gallery-tier2-org-contract-plans W2 · task 2.6）。
 *
 * 覆盖：
 * 1. Adapter 纯函数：沟通计划信封解析、中文映射字典、汇总指标计算、类型筛选；
 * 2. 镜头组件渲染：沟通矩阵表格多维字段、启停状态胶囊、顶部汇总指标卡；
 * 3. 交互行为：类型快速筛选条目收敛；
 * 4. 空数据标准空态回退（ChartLensEmptyState）；
 * 5. RL-01 零写网络断言：交互全程写请求（POST/PATCH/PUT/DELETE）恒为 0；
 * 6. DOM 中性措辞断言：正则扫描全局 DOM 树零「告警/预警/危险」词汇。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  CommunicationPlanItem,
  PaginatedCommunicationPlans,
} from '@/lib/api/communication-plans'
import {
  buildCommunicationPlanViewModel,
  filterCommunicationPlanRows,
} from '@/lib/next/charts/communication-adapter'
import { CommunicationPlanChartLens } from '@/components/next/charts/lenses/CommunicationPlanChartLens'
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

function makeSampleCommunicationPlans(): PaginatedCommunicationPlans {
  const items: CommunicationPlanItem[] = [
    {
      id: 1,
      organizationId: 1,
      projectId: 42,
      ownerId: 7,
      name: '周例会',
      communicationType: 'meeting',
      purpose: '同步周度进度与风险',
      frequency: 'weekly',
      channel: 'video_conference',
      audience: '核心项目组',
      deliverable: '会议纪要',
      reportTemplateKey: null,
      isActive: true,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: null,
    },
    {
      id: 2,
      organizationId: 1,
      projectId: 42,
      ownerId: 8,
      name: '月度进展报告',
      communicationType: 'report',
      purpose: '向管理层汇报月度总体进展',
      frequency: 'monthly',
      channel: 'email',
      audience: '管理层',
      deliverable: null,
      reportTemplateKey: 'monthly-status',
      isActive: false,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: null,
    },
  ]
  return {
    data: items,
    meta: { total: 2, page: 1, perPage: 100, totalPages: 1 },
  }
}

describe('沟通管理计划适配器纯函数测试 (communication-adapter.ts)', () => {
  test('buildCommunicationPlanViewModel 解析信封并计算汇总指标', () => {
    const model = buildCommunicationPlanViewModel(makeSampleCommunicationPlans())

    expect(model.isEmpty).toBe(false)
    expect(model.rows).toHaveLength(2)
    expect(model.metrics.totalCount).toBe(2)
    expect(model.metrics.activeCount).toBe(1)
    expect(model.metrics.inactiveCount).toBe(1)
    expect(model.metrics.meetingCount).toBe(1)
    expect(model.metrics.reportCount).toBe(1)

    const meetingRow = model.rows[0]!
    expect(meetingRow.typeLabel).toBe('会议')
    expect(meetingRow.frequencyLabel).toBe('每周')
    expect(meetingRow.channelLabel).toBe('视频会议')
    expect(meetingRow.statusLabel).toBe('生效中')

    const reportRow = model.rows[1]!
    expect(reportRow.statusLabel).toBe('已停用')
    expect(reportRow.hasReportTemplate).toBe(true)
  })

  test('filterCommunicationPlanRows 按类型筛选收敛行集', () => {
    const model = buildCommunicationPlanViewModel(makeSampleCommunicationPlans())

    const meetingsOnly = filterCommunicationPlanRows(model.rows, 'meeting')
    expect(meetingsOnly).toHaveLength(1)
    expect(meetingsOnly[0]!.name).toBe('周例会')

    const all = filterCommunicationPlanRows(model.rows, 'all')
    expect(all).toHaveLength(2)
  })

  test('空数据信封安全回退为 isEmpty', () => {
    const emptyModel = buildCommunicationPlanViewModel({
      data: [],
      meta: { total: 0, page: 1, perPage: 100, totalPages: 0 },
    })
    expect(emptyModel.isEmpty).toBe(true)
    expect(emptyModel.rows).toHaveLength(0)
    expect(emptyModel.metrics.totalCount).toBe(0)
  })
})

describe('CommunicationPlanChartLens 镜头组件渲染与门禁测试', () => {
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

  test('完整数据流：渲染沟通矩阵表格、启停胶囊、顶部汇总指标与类型筛选', async () => {
    const sample = makeSampleCommunicationPlans()
    const { records } = installFetchRouter((path, method) => {
      if (path.startsWith('/projects/42/communication-plans') && method === 'GET') {
        return jsonResponse(200, sample)
      }
      return null
    })

    render(
      <QueryClientProvider client={queryClient}>
        <CommunicationPlanChartLens projectId={42} />
      </QueryClientProvider>,
    )

    // 等待骨架屏消失并渲染主视口
    await waitFor(() => {
      expect(document.querySelector('[data-chart-viewport-slot]')).not.toBeNull()
    })

    // 断言矩阵行渲染
    await screen.findByText('周例会')
    expect(screen.getByText('月度进展报告')).toBeInTheDocument()
    expect(screen.getByText('生效中')).toBeInTheDocument()
    expect(screen.getByText('已停用')).toBeInTheDocument()

    // 断言顶部汇总指标卡
    expect(screen.getByText('总计 2 项')).toBeInTheDocument()
    expect(screen.getByText('生效中 1')).toBeInTheDocument()

    // 交互：按「会议」类型筛选
    fireEvent.click(screen.getByRole('button', { name: '会议' }))
    expect(screen.getByText('周例会')).toBeInTheDocument()
    expect(screen.queryByText('月度进展报告')).toBeNull()

    // 交互：恢复全部类型
    fireEvent.click(screen.getByRole('button', { name: '全部类型' }))
    expect(screen.getByText('月度进展报告')).toBeInTheDocument()

    // RL-01 零写断言：写方法恒为 0
    expect(writeMethods(records)).toHaveLength(0)

    // DOM 中性措辞断言：绝对排除告警/预警/危险
    expect(screen.queryByText(/告警|预警|危险/)).toBeNull()
  })

  test('空数据态：无沟通计划记录时渲染标准 EmptyState', async () => {
    installFetchRouter((path, method) => {
      if (path.startsWith('/projects/99/communication-plans') && method === 'GET') {
        return jsonResponse(200, {
          data: [],
          meta: { total: 0, page: 1, perPage: 100, totalPages: 0 },
        })
      }
      return null
    })

    render(
      <QueryClientProvider client={queryClient}>
        <CommunicationPlanChartLens projectId={99} />
      </QueryClientProvider>,
    )

    await screen.findByRole('status', { name: '沟通管理计划为空' })
    expect(screen.getByText('暂无沟通管理计划数据')).toBeInTheDocument()
    expect(screen.getByText('当前项目尚未规划沟通管理计划。')).toBeInTheDocument()

    // DOM 中性措辞断言
    expect(screen.queryByText(/告警|预警|危险/)).toBeNull()
  })
})
