/**
 * 议题与变更追踪镜头定向测试（v3-chart-gallery-tier2-governance-matrices W2 · task 2.8）。
 *
 * 覆盖：
 * 1. Adapter 纯函数：状态分组统计（open/in_progress/resolved/closed/rejected）、严重度分布、格式化与筛选；
 * 2. 镜头组件渲染：状态卡片、明细列表与徽标呈现；
 * 3. 类型与严重度下拉筛选响应及条目收敛；
 * 4. 空数据项目安全渲染标准空态（ChartLensEmptyState）；
 * 5. RL-01 零写网络断言：全程零写请求（POST/PATCH/PUT/DELETE 恒为 0）；
 * 6. DOM 中性措辞断言：正则全局扫描零「告警/预警/危险」词汇。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Issue, PaginatedIssues } from '@/lib/api/issues'
import {
  buildIssuesViewModel,
  filterIssueRows,
  formatCreatedAt,
} from '@/lib/next/charts/issues-adapter'
import { IssuesChartLens } from '@/components/next/charts/lenses/IssuesChartLens'
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

function makeSampleIssues(): PaginatedIssues {
  const issues: Issue[] = [
    {
      id: 1,
      organizationId: 1,
      projectId: 42,
      relatedTaskId: 10,
      reportedBy: 1,
      assigneeId: 2,
      code: 'ISS-001',
      title: '登录态跨标签页同步延迟',
      description: '多标签页并发切换租户时未触发 storage 监听',
      type: 'bug',
      severity: 'major',
      priority: 'high',
      status: 'open',
      rootCause: null,
      resolution: null,
      resolvedAt: null,
      closedAt: null,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    },
    {
      id: 2,
      organizationId: 1,
      projectId: 42,
      relatedTaskId: null,
      reportedBy: 1,
      assigneeId: 3,
      code: 'ISS-002',
      title: 'CI 镜像构建偶发超时',
      description: 'Docker Hub 限流导致 base 镜像拉取缓慢',
      type: 'blocker',
      severity: 'critical',
      priority: 'urgent',
      status: 'in_progress',
      rootCause: '上游镜像源抖动',
      resolution: null,
      resolvedAt: null,
      closedAt: null,
      createdAt: '2026-09-02T12:00:00.000Z',
      updatedAt: '2026-09-02T14:00:00.000Z',
    },
    {
      id: 3,
      organizationId: 1,
      projectId: 42,
      relatedTaskId: 15,
      reportedBy: 2,
      assigneeId: 2,
      code: 'ISS-003',
      title: '历史图表组件废弃样式清理',
      description: '逐步移除旧版 tailwind 覆盖样式',
      type: 'technical',
      severity: 'minor',
      priority: 'low',
      status: 'resolved',
      rootCause: null,
      resolution: '已替换为 --nx-* 令牌',
      resolvedAt: '2026-09-05T18:00:00.000Z',
      closedAt: null,
      createdAt: '2026-09-03T09:00:00.000Z',
      updatedAt: '2026-09-05T18:00:00.000Z',
    },
  ]

  return {
    data: issues,
    meta: { total: 3, page: 1, perPage: 50, totalPages: 1 },
  }
}

describe('议题与变更追踪适配器纯函数测试 (issues-adapter.ts)', () => {
  test('状态分组统计与严重度计数装配', () => {
    const data = makeSampleIssues()
    const model = buildIssuesViewModel(data)

    expect(model.isEmpty).toBe(false)
    expect(model.totalCount).toBe(3)
    expect(model.statusCounts.open).toBe(1)
    expect(model.statusCounts.in_progress).toBe(1)
    expect(model.statusCounts.resolved).toBe(1)
    expect(model.statusCounts.closed).toBe(0)
    expect(model.statusCounts.rejected).toBe(0)

    expect(model.severityCounts.critical).toBe(1)
    expect(model.severityCounts.major).toBe(1)
    expect(model.severityCounts.minor).toBe(1)
    expect(model.severityCounts.trivial).toBe(0)

    expect(model.rows[0]!.code).toBe('ISS-001')
    expect(model.rows[0]!.typeLabel).toBe('缺陷')
    expect(model.rows[0]!.severityLabel).toBe('严重')
    expect(model.rows[0]!.statusLabel).toBe('待处理')
  })

  test('日期格式化健全性', () => {
    expect(formatCreatedAt('2026-09-01T10:00:00.000Z')).toBe('2026-09-01')
    expect(formatCreatedAt('')).toBe('-')
  })

  test('filterIssueRows 本地筛选纯函数', () => {
    const data = makeSampleIssues()
    const model = buildIssuesViewModel(data)

    const bugsOnly = filterIssueRows(model.rows, { type: 'bug' })
    expect(bugsOnly).toHaveLength(1)
    expect(bugsOnly[0]!.code).toBe('ISS-001')

    const criticalOnly = filterIssueRows(model.rows, { severity: 'critical' })
    expect(criticalOnly).toHaveLength(1)
    expect(criticalOnly[0]!.code).toBe('ISS-002')

    const noneMatch = filterIssueRows(model.rows, { type: 'process' })
    expect(noneMatch).toHaveLength(0)
  })

  test('空数据信封安全降级', () => {
    const emptyModel = buildIssuesViewModel(null)
    expect(emptyModel.isEmpty).toBe(true)
    expect(emptyModel.totalCount).toBe(0)
    expect(emptyModel.rows).toHaveLength(0)
  })
})

describe('IssuesChartLens 镜头组件渲染与交互测试', () => {
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

  test('完整数据流：渲染状态度量卡、明细表格与下拉筛选响应，全程零写', async () => {
    const sample = makeSampleIssues()
    const { records } = installFetchRouter((path, method) => {
      if (path.startsWith('/projects/42/issues') && method === 'GET') {
        return jsonResponse(200, sample)
      }
      return null
    })

    render(
      <QueryClientProvider client={queryClient}>
        <IssuesChartLens projectId={42} />
      </QueryClientProvider>,
    )

    // 等待视口加载
    await waitFor(() => {
      expect(document.querySelector('[data-chart-viewport-slot]')).not.toBeNull()
    })
    expect(document.querySelector('[data-chart-lens-root="issues"]')).not.toBeNull()

    // 状态度量卡
    expect(screen.getByText('议题总数')).toBeInTheDocument()
    expect(screen.getByText('待处理 (Open)')).toBeInTheDocument()
    expect(screen.getByText('处理中 (In Progress)')).toBeInTheDocument()
    expect(screen.getByText('已解决 (Resolved)')).toBeInTheDocument()

    // 议题条目呈现
    await screen.findByText('ISS-001')
    expect(screen.getByText('登录态跨标签页同步延迟')).toBeInTheDocument()
    expect(screen.getByText('ISS-002')).toBeInTheDocument()
    expect(screen.getByText('CI 镜像构建偶发超时')).toBeInTheDocument()
    expect(screen.getByText('ISS-003')).toBeInTheDocument()

    // 筛选过滤操作：按类型「缺陷」筛选
    const typeSelect = screen.getByRole('combobox', { name: '议题类型筛选' })
    fireEvent.change(typeSelect, { target: { value: 'bug' } })

    // 仅 ISS-001 呈现，ISS-002 与 ISS-003 被过滤
    expect(screen.getByText('ISS-001')).toBeInTheDocument()
    expect(screen.queryByText('ISS-002')).toBeNull()
    expect(screen.queryByText('ISS-003')).toBeNull()
    expect(screen.getByText('当前显示 1 / 3 项')).toBeInTheDocument()

    // RL-01 零写断言
    expect(writeMethods(records)).toHaveLength(0)

    // DOM 中性措辞断言
    expect(screen.queryByText(/告警|预警|危险/)).toBeNull()
  })

  test('空数据项目安全渲染标准空态', async () => {
    installFetchRouter((path, method) => {
      if (path.startsWith('/projects/99/issues') && method === 'GET') {
        return jsonResponse(200, {
          data: [],
          meta: { total: 0, page: 1, perPage: 50, totalPages: 0 },
        })
      }
      return null
    })

    render(
      <QueryClientProvider client={queryClient}>
        <IssuesChartLens projectId={99} />
      </QueryClientProvider>,
    )

    await screen.findByRole('status', { name: '议题追踪为空' })
    expect(screen.getByText('暂无议题缺陷记录')).toBeInTheDocument()
    expect(screen.getByText('当前项目尚未登记议题缺陷或变更追踪记录。')).toBeInTheDocument()

    // DOM 中性措辞
    expect(screen.queryByText(/告警|预警|危险/)).toBeNull()
  })
})
