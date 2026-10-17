// OKR 进度回流前端测试（v3-okr-progress-backflow §5.5）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import OkrBackflowPanel from '@/components/views/okr/okr-backflow-panel'
import {
  makeOkrBackflowSuggestion,
  makeOkrBackflowContribution,
  makeOkrBackflowSourceRef,
  makeManualOverrideWarning,
  makeRestrictedSourceWarning,
  makeStaleSourceWarning,
} from '@aiproj/types'
import { asMock } from './_mock-types'

// Mock the hooks
vi.mock('@/hooks/use-okr', async () => {
  const actual = await vi.importActual('@/hooks/use-okr')
  return {
    ...(actual as Record<string, unknown>),
    useOkrBackflowSuggestions: vi.fn(),
    useRecalculateOkrBackflow: vi.fn(),
    useConfirmOkrBackflow: vi.fn(),
    useRejectOkrBackflow: vi.fn(),
  }
})

const {
  useOkrBackflowSuggestions,
  useRecalculateOkrBackflow,
  useConfirmOkrBackflow,
  useRejectOkrBackflow,
} = vi.mocked(await import('@/hooks/use-okr'))

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

function mockHookDefaults() {
  useOkrBackflowSuggestions.mockReturnValue(
    asMock({
      data: { data: [], meta: { total: 0, page: 1, perPage: 10, totalPages: 0 } },
      isLoading: false,
      error: null,
      isPending: false,
      isError: false,
      isSuccess: true,
      status: 'success',
    }),
  )
  useRecalculateOkrBackflow.mockReturnValue(
    asMock({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
      status: 'idle',
    }),
  )
  useConfirmOkrBackflow.mockReturnValue(
    asMock({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
      status: 'idle',
    }),
  )
  useRejectOkrBackflow.mockReturnValue(
    asMock({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
      status: 'idle',
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHookDefaults()
})

describe('OkrBackflowPanel', () => {
  it('renders loading state', () => {
    useOkrBackflowSuggestions.mockReturnValue(
      asMock({
        data: undefined,
        isLoading: true,
        error: null,
        isPending: true,
        isError: false,
        isSuccess: false,
        status: 'pending',
      }),
    )

    render(<OkrBackflowPanel organizationId={1} canManage={true} />, { wrapper })
    expect(screen.getByTestId('okr-backflow-loading')).toBeDefined()
  })

  it('renders error state', () => {
    useOkrBackflowSuggestions.mockReturnValue(
      asMock({
        data: undefined,
        isLoading: false,
        error: new Error('网络错误'),
        isPending: false,
        isError: true,
        isSuccess: false,
        status: 'error',
      }),
    )

    render(<OkrBackflowPanel organizationId={1} canManage={true} />, { wrapper })
    expect(screen.getByTestId('okr-backflow-error')).toBeDefined()
  })

  it('renders empty state when no suggestions', () => {
    useOkrBackflowSuggestions.mockReturnValue(
      asMock({
        data: { data: [], meta: { total: 0, page: 1, perPage: 10, totalPages: 1 } },
        isLoading: false,
        error: null,
        isPending: false,
        isError: false,
        isSuccess: true,
        status: 'success',
      }),
    )

    render(<OkrBackflowPanel organizationId={1} canManage={true} />, { wrapper })
    expect(screen.getByTestId('okr-backflow-empty')).toBeDefined()
  })

  it('renders suggestion cards', () => {
    const s = makeOkrBackflowSuggestion({
      id: 1,
      keyResultId: 5,
      proposedValue: 75,
      currentValue: 50,
      delta: 25,
      status: 'pending',
      contributions: [
        makeOkrBackflowContribution({
          source: makeOkrBackflowSourceRef({ kind: 'project', id: 10, progress: 75 }),
        }),
      ],
    })

    useOkrBackflowSuggestions.mockReturnValue(
      asMock({
        data: { data: [s], meta: { total: 1, page: 1, perPage: 10, totalPages: 1 } },
        isLoading: false,
        error: null,
        isPending: false,
        isError: false,
        isSuccess: true,
        status: 'success',
      }),
    )

    render(<OkrBackflowPanel organizationId={1} canManage={true} />, { wrapper })
    expect(screen.getByTestId('backflow-suggestion-1')).toBeDefined()
    expect(screen.getByText('50 → 75')).toBeDefined()
    expect(screen.getByTestId('source-chip-project-10')).toBeDefined()
  })

  it('shows confirm and reject buttons when canManage', () => {
    const s = makeOkrBackflowSuggestion({ id: 1, status: 'pending' })
    useOkrBackflowSuggestions.mockReturnValue(
      asMock({
        data: { data: [s], meta: { total: 1, page: 1, perPage: 10, totalPages: 1 } },
        isLoading: false,
        error: null,
        isPending: false,
        isError: false,
        isSuccess: true,
        status: 'success',
      }),
    )

    render(<OkrBackflowPanel organizationId={1} canManage={true} />, { wrapper })
    expect(screen.getByTestId('backflow-confirm-btn')).toBeDefined()
    expect(screen.getByTestId('backflow-reject-btn')).toBeDefined()
  })

  it('hides action buttons when not canManage', () => {
    const s = makeOkrBackflowSuggestion({ id: 1, status: 'pending' })
    useOkrBackflowSuggestions.mockReturnValue(
      asMock({
        data: { data: [s], meta: { total: 1, page: 1, perPage: 10, totalPages: 1 } },
        isLoading: false,
        error: null,
        isPending: false,
        isError: false,
        isSuccess: true,
        status: 'success',
      }),
    )

    render(<OkrBackflowPanel organizationId={1} canManage={false} />, { wrapper })
    expect(screen.queryByTestId('backflow-confirm-btn')).toBeNull()
  })

  it('shows restricted source warning', () => {
    const s = makeOkrBackflowSuggestion({
      id: 1,
      status: 'needs_review',
      warnings: [makeRestrictedSourceWarning()],
    })
    useOkrBackflowSuggestions.mockReturnValue(
      asMock({
        data: { data: [s], meta: { total: 1, page: 1, perPage: 10, totalPages: 1 } },
        isLoading: false,
        error: null,
        isPending: false,
        isError: false,
        isSuccess: true,
        status: 'success',
      }),
    )

    render(<OkrBackflowPanel organizationId={1} canManage={true} />, { wrapper })
    expect(screen.getByTestId('warning-badge-RESTRICTED_SOURCE')).toBeDefined()
  })

  it('shows manual override warning', () => {
    const s = makeOkrBackflowSuggestion({
      id: 1,
      status: 'needs_review',
      warnings: [makeManualOverrideWarning()],
    })
    useOkrBackflowSuggestions.mockReturnValue(
      asMock({
        data: { data: [s], meta: { total: 1, page: 1, perPage: 10, totalPages: 1 } },
        isLoading: false,
        error: null,
        isPending: false,
        isError: false,
        isSuccess: true,
        status: 'success',
      }),
    )

    render(<OkrBackflowPanel organizationId={1} canManage={true} />, { wrapper })
    expect(screen.getByTestId('warning-badge-MANUAL_OVERRIDE_CONFLICT')).toBeDefined()
  })

  it('shows stale source warning', () => {
    const s = makeOkrBackflowSuggestion({
      id: 1,
      status: 'needs_review',
      warnings: [makeStaleSourceWarning('project')],
    })
    useOkrBackflowSuggestions.mockReturnValue(
      asMock({
        data: { data: [s], meta: { total: 1, page: 1, perPage: 10, totalPages: 1 } },
        isLoading: false,
        error: null,
        isPending: false,
        isError: false,
        isSuccess: true,
        status: 'success',
      }),
    )

    render(<OkrBackflowPanel organizationId={1} canManage={true} />, { wrapper })
    expect(screen.getByTestId('warning-badge-STALE_SOURCE')).toBeDefined()
  })

  it('shows confirmed state correctly', () => {
    const s = makeOkrBackflowSuggestion({
      id: 1,
      status: 'confirmed',
      actorId: 1,
      actionedAt: new Date().toISOString(),
    })
    useOkrBackflowSuggestions.mockReturnValue(
      asMock({
        data: { data: [s], meta: { total: 1, page: 1, perPage: 10, totalPages: 1 } },
        isLoading: false,
        error: null,
        isPending: false,
        isError: false,
        isSuccess: true,
        status: 'success',
      }),
    )

    render(<OkrBackflowPanel organizationId={1} canManage={true} />, { wrapper })
    expect(screen.getByText(/已由用户 #1 确认/)).toBeDefined()
  })

  it('shows rejected state correctly', () => {
    const s = makeOkrBackflowSuggestion({
      id: 1,
      status: 'rejected',
      reasonCode: 'OTHER',
      reasonNote: '不需要回流',
    })
    useOkrBackflowSuggestions.mockReturnValue(
      asMock({
        data: { data: [s], meta: { total: 1, page: 1, perPage: 10, totalPages: 1 } },
        isLoading: false,
        error: null,
        isPending: false,
        isError: false,
        isSuccess: true,
        status: 'success',
      }),
    )

    render(<OkrBackflowPanel organizationId={1} canManage={true} />, { wrapper })
    expect(screen.getByText(/已拒绝.*OTHER.*不需要回流/)).toBeDefined()
  })

  it('renders source chips for all source kinds', () => {
    const s = makeOkrBackflowSuggestion({
      id: 1,
      status: 'pending',
      contributions: [
        makeOkrBackflowContribution({
          source: makeOkrBackflowSourceRef({ kind: 'project', id: 1, progress: 80 }),
        }),
        makeOkrBackflowContribution({
          source: makeOkrBackflowSourceRef({ kind: 'milestone', id: 2, progress: 60 }),
        }),
        makeOkrBackflowContribution({
          source: makeOkrBackflowSourceRef({ kind: 'task', id: 3, progress: 40 }),
        }),
      ],
    })
    useOkrBackflowSuggestions.mockReturnValue(
      asMock({
        data: { data: [s], meta: { total: 1, page: 1, perPage: 10, totalPages: 1 } },
        isLoading: false,
        error: null,
        isPending: false,
        isError: false,
        isSuccess: true,
        status: 'success',
      }),
    )

    render(<OkrBackflowPanel organizationId={1} canManage={true} />, { wrapper })
    expect(screen.getByTestId('source-chip-project-1')).toBeDefined()
    expect(screen.getByTestId('source-chip-milestone-2')).toBeDefined()
    expect(screen.getByTestId('source-chip-task-3')).toBeDefined()
  })

  it('shows stale freshness indicator', () => {
    const s = makeOkrBackflowSuggestion({
      id: 1,
      status: 'pending',
      freshness: {
        oldestSourceUpdatedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
        newestSourceUpdatedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
        stale: true,
      },
    })
    useOkrBackflowSuggestions.mockReturnValue(
      asMock({
        data: { data: [s], meta: { total: 1, page: 1, perPage: 10, totalPages: 1 } },
        isLoading: false,
        error: null,
        isPending: false,
        isError: false,
        isSuccess: true,
        status: 'success',
      }),
    )

    render(<OkrBackflowPanel organizationId={1} canManage={true} />, { wrapper })
    expect(screen.getByText('数据可能已陈旧')).toBeDefined()
  })
})
