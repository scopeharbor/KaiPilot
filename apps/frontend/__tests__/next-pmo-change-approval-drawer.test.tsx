import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PmoChangeApprovalDrawer } from '@/components/next/pmo/change-queue/PmoChangeApprovalDrawer'
import { useAuthStore } from '@/stores/auth-store'
import type { ChangeImpactAnalysis, ChangeRequest } from '@/lib/api/change-requests'

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
  projectKey?: string
} {
  return {
    id: 108,
    crCode: 'CR-2026-108',
    organizationId: 1,
    projectId: 42,
    projectName: '智慧园区二期',
    projectKey: 'SP-II',
    title: '调整核心调度模块交付范围与前置依赖',
    description: '因底层接口协议重构，调整批处理任务交付范围并增加演练验证阶段。',
    changeType: 'scope',
    status: 'submitted',
    priority: 'high',
    requesterId: 5,
    approverId: null,
    requestedBy: 5,
    reviewedBy: null,
    impactSummary: {
      scope: '涉及 3 项子模块范围调整',
      schedule: '预计关键里程碑向后顺延 2 天',
      resources: '增加后端专家投入 1.5 人天',
      cost: '测试演练预估支出增加 3000 元',
      risks: '接口兼容性回滚风险中等',
      assumptions: '假设第三方依赖已准时冻结',
    },
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

function mockImpactAnalysis(overrides: Partial<ChangeImpactAnalysis> = {}): ChangeImpactAnalysis {
  return {
    id: 301,
    organizationId: 1,
    projectId: 42,
    changeRequestId: 108,
    status: 'completed',
    ruleVersion: 'R1.4',
    inputSignature: 'sig-abc',
    summary: {
      totalAffected: 5,
      severityDistribution: { critical: 0, high: 2, medium: 2, low: 1, none: 0 },
      dimensionSummaries: [
        { dimension: 'scope', affectedCount: 3, highestSeverity: 'high', topEvidence: [] },
        { dimension: 'schedule', affectedCount: 2, highestSeverity: 'high', topEvidence: [] },
        { dimension: 'resource', affectedCount: 1, highestSeverity: 'medium', topEvidence: [] },
        { dimension: 'risk', affectedCount: 1, highestSeverity: 'medium', topEvidence: [] },
        { dimension: 'assumption', affectedCount: 1, highestSeverity: 'low', topEvidence: [] },
      ],
      criticalPathAffected: true,
      hasBlockingWarnings: false,
    },
    items: [],
    warnings: [],
    missingInputs: null,
    isStale: false,
    staleReason: null,
    aiExplanation: null,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: '2026-09-08T10:05:00.000Z',
    ...overrides,
  }
}

function renderDrawer(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('PmoChangeApprovalDrawer（PMO 变更审查与审批决策抽屉）', () => {
  beforeEach(() => {
    setupJsdom()
    useAuthStore.setState({
      user: {
        id: 1,
        email: 'pmo@example.com',
        fullName: 'PMO 总监',
        organizations: [{ id: 1, name: '主组织', slug: 'main', role: 'admin' }],
      },
      permissions: ['change_request:approve', 'change_request:create'],
      currentOrganizationId: 1,
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
        text: async () => JSON.stringify({ data: [] }),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('测试抽屉平滑展开与容器渲染', () => {
    const cr = mockChangeRequest()
    renderDrawer(<PmoChangeApprovalDrawer open={true} onOpenChange={vi.fn()} changeRequest={cr} />)

    const drawer = screen.getByTestId('pmo-change-approval-drawer')
    expect(drawer).toBeInTheDocument()
    expect(drawer).toHaveAttribute('data-pmo-approval-drawer', 'true')
  })

  test('测试变更基础字段与叙述完整呈现', () => {
    const cr = mockChangeRequest()
    renderDrawer(<PmoChangeApprovalDrawer open={true} onOpenChange={vi.fn()} changeRequest={cr} />)

    // CR 编码、标题、状态、优先级
    expect(screen.getByTestId('drawer-cr-code')).toHaveTextContent('CR-2026-108')
    expect(screen.getByTestId('drawer-change-title')).toHaveTextContent(
      '调整核心调度模块交付范围与前置依赖',
    )
    expect(screen.getByTestId('drawer-status-badge')).toHaveTextContent('已提交')
    expect(screen.getByTestId('drawer-priority-badge')).toHaveTextContent('高')

    // 元数据网格（项目、申请人、类型、提交时间）
    expect(screen.getByTestId('drawer-project')).toHaveTextContent('智慧园区二期')
    expect(screen.getByTestId('drawer-requester')).toHaveTextContent('5')
    expect(screen.getByTestId('drawer-type')).toHaveTextContent('范围')
    expect(screen.getByTestId('drawer-submitted-at')).toBeInTheDocument()

    // 详细叙述
    expect(screen.getByTestId('drawer-description')).toHaveTextContent(
      '因底层接口协议重构，调整批处理任务交付范围并增加演练验证阶段。',
    )
  })

  test('测试六维影响快照柱状指标展示', () => {
    const cr = mockChangeRequest()
    const analysis = mockImpactAnalysis()

    renderDrawer(
      <PmoChangeApprovalDrawer
        open={true}
        onOpenChange={vi.fn()}
        changeRequest={cr}
        impactAnalysis={analysis}
      />,
    )

    // 整体面板与柱状容器
    expect(screen.getByTestId('pmo-change-impact-penetration-panel')).toBeInTheDocument()
    expect(screen.getByTestId('impact-bar-indicator')).toBeInTheDocument()

    // 六维各项柱状指标
    expect(screen.getByTestId('impact-bar-scope')).toBeInTheDocument()
    expect(screen.getByTestId('impact-bar-schedule')).toBeInTheDocument()
    expect(screen.getByTestId('impact-bar-resources')).toBeInTheDocument()
    expect(screen.getByTestId('impact-bar-cost')).toBeInTheDocument()
    expect(screen.getByTestId('impact-bar-risks')).toBeInTheDocument()
    expect(screen.getByTestId('impact-bar-assumptions')).toBeInTheDocument()

    // 受影响实体统计
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  test('测试分析快照过期（isStale）时的琥珀色警告标记展示与恢复', () => {
    const cr = mockChangeRequest()
    const staleAnalysis = mockImpactAnalysis({
      isStale: true,
      staleReason: '项目基准版本发布，甘特排程发生变动',
    })

    const { rerender } = renderDrawer(
      <PmoChangeApprovalDrawer
        open={true}
        onOpenChange={vi.fn()}
        changeRequest={cr}
        impactAnalysis={staleAnalysis}
      />,
    )

    // 存在琥珀色警告标记
    const warning = screen.getByTestId('impact-stale-warning')
    expect(warning).toBeInTheDocument()
    expect(warning).toHaveAttribute('data-pmo-impact-stale', 'true')
    expect(warning).toHaveTextContent('分析快照已过期')
    expect(warning).toHaveTextContent('项目基准版本发布，甘特排程发生变动')

    // 未过期时不展示警告
    const freshAnalysis = mockImpactAnalysis({ isStale: false, staleReason: null })
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PmoChangeApprovalDrawer
          open={true}
          onOpenChange={vi.fn()}
          changeRequest={cr}
          impactAnalysis={freshAnalysis}
        />
      </QueryClientProvider>,
    )

    expect(screen.queryByTestId('impact-stale-warning')).toBeNull()
  })
})
