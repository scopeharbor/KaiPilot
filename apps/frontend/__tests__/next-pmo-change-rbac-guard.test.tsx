import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PmoChangeApprovalDrawer } from '@/components/next/pmo/change-queue/PmoChangeApprovalDrawer'
import { PmoChangeRbacGuard } from '@/components/next/pmo/change-queue/PmoChangeRbacGuard'
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

function mockChangeRequest(): ChangeRequest & { projectName?: string } {
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
  }
}

interface FetchRecord {
  url: string
  method: string
}

function installNetworkMonitor() {
  const records: FetchRecord[] = []
  const fetchMock = vi
    .fn()
    .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      records.push({ url: rawUrl, method })

      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
        text: async () => JSON.stringify({ data: [] }),
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

describe('PMO 变更审批 RBAC 权限守卫与操作阻断（tasks 4.5 / 4.6 / RL-06）', () => {
  beforeEach(() => {
    setupJsdom()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('持有 change_request:approve 权限正常显示全部审批操作按钮', () => {
    useAuthStore.setState({
      user: {
        id: 1,
        email: 'manager@example.com',
        fullName: '治理专员',
        organizations: [{ id: 1, name: '主组织', slug: 'main', role: 'manager' }],
      },
      permissions: ['change_request:approve'],
      currentOrganizationId: 1,
    })

    const cr = mockChangeRequest()
    renderWithClient(
      <PmoChangeApprovalDrawer open={true} onOpenChange={vi.fn()} changeRequest={cr} />,
    )

    // 审批操作按钮组正常呈现
    expect(screen.getByTestId('btn-approve')).toBeInTheDocument()
    expect(screen.getByTestId('btn-reject')).toBeInTheDocument()
    expect(screen.getByTestId('btn-return')).toBeInTheDocument()

    // 不展示灰色小锁只读模式
    expect(screen.queryByTestId('read-only-review-lock')).toBeNull()
  })

  test('只读角色（无 change_request:approve 权限）写按钮物理隐藏，呈现灰色小锁只读模式', () => {
    useAuthStore.setState({
      user: {
        id: 99,
        email: 'viewer@example.com',
        fullName: '访客',
        organizations: [{ id: 1, name: '主组织', slug: 'main', role: 'viewer' }],
      },
      permissions: ['change_request:view'], // 无 approve 权限
      currentOrganizationId: 1,
    })

    const cr = mockChangeRequest()
    renderWithClient(
      <PmoChangeApprovalDrawer open={true} onOpenChange={vi.fn()} changeRequest={cr} />,
    )

    // 写操作按钮物理隐藏
    expect(screen.queryByTestId('btn-approve')).toBeNull()
    expect(screen.queryByTestId('btn-reject')).toBeNull()
    expect(screen.queryByTestId('btn-return')).toBeNull()

    // 呈现灰色小锁只读审阅模式文案
    const lock = screen.getByTestId('read-only-review-lock')
    expect(lock).toBeInTheDocument()
    expect(screen.getByText('只读审阅模式')).toBeInTheDocument()
    expect(screen.getByText(/无变更审批权限 change_request:approve/)).toBeInTheDocument()
  })

  test('PmoChangeRbacGuard 独立封装组件权限门控与 fallback 行为', () => {
    // 1. 无权限时展示默认锁定提示
    useAuthStore.setState({
      user: { id: 2, email: 'user@example.com', fullName: '普通成员', organizations: [] },
      permissions: [],
      currentOrganizationId: 1,
    })

    const { rerender } = renderWithClient(
      <PmoChangeRbacGuard>
        <button data-testid="test-action-button">提交审批</button>
      </PmoChangeRbacGuard>,
    )

    expect(screen.queryByTestId('test-action-button')).toBeNull()
    expect(screen.getByTestId('read-only-review-lock')).toBeInTheDocument()

    // 2. 自定义 fallback
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PmoChangeRbacGuard fallback={<div data-testid="custom-fallback">受限访问</div>}>
          <button data-testid="test-action-button">提交审批</button>
        </PmoChangeRbacGuard>
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument()
    expect(screen.queryByTestId('test-action-button')).toBeNull()

    // 3. 授权后正常呈现 children
    act(() => {
      useAuthStore.setState({
        permissions: ['change_request:approve'],
      })
    })

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PmoChangeRbacGuard>
          <button data-testid="test-action-button">提交审批</button>
        </PmoChangeRbacGuard>
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('test-action-button')).toBeInTheDocument()
  })

  test('严苛断言：只读状态下网络监控绝对 0 写请求发包（RL-06）', () => {
    const { records } = installNetworkMonitor()

    useAuthStore.setState({
      user: {
        id: 99,
        email: 'viewer@example.com',
        fullName: '审计人员',
        organizations: [{ id: 1, name: '主组织', slug: 'main', role: 'auditor' }],
      },
      permissions: ['change_request:view'],
      currentOrganizationId: 1,
    })

    const cr = mockChangeRequest()
    renderWithClient(
      <PmoChangeApprovalDrawer open={true} onOpenChange={vi.fn()} changeRequest={cr} />,
    )

    // 审查网络监控记录：严苛断言所有非 GET 请求数为 0
    const writeRequests = records.filter(
      (r) =>
        r.method === 'POST' || r.method === 'PUT' || r.method === 'PATCH' || r.method === 'DELETE',
    )
    expect(writeRequests.length).toBe(0)
  })
})
