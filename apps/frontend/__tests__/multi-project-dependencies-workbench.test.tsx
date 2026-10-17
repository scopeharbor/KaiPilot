/**
 * 跨项目依赖工作台页面组件测试
 * v3-multi-project-dependency-crud §8.7
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- 测试 mock 组件 props 用 any 是测试惯例 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import MultiProjectDependenciesWorkbench from '@/app/(dashboard)/pmo/dependencies/page'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// Mock hooks
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: vi.fn(),
}))

vi.mock('@/hooks/use-organization-id', () => ({
  useOrganizationId: vi.fn(() => 'org-test-1'),
}))

// 用 vi.hoisted 持有 useMpdList / useMpdGraph 的 mock 引用，供测试用例直接 mockReturnValue。
const { mockUseMpdList, mockUseMpdGraph } = vi.hoisted(() => ({
  // 返回值形状按用例逐个 mockReturnValue 覆盖，故这里放宽为 any，
  // 否则会被初值收窄成 { data: null }。
  mockUseMpdList: vi.fn((): any => ({
    data: null,
    isLoading: true,
    error: null,
  })),
  mockUseMpdGraph: vi.fn((): any => ({
    data: null,
    isLoading: false,
    isError: false,
    error: null,
  })),
}))

vi.mock('@/hooks/use-multi-project-dependencies', () => ({
  useMpdList: mockUseMpdList,
  useMpdDetail: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
  })),
  useMpdCreatePreview: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useMpdConfirmCreate: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useMpdUpdatePreview: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useMpdConfirmUpdate: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useMpdArchivePreview: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useMpdConfirmArchive: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useMpdRestorePreview: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useMpdConfirmRestore: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useMpdDeletePreview: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useMpdConfirmDelete: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useMpdGraph: mockUseMpdGraph,
}))

vi.mock('@/components/views/pmo/MultiProjectDependencyGraph', () => ({
  __esModule: true,
  default: ({ response, isLoading, isError, isEmpty, isFeatureDisabled, isNoPermission }: any) => {
    if (isFeatureDisabled) return <div data-testid="graph-feature-disabled">图谱功能已禁用</div>
    if (isNoPermission) return <div data-testid="graph-no-permission">无图谱权限</div>
    if (isLoading) return <div data-testid="graph-loading">图谱加载中</div>
    if (isError) return <div data-testid="graph-error">图谱加载失败</div>
    if (isEmpty || !response || response.nodes.length === 0) {
      return <div data-testid="graph-empty">暂无图谱数据</div>
    }
    return <div data-testid="graph-rendered">{response.nodes.length} 节点</div>
  },
}))

// 用 vi.hoisted 声明 mock 函数引用，确保 vi.mock 工厂（被 hoist 到文件顶部）能访问。
const { mockUseSearchParams, mockUseRouter } = vi.hoisted(() => ({
  mockUseSearchParams: vi.fn(() => new URLSearchParams()),
  mockUseRouter: vi.fn(() => ({ push: vi.fn() })),
}))

vi.mock('next/navigation', () => ({
  useRouter: mockUseRouter,
  useSearchParams: mockUseSearchParams,
}))

// 工具：覆写 next/navigation 的 useSearchParams 返回值
function setSearchParams(params: Record<string, string> = {}) {
  const sp = new URLSearchParams(params)
  mockUseSearchParams.mockReturnValue(sp)
}

// Mock UI components
vi.mock('@/components/ui/Select', () => ({
  Select: ({ children }: any) => <div data-testid="select">{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => <div />,
}))

vi.mock('@/components/ui/Sheet', () => ({
  Sheet: ({ children }: any) => <div>{children}</div>,
  SheetContent: ({ children }: any) => <div>{children}</div>,
  SheetDescription: ({ children }: any) => <div>{children}</div>,
  SheetHeader: ({ children }: any) => <div>{children}</div>,
  SheetTitle: () => <div />,
}))

vi.mock('@/components/ui/Dialog', () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: () => <div />,
}))

vi.mock('@/components/ui/Table', () => ({
  Table: ({ children }: any) => <table>{children}</table>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableCell: ({ children }: any) => <td>{children}</td>,
  TableHead: ({ children }: any) => <th>{children}</th>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableRow: ({ children }: any) => <tr>{children}</tr>,
}))

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(MultiProjectDependenciesWorkbench),
    ),
  )
}

import { usePermissions as mockedUsePermissions } from '@/hooks/use-permissions'

function setCanAny(canView: boolean, canManage: boolean) {
  vi.mocked(mockedUsePermissions).mockReturnValue({
    canAny: (perms: string[]) => {
      if (perms.includes('dependency.manage') || perms.includes('pmo')) return canManage
      if (perms.includes('dependency.view')) return canView
      return false
    },
  } as unknown as ReturnType<typeof mockedUsePermissions>)
}

describe('MultiProjectDependenciesWorkbench', () => {
  it('shows loading skeleton when loading', () => {
    setCanAny(true, true)
    renderPage()
    // Loading state renders skeletons
    expect(screen.getByText('跨项目依赖管理')).toBeTruthy()
  })

  it('shows no-permission state for unauthorized users', () => {
    setCanAny(false, false)
    renderPage()
    expect(screen.getByText('无权限')).toBeTruthy()
  })

  it('shows empty state when no dependencies exist', () => {
    setCanAny(true, true)
    mockUseMpdList.mockReturnValue({
      data: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } },
      isLoading: false,
      error: null,
    })
    renderPage()
    expect(screen.getByText('暂无跨项目依赖记录')).toBeTruthy()
  })

  it('renders create button for users with manage permission', () => {
    setCanAny(true, true)
    mockUseMpdList.mockReturnValue({
      data: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } },
      isLoading: false,
      error: null,
    })
    renderPage()
    expect(screen.getByText('新建依赖')).toBeTruthy()
  })

  it('does not render create button for view-only users', () => {
    setCanAny(true, false)
    mockUseMpdList.mockReturnValue({
      data: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } },
      isLoading: false,
      error: null,
    })
    renderPage()
    expect(screen.queryByText('新建依赖')).toBeNull()
  })

  it('renders table with dependency data', () => {
    setCanAny(true, true)
    mockUseMpdList.mockReturnValue({
      data: {
        data: [
          {
            id: 'dep-1',
            organizationId: 'org-test-1',
            provider: {
              type: 'task',
              id: 't1',
              projectId: 'p1',
              projectName: 'P1',
              label: '任务A',
              isRedacted: false,
            },
            consumer: {
              type: 'task',
              id: 't2',
              projectId: 'p2',
              projectName: 'P2',
              label: '任务B',
              isRedacted: false,
            },
            category: 'deliverable',
            type: 'FS',
            lagDays: 0,
            strength: 'moderate',
            bufferDays: 5,
            status: 'active',
            risk: 'low',
            sourceMode: 'manual',
            freshnessSignature: '',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            warningCodes: [],
          },
        ],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      },
      isLoading: false,
      error: null,
    })
    renderPage()
    expect(screen.getAllByText('任务A').length).toBeGreaterThan(0)
    expect(screen.getAllByText('任务B').length).toBeGreaterThan(0)
  })

  it('shows redacted marker for restricted endpoints', () => {
    setCanAny(true, true)
    mockUseMpdList.mockReturnValue({
      data: {
        data: [
          {
            id: 'dep-1',
            organizationId: 'org-test-1',
            provider: {
              type: 'task',
              id: 't1',
              projectId: 'p1',
              projectName: 'P1',
              label: '***',
              isRedacted: true,
            },
            consumer: {
              type: 'task',
              id: 't2',
              projectId: 'p2',
              projectName: 'P2',
              label: '任务B',
              isRedacted: false,
            },
            category: 'technical',
            type: 'SS',
            lagDays: 0,
            strength: 'moderate',
            bufferDays: 0,
            status: 'active',
            risk: 'medium',
            sourceMode: 'manual',
            freshnessSignature: '',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            warningCodes: ['ENDPOINT_REDACTED'],
          },
        ],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      },
      isLoading: false,
      error: null,
    })
    renderPage()
    expect(screen.getAllByText('***').length).toBeGreaterThan(0)
  })
})

// ── Graph View Tests（v3-multi-project-dependency-graph §5.1-5.11） ──

describe('MultiProjectDependenciesWorkbench - Graph View', () => {
  const mockGraphData = {
    data: {
      nodes: [
        {
          nodeId: 'node-1',
          endpoint: {
            endpointType: 'project',
            projectId: 1,
            projectName: '项目 A',
            taskId: null,
            taskName: null,
            milestoneId: null,
            milestoneName: null,
            externalLabel: null,
            redacted: false,
          },
          label: '项目 A',
          redacted: false,
          redactionReason: null,
          dependencyCount: 1,
          riskSummary: { critical: 0, high: 0, medium: 1, low: 0 },
          drillDownRef: null,
        },
        {
          nodeId: 'node-2',
          endpoint: {
            endpointType: 'project',
            projectId: 2,
            projectName: '项目 B',
            taskId: null,
            taskName: null,
            milestoneId: null,
            milestoneName: null,
            externalLabel: null,
            redacted: false,
          },
          label: '项目 B',
          redacted: false,
          redactionReason: null,
          dependencyCount: 1,
          riskSummary: { critical: 0, high: 0, medium: 1, low: 0 },
          drillDownRef: null,
        },
      ],
      edges: [
        {
          edgeId: 1,
          sourceNodeId: 'node-1',
          targetNodeId: 'node-2',
          category: 'deliverable',
          type: 'fs',
          status: 'active',
          riskLevel: 'medium',
          bufferDays: 2,
          lagDays: 0,
          freshness: 'fresh',
          drillDownRef: null,
          warningCodes: [],
        },
      ],
      visibleNodeCount: 2,
      redactedNodeCount: 0,
      visibleEdgeCount: 1,
      truncated: false,
      truncationReason: null,
      warningCodes: [],
      freshnessMeta: {
        checkedAt: new Date().toISOString(),
        staleCount: 0,
        freshCount: 1,
      },
    },
  }

  function mockGraphLoading() {
    mockUseMpdGraph.mockReturnValue({
      data: null,
      isLoading: true,
      isError: false,
      error: null,
    })
  }

  function mockGraphSuccess() {
    mockUseMpdGraph.mockReturnValue({
      data: mockGraphData,
      isLoading: false,
      isError: false,
      error: null,
    })
  }

  function mockGraphError(code = 'FEATURE_DISABLED') {
    mockUseMpdGraph.mockReturnValue({
      data: null,
      isLoading: false,
      isError: true,
      error: { code, message: '图谱功能未启用' },
    })
  }

  it('renders graph view when view=graph (§5.1)', () => {
    setCanAny(true, true)
    setSearchParams({ view: 'graph' })
    mockGraphSuccess()
    renderPage()
    expect(screen.getByTestId('graph-rendered')).toBeTruthy()
    expect(screen.getByText('2 节点')).toBeTruthy()
  })

  it('renders list view by default (§5.1)', () => {
    setCanAny(true, true)
    setSearchParams({})
    mockUseMpdList.mockReturnValue({
      data: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } },
      isLoading: false,
      error: null,
    })
    renderPage()
    expect(screen.queryByTestId('graph-rendered')).toBeNull()
  })

  it('shows graph loading state (§5.4)', () => {
    setCanAny(true, true)
    setSearchParams({ view: 'graph' })
    mockGraphLoading()
    renderPage()
    expect(screen.getByTestId('graph-loading')).toBeTruthy()
  })

  it('shows graph feature-disabled state (§5.4, §5.7)', () => {
    setCanAny(true, true)
    setSearchParams({ view: 'graph' })
    mockGraphError('FEATURE_DISABLED')
    renderPage()
    expect(screen.getByTestId('graph-feature-disabled')).toBeTruthy()
  })

  it('shows graph no-permission state (§5.7)', () => {
    setCanAny(true, true)
    setSearchParams({ view: 'graph' })
    mockGraphError('PERMISSION_DENIED')
    renderPage()
    expect(screen.getByTestId('graph-no-permission')).toBeTruthy()
  })

  it('shows graph error state (§5.4)', () => {
    setCanAny(true, true)
    setSearchParams({ view: 'graph' })
    mockGraphError('AI_SERVICE_ERROR')
    renderPage()
    expect(screen.getByTestId('graph-error')).toBeTruthy()
  })

  it('shows graph empty state when no nodes (§5.4)', () => {
    setCanAny(true, true)
    setSearchParams({ view: 'graph' })
    mockUseMpdGraph.mockReturnValue({
      data: { data: { ...mockGraphData.data, nodes: [], visibleNodeCount: 0 } },
      isLoading: false,
      isError: false,
      error: null,
    })
    renderPage()
    expect(screen.getByTestId('graph-empty')).toBeTruthy()
  })

  it('URL restores view=graph with filters (§5.3)', () => {
    setCanAny(true, true)
    setSearchParams({
      view: 'graph',
      status: 'active',
      risk: 'high',
      layoutMode: 'radial',
      depth: '5',
    })
    mockGraphSuccess()
    renderPage()
    // 图谱视图被渲染，说明 view=graph 被正确恢复
    expect(screen.getByTestId('graph-rendered')).toBeTruthy()
    // useMpdGraph 应被调用（view=graph 时启用）
    expect(mockUseMpdGraph).toHaveBeenCalled()
  })

  it('view toggle buttons present (§5.2)', () => {
    setCanAny(true, true)
    setSearchParams({})
    mockUseMpdList.mockReturnValue({
      data: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } },
      isLoading: false,
      error: null,
    })
    renderPage()
    expect(screen.getByText('列表')).toBeTruthy()
    expect(screen.getByText('图谱')).toBeTruthy()
  })
})
