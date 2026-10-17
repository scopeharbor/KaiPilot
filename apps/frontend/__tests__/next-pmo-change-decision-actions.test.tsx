import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PmoChangeDecisionDialog } from '@/components/next/pmo/change-queue/PmoChangeDecisionDialog'
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
      dispatchEvent: vi.fn(),
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

interface FetchRecord {
  url: string
  method: string
  body: unknown
}

function installFetchSpy() {
  const records: FetchRecord[] = []
  const fetchMock = vi
    .fn()
    .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      let parsedBody: unknown = null
      if (init?.body && typeof init.body === 'string') {
        try {
          parsedBody = JSON.parse(init.body)
        } catch {
          parsedBody = init.body
        }
      }
      records.push({ url: rawUrl, method, body: parsedBody })

      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          data: mockChangeRequest({
            status:
              method === 'POST' && rawUrl.includes('/approve')
                ? 'approved'
                : rawUrl.includes('/reject')
                  ? 'rejected'
                  : 'returned',
          }),
        }),
        text: async () => JSON.stringify({ ok: true }),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      }
    })

  vi.stubGlobal('fetch', fetchMock)
  return { records, fetchMock }
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('PmoChangeDecisionDialog（审批决策提交与两阶段确认交互）', () => {
  beforeEach(() => {
    setupJsdom()
    useAuthStore.setState({
      user: {
        id: 1,
        email: 'pmo@example.com',
        fullName: 'PMO 总监',
        organizations: [{ id: 1, name: '主组织', slug: 'main', role: 'admin' }],
      },
      permissions: ['change_request:approve'],
      currentOrganizationId: 1,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('测试批准二次确认提交与参数打包', async () => {
    const { records } = installFetchSpy()
    const cr = mockChangeRequest()
    const onOpenChange = vi.fn()
    const onSuccess = vi.fn()

    renderWithClient(
      <PmoChangeDecisionDialog
        open={true}
        onOpenChange={onOpenChange}
        changeRequest={cr}
        action="approve"
        onSuccess={onSuccess}
      />,
    )

    // 二次确认标题
    expect(screen.getByText('批准变更请求 - 二次确认')).toBeInTheDocument()

    // 录入条件与理由
    const conditionsInput = screen.getByTestId('decision-conditions-input')
    const reasonInput = screen.getByTestId('decision-reason-input')

    fireEvent.change(conditionsInput, { target: { value: '前置自动化集成测试需 100% 通过' } })
    fireEvent.change(reasonInput, { target: { value: '架构评审合规，准予批准' } })

    const confirmBtn = screen.getByTestId('decision-confirm-button')
    expect(confirmBtn).not.toBeDisabled()
    expect(confirmBtn).toHaveTextContent('确认批准')

    fireEvent.click(confirmBtn)

    await waitFor(() => {
      const approveCall = records.find(
        (r) => r.method === 'POST' && r.url.includes('/change-requests/108/approve'),
      )
      expect(approveCall).toBeDefined()
      expect(approveCall?.body).toEqual(
        expect.objectContaining({
          conditions: '前置自动化集成测试需 100% 通过',
          decisionReason: '架构评审合规，准予批准',
        }),
      )
    })
  })

  test('测试驳回时理由为空禁止提交（长度 ≥ 5 字符物理守卫）', async () => {
    const { records } = installFetchSpy()
    const cr = mockChangeRequest()

    renderWithClient(
      <PmoChangeDecisionDialog
        open={true}
        onOpenChange={vi.fn()}
        changeRequest={cr}
        action="reject"
      />,
    )

    expect(screen.getByText('驳回变更请求 - 二次确认')).toBeInTheDocument()

    const confirmBtn = screen.getByTestId('decision-confirm-button')
    const reasonInput = screen.getByTestId('decision-reason-input')

    // 1. 理由为空时提交按钮必须禁用
    expect(confirmBtn).toBeDisabled()

    // 2. 理由长度小于 5（例如 3 字符）仍然禁用并显示校验提示
    fireEvent.change(reasonInput, { target: { value: '不通过' } })
    expect(confirmBtn).toBeDisabled()
    expect(screen.getByTestId('decision-reason-error')).toHaveTextContent(
      '驳回变更必须提供决策理由（至少 5 个字符）',
    )

    // 3. 补充至完整理由（>= 5 字符）解锁提交
    fireEvent.change(reasonInput, { target: { value: '设计方案不满足微服务解耦规范' } })
    expect(confirmBtn).not.toBeDisabled()

    fireEvent.click(confirmBtn)

    await waitFor(() => {
      const rejectCall = records.find(
        (r) => r.method === 'POST' && r.url.includes('/change-requests/108/reject'),
      )
      expect(rejectCall).toBeDefined()
      expect(rejectCall?.body).toEqual(
        expect.objectContaining({
          decisionReason: '设计方案不满足微服务解耦规范',
        }),
      )
    })
  })

  test('测试退回修改参数打包与必填校验', async () => {
    const { records } = installFetchSpy()
    const cr = mockChangeRequest()

    renderWithClient(
      <PmoChangeDecisionDialog
        open={true}
        onOpenChange={vi.fn()}
        changeRequest={cr}
        action="return"
      />,
    )

    expect(screen.getByText('退回修改变更请求 - 二次确认')).toBeInTheDocument()

    const confirmBtn = screen.getByTestId('decision-confirm-button')
    const reasonInput = screen.getByTestId('decision-reason-input')

    expect(confirmBtn).toBeDisabled()

    fireEvent.change(reasonInput, { target: { value: '请补充详细成本测算清单与排期表' } })
    expect(confirmBtn).not.toBeDisabled()

    fireEvent.click(confirmBtn)

    await waitFor(() => {
      const returnCall = records.find(
        (r) => r.method === 'POST' && r.url.includes('/change-requests/108/return'),
      )
      expect(returnCall).toBeDefined()
      expect(returnCall?.body).toEqual(
        expect.objectContaining({
          decisionReason: '请补充详细成本测算清单与排期表',
        }),
      )
    })
  })

  test('测试提交后成功提示与状态更新回调', async () => {
    installFetchSpy()
    const cr = mockChangeRequest()
    const onSuccess = vi.fn()

    renderWithClient(
      <PmoChangeDecisionDialog
        open={true}
        onOpenChange={vi.fn()}
        changeRequest={cr}
        action="approve"
        onSuccess={onSuccess}
      />,
    )

    const confirmBtn = screen.getByTestId('decision-confirm-button')
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(screen.getByTestId('decision-success-alert')).toBeInTheDocument()
      expect(screen.getByTestId('decision-success-alert')).toHaveTextContent(
        '变更请求已成功批准，进入实施推进',
      )
      expect(onSuccess).toHaveBeenCalledWith('approve')
    })
  })
})
