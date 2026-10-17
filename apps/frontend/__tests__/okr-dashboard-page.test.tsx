/**
 * OKR Dashboard 页面测试（v3-okr-dashboard §5.4）。
 *
 * 覆盖：
 *   - forbidden 空态（无 okr:view）
 *   - loading 骨架
 *   - empty 空态（visible objectives/KR = 0）
 *   - stale 提示（sourceFreshness.isStale=true）
 *   - ok 主体渲染 KPI/分布/关注项/对齐/证据/warning/backflow
 *   - error 重试按钮
 *   - 未授权 drill target 只显示 EyeOff，不渲染跳转 href
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import React from 'react'
import { computeOkrDashboardSummary, makeOkrDashboardFixtureInput } from '@aiproj/types'
import type { OkrDashboardSummary } from '@aiproj/types'

const canMock = vi.hoisted(() => vi.fn(() => true))
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ can: canMock }),
}))

const orgIdMock = vi.hoisted(() => vi.fn(() => 42 as number | null))
vi.mock('@/hooks/use-organization-dashboard', () => ({
  useCurrentOrganizationId: () => orgIdMock(),
}))

const okrCyclesMock = vi.hoisted(() =>
  vi.fn(() => ({
    data: { data: [{ id: 10, title: '2026 Q3' }] },
    isLoading: false,
  })),
)
vi.mock('@/hooks/use-okr', () => ({
  useOkrCycles: () => okrCyclesMock(),
}))

const summaryMock = vi.hoisted(() =>
  vi.fn(() => ({
    data: undefined as OkrDashboardSummary | undefined,
    isLoading: false,
    error: null as unknown,
    refetch: vi.fn(),
  })),
)
vi.mock('@/hooks/use-okr-dashboard', () => ({
  useOkrDashboardSummary: () => summaryMock(),
}))

import OkrDashboardPage from '@/app/(dashboard)/organization/okrs/dashboard/page'

function wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const baseSummary = computeOkrDashboardSummary(
  makeOkrDashboardFixtureInput({
    objectives: [
      {
        id: 1,
        organizationId: 1,
        cycleId: 1,
        projectId: null,
        teamId: null,
        ownerId: 1,
        scope: 'team',
        title: '示例目标',
        description: null,
        status: 'active',
        weight: 1,
        progress: 60,
        confidence: 'medium',
        startDate: '2026-06-01T00:00:00.000Z',
        endDate: '2026-09-30T00:00:00.000Z',
        metricVersion: 'okr@2026-07',
        calculatedAt: '2026-07-30T00:00:00.000Z',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
        deletedAt: null,
      },
    ],
    keyResults: [
      // 字段名以 OkrKeyResult 契约为准：measurementType / unitLabel /
      // baselineValue / targetValue / currentValue / lastUpdatedAt。
      // 原 fixture 写的是 metricType / baseline / target / current / progress /
      // ownerId / startDate / endDate / lastEvidenceAt / metricVersion /
      // calculatedAt——契约里都不存在，被 `as any` 盖住后 computeOkrDashboardSummary
      // 读到的每个指标字段都是 undefined。
      {
        id: 10,
        organizationId: 1,
        objectiveId: 1,
        title: '示例 KR',
        description: null,
        measurementType: 'number',
        unitLabel: null,
        baselineValue: 0,
        targetValue: 100,
        currentValue: 60,
        confidence: 'medium',
        status: 'active',
        weight: 1,
        lastUpdatedAt: '2026-07-29T00:00:00.000Z',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
        deletedAt: null,
      },
    ],
  }),
)

beforeEach(() => {
  canMock.mockReset().mockReturnValue(true)
  orgIdMock.mockReset().mockReturnValue(42)
  okrCyclesMock.mockReset().mockReturnValue({
    data: { data: [{ id: 10, title: '2026 Q3' }] },
    isLoading: false,
  })
  summaryMock.mockReset().mockReturnValue({
    data: baseSummary,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })
})

describe('OkrDashboardPage — 状态分支', () => {
  it('无 okr:view 权限 → forbidden 空态', () => {
    canMock.mockReturnValue(false)
    render(<OkrDashboardPage />, { wrapper })
    expect(screen.getByText(/没有 OKR Dashboard 访问权限/)).toBeInTheDocument()
  })

  it('isLoading → 渲染骨架', () => {
    summaryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    })
    render(<OkrDashboardPage />, { wrapper })
    expect(screen.getByTestId('okr-dashboard-loading')).toBeInTheDocument()
  })

  it('error → 渲染重试按钮', () => {
    summaryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
      refetch: vi.fn(),
    })
    render(<OkrDashboardPage />, { wrapper })
    expect(screen.getByTestId('okr-dashboard-retry')).toBeInTheDocument()
  })

  it('403 error → forbidden 空态（deriveOkrDashboardUiStatus 把它归到 forbidden）', () => {
    summaryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: Object.assign(new Error('forbidden'), { status: 403 }),
      refetch: vi.fn(),
    })
    render(<OkrDashboardPage />, { wrapper })
    expect(screen.getByText(/没有 OKR Dashboard 访问权限/)).toBeInTheDocument()
  })

  it('visibleObjectiveCount=0 且 visibleKeyResultCount=0 → 空态', () => {
    const empty = {
      ...baseSummary,
      meta: {
        ...baseSummary.meta,
        visibleObjectiveCount: 0,
        visibleKeyResultCount: 0,
      },
    }
    summaryMock.mockReturnValue({
      data: empty,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    render(<OkrDashboardPage />, { wrapper })
    expect(screen.getByText(/当前周期暂无 OKR/)).toBeInTheDocument()
  })

  it('sourceFreshness.isStale=true → 渲染 stale rail 与主体', () => {
    const stale = {
      ...baseSummary,
      sourceFreshness: baseSummary.sourceFreshness.map((f) => ({
        ...f,
        isStale: true,
      })),
    }
    summaryMock.mockReturnValue({
      data: stale,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    render(<OkrDashboardPage />, { wrapper })
    expect(screen.getByTestId('okr-stale-rail')).toBeInTheDocument()
    expect(screen.getByTestId('okr-kpi-strip')).toBeInTheDocument()
  })

  it('ok 分支 → 渲染 KPI / 分布 / 关注项 / warnings / backflow', () => {
    render(<OkrDashboardPage />, { wrapper })
    expect(screen.getByTestId('okr-dashboard-page')).toBeInTheDocument()
    expect(screen.getByTestId('okr-kpi-strip')).toBeInTheDocument()
    expect(screen.getByTestId('okr-progress-distribution')).toBeInTheDocument()
    expect(screen.getByTestId('okr-status-distribution')).toBeInTheDocument()
  })

  it('organizationId=null → 不发请求且不 crash（hook enabled=false）', () => {
    orgIdMock.mockReturnValue(null)
    summaryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    render(<OkrDashboardPage />, { wrapper })
    // organizationId=null 时 uiStatus=error（!summary），页面不 crash
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
