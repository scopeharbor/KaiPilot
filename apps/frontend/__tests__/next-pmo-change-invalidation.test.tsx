import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PmoChangeDecisionDialog } from '@/components/next/pmo/change-queue/PmoChangeDecisionDialog'
import {
  invalidatePmoChangeQueries,
  PMO_CHANGE_QUEUE_QUERY_KEY,
} from '@/components/next/pmo/change-queue/pmo-change-invalidation'
import { useAuthStore } from '@/stores/auth-store'
import type { ChangeRequest } from '@/lib/api/change-requests'

function setupJsdom() {
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventMock extends MouseEvent {}
    window.PointerEvent = PointerEventMock as unknown as typeof PointerEvent
  }
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }))
  }
}

function mockChangeRequest(overrides: Partial<ChangeRequest> = {}): ChangeRequest & {
  projectName?: string
} {
  return {
    id: 108,
    crCode: 'CR-2026-108',
    organizationId: 1,
    projectId: 42,
    projectName: '智慧园区二期',
    title: '调整核心调度模块交付范围',
    description: '重构批处理任务交付范围',
    changeType: 'scope',
    status: 'submitted',
    priority: 'high',
    requesterId: 5,
    approverId: null,
    requestedBy: 5,
    reviewedBy: null,
    impactSummary: null,
    impactAnalysis: null,
    conditions: null,
    decisionReason: null,
    approvalComments: null,
    submittedAt: '2026-09-08T10:00:00.000Z',
    approvedAt: null,
    implementedAt: null,
    implementedBy: null,
    closedAt: null,
    closedBy: null,
    createdAt: '2026-09-08T09:30:00.000Z',
    updatedAt: '2026-09-08T10:00:00.000Z',
    ...overrides,
  }
}

describe('PMO 变更审批成功后缓存集中失效联动（tasks 4.7 / 4.8）', () => {
  beforeEach(() => {
    setupJsdom()
    useAuthStore.setState({
      user: {
        id: 1,
        email: 'pmo@example.com',
        fullName: 'PMO 治理员',
        organizations: [{ id: 1, name: '主组织', slug: 'main', role: 'admin' }],
      },
      permissions: ['change_request:approve'],
      currentOrganizationId: 1,
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: mockChangeRequest({ status: 'approved' }) }),
        text: async () => JSON.stringify({ ok: true }),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('invalidatePmoChangeQueries 纯函数触发双重失效断言', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await invalidatePmoChangeQueries(queryClient, 42)

    // 1. 断言失效全局 PMO 变更队列缓存 ['pmo', 'change-queue']
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: PMO_CHANGE_QUEUE_QUERY_KEY }),
    )

    // 2. 断言失效项目级变更请求缓存 ['projects', 42, 'change-requests']
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['projects', 42, 'change-requests'] }),
    )

    // 3. 断言失效通用变更请求缓存 ['change-requests']
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['change-requests'] }),
    )
  })

  test('审批批准成功后触发 [pmo, change-queue] 与 [projects, projectId, change-requests] 双重失效', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const cr = mockChangeRequest({ projectId: 42 })

    render(
      <QueryClientProvider client={queryClient}>
        <PmoChangeDecisionDialog
          open={true}
          onOpenChange={vi.fn()}
          changeRequest={cr}
          action="approve"
        />
      </QueryClientProvider>,
    )

    const confirmBtn = screen.getByTestId('decision-confirm-button')
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      // 严苛断言双重失效
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['pmo', 'change-queue'] }),
      )
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['projects', 42, 'change-requests'] }),
      )
    })
  })

  test('驳回与退回修改成功后同样触发集中失效网联动', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const cr = mockChangeRequest({ projectId: 99 })

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <PmoChangeDecisionDialog
          open={true}
          onOpenChange={vi.fn()}
          changeRequest={cr}
          action="reject"
        />
      </QueryClientProvider>,
    )

    // 填写驳回理由
    const reasonInput = screen.getByTestId('decision-reason-input')
    fireEvent.change(reasonInput, { target: { value: '成本超出预算边界，暂缓实施' } })

    const confirmBtn = screen.getByTestId('decision-confirm-button')
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['pmo', 'change-queue'] }),
      )
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['projects', 99, 'change-requests'] }),
      )
    })

    unmount()
    invalidateSpy.mockClear()

    // 退回修改联动
    render(
      <QueryClientProvider client={queryClient}>
        <PmoChangeDecisionDialog
          open={true}
          onOpenChange={vi.fn()}
          changeRequest={cr}
          action="return"
        />
      </QueryClientProvider>,
    )

    const returnReasonInput = screen.getByTestId('decision-reason-input')
    fireEvent.change(returnReasonInput, { target: { value: '请补充环境隔离演练材料' } })

    const returnConfirmBtn = screen.getByTestId('decision-confirm-button')
    fireEvent.click(returnConfirmBtn)

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['pmo', 'change-queue'] }),
      )
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['projects', 99, 'change-requests'] }),
      )
    })
  })
})
