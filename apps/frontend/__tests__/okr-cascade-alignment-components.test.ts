// OKR 级联与对齐工作台组件测试
// v3-okr-cascade-and-alignment §5.7
// Vitest + @testing-library/react (JSDOM)

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// Mock all dependency hooks and API
vi.mock('@/hooks/use-okr', () => ({
  useOkrCycles: vi.fn(() => ({
    data: { data: [{ id: 1, title: '2026 Q3', status: 'active' }], meta: { total: 1 } },
    isLoading: false,
  })),
  useOkrTree: vi.fn(),
  useCreateOkrObjective: vi.fn(),
}))

vi.mock('@/hooks/use-okr-cascade-alignment', () => ({
  useCascadePlans: vi.fn(() => ({
    data: { data: [], meta: { total: 0 } },
    isLoading: false,
  })),
  useCascadePlan: vi.fn(() => ({
    data: { data: { id: 1, title: 'Test', status: 'draft', items: [], revisionHash: 'abc' } },
    isLoading: false,
    error: null,
  })),
  useCreateCascadePlan: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
  useConfirmCascadeItems: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useRejectCascadeItems: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useRelations: vi.fn(() => ({
    data: { data: [], meta: { total: 0 } },
    isLoading: false,
  })),
  useCreateRelation: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
  useUpdateRelation: vi.fn(() => ({
    mutateAsync: vi.fn(),
  })),
  useArchiveRelation: vi.fn(() => ({
    mutateAsync: vi.fn(),
  })),
  useHealthList: vi.fn(() => ({
    data: { data: [], meta: { total: 0 } },
    isLoading: false,
  })),
  useMatrix: vi.fn(() => ({
    data: { data: [], meta: { total: 0 } },
    isLoading: false,
  })),
  useAiCascadeSuggestions: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
  useRelation: vi.fn(),
  useHealth: vi.fn(),
  okrCascadeKeys: {
    all: ['okr-cascade'],
    plans: () => ['okr-cascade', 'plans'],
    aiSuggestions: () => ['ai'],
  },
}))

vi.mock('next/navigation', () => ({
  useParams: vi.fn(() => ({ organizationId: '1' })),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
  usePathname: vi.fn(() => '/okr-alignment'),
}))

// Mock auth store：模拟已选择组织，`selectEffectiveOrganizationId` 返回 7。
// 测试内可通过改 `mockAuthState.currentOrganizationId` 模拟"未选择组织"。
const mockAuthState: { currentOrganizationId: number | null } = { currentOrganizationId: 7 }

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn((selector: (state: typeof mockAuthState) => unknown) =>
    selector(mockAuthState),
  ),
  selectEffectiveOrganizationId: (state: { currentOrganizationId: number | null }) =>
    state.currentOrganizationId,
}))

import OkrAlignmentWorkbenchPage from '@/app/(dashboard)/okr-alignment/page'
import { CascadePlanDetailDrawer } from '@/components/views/okr/cascade-plan-detail-drawer'
import { AiCascadeSuggestionPanel } from '@/components/views/okr/ai-cascade-suggestion-panel'
import { AlignmentMatrixView } from '@/components/views/okr/alignment-matrix-view'
import { HealthDashboard } from '@/components/views/okr/health-dashboard'
import { asMock } from './_mock-types'

/** AiCascadeSuggestionPanel 的 mutation prop 类型（组件只用到 mutateAsync/isPending/error）。 */
type CascadeMutation = React.ComponentProps<typeof AiCascadeSuggestionPanel>['mutation']

// ── Helpers ─────────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('OkrAlignmentWorkbenchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 默认已选择组织，避免上一个用例的改写泄漏
    mockAuthState.currentOrganizationId = 7
  })

  it('renders the workbench title', async () => {
    render(React.createElement(OkrAlignmentWorkbenchPage), { wrapper: createWrapper() })
    expect(screen.getByText('OKR 级联与对齐')).toBeTruthy()
  })

  it('renders cycle selector', () => {
    render(React.createElement(OkrAlignmentWorkbenchPage), { wrapper: createWrapper() })
    expect(screen.getByLabelText('选择 OKR 周期')).toBeTruthy()
  })

  it('renders scope filter', () => {
    render(React.createElement(OkrAlignmentWorkbenchPage), { wrapper: createWrapper() })
    expect(screen.getByLabelText('按范围筛选')).toBeTruthy()
  })

  it('renders all three tabs', () => {
    render(React.createElement(OkrAlignmentWorkbenchPage), { wrapper: createWrapper() })
    expect(screen.getByText('级联计划')).toBeTruthy()
    expect(screen.getByText('关系矩阵')).toBeTruthy()
    expect(screen.getByText('健康仪表盘')).toBeTruthy()
  })

  it('renders AI suggestion button', () => {
    render(React.createElement(OkrAlignmentWorkbenchPage), { wrapper: createWrapper() })
    expect(screen.getByText('AI 级联建议')).toBeTruthy()
  })

  it('shows empty state when no cycle selected for cascade plans', () => {
    render(React.createElement(OkrAlignmentWorkbenchPage), { wrapper: createWrapper() })
    // Default active tab is cascade-plans, no cycle selected
    expect(screen.getByText('请先选择一个 OKR 周期。')).toBeTruthy()
  })

  it('sends queries with the auth store organization id (ghost param fix)', async () => {
    const { useOkrCycles } = await import('@/hooks/use-okr')
    const { useCascadePlans, useRelations, useHealthList, useMatrix } =
      await import('@/hooks/use-okr-cascade-alignment')

    render(React.createElement(OkrAlignmentWorkbenchPage), { wrapper: createWrapper() })

    // 组织 id 必须来自 auth store（7），而不是路由参数（NaN/undefined）
    expect(useOkrCycles).toHaveBeenCalledWith(7, {})
    expect(useCascadePlans).toHaveBeenCalledWith(7, {})
    expect(useRelations).toHaveBeenCalledWith(7, { page: 1, perPage: 100 })
    expect(useHealthList).toHaveBeenCalledWith(7, expect.objectContaining({}))
    expect(useMatrix).toHaveBeenCalledWith(7, expect.objectContaining({ depth: 5 }))
  })

  it('shows org-required alert and sends no query when no organization selected', async () => {
    const { useOkrCycles } = await import('@/hooks/use-okr')
    const { useCascadePlans, useMatrix } = await import('@/hooks/use-okr-cascade-alignment')
    mockAuthState.currentOrganizationId = null

    render(React.createElement(OkrAlignmentWorkbenchPage), { wrapper: createWrapper() })

    expect(screen.getByText('请先选择组织')).toBeTruthy()
    expect(useOkrCycles).not.toHaveBeenCalled()
    expect(useCascadePlans).not.toHaveBeenCalled()
    expect(useMatrix).not.toHaveBeenCalled()
  })
})

describe('CascadePlanDetailDrawer', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      React.createElement(CascadePlanDetailDrawer, {
        organizationId: 1,
        planId: 1,
        open: false,
        onClose: vi.fn(),
      }),
    )
    expect(container.innerHTML).toBe('')
  })
})

describe('AiCascadeSuggestionPanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      React.createElement(AiCascadeSuggestionPanel, {
        organizationId: 1,
        cycleId: 1,
        open: false,
        onClose: vi.fn(),
        onApplySuggestion: vi.fn(),
        mutation: asMock<CascadeMutation>({ mutateAsync: vi.fn(), isPending: false, error: null }),
      }),
    )
    expect(container.innerHTML).toBe('')
  })

  it('shows preview-only warning when open', () => {
    render(
      React.createElement(AiCascadeSuggestionPanel, {
        organizationId: 1,
        cycleId: 1,
        open: true,
        onClose: vi.fn(),
        onApplySuggestion: vi.fn(),
        mutation: asMock<CascadeMutation>({ mutateAsync: vi.fn(), isPending: false, error: null }),
      }),
    )
    expect(screen.getByText(/仅预览/)).toBeTruthy()
    expect(screen.getByText(/AI 建议不会自动落库/)).toBeTruthy()
  })

  it('shows preview disclaimer text', () => {
    render(
      React.createElement(AiCascadeSuggestionPanel, {
        organizationId: 1,
        cycleId: 1,
        open: true,
        onClose: vi.fn(),
        onApplySuggestion: vi.fn(),
        mutation: asMock<CascadeMutation>({ mutateAsync: vi.fn(), isPending: false, error: null }),
      }),
    )
    expect(screen.getByText(/AI 生成的级联建议仅供参考/)).toBeTruthy()
  })
})

describe('AlignmentMatrixView', () => {
  it('shows empty message when no rows', () => {
    render(
      React.createElement(AlignmentMatrixView, {
        organizationId: 1,
        rows: [],
        relations: [],
        loading: false,
        onCreateRelation: vi.fn(),
        onUpdateRelation: vi.fn(),
        onArchiveRelation: vi.fn(),
      }),
    )
    expect(screen.getByText('请先选择一个 OKR 周期以查看关系矩阵。')).toBeTruthy()
  })

  it('shows loading state', () => {
    render(
      React.createElement(AlignmentMatrixView, {
        organizationId: 1,
        rows: [],
        relations: [],
        loading: true,
        onCreateRelation: vi.fn(),
        onUpdateRelation: vi.fn(),
        onArchiveRelation: vi.fn(),
      }),
    )
    expect(screen.getByText('加载关系矩阵...')).toBeTruthy()
  })
})

describe('HealthDashboard', () => {
  it('shows empty message when no items', () => {
    render(
      React.createElement(HealthDashboard, {
        organizationId: 1,
        items: [],
        loading: false,
      }),
    )
    expect(screen.getByText('请先选择一个 OKR 周期以查看健康仪表盘。')).toBeTruthy()
  })
})
